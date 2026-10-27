<?php
/**
 * Writes entries of the new renderer as 3.x leads.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Compat\Migration\Migrator;
use Funnelforms\Domain\Entry\LegacyLead;
use Funnelforms\Domain\Entry\Submission;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom tables of this plugin.

/**
 * Until 5.0 has its own lead list and API, the 3.x lead list, the dashboard, the mobile app,
 * Zapier, Make and the 3.x auto delete read leads only from af2_request posts. So every complete
 * entry of a migrated form on the new renderer is also stored as such a post, in the format 3.x
 * wrote (frontend.php: urlencode(serialize(zapier_json)), status "privat").
 *
 * The post and the entry are linked through ffx_entries.legacy_post_id and a migration item with
 * status "mirror", which the migration never imports. Deleting the post in 3.x deletes the entry
 * on the next delta run, as for imported leads; deleting the entry (retention, privacy request)
 * deletes the post too, because the plugin wrote it.
 */
final class LeadMirror {

	public const STATUS = 'mirror';

	/** IDs of 3.x leads erased on a privacy request (a restore leaves them out). */
	public const ERASED = 'funnelforms_erased_leads';

	/**
	 * Whether entries are written as 3.x leads.
	 */
	public static function enabled(): bool {
		/**
		 * Whether entries of migrated forms on the new renderer are also stored as 3.x leads, so the
		 * 3.x lead list, the app, Zapier and Make keep seeing them.
		 *
		 * @param bool $enabled Default true.
		 */
		return (bool) apply_filters( 'funnelforms_mirror_legacy_leads', true );
	}

	/**
	 * Stores the 3.x lead of a complete entry.
	 *
	 * @param int        $entry_id Entry ID.
	 * @param Submission $s        Submission with entry_id and files set.
	 * @return int Post ID, 0 when none was written.
	 */
	public static function write( int $entry_id, Submission $s ): int {
		global $wpdb;
		if ( ! self::enabled() || null === ( $s->document->raw()['meta']['legacy']['formId'] ?? null ) ) {
			return 0;
		}
		$post_id = wp_insert_post(
			array(
				'post_type'     => LegacyRepository::LEAD,
				'post_status'   => 'privat',
				'post_content'  => urlencode( serialize( LegacyLead::zapier_json( $s ) ) ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize, WordPress.PHP.DiscouragedPHPFunctions.urlencode_urlencode -- storage format of 3.x leads.
				'post_date_gmt' => $s->created_at,
				'post_date'     => get_date_from_gmt( $s->created_at ),
			),
			true
		);
		if ( is_wp_error( $post_id ) || 0 === (int) $post_id ) {
			return 0;
		}
		$post_id = (int) $post_id;
		$wpdb->update( Schema::table( 'entries' ), array( 'legacy_post_id' => $post_id ), array( 'id' => $entry_id ) );
		( new MigrationStore( SecretBox::for_site() ) )->record( LegacyRepository::LEAD, $post_id, 'entry', $entry_id, self::STATUS, Migrator::VERSION, '', array(), array() );
		return $post_id;
	}

	/**
	 * After an entry was deleted on purpose: deletes the 3.x lead the plugin wrote for it, or marks
	 * an imported lead so the migration does not import it again (the 3.x data stays untouched).
	 *
	 * @param int    $legacy_post_id 3.x lead ID of the entry.
	 * @param string $reason         retention or privacy_erasure (deletes an imported lead too).
	 * @return bool Whether a 3.x lead is left behind.
	 */
	public static function entry_deleted( int $legacy_post_id, string $reason ): bool {
		$store = new MigrationStore( SecretBox::for_site() );
		if ( self::STATUS === ( $store->item( LegacyRepository::LEAD, $legacy_post_id )['status'] ?? '' ) ) {
			if ( LegacyRepository::LEAD === get_post_type( $legacy_post_id ) ) {
				wp_delete_post( $legacy_post_id, true );
			}
			$store->forget( LegacyRepository::LEAD, $legacy_post_id );
			return false;
		}
		$store->mark_removed( $legacy_post_id, $reason );
		if ( 'privacy_erasure' === $reason ) {
			self::erase( $legacy_post_id );
			return false;
		}
		return true;
	}

	/**
	 * On a privacy request: deletes a 3.x lead with the files uploaded to it, and keeps a restore
	 * of Funnelforms 3 from bringing it back. Otherwise Funnelforms never changes 3.x data.
	 *
	 * @param int $post_id 3.x lead ID.
	 */
	public static function erase( int $post_id ): void {
		if ( LegacyRepository::LEAD !== get_post_type( $post_id ) ) {
			return;
		}
		$texts = array( urldecode( (string) get_post_field( 'post_content', $post_id, 'raw' ) ) );
		foreach ( (array) get_post_meta( $post_id ) as $values ) {
			foreach ( (array) $values as $value ) {
				$texts[] = (string) $value;
			}
		}
		foreach ( $texts as $text ) {
			preg_match_all( '#https?://[^\s"\',<>]+#', stripslashes( $text ), $urls );
			foreach ( $urls[0] as $url ) {
				$file = self::upload_file( $url );
				if ( '' !== $file ) {
					wp_delete_file( $file );
				}
			}
		}
		wp_delete_post( $post_id, true );
		$erased = self::erased();
		if ( ! in_array( $post_id, $erased, true ) ) {
			$erased[] = $post_id;
			update_option( self::ERASED, $erased, false );
		}
	}

	/**
	 * IDs of 3.x leads erased on a privacy request.
	 *
	 * @return int[]
	 */
	public static function erased(): array {
		return array_map( 'intval', (array) get_option( self::ERASED, array() ) );
	}

	/**
	 * File of an address 3.x stored for an upload; only files in uploads/af2 (as
	 * af2_upload_file_path() in the 3.x code, which may not be loaded).
	 *
	 * @param string $url Address.
	 * @return string Absolute path, or ''.
	 */
	public static function upload_file( string $url ): string {
		$uploads = wp_get_upload_dir();
		$folder  = realpath( trailingslashit( $uploads['basedir'] ) . 'af2' );
		$base    = (string) wp_parse_url( set_url_scheme( (string) $uploads['baseurl'], 'https' ), PHP_URL_PATH );
		$path    = (string) wp_parse_url( set_url_scheme( $url, 'https' ), PHP_URL_PATH );
		if ( false === $folder || '' === $path || ! str_starts_with( $path, trailingslashit( $base ) ) ) {
			return '';
		}
		$relative = rawurldecode( substr( $path, strlen( $base ) ) );
		// 3.x put the month folder into some addresses but saved the files in uploads/af2.
		foreach ( array( trailingslashit( $uploads['basedir'] ) . ltrim( $relative, '/' ), $folder . '/' . basename( $relative ) ) as $candidate ) {
			$real = realpath( $candidate );
			if ( false !== $real && is_file( $real ) && str_starts_with( $real, $folder . DIRECTORY_SEPARATOR ) ) {
				return $real;
			}
		}
		return '';
	}
}
