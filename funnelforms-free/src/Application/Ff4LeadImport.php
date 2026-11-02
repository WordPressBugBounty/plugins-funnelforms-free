<?php
/**
 * Imports the leads of Funnelforms 4 as entries of the imported forms.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Compat\Ff4\Ff4Media;
use Funnelforms\Compat\Ff4\Ff4Responses;
use Funnelforms\Infrastructure\Files\PrivateStorage;
use Funnelforms\Infrastructure\Repository\EntryRepository;
use Funnelforms\Infrastructure\Repository\FileRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * A leads export of Funnelforms 4 (Ff4Responses) holds the leads of one or more forms. Each lead
 * becomes an entry of the form imported from the same form of Funnelforms 4 (found by
 * meta.import.sourceId), so the forms file is imported first. Nothing is sent: no e-mails,
 * webhooks or other actions run for imported leads, and they count as read.
 *
 * The entry keeps the id of the lead (uid "ff4-<id>"), so importing the same file again adds no
 * entry twice. Uploaded files and signatures are copied into the private storage of entry files;
 * one request copies at most MAX_FILES files or for MAX_SECONDS. What is not
 * copied stays as an address in the answer and under meta.ff4.pending, and the next import of the
 * same file copies it.
 */
final class Ff4LeadImport {

	/** Most files one request copies. */
	public const MAX_FILES = 100;

	/**
	 * Seconds after which a request copies no further file; the leads themselves need time too
	 * (a leads file of 5 MB holds about 4,000), and many hosts stop a request after 30 seconds.
	 */
	public const MAX_SECONDS = 15;

	/**
	 * Types never copied, whatever WordPress allows: they could run in the browser (as for uploads
	 * of visitors in Pro, UploadFile; Free has no uploads but takes the files of imported leads).
	 */
	private const NEVER_TYPES = array( 'text/html', 'text/css', 'application/javascript', 'text/javascript', 'image/svg+xml', 'application/x-shockwave-flash', 'application/xhtml+xml', 'text/xml', 'application/xml' );

	/** A file that can be copied by a later import. */
	private const LATER = 'later';

	/** A file that cannot be copied. */
	private const NEVER = 'never';

	/**
	 * When the first file was copied.
	 *
	 * @var float|null
	 */
	private ?float $started = null;

	/**
	 * Files copied (or tried) in this request.
	 *
	 * @var int
	 */
	private int $tries = 0;

	/**
	 * Repositories.
	 *
	 * @param FormRepository  $forms   Forms.
	 * @param EntryRepository $entries Entries.
	 * @param FileRepository  $files   Files of entries.
	 */
	public function __construct( private FormRepository $forms, private EntryRepository $entries, private FileRepository $files ) {}

	/**
	 * With the repositories of WordPress.
	 */
	public static function create(): self {
		return new self( new FormRepository(), new EntryRepository(), new FileRepository() );
	}

	/**
	 * Imports a leads export: one result per form of Funnelforms 4, with the form it went to.
	 *
	 * @param object $data Decoded export.
	 * @return array{ok:bool,code?:string,forms:array<int,array<string,mixed>>}
	 */
	public function import( object $data ): array {
		if ( ! current_user_can( Capabilities::VIEW_ENTRIES ) ) {
			return array(
				'ok'    => false,
				'code'  => 'no_entry_rights',
				'forms' => array(),
			);
		}
		$groups = Ff4Responses::forms( $data );
		if ( null === $groups ) {
			return array(
				'ok'    => false,
				'code'  => 'unknown_format',
				'forms' => array(),
			);
		}
		if ( array() === $groups ) {
			return array(
				'ok'    => false,
				'code'  => 'no_entries',
				'forms' => array(),
			);
		}
		$out = array();
		foreach ( $groups as $source_id => $group ) {
			$form = $this->forms->by_import_source( (string) $source_id );
			if ( null === $form ) {
				$out[] = array(
					'id'       => null,
					'title'    => $group['title'],
					'source'   => 'ff4',
					'sourceId' => (string) $source_id,
					'errors'   => array( 'ff4_form_missing' ),
				);
				continue;
			}
			$out[] = array(
				'id'       => (int) $form['id'],
				'title'    => (string) $form['title'],
				'source'   => 'ff4',
				'sourceId' => (string) $source_id,
				'entries'  => $this->import_form( $form, $group['responses'] ),
			);
		}
		return array(
			'ok'    => true,
			'forms' => $out,
		);
	}

	/**
	 * Imports the leads of one form.
	 *
	 * @param array<string,mixed>            $form      Form row.
	 * @param array<int,array<string,mixed>> $responses Leads.
	 * @return array{imported:int,skipped:int,failed:int,files:int,filesLeft:int}
	 */
	private function import_form( array $form, array $responses ): array {
		$form_id   = (int) $form['id'];
		$json      = $this->forms->draft( $form_id ) ?? ( null === $form['current_revision_id'] ? null : $this->forms->document_json( (int) $form['current_revision_id'] ) );
		$document  = null === $json ? null : json_decode( $json, true );
		$converter = new Ff4Responses( is_array( $document ) ? $document : null );
		$legacy    = null === $form['legacy_post_id'] ? null : (int) $form['legacy_post_id'];
		$count     = array(
			'imported'  => 0,
			'skipped'   => 0,
			'failed'    => 0,
			'files'     => 0,
			'filesLeft' => 0,
		);
		foreach ( $responses as $response ) {
			$uid      = Ff4Responses::uid( (string) $response['id'] );
			$existing = $this->entries->id_by_uid( $uid );
			if ( $existing > 0 ) {
				++$count['skipped'];
				$this->finish_files( $existing, $form_id, $count );
				continue;
			}
			$result = $converter->convert( $response );
			$row    = $result['row'];
			if ( array() !== $result['files'] ) {
				$row['meta']['ff4']['pending'] = (object) $result['files'];
			}
			$origin = Ff4Responses::origin( $response );
			$host   = (string) wp_parse_url( (string) ( $row['source_url'] ?? '' ), PHP_URL_HOST );
			$row   += LeadSources::of( TrafficSources::detect( $origin['referrer'], $origin['query'], '' === $host ? array() : array( $host ) ), (array) $row['utm'] );
			$row   += array(
				'uid'     => $uid,
				// Leads of Funnelforms 4 were seen there already.
				'is_read' => 1,
			);
			$id     = $this->entries->insert( $form_id, $legacy, $row );
			if ( 0 === $id ) {
				++$count['failed'];
				continue;
			}
			++$count['imported'];
			if ( array() !== $result['files'] ) {
				$this->finish_files( $id, $form_id, $count );
			}
		}
		$this->forms->audit(
			'ff4_entries_imported',
			$form_id,
			array(
				'imported' => $count['imported'],
				'skipped'  => $count['skipped'],
			)
		);
		return $count;
	}

	/**
	 * Copies the files an entry still has in Funnelforms 4; an answer whose files are all copied
	 * shows them as its files.
	 *
	 * @param int               $entry_id Entry ID.
	 * @param int               $form_id  Form ID.
	 * @param array<string,int> $count    Counts, by reference.
	 */
	private function finish_files( int $entry_id, int $form_id, array &$count ): void {
		$entry   = $this->entries->find( $entry_id );
		$pending = is_array( $entry['meta']['ff4']['pending'] ?? null ) ? $entry['meta']['ff4']['pending'] : array();
		if ( null === $entry || array() === $pending ) {
			return;
		}
		$data   = (array) $entry['data'];
		$meta   = (array) $entry['meta'];
		$copied = is_array( $meta['ff4']['copied'] ?? null ) ? $meta['ff4']['copied'] : array();
		foreach ( $pending as $index => $sources ) {
			$answer = $data['answers'][ (int) $index ] ?? null;
			if ( ! is_array( $answer ) || ! is_array( $sources ) ) {
				unset( $pending[ $index ] );
				continue;
			}
			$left = array();
			foreach ( $sources as $source ) {
				$file = is_string( $source ) ? $this->copy( $source, $form_id, (string) ( $answer['fieldId'] ?? '' ) ) : self::NEVER;
				if ( self::LATER === $file ) {
					$left[] = $source;
					continue;
				}
				if ( self::NEVER === $file ) {
					// Gone in Funnelforms 4 or not allowed here: the answer keeps the address.
					$copied[ $index ][] = array(
						'id'   => 0,
						'name' => is_string( $source ) && ! str_starts_with( $source, 'data:' ) ? $source : '',
					);
					continue;
				}
				$this->files->attach( array( $file['id'] ), $entry_id, null );
				$copied[ $index ][] = $file;
				++$count['files'];
			}
			if ( array() !== $left ) {
				$pending[ $index ]   = $left;
				$count['filesLeft'] += count( $left );
				continue;
			}
			unset( $pending[ $index ] );
			$files                                    = (array) ( $copied[ $index ] ?? array() );
			$data['answers'][ (int) $index ]['value'] = array_values( array_filter( array_map( 'strval', array_column( $files, 'name' ) ) ) );
			$ids                                      = array_values( array_filter( array_map( 'intval', array_column( $files, 'id' ) ) ) );
			if ( array() !== $ids ) {
				$data['answers'][ (int) $index ]['fileIds'] = $ids;
			}
			unset( $copied[ $index ] );
		}
		$meta['ff4']['pending'] = (object) $pending;
		$meta['ff4']['copied']  = (object) $copied;
		if ( array() === $pending ) {
			unset( $meta['ff4']['pending'], $meta['ff4']['copied'] );
		}
		$this->entries->update_answers( $entry_id, $data, $meta );
	}

	/**
	 * Copies one file into the private storage as a file of the form: the file, LATER when it
	 * cannot be copied now (download failed, budget of the request spent), NEVER when it never
	 * will be (gone in Funnelforms 4, too large, type not allowed here).
	 *
	 * @param string $source   Address in the storage of Funnelforms 4, or a signature as data address.
	 * @param int    $form_id  Form ID.
	 * @param string $field_id Field id.
	 * @return array{id:int,name:string}|string
	 */
	private function copy( string $source, int $form_id, string $field_id ) {
		$now           = microtime( true );
		$this->started = $this->started ?? $now;
		if ( $this->tries >= self::MAX_FILES || $now - $this->started > self::MAX_SECONDS ) {
			return self::LATER;
		}
		++$this->tries;
		if ( ! function_exists( 'download_url' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		if ( str_starts_with( $source, 'data:image/png;base64,' ) ) {
			$bytes = base64_decode( substr( $source, strlen( 'data:image/png;base64,' ) ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- a signature drawn in Funnelforms 4.
			$tmp   = wp_tempnam( 'signature.png' );
			if ( false === $bytes || '' === $tmp || false === file_put_contents( $tmp, $bytes ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- temporary file.
				return false === $bytes ? self::NEVER : self::LATER;
			}
		} elseif ( Ff4Media::is_storage_url( $source ) ) {
			$tmp = download_url( $source, 15 );
			if ( is_wp_error( $tmp ) ) {
				// download_url() names the HTTP status: http_404 for a file deleted in Funnelforms 4.
				return in_array( $tmp->get_error_code(), array( 'http_400', 'http_403', 'http_404', 'http_410' ), true ) ? self::NEVER : self::LATER;
			}
		} else {
			return self::NEVER;
		}
		$size = (int) filesize( $tmp );
		if ( $size <= 0 || $size > Ff4Media::MAX_BYTES ) {
			wp_delete_file( $tmp );
			return self::NEVER;
		}
		$name   = mb_substr( sanitize_file_name( Ff4Responses::file_name( $source ) ), 0, 200 );
		$stored = PrivateStorage::store(
			array(
				'name'     => $name,
				'type'     => '',
				'tmp_name' => $tmp,
				'error'    => UPLOAD_ERR_OK,
				'size'     => $size,
			),
			self::mimes(),
			false
		);
		if ( is_wp_error( $stored ) ) {
			wp_delete_file( $tmp );
			return self::NEVER;
		}
		$id = $this->files->add_pending(
			array(
				'form_id'       => $form_id,
				'field_id'      => mb_substr( $field_id, 0, 64 ),
				'path'          => $stored['path'],
				'original_name' => $name,
				'mime_type'     => $stored['type'],
				'size'          => $size,
				'visibility'    => 'private',
			)
		);
		if ( 0 === $id ) {
			PrivateStorage::delete( $stored['path'] );
			return self::LATER;
		}
		return array(
			'id'   => $id,
			'name' => $name,
		);
	}

	/**
	 * Types a copied file may have: what WordPress allows visitors, without NEVER_TYPES.
	 *
	 * @return array<string,string>
	 */
	private static function mimes(): array {
		return array_filter( get_allowed_mime_types( 0 ), static fn( string $mime ): bool => ! in_array( $mime, self::NEVER_TYPES, true ) );
	}
}
