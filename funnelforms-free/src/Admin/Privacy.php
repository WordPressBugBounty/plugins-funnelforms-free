<?php
/**
 * Entries in the WordPress privacy tools (export and erase personal data).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\LeadMirror;
use Funnelforms\Compat\Legacy\LegacyCodec;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\EntryRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- tables of this plugin and 3.x leads, read for one request.

/**
 * Finds the entries whose contact data holds the e-mail address of the request (any contact
 * field, compared without case). Erasing deletes them like the retention job does, including
 * bookings that have not happened yet. Saved progress and 3.x leads with the address (also those
 * not imported yet) are exported and erased too; an erased 3.x lead goes with its uploads and a
 * restore of Funnelforms 3 leaves it out.
 */
final class Privacy {

	private const PAGE  = 50;
	private const GROUP = 'funnelforms-entries';

	/**
	 * Registers exporter and eraser.
	 */
	public static function register(): void {
		add_filter( 'wp_privacy_personal_data_exporters', array( self::class, 'add_exporter' ) );
		add_filter( 'wp_privacy_personal_data_erasers', array( self::class, 'add_eraser' ) );
	}

	/**
	 * Adds the exporter.
	 *
	 * @param array<string,mixed> $exporters Exporters.
	 * @return array<string,mixed>
	 */
	public static function add_exporter( $exporters ): array {
		$exporters                = (array) $exporters;
		$exporters['funnelforms'] = array(
			'exporter_friendly_name' => __( 'Funnelforms entries', 'funnelforms-free' ),
			'callback'               => array( self::class, 'export' ),
		);
		return $exporters;
	}

	/**
	 * Adds the eraser.
	 *
	 * @param array<string,mixed> $erasers Erasers.
	 * @return array<string,mixed>
	 */
	public static function add_eraser( $erasers ): array {
		$erasers                = (array) $erasers;
		$erasers['funnelforms'] = array(
			'eraser_friendly_name' => __( 'Funnelforms entries', 'funnelforms-free' ),
			'callback'             => array( self::class, 'erase' ),
		);
		return $erasers;
	}

	/**
	 * One page of the export.
	 *
	 * @param string $email E-mail address.
	 * @param int    $page  Page, from 1.
	 * @return array{data:array<int,array<string,mixed>>,done:bool}
	 */
	public static function export( $email, $page = 1 ): array {
		$page    = max( 1, (int) $page );
		$found   = ( new EntryRepository() )->with_contact_value( (string) $email, self::PAGE * $page );
		$entries = array_slice( $found, self::PAGE * ( $page - 1 ) );
		$forms   = new FormRepository();
		$data    = array();
		foreach ( $entries as $entry ) {
			$form   = null === $entry['form_id'] ? null : $forms->by_id( (int) $entry['form_id'] );
			$data[] = array(
				'group_id'    => self::GROUP,
				'group_label' => __( 'Form entries', 'funnelforms-free' ),
				'item_id'     => 'funnelforms-entry-' . $entry['uid'],
				'data'        => self::items( $entry, null === $form ? '' : (string) $form['title'] ),
			);
		}
		$done = count( $found ) < self::PAGE * $page;
		// The rest comes with the last page of entries, once.
		if ( $done && intdiv( count( $found ), self::PAGE ) + 1 === $page ) {
			foreach ( self::progress( (string) $email ) as $row ) {
				$form   = $forms->by_id( (int) $row['form_id'] );
				$data[] = array(
					'group_id'    => 'funnelforms-saved',
					'group_label' => __( 'Saved form progress', 'funnelforms-free' ),
					'item_id'     => 'funnelforms-saved-' . $row['id'],
					'data'        => array_merge(
						array(
							array(
								'name'  => __( 'Form', 'funnelforms-free' ),
								'value' => null === $form ? '' : (string) $form['title'],
							),
							array(
								'name'  => __( 'Saved (UTC)', 'funnelforms-free' ),
								'value' => (string) $row['updated_at'],
							),
						),
						self::pairs( $row['answers'] )
					),
				);
			}
			foreach ( self::legacy_leads( (string) $email, true ) as $id => $content ) {
				$data[] = array(
					'group_id'    => 'funnelforms-legacy',
					'group_label' => __( 'Funnelforms 3 leads', 'funnelforms-free' ),
					'item_id'     => 'funnelforms-legacy-' . $id,
					'data'        => self::pairs( $content ),
				);
			}
		}
		return array(
			'data' => $data,
			'done' => $done,
		);
	}

	/**
	 * Saved progress whose answers hold the address (Funnelforms Pro), at most 100.
	 *
	 * @param string $email E-mail address.
	 * @return list<array{id:int,form_id:int,updated_at:string,answers:array<string,mixed>}>
	 */
	private static function progress( string $email ): array {
		global $wpdb;
		$email = strtolower( trim( $email ) );
		if ( '' === $email ) {
			return array();
		}
		$rows  = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, form_id, updated_at, answers FROM %i WHERE answers LIKE %s ORDER BY id LIMIT 100', Schema::table( 'saved_progress' ), '%' . $wpdb->esc_like( $email ) . '%' ), ARRAY_A );
		$found = array();
		foreach ( $rows as $row ) {
			$answers = json_decode( (string) $row['answers'], true );
			if ( is_array( $answers ) && self::holds( $answers, $email ) ) {
				$found[] = array(
					'id'         => (int) $row['id'],
					'form_id'    => (int) $row['form_id'],
					'updated_at' => (string) $row['updated_at'],
					'answers'    => $answers,
				);
			}
		}
		return $found;
	}

	/**
	 * 3.x leads whose data holds the address, at most 100: their content by post ID.
	 *
	 * @param string $email        E-mail address.
	 * @param bool   $not_imported Only leads without an entry (whose data the entries do not hold).
	 * @return array<int,array<mixed>>
	 */
	private static function legacy_leads( string $email, bool $not_imported ): array {
		global $wpdb;
		$email = strtolower( trim( $email ) );
		if ( '' === $email ) {
			return array();
		}
		// 3.x stored leads as urlencode(serialize()), later imports as JSON.
		$ids   = (array) $wpdb->get_col( $wpdb->prepare( 'SELECT ID FROM %i WHERE post_type = %s AND ( post_content LIKE %s OR post_content LIKE %s ) ORDER BY ID LIMIT 100', $wpdb->posts, LegacyRepository::LEAD, '%' . $wpdb->esc_like( $email ) . '%', '%' . $wpdb->esc_like( rawurlencode( $email ) ) . '%' ) );
		$codec = new LegacyCodec();
		$found = array();
		foreach ( array_map( 'intval', $ids ) as $id ) {
			if ( $not_imported && null !== $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_post_id = %d', Schema::table( 'entries' ), $id ) ) ) {
				continue;
			}
			$content = $codec->decode( (string) get_post_field( 'post_content', $id, 'raw' ) );
			if ( is_array( $content ) && self::holds( $content, $email ) ) {
				$found[ $id ] = $content;
			}
		}
		return $found;
	}

	/**
	 * Whether a value anywhere in the data is the address.
	 *
	 * @param array<mixed> $data  Data.
	 * @param string       $email Lower-case address.
	 */
	private static function holds( array $data, string $email ): bool {
		foreach ( $data as $value ) {
			if ( is_array( $value ) ? self::holds( $value, $email ) : ( is_scalar( $value ) && strtolower( trim( (string) $value ) ) === $email ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Name/value pairs of nested data, named by their keys.
	 *
	 * @param array<mixed> $data   Data.
	 * @param string       $prefix Name so far.
	 * @return array<int,array{name:string,value:string}>
	 */
	private static function pairs( array $data, string $prefix = '' ): array {
		$items = array();
		foreach ( $data as $key => $value ) {
			$name = '' === $prefix ? (string) $key : $prefix . ' › ' . $key;
			if ( is_array( $value ) ) {
				$items = array_merge( $items, self::pairs( $value, $name ) );
			} elseif ( '' !== self::text( $value ) ) {
				$items[] = array(
					'name'  => $name,
					'value' => self::text( $value ),
				);
			}
		}
		return $items;
	}

	/**
	 * Name/value pairs of an entry.
	 *
	 * @param array<string,mixed> $entry Entry with decoded data.
	 * @param string              $form  Form title.
	 * @return array<int,array{name:string,value:string}>
	 */
	private static function items( array $entry, string $form ): array {
		$items = array(
			array(
				'name'  => __( 'Form', 'funnelforms-free' ),
				'value' => $form,
			),
			array(
				'name'  => __( 'Submitted (UTC)', 'funnelforms-free' ),
				'value' => (string) $entry['created_at'],
			),
			array(
				'name'  => __( 'Page', 'funnelforms-free' ),
				'value' => (string) ( $entry['source_url'] ?? '' ),
			),
		);
		$data  = (array) $entry['data'];
		foreach ( array_merge( (array) ( $data['contact'] ?? array() ), (array) ( $data['answers'] ?? array() ) ) as $field ) {
			if ( is_array( $field ) ) {
				$items[] = array(
					'name'  => (string) ( $field['label'] ?? '' ),
					'value' => self::text( $field['value'] ?? '' ),
				);
			}
		}
		foreach ( (array) ( $data['calculations'] ?? array() ) as $calc ) {
			if ( is_array( $calc ) ) {
				$items[] = array(
					'name'  => (string) ( $calc['title'] ?? '' ),
					'value' => self::text( $calc['formatted'] ?? $calc['value'] ?? '' ),
				);
			}
		}
		foreach ( (array) ( $entry['consent'] ?? array() ) as $consent ) {
			if ( is_array( $consent ) ) {
				$items[] = array(
					'name'  => __( 'Consent', 'funnelforms-free' ),
					'value' => self::text( $consent['text'] ?? '' ) . ' (' . ( empty( $consent['checked'] ) ? __( 'no', 'funnelforms-free' ) : __( 'yes', 'funnelforms-free' ) ) . ')',
				);
			}
		}
		foreach ( (array) ( $entry['utm'] ?? array() ) as $key => $value ) {
			$items[] = array(
				'name'  => (string) $key,
				'value' => self::text( $value ),
			);
		}
		$tags = EntryRepository::entry_tags( $entry );
		if ( array() !== $tags ) {
			$items[] = array(
				'name'  => __( 'Tags', 'funnelforms-free' ),
				'value' => implode( ', ', $tags ),
			);
		}
		$meta = is_array( $entry['meta'] ?? null ) ? $entry['meta'] : array();
		foreach ( array(
			'device'  => __( 'Device', 'funnelforms-free' ),
			'browser' => __( 'Browser', 'funnelforms-free' ),
			'os'      => __( 'Operating system', 'funnelforms-free' ),
		) as $key => $label ) {
			$items[] = array(
				'name'  => $label,
				'value' => self::text( $meta['visit'][ $key ] ?? '' ),
			);
		}
		// Kept for conversion tracking with marketing consent: IP address, browser, click IDs.
		foreach ( (array) ( $meta['tracking'] ?? array() ) as $key => $value ) {
			if ( '' !== self::text( $value ) ) {
				$items[] = array(
					'name'  => 'ip' === $key ? __( 'IP address', 'funnelforms-free' ) : (string) $key,
					'value' => self::text( $value ),
				);
			}
		}
		global $wpdb;
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT starts_at, ends_at, timezone, status FROM %i WHERE entry_id = %d ORDER BY id', Schema::table( 'bookings' ), (int) $entry['id'] ), ARRAY_A ) as $booking ) {
			$items[] = array(
				'name'  => __( 'Appointment', 'funnelforms-free' ),
				'value' => $booking['starts_at'] . ' – ' . $booking['ends_at'] . ' UTC (' . $booking['timezone'] . ', ' . $booking['status'] . ')',
			);
		}
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT original_name, mime_type, size FROM %i WHERE entry_id = %d ORDER BY id', Schema::table( 'entry_files' ), (int) $entry['id'] ), ARRAY_A ) as $file ) {
			$items[] = array(
				'name'  => __( 'Uploaded file', 'funnelforms-free' ),
				'value' => $file['original_name'] . ' (' . $file['mime_type'] . ', ' . size_format( (int) $file['size'] ) . ')',
			);
		}
		// Internal notes are data about the person too; their authors are not.
		foreach ( ( new EntryRepository() )->notes( (int) $entry['id'] ) as $note ) {
			$items[] = array(
				'name'  => __( 'Note', 'funnelforms-free' ),
				'value' => (string) $note['note'],
			);
		}
		return array_values( array_filter( $items, static fn( array $item ): bool => '' !== $item['name'] || '' !== $item['value'] ) );
	}

	/**
	 * A stored value as text.
	 *
	 * @param mixed $value Value.
	 */
	private static function text( $value ): string {
		if ( is_array( $value ) ) {
			return implode( ', ', array_map( array( self::class, 'text' ), $value ) );
		}
		if ( is_bool( $value ) ) {
			return $value ? __( 'yes', 'funnelforms-free' ) : __( 'no', 'funnelforms-free' );
		}
		return is_scalar( $value ) ? (string) $value : '';
	}

	/**
	 * Erases one batch.
	 *
	 * @param string $email E-mail address.
	 * @param int    $page  Page (unused: erased entries no longer match).
	 * @return array{items_removed:bool,items_retained:bool,messages:string[],done:bool}
	 */
	public static function erase( $email, $page = 1 ): array {
		unset( $page );
		$repository = new EntryRepository();
		$entries    = $repository->with_contact_value( (string) $email, self::PAGE );
		$legacy     = 0;
		$store      = new MigrationStore( SecretBox::for_site() );
		foreach ( $entries as $entry ) {
			$repository->delete( (int) $entry['id'] );
			if ( null !== $entry['legacy_post_id'] ) {
				LeadMirror::entry_deleted( (int) $entry['legacy_post_id'], 'privacy_erasure' );
				++$legacy;
			}
		}
		$done  = count( $entries ) < self::PAGE;
		$other = 0;
		if ( $done ) {
			global $wpdb;
			foreach ( self::progress( (string) $email ) as $row ) {
				$wpdb->delete( Schema::table( 'saved_progress' ), array( 'id' => $row['id'] ) );
				++$other;
			}
			foreach ( array_keys( self::legacy_leads( (string) $email, false ) ) as $id ) {
				$store->mark_removed( $id, 'privacy_erasure' );
				LeadMirror::erase( $id );
				++$legacy;
				++$other;
			}
		}
		if ( array() !== $entries || $other > 0 ) {
			$store->audit( 'entries_erased', 'privacy_request', '', array( 'count' => count( $entries ) + $other ) );
		}
		$messages = array();
		if ( $legacy > 0 && array() !== LegacyBackup::all() ) {
			// Free has no screen for restore points; they are deleted 30 days after the move.
			$messages[] = Edition::is_free()
				? __( 'Restore points of Funnelforms 3 still hold the erased leads until they are deleted on their own, 30 days after the move to Funnelforms 5. They are never restored.', 'funnelforms-free' )
				: __( 'Restore points of Funnelforms 3 still hold the erased leads until they are deleted under Settings → Backup and way back. A restore leaves them out.', 'funnelforms-free' );
		}
		return array(
			'items_removed'  => array() !== $entries || $other > 0,
			'items_retained' => false,
			'messages'       => $messages,
			'done'           => $done,
		);
	}
}
