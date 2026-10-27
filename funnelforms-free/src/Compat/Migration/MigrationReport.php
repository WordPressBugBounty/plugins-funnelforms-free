<?php
/**
 * What the migration copied and checked, for the migration page and WP-CLI.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Application\FormRenderer;
use Funnelforms\Application\LeadMirror;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- counts across the 3.x posts and this plugin's tables, fresh on purpose.

/**
 * Accounts for every piece of Funnelforms 3 data: each 3.x post is either copied (and its copy
 * still exists), deliberately not copied (deleted on purpose in Funnelforms 5), failed, or not
 * copied yet (it came in after the last run). Counts only, never what visitors entered.
 */
final class MigrationReport {

	/** Kinds of 3.x data with their table of copies. */
	public const KINDS = array(
		'forms'         => array( LegacyRepository::FORM, 'forms' ),
		'leads'         => array( LegacyRepository::LEAD, 'entries' ),
		'bookings'      => array( LegacyRepository::BOOKING, 'bookings' ),
		'booking_types' => array( LegacyRepository::BOOKING_TYPE, 'booking_types' ),
	);

	/** Files whose existence is looked up on disk at most. */
	private const FILE_LIMIT = 2000;

	/**
	 * Per kind of data: how many 3.x posts there are and what became of each.
	 *
	 * @return array<string,array{legacy:int,copied:int,verified:int,review:int,failed:int,mirror:int,removed:int,pending:int,missing:int,ok:bool}>
	 *         copied: copies that exist; mirror: 3.x leads Funnelforms 5 wrote itself; removed: copies
	 *         deleted on purpose; pending: not copied yet; missing: recorded as copied, but the copy
	 *         is gone.
	 */
	public static function data(): array {
		global $wpdb;
		$items = Schema::table( 'migration_items' );
		$out   = array();
		foreach ( self::KINDS as $kind => $spec ) {
			$row          = (array) $wpdb->get_row(
				$wpdb->prepare(
					"SELECT COUNT(*) AS legacy,
						SUM(m.id IS NULL) AS pending,
						SUM(m.status IN ('verified','needs_review','migrated') AND t.id IS NOT NULL) AS copied,
						SUM(m.status = 'verified') AS verified,
						SUM(m.status = 'needs_review') AS review,
						SUM(m.status = 'failed') AS failed,
						SUM(m.status = %s) AS mirror,
						SUM(m.status = %s) AS removed,
						SUM(m.status IN ('verified','needs_review','migrated') AND t.id IS NULL) AS missing
					FROM {$wpdb->posts} p
					LEFT JOIN %i m ON m.legacy_type = p.post_type AND m.legacy_post_id = p.ID
					LEFT JOIN %i t ON t.id = m.target_id
					WHERE p.post_type = %s AND p.post_status NOT IN ('auto-draft', 'inherit')",
					LeadMirror::STATUS,
					MigrationStore::REMOVED,
					$items,
					Schema::table( $spec[1] ),
					$spec[0]
				),
				ARRAY_A
			);
			$counts       = array_map( 'intval', $row + array_fill_keys( array( 'legacy', 'pending', 'copied', 'verified', 'review', 'failed', 'mirror', 'removed', 'missing' ), 0 ) );
			$counts['ok'] = 0 === $counts['pending'] + $counts['failed'] + $counts['missing'];
			$out[ $kind ] = $counts;
		}
		return $out;
	}

	/**
	 * Files of copied leads: they stay in uploads/af2, and the copy links to them.
	 *
	 * @return array{total:int,found:int,checked:int}
	 */
	public static function files(): array {
		global $wpdb;
		$total = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE path LIKE %s', Schema::table( 'entry_files' ), $wpdb->esc_like( 'af2/' ) . '%' ) );
		$paths = (array) $wpdb->get_col( $wpdb->prepare( 'SELECT path FROM %i WHERE path LIKE %s ORDER BY id ASC LIMIT %d', Schema::table( 'entry_files' ), $wpdb->esc_like( 'af2/' ) . '%', self::FILE_LIMIT ) );
		$base  = trailingslashit( wp_upload_dir( null, false )['basedir'] );
		$found = 0;
		foreach ( $paths as $path ) {
			$found += ! str_contains( (string) $path, '..' ) && is_file( $base . $path ) ? 1 : 0;
		}
		return array(
			'total'   => $total,
			'found'   => $found,
			'checked' => count( $paths ),
		);
	}

	/**
	 * Entries that came in on Funnelforms 5, on imported forms and on forms made in Funnelforms 5,
	 * and how many of them are also in the Funnelforms 3 lead list.
	 *
	 * @return array{imported_forms:int,own_forms:int,mirrored:int}
	 */
	public static function new_entries(): array {
		global $wpdb;
		$row = (array) $wpdb->get_row(
			$wpdb->prepare(
				'SELECT SUM(f.legacy_post_id IS NOT NULL) AS imported_forms, SUM(f.legacy_post_id IS NULL) AS own_forms, SUM(m.status = %s) AS mirrored
				FROM %i e
				LEFT JOIN %i m ON m.legacy_type = %s AND m.legacy_post_id = e.legacy_post_id
				LEFT JOIN %i f ON f.id = e.form_id
				WHERE e.legacy_post_id IS NULL OR m.status = %s',
				LeadMirror::STATUS,
				Schema::table( 'entries' ),
				Schema::table( 'migration_items' ),
				LegacyRepository::LEAD,
				Schema::table( 'forms' ),
				LeadMirror::STATUS
			),
			ARRAY_A
		);
		return array(
			'imported_forms' => (int) ( $row['imported_forms'] ?? 0 ),
			'own_forms'      => (int) ( $row['own_forms'] ?? 0 ),
			'mirrored'       => (int) ( $row['mirrored'] ?? 0 ),
		);
	}

	/**
	 * Entries of forms by where they came from.
	 *
	 * @param int[] $form_ids Form IDs.
	 * @return array<int,array{from3:int,new:int,mirrored:int}> from3: copied from Funnelforms 3; new:
	 *         came in on Funnelforms 5; mirrored: of those, also in the Funnelforms 3 lead list.
	 */
	public static function entries_by_form( array $form_ids ): array {
		global $wpdb;
		$form_ids = array_values( array_unique( array_filter( array_map( 'intval', $form_ids ) ) ) );
		$out      = array_fill_keys(
			$form_ids,
			array(
				'from3'    => 0,
				'new'      => 0,
				'mirrored' => 0,
			)
		);
		if ( array() === $form_ids ) {
			return $out;
		}
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT e.form_id, SUM(m.status IS NOT NULL AND m.status <> %s) AS from3, SUM(e.legacy_post_id IS NULL OR m.status = %s) AS new_, SUM(m.status = %s) AS mirrored
				FROM %i e LEFT JOIN %i m ON m.legacy_type = %s AND m.legacy_post_id = e.legacy_post_id
				WHERE e.form_id IN (' . implode( ', ', array_fill( 0, count( $form_ids ), '%d' ) ) . ') GROUP BY e.form_id', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- placeholders only.
				array_merge( array( LeadMirror::STATUS, LeadMirror::STATUS, LeadMirror::STATUS, Schema::table( 'entries' ), Schema::table( 'migration_items' ), LegacyRepository::LEAD ), $form_ids )
			),
			ARRAY_A
		);
		foreach ( $rows as $row ) {
			$out[ (int) $row['form_id'] ] = array(
				'from3'    => (int) $row['from3'],
				'new'      => (int) $row['new_'],
				'mirrored' => (int) $row['mirrored'],
			);
		}
		return $out;
	}

	/**
	 * Every form from Funnelforms 3 with its check, where it runs and what keeps it on 3.
	 *
	 * @return list<array{id:int,legacy_id:int,title:string,check:string,renderer:string,status:string,blockers:string[],checks:array<string,array{status:string,details:string[]}>,notes:string[],migrated_at:string,entries:array{from3:int,new:int,mirrored:int},in_3x:bool,state:string,pinned:bool,auto:bool}>
	 *         check: verified, needs_review, failed or edited (changed in the Funnelforms 5 builder).
	 *         state: see state(); pinned: kept on Funnelforms 3 by hand; auto: moved by AutoRenderer.
	 */
	public static function forms(): array {
		$store     = new MigrationStore( SecretBox::for_site() );
		$forms     = new FormRepository();
		$renderers = new FormRenderer( $forms, $store );
		$in_3x     = ( new LegacyRepository() )->all_ids( LegacyRepository::FORM );
		$rows      = array();
		$seen      = array();
		foreach ( $store->items( LegacyRepository::FORM, 5000 ) as $item ) {
			$seen[ (int) $item['legacy_post_id'] ] = true;
			$rows[]                                = array(
				'item' => $item,
				'form' => null === $item['target_id'] ? null : $forms->by_id( (int) $item['target_id'] ),
			);
		}
		// Forms that carry a 3.x ID without a record (made by hand or by an old version).
		foreach ( $forms->with_legacy_ids() as $row ) {
			if ( ! isset( $seen[ (int) $row['legacy_post_id'] ] ) ) {
				$rows[] = array(
					'item' => null,
					'form' => $forms->by_id( (int) $row['id'] ),
				);
			}
		}
		$pinned  = AutoRenderer::pinned();
		$auto    = AutoRenderer::forms();
		$entries = self::entries_by_form( array_map( static fn( array $r ): int => (int) ( $r['form']['id'] ?? 0 ), $rows ) );
		$out     = array();
		foreach ( $rows as $row ) {
			$form = $row['form'];
			$item = $row['item'];
			if ( null !== $form && 'trashed' === ( $form['status'] ?? '' ) ) {
				continue;
			}
			$legacy_id = (int) ( $item['legacy_post_id'] ?? $form['legacy_post_id'] ?? 0 );
			$check     = (string) ( $item['status'] ?? FormVerifier::FAILED );
			if ( null !== $form && $forms->edited( $form ) ) {
				$check = 'edited';
			} elseif ( ! in_array( $check, array( FormVerifier::VERIFIED, FormVerifier::NEEDS_REVIEW ), true ) ) {
				$check = FormVerifier::FAILED;
			}
			$on_v5    = null !== $form && FormRepository::RENDERER_V5 === $form['renderer'];
			$blockers = null === $form ? array( 'no_document' ) : ( $on_v5 ? array() : array_values( array_diff( $renderers->blockers( $form ), array( 'rollback_active' ) ) ) );
			$checks   = null === $item ? array() : (array) json_decode( (string) $item['checks'], true );
			$state    = self::state( $on_v5, $blockers );
			$out[]    = array(
				'id'          => (int) ( $form['id'] ?? 0 ),
				'legacy_id'   => $legacy_id,
				'title'       => (string) ( $form['title'] ?? $item['title'] ?? '' ),
				'check'       => $check,
				'renderer'    => null === $form ? '' : (string) $form['renderer'],
				'status'      => (string) ( $form['status'] ?? '' ),
				'blockers'    => $blockers,
				'checks'      => array_filter( $checks, 'is_array' ),
				'notes'       => null === $item ? array() : array_map( 'strval', (array) json_decode( (string) $item['notes'], true ) ),
				'migrated_at' => (string) ( $item['migrated_at'] ?? '' ),
				'entries'     => $entries[ (int) ( $form['id'] ?? 0 ) ] ?? array(
					'from3'    => 0,
					'new'      => 0,
					'mirrored' => 0,
				),
				'in_3x'       => isset( $in_3x[ $legacy_id ] ),
				'state'       => $state,
				'pinned'      => null !== $form && in_array( (int) $form['id'], $pinned, true ),
				'auto'        => null !== $form && in_array( (int) $form['id'], $auto, true ),
			);
		}
		usort(
			$out,
			static function ( array $a, array $b ): int {
				$order = array(
					'stays'  => 0,
					'review' => 1,
					'ready'  => 2,
					'v5'     => 3,
				);
				return array( $order[ $a['state'] ], strtolower( $a['title'] ), $a['legacy_id'] ) <=> array( $order[ $b['state'] ], strtolower( $b['title'] ), $b['legacy_id'] );
			}
		);
		return $out;
	}

	/**
	 * Where a form stands: v5 (runs on Funnelforms 5), ready (checked, can move), review (the
	 * comparison found differences someone has to look at before it can move) or stays (something
	 * else keeps it on Funnelforms 3).
	 *
	 * @param bool     $on_v5    Whether the form runs on Funnelforms 5.
	 * @param string[] $blockers FormRenderer::blockers() without rollback_active.
	 */
	public static function state( bool $on_v5, array $blockers ): string {
		if ( $on_v5 ) {
			return 'v5';
		}
		if ( in_array( 'needs_review', $blockers, true ) ) {
			return 'review';
		}
		return array() === $blockers ? 'ready' : 'stays';
	}

	/**
	 * One form of forms() by its form ID, or by its 3.x ID when it was not copied.
	 *
	 * @param int $form_id   Form ID (0 when looking up by 3.x ID).
	 * @param int $legacy_id 3.x form ID.
	 * @return array<string,mixed>|null
	 */
	public static function form( int $form_id, int $legacy_id = 0 ): ?array {
		foreach ( self::forms() as $form ) {
			if ( ( $form_id > 0 && $form['id'] === $form_id ) || ( 0 === $form_id && $legacy_id > 0 && $form['legacy_id'] === $legacy_id ) ) {
				return $form;
			}
		}
		return null;
	}
}
