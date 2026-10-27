<?php
/**
 * The stages of the lead pipeline: the columns of the entries board and the lead status of an entry.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

/**
 * A stage is a key (stored in the column lead_status of each entry), a name and a colour. Until
 * the site changes them, the stages are those of 5.0: New, Contacted, Won and Lost, named in the
 * reader's language. The site renames, adds, orders and deletes stages; the board belongs to the
 * site (all forms), so the stages do too, in one option that is not autoloaded.
 *
 * Keys never change, so entries keep their stage when a stage is renamed or moved. A deleted
 * stage hands its entries to another one in the same step. "new" is the stage new entries land
 * in (the column's default), so it can be renamed and moved but not deleted; "won" gives the key
 * figure "Won" of the entries page while it exists.
 */
final class LeadStages {

	public const OPTION = 'funnelforms_lead_stages';

	/** Most stages per site. */
	public const MAX = 12;

	/** Longest name. */
	public const MAX_NAME = 40;

	/** The stage new entries land in. */
	public const INBOX = 'new';

	/** Colours a stage can have, the tones of the plugin's badges. */
	public const TONES = array( 'info', 'warning', 'success', 'neutral', 'danger' );

	/** What a key looks like; it fits the column lead_status (varchar 20). */
	public const KEY_PATTERN = '^[a-z0-9_]{1,20}$';

	/**
	 * The stages of 5.0, with an empty name (the standard name, translated when read).
	 *
	 * @return array<int,array{key:string,name:string,tone:string}>
	 */
	public static function defaults(): array {
		return array(
			array(
				'key'  => 'new',
				'name' => '',
				'tone' => 'info',
			),
			array(
				'key'  => 'contacted',
				'name' => '',
				'tone' => 'warning',
			),
			array(
				'key'  => 'won',
				'name' => '',
				'tone' => 'success',
			),
			array(
				'key'  => 'lost',
				'name' => '',
				'tone' => 'neutral',
			),
		);
	}

	/**
	 * Standard name of a stage of 5.0, in the current language; empty for other keys.
	 *
	 * @param string $key Stage key.
	 */
	public static function standard_name( string $key ): string {
		switch ( $key ) {
			case 'new':
				return __( 'New', 'funnelforms-free' );
			case 'contacted':
				return __( 'Contacted', 'funnelforms-free' );
			case 'won':
				return __( 'Won', 'funnelforms-free' );
			case 'lost':
				return __( 'Lost', 'funnelforms-free' );
		}
		return '';
	}

	/**
	 * The stages in their order, as stored (name empty: the standard name).
	 *
	 * @return array<int,array{key:string,name:string,tone:string}>
	 */
	public static function stored(): array {
		$stored = get_option( self::OPTION, null );
		if ( ! is_array( $stored ) ) {
			return self::defaults();
		}
		$stages = self::clean( $stored );
		return array() === $stages ? self::defaults() : $stages;
	}

	/**
	 * The stages in their order with their names to show: key, name, tone, whether the name is
	 * the standard one, and whether it can be deleted.
	 *
	 * @return array<int,array{key:string,name:string,tone:string,standard:bool,locked:bool}>
	 */
	public static function all(): array {
		return array_map(
			static fn( array $stage ): array => array(
				'key'      => $stage['key'],
				'name'     => '' === $stage['name'] ? self::fallback_name( $stage['key'] ) : $stage['name'],
				'tone'     => $stage['tone'],
				'standard' => '' === $stage['name'],
				'locked'   => self::INBOX === $stage['key'],
			),
			self::stored()
		);
	}

	/**
	 * Keys of the stages, in their order.
	 *
	 * @return string[]
	 */
	public static function keys(): array {
		return array_column( self::stored(), 'key' );
	}

	/**
	 * Whether a stage with this key exists.
	 *
	 * @param mixed $key Stage key.
	 */
	public static function exists( $key ): bool {
		return is_string( $key ) && in_array( $key, self::keys(), true );
	}

	/**
	 * Name of a stage; an unknown key (a stage deleted outside the plugin) stays as it is.
	 *
	 * @param string $key Stage key.
	 */
	public static function name( string $key ): string {
		foreach ( self::stored() as $stage ) {
			if ( $stage['key'] === $key ) {
				return '' === $stage['name'] ? self::fallback_name( $key ) : $stage['name'];
			}
		}
		return $key;
	}

	/**
	 * Entries per stage key (every entry, archived and spam too: a stage that is deleted takes
	 * them all along).
	 *
	 * @return array<string,int>
	 */
	public static function counts(): array {
		global $wpdb;
		$counts = array_fill_keys( self::keys(), 0 );
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT lead_status, COUNT(*) AS n FROM %i GROUP BY lead_status', Schema::table( 'entries' ) ), ARRAY_A ) as $row ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- counts of this plugin's table, fresh on purpose.
			if ( isset( $counts[ $row['lead_status'] ] ) ) {
				$counts[ $row['lead_status'] ] = (int) $row['n'];
			}
		}
		return $counts;
	}

	/**
	 * Saves the stages: the whole list in its new order. A stage without a known key is new and
	 * gets one; a stage left out is deleted, and its entries move to the stage moveTo names.
	 *
	 * @param mixed $stages  Stages: key (optional for new ones), name, tone.
	 * @param mixed $move_to Old key => key of a stage of the new list, for every deleted stage that has entries.
	 * @return array{ok:bool,code?:string,stage?:string,moved?:int} moved: entries that changed stage.
	 */
	public static function save( $stages, $move_to = array() ): array {
		if ( ! is_array( $stages ) || array() === $stages ) {
			return array(
				'ok'   => false,
				'code' => 'no_stages',
			);
		}
		if ( count( $stages ) > self::MAX ) {
			return array(
				'ok'   => false,
				'code' => 'too_many_stages',
			);
		}
		$old  = self::keys();
		$next = array();
		$used = array();
		foreach ( array_values( $stages ) as $item ) {
			$item = is_array( $item ) ? $item : array();
			$name = self::clean_name( $item['name'] ?? '' );
			$key  = is_string( $item['key'] ?? null ) ? $item['key'] : '';
			if ( '' === $name ) {
				return array(
					'ok'    => false,
					'code'  => 'empty_name',
					'stage' => $key,
				);
			}
			if ( '' === $key || ! preg_match( '/' . self::KEY_PATTERN . '/', $key ) ) {
				$key = self::new_key( array_merge( $old, $used ) );
			}
			if ( isset( $used[ $key ] ) ) {
				return array(
					'ok'    => false,
					'code'  => 'duplicate_stage',
					'stage' => $key,
				);
			}
			$used[ $key ] = $key;
			// The standard name in the language of the one who saves stays the standard name, so
			// readers in other languages keep theirs.
			$standard = self::standard_name( $key );
			$next[]   = array(
				'key'  => $key,
				'name' => '' !== $standard && $name === $standard ? '' : $name,
				'tone' => in_array( $item['tone'] ?? null, self::TONES, true ) ? (string) $item['tone'] : 'neutral',
			);
		}
		if ( ! isset( $used[ self::INBOX ] ) ) {
			return array(
				'ok'    => false,
				'code'  => 'stage_locked',
				'stage' => self::INBOX,
			);
		}
		$move_to = is_array( $move_to ) ? $move_to : array();
		$counts  = self::counts();
		$moves   = array();
		foreach ( array_diff( $old, array_keys( $used ) ) as $gone ) {
			$target = $move_to[ $gone ] ?? null;
			if ( is_string( $target ) && isset( $used[ $target ] ) ) {
				$moves[ $gone ] = $target;
			} elseif ( ( $counts[ $gone ] ?? 0 ) > 0 ) {
				return array(
					'ok'    => false,
					'code'  => 'stage_has_entries',
					'stage' => $gone,
				);
			}
		}
		global $wpdb;
		$moved = 0;
		foreach ( $moves as $from => $to ) {
			$moved += (int) $wpdb->update( Schema::table( 'entries' ), array( 'lead_status' => $to ), array( 'lead_status' => $from ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- one statement for all entries of the stage.
		}
		// The stages of 5.0 as they were need no option.
		if ( self::defaults() === $next ) {
			delete_option( self::OPTION );
		} else {
			update_option( self::OPTION, $next, false );
		}
		return array(
			'ok'    => true,
			'moved' => $moved,
		);
	}

	/**
	 * Name shown for a stage without a name of its own.
	 *
	 * @param string $key Stage key.
	 */
	private static function fallback_name( string $key ): string {
		$standard = self::standard_name( $key );
		return '' === $standard ? $key : $standard;
	}

	/**
	 * Stored stages as they may be: known tones, valid unique keys, short names, at most MAX.
	 *
	 * @param array<mixed> $stored Option value.
	 * @return array<int,array{key:string,name:string,tone:string}>
	 */
	private static function clean( array $stored ): array {
		$out  = array();
		$seen = array();
		foreach ( $stored as $item ) {
			$key = is_array( $item ) && is_string( $item['key'] ?? null ) ? $item['key'] : '';
			if ( ! preg_match( '/' . self::KEY_PATTERN . '/', $key ) || isset( $seen[ $key ] ) ) {
				continue;
			}
			$seen[ $key ] = true;
			$out[]        = array(
				'key'  => $key,
				'name' => self::clean_name( $item['name'] ?? '' ),
				'tone' => in_array( $item['tone'] ?? null, self::TONES, true ) ? (string) $item['tone'] : 'neutral',
			);
		}
		return array_slice( $out, 0, self::MAX );
	}

	/**
	 * A name as stored: one line of plain text, at most MAX_NAME characters.
	 *
	 * @param mixed $name Name.
	 */
	private static function clean_name( $name ): string {
		$name = is_string( $name ) ? trim( sanitize_text_field( $name ) ) : '';
		return function_exists( 'mb_substr' ) ? mb_substr( $name, 0, self::MAX_NAME ) : substr( $name, 0, self::MAX_NAME );
	}

	/**
	 * A key no stage has had in this list.
	 *
	 * @param string[] $taken Keys in use.
	 */
	private static function new_key( array $taken ): string {
		do {
			$key = 'stage_' . strtolower( wp_generate_password( 6, false, false ) );
		} while ( in_array( $key, $taken, true ) );
		return $key;
	}
}
