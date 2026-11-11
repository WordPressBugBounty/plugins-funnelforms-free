<?php
/**
 * Writes entries of the new renderer as 3.x leads.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Compat\Legacy\LegacyCodec;
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
	 * Visitors write the answers of a lead, so an address in an answer proves nothing about the
	 * file behind it. Only the files 3.x stored for the lead's upload questions are deleted
	 * (uploaded_files()), never a file another lead or entry still names, and never the files that
	 * protect the upload folder. A lead the plugin wrote for an entry (status mirror) holds no 3.x
	 * uploads: the files of the entry go with the entry.
	 *
	 * @param int $post_id 3.x lead ID.
	 */
	public static function erase( int $post_id ): void {
		if ( LegacyRepository::LEAD !== get_post_type( $post_id ) ) {
			return;
		}
		if ( ! self::is_mirror( $post_id ) ) {
			foreach ( self::uploaded_files( $post_id ) as $file ) {
				if ( ! self::referenced_elsewhere( $file, $post_id ) ) {
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
	 * Whether the plugin wrote this 3.x lead for an entry (write()).
	 *
	 * @param int $post_id 3.x lead ID.
	 */
	public static function is_mirror( int $post_id ): bool {
		return self::STATUS === ( ( new MigrationStore( SecretBox::for_site() ) )->item( LegacyRepository::LEAD, $post_id )['status'] ?? '' );
	}

	/**
	 * Files in uploads/af2 that 3.x stored for a lead:
	 *  - the answers of its upload questions (3.x marks them with file_upload_public, frontend.php
	 *    af2_create_answers_json; private files keep their address there),
	 *  - the addresses 3.x kept in post meta "<lead>_<key>" for public files (refactorFileUploads()),
	 *  - in leads older than the current format (no analyticsData, so no visitor can write one
	 *    today), which had no upload marker yet, any address in the answers.
	 * Addresses in other answers, contact data or analytics are never taken.
	 *
	 * @param int $post_id 3.x lead ID.
	 * @return string[] Absolute paths.
	 */
	public static function uploaded_files( int $post_id ): array {
		$urls    = array();
		$content = ( new LegacyCodec() )->decode( (string) get_post_field( 'post_content', $post_id, 'raw' ) );
		if ( is_array( $content ) ) {
			$current = isset( $content['analyticsData'] );
			foreach ( ( $current || isset( $content['questions'] ) ? (array) ( $content['questions'] ?? array() ) : $content ) as $question ) {
				if ( ! is_array( $question ) || ( $current && ! array_key_exists( 'file_upload_public', $question ) ) ) {
					continue;
				}
				$urls = array_merge( $urls, self::urls( $question['antwort'] ?? $question['answer'] ?? '' ) );
			}
		}
		foreach ( (array) get_post_meta( $post_id ) as $key => $values ) {
			if ( str_starts_with( (string) $key, $post_id . '_' ) ) {
				foreach ( (array) $values as $value ) {
					$urls = array_merge( $urls, self::urls( $value ) );
				}
			}
		}
		$files = array();
		foreach ( array_unique( $urls ) as $url ) {
			$file = self::upload_file( $url );
			if ( '' !== $file ) {
				$files[ $file ] = $file;
			}
		}
		return array_values( $files );
	}

	/**
	 * Web addresses in a stored value.
	 *
	 * @param mixed $value Answer or meta value.
	 * @return string[]
	 */
	private static function urls( $value ): array {
		$urls = array();
		foreach ( (array) $value as $text ) {
			if ( is_scalar( $text ) && 0 < (int) preg_match_all( '#https?://[^\s"\',<>]+#', stripslashes( (string) $text ), $m ) ) {
				$urls = array_merge( $urls, $m[0] );
			}
		}
		return $urls;
	}

	/**
	 * Whether another 3.x lead or an entry still names the file, so erasing this lead must keep it.
	 * The search is by file name and may find more than needed; then the file stays.
	 *
	 * @param string $file    Absolute path in uploads/af2.
	 * @param int    $post_id 3.x lead being erased.
	 */
	private static function referenced_elsewhere( string $file, int $post_id ): bool {
		global $wpdb;
		$folder = (string) realpath( trailingslashit( wp_get_upload_dir()['basedir'] ) . 'af2' );
		$name   = str_replace( DIRECTORY_SEPARATOR, '/', substr( $file, strlen( $folder ) + 1 ) );
		if ( null !== $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE path = %s LIMIT 1', Schema::table( 'entry_files' ), 'af2/' . $name ) ) ) {
			return true;
		}
		$base  = wp_basename( $name );
		$forms = array_unique( array( $base, urlencode( $base ), rawurlencode( $base ), urlencode( rawurlencode( $base ) ) ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.urlencode_urlencode -- 3.x stored leads urlencoded.
		foreach ( $forms as $form ) {
			$like = '%' . $wpdb->esc_like( $form ) . '%';
			if ( null !== $wpdb->get_var( $wpdb->prepare( 'SELECT ID FROM %i WHERE post_type = %s AND ID <> %d AND post_content LIKE %s LIMIT 1', $wpdb->posts, LegacyRepository::LEAD, $post_id, $like ) ) ) {
				return true;
			}
			if ( null !== $wpdb->get_var( $wpdb->prepare( 'SELECT m.meta_id FROM %i m INNER JOIN %i p ON p.ID = m.post_id WHERE p.post_type = %s AND m.post_id <> %d AND m.meta_value LIKE %s LIMIT 1', $wpdb->postmeta, $wpdb->posts, LegacyRepository::LEAD, $post_id, $like ) ) ) {
				return true;
			}
		}
		return false;
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
			if ( false !== $real && is_file( $real ) && str_starts_with( $real, $folder . DIRECTORY_SEPARATOR ) && ! self::protects_folder( $real ) ) {
				return $real;
			}
		}
		return '';
	}

	/**
	 * Files no upload ever has, which keep the folder from being listed or run (.htaccess,
	 * index.php and other hidden or PHP files).
	 *
	 * @param string $file Absolute path.
	 */
	private static function protects_folder( string $file ): bool {
		$name = strtolower( wp_basename( $file ) );
		return str_starts_with( $name, '.' ) || str_starts_with( $name, 'index.' ) || 1 === preg_match( '/\.(php\d?|phtml|phar|pht)$/', $name );
	}
}
