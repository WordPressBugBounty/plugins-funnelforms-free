<?php
/**
 * Images and files of an import from Funnelforms 4 move into the media library.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Ff4;

defined( 'ABSPATH' ) || exit;

/**
 * Funnelforms 4 keeps uploaded images and files in its storage (Supabase,
 * https://<project>.supabase.co/storage/v1/…). That storage closes with the SaaS, so the import
 * copies every such address of a converted document into the media library and points the
 * document at the copy: option images, media blocks, downloads of the thank-you page, images in
 * texts and mails. Other addresses (the customer's own website, image services) stay as they are.
 *
 * One instance serves one import: an address that appears in several forms is copied once, and
 * the import stops copying after MAX_FILES files or MAX_SECONDS, so one request stays short. What
 * is not copied keeps its address and is counted, so the import can say so.
 *
 * The copying itself is a callable (address in, new address or '' out), so this class runs
 * without WordPress in unit tests; sideload() is the one of WordPress.
 */
final class Ff4Media {

	/** Most files one import copies. */
	public const MAX_FILES = 100;

	/** Seconds after which an import copies no further file. */
	public const MAX_SECONDS = 25;

	/** Largest file copied, in bytes. */
	public const MAX_BYTES = 20 * 1024 * 1024;

	/** Meta key of an attachment with the address it was copied from. */
	public const SOURCE_META = '_ffx_ff4_source';

	/** An address in the storage of Funnelforms 4, also inside a text. */
	private const PATTERN = '#https?://[a-z0-9-]+\.supabase\.(?:co|in)/storage/v1/[^\s"\'<>()\\\\]+#i';

	/**
	 * Copies a file, returns its new address or '' when it could not be copied.
	 *
	 * @var callable(string):string
	 */
	private $copy;

	/**
	 * Time source in seconds.
	 *
	 * @var callable():float
	 */
	private $clock;

	/**
	 * When the first file was copied.
	 *
	 * @var float|null
	 */
	private ?float $started = null;

	/**
	 * Addresses already handled: new address, or '' when copying failed or was skipped.
	 *
	 * @var array<string,string>
	 */
	private array $done = array();

	/**
	 * Files copied (or tried) so far.
	 *
	 * @var int
	 */
	private int $tries = 0;

	/**
	 * Copy function and clock; both default to WordPress and the system time.
	 *
	 * @param callable(string):string|null $copy  Copies one file.
	 * @param callable():float|null        $clock Seconds.
	 */
	public function __construct( ?callable $copy = null, ?callable $clock = null ) {
		$this->copy  = $copy ?? array( self::class, 'sideload' );
		$this->clock = $clock ?? static fn(): float => microtime( true );
	}

	/**
	 * Whether an address lies in the storage of Funnelforms 4.
	 *
	 * @param string $url Address.
	 */
	public static function is_storage_url( string $url ): bool {
		return 1 === preg_match( self::PATTERN, $url, $m ) && trim( $url ) === $m[0];
	}

	/**
	 * A document with every address of the storage of Funnelforms 4 replaced by its copy in the
	 * media library, and how many different addresses stay in that storage.
	 *
	 * @param array<string,mixed> $document Converted document.
	 * @return array{document:array<string,mixed>,left:int}
	 */
	public function move( array $document ): array {
		$left     = array();
		$document = $this->walk( $document, $left );
		return array(
			'document' => $document,
			'left'     => count( $left ),
		);
	}

	/**
	 * Replaces the addresses in a value.
	 *
	 * @param mixed              $value Value.
	 * @param array<string,bool> $left  Addresses that stay, by reference.
	 * @return mixed
	 */
	private function walk( $value, array &$left ) {
		if ( is_array( $value ) ) {
			foreach ( $value as $key => $item ) {
				$value[ $key ] = $this->walk( $item, $left );
			}
			return $value;
		}
		if ( ! is_string( $value ) || false === stripos( $value, '/storage/v1/' ) ) {
			return $value;
		}
		return (string) preg_replace_callback(
			self::PATTERN,
			function ( array $m ) use ( &$left ): string {
				$url  = html_entity_decode( $m[0], ENT_QUOTES | ENT_HTML5, 'UTF-8' );
				$copy = $this->copy_once( $url );
				if ( '' === $copy ) {
					$left[ $url ] = true;
					return $m[0];
				}
				return $copy;
			},
			$value
		);
	}

	/**
	 * The new address of a file, copied once per import.
	 *
	 * @param string $url Address in the storage of Funnelforms 4.
	 */
	private function copy_once( string $url ): string {
		if ( isset( $this->done[ $url ] ) ) {
			return $this->done[ $url ];
		}
		$now           = ( $this->clock )();
		$this->started = $this->started ?? $now;
		if ( $this->tries >= self::MAX_FILES || $now - $this->started > self::MAX_SECONDS ) {
			return '';
			// Not remembered: a later import may still copy it.
		}
		++$this->tries;
		$copy               = (string) ( $this->copy )( $url );
		$this->done[ $url ] = 1 === preg_match( '#^https?://#i', $copy ) ? $copy : '';
		return $this->done[ $url ];
	}

	/**
	 * Copies a file of the storage of Funnelforms 4 into the media library (WordPress). A file
	 * copied by an earlier import is used again.
	 *
	 * @param string $url Address.
	 * @return string Address of the attachment, or '' when the file could not be copied.
	 */
	public static function sideload( string $url ): string {
		$known = get_posts(
			array(
				'post_type'        => 'attachment',
				'post_status'      => 'inherit',
				'fields'           => 'ids',
				'numberposts'      => 1,
				'meta_key'         => self::SOURCE_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- once per file of an import.
				'meta_value'       => $url, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value -- once per file of an import.
				'suppress_filters' => false,
			)
		);
		if ( array() !== $known ) {
			return (string) wp_get_attachment_url( (int) $known[0] );
		}
		if ( ! function_exists( 'media_handle_sideload' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
		}
		$tmp = download_url( $url, 15 );
		if ( is_wp_error( $tmp ) ) {
			return '';
		}
		if ( (int) filesize( $tmp ) > self::MAX_BYTES ) {
			wp_delete_file( $tmp );
			return '';
		}
		$name = sanitize_file_name( rawurldecode( basename( (string) wp_parse_url( $url, PHP_URL_PATH ) ) ) );
		$id   = media_handle_sideload(
			array(
				'name'     => '' !== $name ? $name : 'funnelforms-4-file',
				'tmp_name' => $tmp,
			),
			0
		);
		if ( is_wp_error( $id ) ) {
			wp_delete_file( $tmp );
			return '';
		}
		update_post_meta( (int) $id, self::SOURCE_META, $url );
		return (string) wp_get_attachment_url( (int) $id );
	}
}
