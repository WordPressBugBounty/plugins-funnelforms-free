<?php
/**
 * Backup of the Funnelforms 3 data.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Safety;

use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\MigrationReport;
use Funnelforms\Compat\Migration\Migrator;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Files\PrivateStorage;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- reads the rows exactly as stored, on purpose without caches.

/**
 * A restore point of everything Funnelforms 3 keeps: its posts (forms, questions, contact forms,
 * calculations, leads, appointments, appointment events) with all their meta, and its options.
 * Written before the first import and before every restore, so nothing of 3.x can get lost.
 *
 * The file is gzip-compressed JSON lines in uploads/funnelforms-backups: one header line, then one
 * line per row ({"t":"post"|"meta"|"option","r":{…}}), exactly as the database holds them. The
 * rows hold leads and the API keys of 3.x, so the folder denies web access (.htaccess, web.config,
 * index.php), the file name has a random part nobody can guess, and every row line is encrypted
 * with the key of the site's credentials (SecretBox): a copy taken off the server is of no use.
 * It is written in short steps (Action Scheduler, falling back to WP-Cron, or the setup page), so
 * large sites do not run into time limits; its SHA-256 is kept with the list of backups.
 *
 * At most two restore points stay (the state before Funnelforms 5 and the newest one, plus one a
 * restore or the way back is using right now). Once the migration is checked complete, restore
 * points older than 30 days are deleted; the migration page deletes them on request, and the
 * uninstall removes the folder when the data is to go.
 */
final class LegacyBackup {

	public const HOOK = 'funnelforms_backup_step';

	/** Finished backups (newest last). */
	public const LIST = 'funnelforms_backups';

	/** Backup in progress. */
	public const STATE = 'funnelforms_backup_state';

	/** When and why the restore points were deleted for good ({at, why}); then none is required. */
	public const RETIRED = 'funnelforms_backups_retired';

	/** Format of the file: 1 plain rows, 2 encrypted rows. */
	public const FORMAT = 2;

	/** Posts per batch. */
	private const BATCH = 200;

	/** Restore points kept at most (the first one and the newest one). */
	public const KEEP = 2;

	/** Days after which restore points go once the migration is checked complete. */
	public const MAX_AGE_DAYS = 30;

	/**
	 * Key for the rows, once per request.
	 *
	 * @var SecretBox|null
	 */
	private static ?SecretBox $box = null;

	/**
	 * Options of 3.x that do not start with af2_ (from the 3.x code; blogname is WordPress').
	 */
	public const OPTIONS = array( 'ac_key', 'ac_url', 'app_code', 'app_qr_code', 'checklist_appointmentevent', 'checklist_appointmenteventquestion', 'checklist_appointtoform', 'checklist_contactform', 'checklist_form', 'checklist_question', 'checklist_shortcode', 'dnp_api_key', 'dnp_mail', 'fincrm_id', 'fincrm_token', 'hubspot_key', 'klicktipp_pw', 'klicktipp_user', 'license_key', 'license_last_updated', 'license_password', 'license_stat', 'messagebird_error', 'messagebird_error_text', 'messagebird_key', 'regNewApp', 'registrationTokens', 'twm_smtp_options', 'unread_leads', 'zapier_pw' );

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( self::HOOK, array( self::class, 'run_step' ) );
		// The hourly copy of new leads ends with this, so old restore points go without a cron of their own.
		add_action( 'funnelforms_migration_finished', array( self::class, 'after_migration' ) );
	}

	/**
	 * Whether the import and going live wait for a restore point.
	 */
	public static function required(): bool {
		// Once they were deleted after the migration was complete, nothing waits for them again.
		if ( self::retired() ) {
			return false;
		}

		/**
		 * Whether the first import and going live on Funnelforms 5 wait for a restore point of the
		 * 3.x data. Turn it off only where the whole database is backed up otherwise.
		 *
		 * @param bool $required Default true.
		 */
		return (bool) apply_filters( 'funnelforms_restore_point_required', true );
	}

	/**
	 * Folder of the backups, without trailing slash.
	 */
	public static function dir(): string {
		return dirname( PrivateStorage::base() ) . '/funnelforms-backups';
	}

	/**
	 * Finished backups, oldest first.
	 *
	 * @return list<array{id:string,file:string,created_at:string,reason:string,sha256:string,bytes:int,counts:array<string,int>}>
	 */
	public static function all(): array {
		$list = get_option( self::LIST, array() );
		return is_array( $list ) ? array_values( array_filter( $list, 'is_array' ) ) : array();
	}

	/**
	 * The newest finished backup whose file is still there.
	 *
	 * @return array<string,mixed>|null
	 */
	public static function latest(): ?array {
		foreach ( array_reverse( self::all() ) as $backup ) {
			if ( is_readable( self::path( $backup ) ) ) {
				return $backup;
			}
		}
		return null;
	}

	/**
	 * A finished backup by ID.
	 *
	 * @param string $id Backup ID.
	 * @return array<string,mixed>|null
	 */
	public static function find( string $id ): ?array {
		foreach ( self::all() as $backup ) {
			if ( $backup['id'] === $id ) {
				return $backup;
			}
		}
		return null;
	}

	/**
	 * Absolute path of a backup's file.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	public static function path( array $backup ): string {
		return self::dir() . '/' . basename( (string) $backup['file'] );
	}

	/**
	 * Whether the file of a backup is complete and unchanged.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	public static function verify( array $backup ): bool {
		return '' === self::problem( $backup );
	}

	/**
	 * What keeps a backup from being used.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @return string Empty when it can be used; else missing, damaged or locked (the key of the
	 *                site changed, e.g. new salts in wp-config.php, so its rows cannot be read).
	 */
	public static function problem( array $backup ): string {
		$path = self::path( $backup );
		if ( ! is_readable( $path ) ) {
			return 'missing';
		}
		if ( ! hash_equals( (string) $backup['sha256'], (string) hash_file( 'sha256', $path ) ) ) {
			return 'damaged';
		}
		return self::readable( $backup ) ? '' : 'locked';
	}

	/**
	 * Whether the rows of a backup can be read with the key of the site.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	public static function readable( array $backup ): bool {
		$gz = @gzopen( self::path( $backup ), 'rb' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a missing file is an answer, not a warning.
		if ( false === $gz ) {
			return false;
		}
		gzgets( $gz );
		$line = gzgets( $gz );
		gzclose( $gz );
		return false !== $line && null !== self::decode( $line );
	}

	/**
	 * Whether a backup's rows are encrypted.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	public static function encrypted( array $backup ): bool {
		$gz = @gzopen( self::path( $backup ), 'rb' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a missing file is an answer, not a warning.
		if ( false === $gz ) {
			return false;
		}
		$header = json_decode( (string) gzgets( $gz ), true );
		gzclose( $gz );
		return is_array( $header ) && 'secretbox' === ( $header['r']['enc'] ?? '' );
	}

	/**
	 * State of the backup in progress (status idle, running, done or failed).
	 *
	 * @return array<string,mixed>
	 */
	public static function state(): array {
		$state = get_option( self::STATE, array() );
		return ( is_array( $state ) ? $state : array() ) + array(
			'status'  => 'idle',
			'reason'  => '',
			'phase'   => 'posts',
			'cursor'  => 0,
			'file'    => '',
			'counts'  => array(),
			'started' => null,
			'error'   => '',
			'then'    => '',
		);
	}

	/**
	 * Whether a backup is being written.
	 */
	public static function running(): bool {
		return 'running' === self::state()['status'];
	}

	/**
	 * Starts a backup in the background.
	 *
	 * @param string $reason before_migration, before_restore or manual.
	 * @param string $then   What follows once it is done: migration, restore:<id> or nothing.
	 * @return bool False while another backup runs or the folder cannot be written.
	 */
	public static function start( string $reason, string $then = '' ): bool {
		if ( self::running() ) {
			return false;
		}
		self::protect();
		// 128 random bits: the name cannot be guessed even where the folder is served after all.
		$name = 'funnelforms3-' . gmdate( 'Ymd-His' ) . '-' . bin2hex( random_bytes( 16 ) ) . '.jsonl.gz';
		$gz   = @gzopen( self::dir() . '/' . $name . '.part', 'wb6' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- an unwritable folder is reported as a state, not a warning.
		if ( false === $gz ) {
			update_option(
				self::STATE,
				array(
					'status' => 'failed',
					'error'  => 'not_writable',
					'reason' => $reason,
				) + self::state(),
				false
			);
			/** This action is documented in src/Compat/Safety/LegacyBackup.php */
			do_action( 'funnelforms_backup_failed', 'not_writable', $reason );
			return false;
		}
		gzwrite(
			$gz,
			wp_json_encode(
				array(
					't' => 'header',
					'r' => array(
						'format'  => self::FORMAT,
						'enc'     => 'secretbox',
						'site'    => home_url(),
						'prefix'  => $GLOBALS['wpdb']->prefix,
						'created' => gmdate( 'c' ),
						'reason'  => $reason,
						'plugin'  => defined( 'FUNNELFORMS_VERSION' ) ? FUNNELFORMS_VERSION : '',
					),
				)
			) . "\n"
		);
		gzclose( $gz );
		update_option(
			self::STATE,
			array(
				'status'  => 'running',
				'reason'  => $reason,
				'phase'   => 'posts',
				'cursor'  => 0,
				'file'    => $name,
				'counts'  => array(),
				'started' => gmdate( 'Y-m-d H:i:s' ),
				'error'   => '',
				'then'    => $then,
			),
			false
		);
		self::schedule();
		return true;
	}

	/**
	 * Action: one step, then the next one is queued.
	 */
	public static function run_step(): void {
		$state = self::step();
		if ( 'running' === $state['status'] ) {
			self::schedule();
		}
	}

	/**
	 * Writes for a few seconds.
	 *
	 * @param float $seconds Time budget.
	 * @return array<string,mixed> State.
	 */
	public static function step( float $seconds = 8.0 ): array {
		// Cron, the settings page and the setup assistant may all push; one writes at a time.
		if ( ! self::lock( 'funnelforms_backup_lock' ) ) {
			return self::state();
		}
		try {
			return self::write( $seconds );
		} finally {
			self::unlock( 'funnelforms_backup_lock' );
		}
	}

	/**
	 * Takes a lock that expires after two minutes (a step that died).
	 *
	 * @param string $name Option that holds the lock.
	 */
	public static function lock( string $name ): bool {
		if ( add_option( $name, (string) time(), '', false ) ) {
			return true;
		}
		if ( time() - (int) get_option( $name, 0 ) > 2 * MINUTE_IN_SECONDS ) {
			delete_option( $name );
			return add_option( $name, (string) time(), '', false );
		}
		return false;
	}

	/**
	 * Releases a lock.
	 *
	 * @param string $name Option that holds the lock.
	 */
	public static function unlock( string $name ): void {
		delete_option( $name );
	}

	/**
	 * Writes for a few seconds, under the lock.
	 *
	 * @param float $seconds Time budget.
	 * @return array<string,mixed> State.
	 */
	private static function write( float $seconds ): array {
		$state = self::state();
		if ( 'running' !== $state['status'] ) {
			return $state;
		}
		$part = self::dir() . '/' . basename( (string) $state['file'] ) . '.part';
		// Appending adds a gzip member; readers see one stream.
		$gz = is_writable( $part ) ? gzopen( $part, 'ab6' ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_is_writable -- gzip needs a plain file.
		if ( false === $gz ) {
			return self::fail( $state, 'not_writable' );
		}
		$until = microtime( true ) + $seconds;
		do {
			$more = match ( $state['phase'] ) {
				'posts'   => self::posts( $gz, $state ),
				'options' => self::options( $gz, $state ),
				default   => false,
			};
		} while ( $more && microtime( true ) < $until );
		gzclose( $gz );
		if ( 'error' === $state['phase'] ) {
			return self::fail( $state, 'write_failed' );
		}
		if ( 'done' === $state['phase'] ) {
			return self::finish( $state, $part );
		}
		update_option( self::STATE, $state, false );
		return $state;
	}

	/**
	 * Writes the whole backup now (WP-CLI, tests, small sites).
	 *
	 * @param string $reason Reason.
	 * @return array<string,mixed>|null The backup, or null when it failed.
	 */
	public static function run_now( string $reason ): ?array {
		if ( ! self::start( $reason ) ) {
			return null;
		}
		do {
			$state = self::step( 30.0 );
		} while ( 'running' === $state['status'] );
		return 'done' === $state['status'] ? self::latest() : null;
	}

	/**
	 * Reads the rows of a backup.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @param int                 $offset Uncompressed byte offset to start at (from a former read).
	 * @return \Generator<int,array{t:string,r:array<string,mixed>,next:int}>
	 */
	public static function rows( array $backup, int $offset = 0 ): \Generator {
		$gz = gzopen( self::path( $backup ), 'rb' );
		if ( false === $gz ) {
			return;
		}
		if ( $offset > 0 ) {
			gzseek( $gz, $offset );
		}
		while ( ! gzeof( $gz ) ) {
			$line = gzgets( $gz );
			if ( false === $line || '' === trim( $line ) ) {
				continue;
			}
			$row = self::decode( $line );
			if ( null !== $row ) {
				yield array(
					't'    => (string) $row['t'],
					'r'    => $row['r'],
					'next' => (int) gztell( $gz ),
				);
			}
		}
		gzclose( $gz );
	}

	/**
	 * One line of a file as a row: plain JSON (the header, format 1) or an encrypted row.
	 *
	 * @param string $line Line.
	 * @return array{t:string,r:array<string,mixed>}|null Null when it cannot be read.
	 */
	private static function decode( string $line ): ?array {
		$line = trim( $line );
		if ( str_starts_with( $line, 'ffx1:' ) ) {
			$plain = self::box()->decrypt( $line );
			$line  = null === $plain ? '' : (string) gzinflate( $plain );
		}
		$row = json_decode( $line, true );
		return is_array( $row ) && isset( $row['t'], $row['r'] ) && is_array( $row['r'] ) ? array(
			't' => (string) $row['t'],
			'r' => $row['r'],
		) : null;
	}

	/**
	 * One row as an encrypted line (compressed first: encrypted data does not compress).
	 *
	 * @param string              $type post, meta, option or end.
	 * @param array<string,mixed> $row  Row.
	 */
	private static function encode( string $type, array $row ): string {
		$json = (string) wp_json_encode(
			array(
				't' => $type,
				'r' => $row,
			)
		);
		return self::box()->encrypt( (string) gzdeflate( $json, 6 ) ) . "\n";
	}

	/**
	 * The key of the site's credentials.
	 */
	private static function box(): SecretBox {
		self::$box ??= SecretBox::for_site();
		return self::$box;
	}

	/**
	 * Forgets the key (tests that change it).
	 */
	public static function reset_key(): void {
		self::$box = null;
	}

	/**
	 * Fingerprint of the 3.x data as it is now: per post type and for the options, the number of
	 * rows and a hash over all of them. Two equal fingerprints mean nothing changed.
	 *
	 * @return array<string,array{rows:int,hash:string}>
	 */
	public static function fingerprint(): array {
		global $wpdb;
		$out = array();
		foreach ( LegacyRepository::ALL_TYPES as $type ) {
			$ctx  = hash_init( 'sha256' );
			$rows = 0;
			$last = 0;
			do {
				$posts = (array) $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$wpdb->posts} WHERE post_type = %s AND ID > %d ORDER BY ID ASC LIMIT %d", $type, $last, 500 ), ARRAY_A );
				foreach ( $posts as $post ) {
					$last = (int) $post['ID'];
					++$rows;
					hash_update( $ctx, (string) wp_json_encode( $post ) );
					foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT meta_key, meta_value FROM {$wpdb->postmeta} WHERE post_id = %d ORDER BY meta_id ASC", $last ), ARRAY_A ) as $meta ) {
						hash_update( $ctx, (string) wp_json_encode( $meta ) );
					}
				}
			} while ( array() !== $posts );
			$out[ $type ] = array(
				'rows' => $rows,
				'hash' => hash_final( $ctx ),
			);
		}
		$ctx     = hash_init( 'sha256' );
		$options = self::option_rows();
		foreach ( $options as $option ) {
			hash_update( $ctx, $option['option_name'] . "\0" . $option['option_value'] . "\0" );
		}
		$out['options'] = array(
			'rows' => count( $options ),
			'hash' => hash_final( $ctx ),
		);
		return $out;
	}

	/**
	 * The 3.x options as stored.
	 *
	 * @return list<array{option_name:string,option_value:string,autoload:string}>
	 */
	public static function option_rows(): array {
		global $wpdb;
		$in = implode( ', ', array_fill( 0, count( self::OPTIONS ), '%s' ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- one placeholder per option name.
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT option_name, option_value, autoload FROM {$wpdb->options} WHERE ( option_name LIKE %s OR option_name IN ({$in}) ) ORDER BY option_name ASC",
				array_merge( array( $wpdb->esc_like( 'af2_' ) . '%' ), self::OPTIONS )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		return array_values( $rows );
	}

	/**
	 * Writes one batch of posts with their meta.
	 *
	 * @param resource            $gz    Open file.
	 * @param array<string,mixed> $state State, updated.
	 * @return bool Whether work remains.
	 */
	private static function posts( $gz, array &$state ): bool {
		global $wpdb;
		$in = implode( ', ', array_fill( 0, count( LegacyRepository::ALL_TYPES ), '%s' ) );
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- one placeholder per type.
		$posts = (array) $wpdb->get_results(
			$wpdb->prepare( "SELECT * FROM {$wpdb->posts} WHERE post_type IN ({$in}) AND ID > %d ORDER BY ID ASC LIMIT %d", array_merge( LegacyRepository::ALL_TYPES, array( (int) $state['cursor'], self::BATCH ) ) ),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		if ( array() === $posts ) {
			$state['phase'] = 'options';
			return true;
		}
		$ids  = array_map( 'intval', array_column( $posts, 'ID' ) );
		$meta = (array) $wpdb->get_results(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- one placeholder per ID.
			$wpdb->prepare( "SELECT * FROM {$wpdb->postmeta} WHERE post_id IN (" . implode( ', ', array_fill( 0, count( $ids ), '%d' ) ) . ') ORDER BY meta_id ASC', $ids ),
			ARRAY_A
		);
		$out = '';
		foreach ( $posts as $post ) {
			$out                                  .= self::encode( 'post', $post );
			$state['counts'][ $post['post_type'] ] = (int) ( $state['counts'][ $post['post_type'] ] ?? 0 ) + 1;
		}
		foreach ( $meta as $row ) {
			$out .= self::encode( 'meta', $row );
		}
		$state['counts']['meta'] = (int) ( $state['counts']['meta'] ?? 0 ) + count( $meta );
		if ( false === gzwrite( $gz, $out ) ) {
			$state['phase'] = 'error';
			return false;
		}
		$state['cursor'] = (int) end( $ids );
		return true;
	}

	/**
	 * Writes the options.
	 *
	 * @param resource            $gz    Open file.
	 * @param array<string,mixed> $state State, updated.
	 */
	private static function options( $gz, array &$state ): bool {
		$out = '';
		foreach ( self::option_rows() as $row ) {
			$out .= self::encode( 'option', $row );
		}
		$state['counts']['options'] = substr_count( $out, "\n" );
		$out                       .= self::encode( 'end', array( 'counts' => $state['counts'] ) );
		$state['phase']             = false === gzwrite( $gz, $out ) ? 'error' : 'done';
		return false;
	}

	/**
	 * Closes a finished backup: checks the file, records it, starts what follows.
	 *
	 * @param array<string,mixed> $state State.
	 * @param string              $part  Path of the file being written.
	 * @return array<string,mixed> State.
	 */
	private static function finish( array $state, string $part ): array {
		$file = basename( (string) $state['file'] );
		$path = self::dir() . '/' . $file;
		// A file that cannot be read back to its end line is no backup.
		if ( ! rename( $part, $path ) || ! self::complete( $path ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename -- same folder.
			return self::fail( $state, 'unreadable' );
		}
		$backup = array(
			'id'         => substr( hash( 'sha256', $file ), 0, 16 ),
			'file'       => $file,
			'created_at' => gmdate( 'Y-m-d H:i:s' ),
			'reason'     => (string) $state['reason'],
			'sha256'     => (string) hash_file( 'sha256', $path ),
			'bytes'      => (int) filesize( $path ),
			'counts'     => array_map( 'intval', (array) $state['counts'] ),
		);
		$list   = self::all();
		$list[] = $backup;
		$list   = self::prune( $list, self::in_use( (string) $state['then'] ) );
		update_option( self::LIST, $list, false );
		$state['status'] = 'done';
		update_option( self::STATE, $state, false );

		/**
		 * After a backup of the Funnelforms 3 data was written.
		 *
		 * @param array<string,mixed> $backup Backup.
		 * @param string              $then   What was to follow (migration, restore:<id>).
		 */
		do_action( 'funnelforms_backup_done', $backup, (string) $state['then'] );
		return $state;
	}

	/**
	 * Keeps the first backup (the state before 5.0), the ones in use and the newest one; deletes
	 * the files of the others.
	 *
	 * @param list<array<string,mixed>> $backups Backups, oldest first.
	 * @param string[]                  $protect IDs that must stay.
	 * @return list<array<string,mixed>> Backups kept, oldest first.
	 */
	private static function prune( array $backups, array $protect ): array {
		$excess = count( $backups ) - self::KEEP;
		$last   = count( $backups ) - 1;
		$keep   = array();
		foreach ( $backups as $i => $backup ) {
			if ( $excess > 0 && $i > 0 && $i < $last && ! in_array( (string) $backup['id'], $protect, true ) ) {
				wp_delete_file( self::path( $backup ) );
				--$excess;
				continue;
			}
			$keep[] = $backup;
		}
		return $keep;
	}

	/**
	 * Backups that something still needs: the one a restore is about to read, and the one the way
	 * back to Funnelforms 3 was taken with.
	 *
	 * @param string $then What follows the backup being finished (restore:<id>).
	 * @return string[] IDs.
	 */
	private static function in_use( string $then ): array {
		$ids = array( (string) Rollback::record()['backup'] );
		if ( str_starts_with( $then, 'restore:' ) ) {
			$ids[] = substr( $then, 8 );
		}
		$restore = LegacyRestore::state();
		if ( in_array( $restore['status'], array( 'backing_up', 'running' ), true ) ) {
			$ids[] = (string) $restore['backup'];
		}
		return array_values( array_filter( $ids ) );
	}

	/**
	 * After a migration run (also the hourly copy of new leads): old restore points go.
	 */
	public static function after_migration(): void {
		self::expire();
	}

	/**
	 * Age in days after which restore points go once the migration is checked complete.
	 */
	public static function max_age(): int {
		/**
		 * Days a restore point of the Funnelforms 3 data is kept once the migration is complete.
		 *
		 * @param int $days Default 30.
		 */
		return max( 1, (int) apply_filters( 'funnelforms_backup_max_age', self::MAX_AGE_DAYS ) );
	}

	/**
	 * Whether the migration is complete enough for old restore points to go: the copy is done,
	 * every lead, form and appointment is there in Funnelforms 5, the site did not go back to
	 * Funnelforms 3, and no restore point is being written, checked or restored.
	 */
	public static function migration_verified(): bool {
		if ( 'done' !== Migrator::state()['status'] || Rollback::active() || self::busy() ) {
			return false;
		}
		foreach ( MigrationReport::data() as $kind ) {
			if ( ! $kind['ok'] ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Whether a restore point is being written, checked or restored.
	 */
	public static function busy(): bool {
		return self::running()
			|| in_array( LegacyRestore::state()['status'], array( 'backing_up', 'running' ), true )
			|| 'running' === LegacyCheck::state()['status'];
	}

	/**
	 * Deletes the restore points older than max_age() days, once the migration is checked complete.
	 *
	 * @return int Restore points deleted.
	 */
	public static function expire(): int {
		$all = self::all();
		if ( array() === $all || ! self::migration_verified() ) {
			return 0;
		}
		$limit = time() - self::max_age() * DAY_IN_SECONDS;
		$keep  = array();
		foreach ( $all as $backup ) {
			$time = strtotime( (string) $backup['created_at'] . ' UTC' );
			if ( false !== $time && $time < $limit ) {
				continue;
			}
			$keep[] = $backup;
		}
		return self::remove( $all, $keep, 'age' );
	}

	/**
	 * Deletes every restore point (on request on the migration page).
	 *
	 * @return int|null Restore points deleted, or null while one is being written, checked or restored.
	 */
	public static function delete_all(): ?int {
		if ( self::busy() ) {
			return null;
		}
		$count = self::remove( self::all(), array(), 'admin' );
		// Leftovers of a write that died.
		foreach ( (array) glob( self::dir() . '/funnelforms3-*' ) as $file ) {
			wp_delete_file( (string) $file );
		}
		return $count;
	}

	/**
	 * Deletes the files of the backups not kept.
	 *
	 * @param list<array<string,mixed>> $all  All backups.
	 * @param list<array<string,mixed>> $keep Backups that stay.
	 * @param string                    $why  age or admin.
	 * @return int Backups deleted.
	 */
	private static function remove( array $all, array $keep, string $why ): int {
		$ids   = array_column( $keep, 'id' );
		$count = 0;
		foreach ( $all as $backup ) {
			if ( ! in_array( $backup['id'], $ids, true ) ) {
				wp_delete_file( self::path( $backup ) );
				++$count;
			}
		}
		if ( 0 === $count ) {
			return 0;
		}
		update_option( self::LIST, array_values( $keep ), false );
		if ( array() === $keep ) {
			update_option(
				self::RETIRED,
				array(
					'at'  => gmdate( 'Y-m-d H:i:s' ),
					'why' => $why,
				),
				false
			);
		}

		/**
		 * After restore points of the Funnelforms 3 data were deleted.
		 *
		 * @param int    $count Restore points deleted.
		 * @param string $why   age (older than allowed after a complete migration) or admin (on request).
		 */
		do_action( 'funnelforms_backups_deleted', $count, $why );
		return $count;
	}

	/**
	 * When and why all restore points were deleted, or null.
	 *
	 * @return array{at:string,why:string}|null
	 */
	public static function retired(): ?array {
		$retired = get_option( self::RETIRED, array() );
		if ( ! is_array( $retired ) || ! isset( $retired['at'] ) ) {
			return null;
		}
		return array(
			'at'  => (string) $retired['at'],
			'why' => (string) ( $retired['why'] ?? '' ),
		);
	}

	/**
	 * The folder relative to the WordPress root, for people to find it.
	 */
	public static function where(): string {
		$dir  = wp_normalize_path( self::dir() );
		$root = wp_normalize_path( untrailingslashit( ABSPATH ) );
		return str_starts_with( $dir, $root . '/' ) ? substr( $dir, strlen( $root ) + 1 ) : $dir;
	}

	/**
	 * Age of a backup in whole days.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	public static function age_days( array $backup ): int {
		$time = strtotime( (string) $backup['created_at'] . ' UTC' );
		return false === $time ? 0 : max( 0, (int) floor( ( time() - $time ) / DAY_IN_SECONDS ) );
	}

	/**
	 * Writes the rows of a backup as a plain file (format 1) to a stream, for the download.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @param callable(string)    $out    Gets the gzip data, piece by piece.
	 * @return bool False when the file could not be read.
	 */
	public static function export( array $backup, callable $out ): bool {
		if ( '' !== self::problem( $backup ) ) {
			return false;
		}
		$deflate = deflate_init( ZLIB_ENCODING_GZIP, array( 'level' => 6 ) );
		if ( false === $deflate ) {
			return false;
		}
		foreach ( self::rows( $backup ) as $row ) {
			if ( 'header' === $row['t'] ) {
				$row['r']['format'] = 1;
				unset( $row['r']['enc'] );
			}
			$line = (string) wp_json_encode(
				array(
					't' => $row['t'],
					'r' => $row['r'],
				)
			) . "\n";
			$out( (string) deflate_add( $deflate, $line, ZLIB_NO_FLUSH ) );
		}
		$out( (string) deflate_add( $deflate, '', ZLIB_FINISH ) );
		return true;
	}

	/**
	 * Number of rows a backup holds (posts, meta and options), for progress.
	 *
	 * @param array<string,mixed> $backup Backup.
	 */
	public static function rows_total( array $backup ): int {
		return (int) array_sum( array_map( 'intval', (array) ( $backup['counts'] ?? array() ) ) );
	}

	/**
	 * Whether a file ends with the end line.
	 *
	 * @param string $path File.
	 */
	private static function complete( string $path ): bool {
		$last = null;
		foreach ( self::rows( array( 'file' => basename( $path ) ) ) as $row ) {
			$last = $row['t'];
		}
		return 'end' === $last;
	}

	/**
	 * Marks the backup as failed and removes the partial file.
	 *
	 * @param array<string,mixed> $state State.
	 * @param string              $error Code.
	 * @return array<string,mixed> State.
	 */
	private static function fail( array $state, string $error ): array {
		$part = self::dir() . '/' . basename( (string) $state['file'] ) . '.part';
		if ( file_exists( $part ) ) {
			wp_delete_file( $part );
		}
		$state['status'] = 'failed';
		$state['error']  = $error;
		update_option( self::STATE, $state, false );

		/**
		 * After a backup of the Funnelforms 3 data could not be written.
		 *
		 * @param string $error  Error code (not_writable, write_failed or unreadable).
		 * @param string $reason Occasion of the backup.
		 */
		do_action( 'funnelforms_backup_failed', $error, (string) $state['reason'] );
		return $state;
	}

	/**
	 * Queues the next step.
	 */
	private static function schedule(): void {
		if ( function_exists( 'as_enqueue_async_action' ) ) {
			if ( ! as_has_scheduled_action( self::HOOK, array(), 'funnelforms' ) ) {
				as_enqueue_async_action( self::HOOK, array(), 'funnelforms' );
			}
			return;
		}
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_single_event( time(), self::HOOK );
		}
	}

	/**
	 * Creates the folder with files that deny web access.
	 */
	private static function protect(): void {
		// protect_dir() writes nothing while .htaccess exists; a lost index.php comes back too.
		if ( file_exists( self::dir() . '/.htaccess' ) && ! file_exists( self::dir() . '/index.php' ) ) {
			wp_delete_file( self::dir() . '/.htaccess' );
		}
		PrivateStorage::protect_dir( self::dir() );
	}
}
