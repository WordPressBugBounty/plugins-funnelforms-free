<?php
/**
 * Imports the 3.x data into the 5.0 tables, in resumable batches.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Compat\Legacy\LegacyCodec;
use Funnelforms\Application\FormRenderer;
use Funnelforms\Application\LeadMirror;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Phases run in order: connections (global integration credentials), booking types, forms,
 * entries (leads), bookings. Each phase walks its posts by ID and stores a cursor, so a run can
 * stop after any batch and continue in the next request.
 *
 * The 3.x data is never changed. Forms keep rendering with the 3.x code (renderer "legacy") and
 * keep writing 3.x leads, so after the first full run a delta run picks up new and changed posts
 * and removes entries whose lead was deleted in 3.x. Every item is keyed on its legacy ID and
 * skipped when its source hash is unchanged, so runs can repeat safely.
 */
class Migrator {

	/**
	 * Bumped when the import changes; together with the converter versions it forces a re-import.
	 */
	public const VERSION = 1;

	public const STATE_OPTION = 'ffx_migration_state';

	/** Copies kept because many 3.x leads vanished at once (see sweep_deleted_entries()). */
	public const HELD = 'funnelforms_migration_held';

	/** Vanished leads below this number are always followed. */
	private const HOLD_MIN = 20;

	public const PHASES = array( 'connections', 'booking_types', 'forms', 'entries', 'bookings' );

	private const PHASE_TYPES = array(
		'booking_types' => LegacyRepository::BOOKING_TYPE,
		'forms'         => LegacyRepository::FORM,
		'entries'       => LegacyRepository::LEAD,
		'bookings'      => LegacyRepository::BOOKING,
	);

	/**
	 * 3.x global integration options: type => [config field => option names, secret field => option names].
	 * The MessageBird key (af2_messagebird_key) is not copied: 5.0 retired MessageBird
	 * (Integrations\Sms\MessageBirdRetired); the 3.x renderer still reads the option.
	 */
	private const GLOBAL_CONNECTIONS = array(
		'activecampaign' => array(
			'config' => array( 'api_url' => array( 'af2_ac_url', 'ac_url' ) ),
			'secret' => array( 'api_key' => array( 'af2_ac_key', 'ac_key' ) ),
		),
		'mailchimp'      => array(
			'config' => array( 'api_url' => array( 'af2_mc_url' ) ),
			'secret' => array( 'api_key' => array( 'af2_mc_key', 'af2_mailchimp_api_key' ) ),
		),
		'pipedrive'      => array(
			'config' => array( 'api_url' => array( 'af2_pipedrive_api_url' ) ),
			'secret' => array( 'api_key' => array( 'af2_pipedrive_api_key' ) ),
		),
		'getresponse'    => array(
			'config' => array(),
			'secret' => array( 'api_key' => array( 'af2_getresponse_api_key' ) ),
		),
		'hubspot'        => array(
			'config' => array(),
			'secret' => array( 'access_token' => array( 'af2_hubspot_key', 'hubspot_key' ) ),
		),
		'klicktipp'      => array(
			'config' => array( 'user' => array( 'af2_klicktipp_user', 'klicktipp_user' ) ),
			'secret' => array( 'password' => array( 'af2_klicktipp_pw', 'klicktipp_pw' ) ),
		),
		'fincrm'         => array(
			'config' => array( 'user_id' => array( 'af2_fincrm_id', 'fincrm_id' ) ),
			'secret' => array( 'token' => array( 'af2_fincrm_token', 'fincrm_token' ) ),
		),
		'hellohq'        => array(
			'config' => array(),
			'secret' => array(
				'token'         => array( 'af2_hellohq_token' ),
				'refresh_token' => array( 'af2_hellohq_refreshtoken' ),
			),
		),
		'dealsnprojects' => array(
			'config' => array( 'mail' => array( 'af2_dnp_mail', 'dnp_mail' ) ),
			'secret' => array( 'api_key' => array( 'af2_dnp_api_key', 'dnp_api_key' ) ),
		),
		'zapier'         => array(
			'config' => array(),
			'secret' => array( 'api_password' => array( 'af2_zapier_pw', 'zapier_pw' ) ),
		),
		'make'           => array(
			'config' => array(),
			'secret' => array( 'api_password' => array( 'af2_make_pw' ) ),
		),
	);

	/**
	 * 3.x data.
	 *
	 * @var LegacyRepository
	 */
	private LegacyRepository $legacy;

	/**
	 * Target tables.
	 *
	 * @var MigrationStore
	 */
	private MigrationStore $store;

	/**
	 * Converter context.
	 *
	 * @var array<string,mixed>
	 */
	private array $ctx;

	/**
	 * Run state.
	 *
	 * @var array<string,mixed>
	 */
	private array $state;

	/**
	 * Per-step caches.
	 *
	 * @var array<string,mixed>
	 */
	private array $cache = array();

	/**
	 * Imports items again even when their source did not change.
	 *
	 * @var bool
	 */
	private bool $force = false;

	/**
	 * Constructor.
	 *
	 * @param LegacyRepository    $legacy 3.x data.
	 * @param MigrationStore      $store  Target tables.
	 * @param array<string,mixed> $ctx    FormConverter context (locale, plugin_url, no_nl2br) and site timezone.
	 */
	public function __construct( LegacyRepository $legacy, MigrationStore $store, array $ctx ) {
		$this->legacy = $legacy;
		$this->store  = $store;
		$this->ctx    = $ctx + array( 'timezone' => 'UTC' );
		$this->state  = self::state();
	}

	/**
	 * Stored run state.
	 *
	 * @return array<string,mixed>
	 */
	public static function state(): array {
		$state = get_option( self::STATE_OPTION, array() );
		return ( is_array( $state ) ? $state : array() ) + array(
			'status'         => 'idle',
			'mode'           => 'full',
			'phase'          => 0,
			'cursor'         => 0,
			'pending'        => array(),
			'entered'        => false,
			'run_started_at' => null,
			'last_sync_at'   => null,
			'finished_at'    => null,
			'changes'        => array(),
		);
	}

	/**
	 * Saves the run state.
	 */
	private function save(): void {
		update_option( self::STATE_OPTION, $this->state, false );
	}

	/**
	 * Starts a run. A full run walks everything; a delta run only new, changed and deleted posts
	 * since the last completed run.
	 *
	 * @param string $mode full or delta.
	 * @return array<string,mixed> State.
	 */
	public function begin( string $mode = 'full' ): array {
		if ( 'delta' === $mode && null === $this->state['last_sync_at'] ) {
			$mode = 'full';
		}
		$this->state = array(
			'status'         => 'running',
			'mode'           => $mode,
			'phase'          => 0,
			'cursor'         => 0,
			'pending'        => array(),
			'entered'        => false,
			'run_started_at' => gmdate( 'Y-m-d H:i:s' ),
			'last_sync_at'   => $this->state['last_sync_at'],
			'finished_at'    => null,
			'changes'        => array(),
		);
		$this->save();
		// The hourly delta runs show up in the log only when they changed something.
		if ( 'full' === $mode ) {
			$this->store->audit( 'migration_started', 'migration', $mode );
		}
		return $this->state;
	}

	/**
	 * Processes batches until the time budget is used or the run is complete.
	 *
	 * @param int   $batch   Posts per batch.
	 * @param float $seconds Time budget.
	 * @return array<string,mixed> State.
	 */
	public function step( int $batch = 100, float $seconds = 20.0 ): array {
		if ( 'running' !== $this->state['status'] ) {
			return $this->state;
		}
		$until = microtime( true ) + $seconds;
		do {
			$more = $this->batch( $batch );
			$this->save();
			$this->legacy->flush();
		} while ( $more && microtime( true ) < $until );
		if ( 'done' === $this->state['status'] ) {
			/**
			 * After a full or delta run of the migration finished.
			 *
			 * @param array<string,mixed> $state State of the run.
			 */
			do_action( 'funnelforms_migration_finished', $this->state );
		}
		return $this->state;
	}

	/**
	 * One batch of the current phase.
	 *
	 * @param int $batch Posts per batch.
	 * @return bool Whether work remains.
	 */
	private function batch( int $batch ): bool {
		$phase = self::PHASES[ $this->state['phase'] ] ?? null;
		if ( null === $phase ) {
			$this->state['status']       = 'done';
			$this->state['finished_at']  = gmdate( 'Y-m-d H:i:s' );
			$this->state['last_sync_at'] = $this->state['run_started_at'];
			if ( 'full' === $this->state['mode'] || array() !== (array) $this->state['changes'] ) {
				$this->store->audit(
					'migration_finished',
					'migration',
					$this->state['mode'],
					array(
						'summary' => $this->store->summary(),
						'changes' => (array) $this->state['changes'],
					)
				);
			}
			return false;
		}

		if ( 'connections' === $phase ) {
			$this->migrate_global_connections();
			$this->next_phase();
			return true;
		}

		$type = self::PHASE_TYPES[ $phase ];
		if ( ! $this->state['entered'] ) {
			$this->enter_phase( $phase, $type );
		}

		if ( array() !== $this->state['pending'] ) {
			$ids                    = array_splice( $this->state['pending'], 0, $batch );
			$rows                   = array_filter( array_map( array( $this->legacy, 'row' ), $ids ) );
			$this->state['pending'] = array_values( $this->state['pending'] );
		} else {
			$rows = $this->legacy->posts_after( $type, (int) $this->state['cursor'], $batch );
			if ( array() === $rows ) {
				if ( 'entries' === $phase ) {
					$this->sweep_deleted_entries();
				}
				$this->next_phase();
				return true;
			}
			$this->state['cursor'] = (int) end( $rows )['ID'];
		}

		foreach ( $rows as $row ) {
			$this->process( $phase, $row );
		}
		return true;
	}

	/**
	 * Sets the cursor of a phase. Delta runs start leads and bookings after the last imported ID
	 * and queue the older ones that changed since the last run.
	 *
	 * @param string $phase Phase.
	 * @param string $type  Legacy post type.
	 */
	private function enter_phase( string $phase, string $type ): void {
		$this->state['entered'] = true;
		$this->state['cursor']  = 0;
		$this->state['pending'] = array();
		if ( 'delta' === $this->state['mode'] && in_array( $phase, array( 'entries', 'bookings' ), true ) ) {
			$cursor  = $this->store->max_recorded_id( $type );
			$since   = gmdate( 'Y-m-d H:i:s', (int) strtotime( $this->state['last_sync_at'] . ' UTC' ) - 300 );
			$pending = array_filter(
				$this->legacy->ids_modified_since( $type, $since ),
				static function ( int $id ) use ( $cursor ): bool {
					return $id <= $cursor;
				}
			);

			$this->state['cursor']  = $cursor;
			$this->state['pending'] = array_values( $pending );
		}
	}

	/**
	 * Moves to the next phase.
	 */
	private function next_phase(): void {
		++$this->state['phase'];
		$this->state['entered'] = false;
		$this->state['cursor']  = 0;
		$this->state['pending'] = array();
	}

	/**
	 * Imports one post.
	 *
	 * @param string              $phase Phase.
	 * @param array<string,mixed> $row   Post row.
	 */
	public function process( string $phase, array $row ): void {
		switch ( $phase ) {
			case 'booking_types':
				$this->migrate_booking_type( $row );
				break;
			case 'forms':
				$this->migrate_form( $row );
				break;
			case 'entries':
				$this->migrate_entry( $row );
				break;
			case 'bookings':
				$this->migrate_booking( $row );
				break;
		}
	}

	/**
	 * Imports one 3.x form again now, even when it did not change (the "Import again" button). Runs
	 * the conversion and the check again; a version changed in the builder is kept.
	 *
	 * @param int $legacy_id 3.x form ID.
	 * @return string Status of the form afterwards (verified, needs_review, failed), or
	 *                not_found when there is no such 3.x form.
	 */
	public function reimport_form( int $legacy_id ): string {
		$row = $this->legacy->row( $legacy_id );
		if ( null === $row || LegacyRepository::FORM !== $row['post_type'] ) {
			return 'not_found';
		}
		$this->force = true;
		try {
			$this->migrate_form( $row );
		} finally {
			$this->force = false;
			$this->legacy->flush();
		}
		$status = (string) ( $this->store->item( LegacyRepository::FORM, $legacy_id )['status'] ?? FormVerifier::FAILED );
		$this->store->audit( 'migration_form_reimported', 'form', (string) $legacy_id, array( 'status' => $status ) );
		return $status;
	}

	/**
	 * Records the outcome of one item and counts it as a change of this run.
	 *
	 * @param string              $type        Legacy post type.
	 * @param int                 $legacy_id   Legacy post ID.
	 * @param string              $target_type Target table.
	 * @param int|null            $target_id   Target row.
	 * @param string              $status      Status.
	 * @param int                 $version     Migrator version.
	 * @param string              $hash        Source hash.
	 * @param array<string,mixed> $checks      Verification.
	 * @param string[]            $notes       Notes.
	 */
	private function record( string $type, int $legacy_id, string $target_type, ?int $target_id, string $status, int $version, string $hash, array $checks, array $notes ): void {
		$this->store->record( $type, $legacy_id, $target_type, $target_id, $status, $version, $hash, $checks, $notes );
		$changes                = (array) ( $this->state['changes'] ?? array() );
		$changes[ $type ]       = (int) ( $changes[ $type ] ?? 0 ) + 1;
		$this->state['changes'] = $changes;
	}

	/**
	 * Hash of what an item was built from, including the code versions.
	 *
	 * @param string ...$parts Source parts.
	 */
	private static function hash( string ...$parts ): string {
		return hash( 'sha256', implode( "\0", array_merge( array( self::VERSION, FormConverter::VERSION, FormVerifier::VERSION, EntryConverter::DATA_VERSION ), $parts ) ) );
	}

	/**
	 * Whether an item is unchanged since its last import.
	 *
	 * @param string $type Legacy post type.
	 * @param int    $id   Legacy post ID.
	 * @param string $hash Source hash.
	 */
	private function unchanged( string $type, int $id, string $hash ): bool {
		$item = $this->store->item( $type, $id );
		return ! $this->force && null !== $item && $item['source_hash'] === $hash;
	}

	/**
	 * Global integration credentials from wp_options.
	 */
	private function migrate_global_connections(): void {
		$migrated = array();
		foreach ( self::GLOBAL_CONNECTIONS as $type => $fields ) {
			$values = array(
				'config' => array(),
				'secret' => array(),
			);
			foreach ( array( 'config', 'secret' ) as $part ) {
				foreach ( $fields[ $part ] as $field => $options ) {
					$value = '';
					foreach ( $options as $option ) {
						$value = trim( LegacyValue::str( get_option( $option, '' ) ) );
						if ( '' !== $value ) {
							break;
						}
					}
					$values[ $part ][ $field ] = $value;
				}
			}
			$config = $values['config'];
			$secret = $values['secret'];
			if ( '' === implode( '', $secret ) ) {
				continue;
			}
			$this->store->upsert_connection(
				array(
					'ref'    => 'legacy:' . $type,
					'type'   => $type,
					'label'  => $type,
					'config' => $config,
					'secret' => $secret,
				)
			);
			$migrated[] = $type;
		}
		$this->store->audit( 'migration_connections', 'connection', 'global', array( 'types' => $migrated ) );
	}

	/**
	 * Booking type (af2_terminevent). The Cronofy token becomes an encrypted calendar connection.
	 *
	 * @param array<string,mixed> $row Post row.
	 */
	private function migrate_booking_type( array $row ): void {
		$id   = (int) $row['ID'];
		$hash = self::hash( (string) $row['post_status'], (string) $row['post_content'] );
		if ( $this->unchanged( LegacyRepository::BOOKING_TYPE, $id, $hash ) ) {
			return;
		}
		$content = ( new LegacyCodec() )->decode( (string) $row['post_content'] );
		if ( null === $content ) {
			$this->record( LegacyRepository::BOOKING_TYPE, $id, 'booking_type', null, 'failed', self::VERSION, $hash, array(), array( 'undecodable' ) );
			return;
		}
		$token    = is_array( $content['cronofy_token_data'] ?? null ) ? $content['cronofy_token_data'] : null;
		$calendar = null;
		if ( null !== $token && '' !== LegacyValue::str( $token['access_token'] ?? '' ) ) {
			$profile  = is_array( $token['linking_profile'] ?? null ) ? $token['linking_profile'] : array();
			$calendar = array(
				'provider' => 'cronofy',
				'label'    => LegacyValue::str( $profile['provider_name'] ?? 'Cronofy' ),
				'secret'   => $token,
				// Issued to the Funnelforms Cronofy app: only refreshable through the 3.x proxy.
				'status'   => 'legacy_proxy',
			);
		}
		unset( $content['cronofy_token_data'], $content['error'] );
		$target = $this->store->upsert_booking_type( $id, LegacyValue::str( $content['title'] ?? '' ), $content, $calendar );
		$this->record( LegacyRepository::BOOKING_TYPE, $id, 'booking_type', $target, 'migrated', self::VERSION, $hash, array(), array() );
	}

	/**
	 * Form (af2_formular) with its questions, contact forms and calculations.
	 *
	 * @param array<string,mixed> $row Post row.
	 */
	private function migrate_form( array $row ): void {
		$id   = (int) $row['ID'];
		$form = ( new LegacyCodec() )->decode( (string) $row['post_content'] );
		if ( null === $form ) {
			$this->record( LegacyRepository::FORM, $id, 'form', null, FormVerifier::FAILED, self::VERSION, self::hash( (string) $row['post_content'] ), array(), array( 'undecodable' ) );
			return;
		}

		$load   = array( $this->legacy, 'load' );
		$result = ( new FormConverter( $load, $this->ctx ) )->convert( $id, $form );

		$trashed = 'trash' === (string) $row['post_status'];
		$parts   = array( (string) $row['post_content'], (string) wp_json_encode( $this->ctx ) );
		if ( $trashed ) {
			// Only for trashed forms, so the hashes of all other forms stay as they were.
			$parts[] = 'trash';
		}
		foreach ( $result['refs'] as $ids ) {
			sort( $ids );
			foreach ( $ids as $ref ) {
				$post    = $this->legacy->load( (int) $ref );
				$parts[] = $ref . ':' . ( null === $post ? '' : $post['raw'] );
			}
		}
		$hash = self::hash( ...$parts );
		if ( $this->unchanged( LegacyRepository::FORM, $id, $hash ) ) {
			return;
		}

		$verification = ( new FormVerifier( $load ) )->verify( $form, $result );
		$target       = null;
		if ( $result['ok'] ) {
			foreach ( $result['connections'] as $connection ) {
				$this->store->upsert_connection( $connection );
			}
			if ( $this->store->builder_owned( $id ) ) {
				$result['notes'][] = 'kept_builder_version';
			}
			$target = $this->store->upsert_form( $id, (string) $result['document']['title'], (string) $result['document']['locales']['default'], $result['document'] );
			if ( ! $this->store->builder_owned( $id ) && $this->mirror_trash( $target, $id, $trashed ) ) {
				$result['notes'][] = 'trashed_in_3x';
			}
		}
		$this->record( LegacyRepository::FORM, $id, 'form', $target, $verification['status'], self::VERSION, $hash, $verification['checks'], array_merge( $result['errors'], $result['notes'] ) );
		if ( null !== $target ) {
			FormRepository::flush();
			( new FormRenderer( new FormRepository(), $this->store ) )->recheck( $target );
		}
	}

	/**
	 * Keeps a form that is in the Funnelforms 3 trash in the trash of 5.0, so a deleted form does not
	 * come back as a published one. A form the import put in the trash comes back when it is restored
	 * in Funnelforms 3; one trashed in 5.0 stays there.
	 *
	 * @param int  $form_id   Form ID.
	 * @param int  $legacy_id Legacy form ID.
	 * @param bool $trashed   Whether the 3.x form is in the trash.
	 * @return bool Whether the form is in the trash because of the 3.x trash.
	 */
	private function mirror_trash( int $form_id, int $legacy_id, bool $trashed ): bool {
		$forms = new FormRepository();
		$form  = $forms->by_id( $form_id );
		if ( null === $form ) {
			return false;
		}
		if ( $trashed ) {
			if ( 'trashed' !== $form['status'] ) {
				$forms->update( $form_id, array( 'status' => 'trashed' ) );
			}
			return true;
		}
		$notes = json_decode( (string) ( $this->store->item( LegacyRepository::FORM, $legacy_id )['notes'] ?? '[]' ), true );
		if ( 'trashed' === $form['status'] && is_array( $notes ) && in_array( 'trashed_in_3x', $notes, true ) ) {
			$forms->update( $form_id, array( 'status' => 'published' ) );
		}
		return false;
	}

	/**
	 * Lead (af2_request).
	 *
	 * @param array<string,mixed> $row Post row.
	 */
	private function migrate_entry( array $row ): void {
		$id   = (int) $row['ID'];
		$hash = self::hash( (string) $row['post_status'], (string) $row['post_date_gmt'], (string) $row['post_modified_gmt'], (string) $row['post_content'] );
		if ( $this->unchanged( LegacyRepository::LEAD, $id, $hash ) || in_array( $this->store->item( LegacyRepository::LEAD, $id )['status'] ?? '', array( MigrationStore::REMOVED, LeadMirror::STATUS ), true ) ) {
			return;
		}
		if ( ! isset( $this->cache['form_map'] ) ) {
			$this->cache['form_map']  = $this->store->form_map();
			$this->cache['field_map'] = array();
			foreach ( array_keys( $this->legacy->all_ids( LegacyRepository::QUESTION ) ) as $question_id ) {
				$this->cache['field_map'][ $question_id ] = FieldIds::question( $question_id );
			}
		}

		$codec   = new LegacyCodec();
		$content = $codec->decode( (string) $row['post_content'] );
		$result  = ( new EntryConverter() )->convert( $content, $row, $this->cache['form_map'], $this->cache['field_map'], (string) $this->ctx['timezone'] );
		if ( ! $result['ok'] ) {
			$this->record( LegacyRepository::LEAD, $id, 'entry', null, 'failed', self::VERSION, $hash, array(), array( $result['reason'] ) );
			return;
		}
		$result['row']['locale'] = (string) $this->ctx['locale'];

		$entry_id = $this->store->upsert_entry( $result['row'] );
		$this->store->replace_entry_files( $entry_id, $this->files( $result['row']['data']['answers'] ) );
		$this->record( LegacyRepository::LEAD, $id, 'entry', $entry_id, 'migrated', self::VERSION, $hash, array(), array_merge( $result['notes'], $codec->notes() ) );
	}

	/**
	 * File rows for the uploads referenced by an entry's answers (files stay where they are).
	 *
	 * @param array<int,array<string,mixed>> $answers Entry answers.
	 * @return array<int,array<string,mixed>>
	 */
	private function files( array $answers ): array {
		$files = array();
		foreach ( $answers as $answer ) {
			$values = is_array( $answer['value'] ) ? $answer['value'] : array( $answer['value'] );
			foreach ( $values as $value ) {
				if ( ! is_string( $value ) || 0 === (int) preg_match_all( '#https?://\S+?/uploads/af2/([^\s"\'<>?\#]+)#', $value, $m ) ) {
					continue;
				}
				foreach ( $m[1] as $i => $name ) {
					$name = rawurldecode( $name );
					if ( isset( $files[ $name ] ) || str_contains( $name, '..' ) ) {
						continue;
					}
					$path           = trailingslashit( wp_upload_dir( null, false )['basedir'] ) . 'af2/' . $name;
					$attachment     = attachment_url_to_postid( $m[0][ $i ] );
					$files[ $name ] = array(
						'field_id'      => (string) ( $answer['fieldId'] ?? '' ),
						'attachment_id' => $attachment > 0 ? $attachment : null,
						'path'          => 'af2/' . $name,
						'original_name' => wp_basename( $name ),
						'mime_type'     => (string) ( wp_check_filetype( $name )['type'] ?? '' ),
						'size'          => is_file( $path ) ? (int) filesize( $path ) : 0,
						'visibility'    => ! empty( $answer['filesPublic'] ) ? 'public' : 'private',
					);
				}
			}
		}
		return array_values( $files );
	}

	/**
	 * Entries whose 3.x lead no longer exists are removed: until the switch to 5.0 the 3.x lead
	 * is the original, and a lead deleted there (by an admin or the retention job) must not live on.
	 *
	 * When the leads cannot be read, or a large share of them is gone at once (a broken database,
	 * a half restored backup, an import of another site), nothing is removed: the copies stay and
	 * the run notes it (option funnelforms_migration_held), until the leads are back or the
	 * removal is confirmed by the filter funnelforms_migration_allow_mass_removal.
	 */
	private function sweep_deleted_entries(): void {
		global $wpdb;
		$existing = $this->legacy->all_ids( LegacyRepository::LEAD );
		if ( '' !== (string) $wpdb->last_error ) {
			return;
		}
		$gone = array();
		foreach ( $this->store->recorded_ids( LegacyRepository::LEAD ) as $legacy_id ) {
			if ( ! isset( $existing[ $legacy_id ] ) ) {
				$gone[] = $legacy_id;
			}
		}
		$recorded = count( $existing ) + count( $gone );
		if ( count( $gone ) > max( self::HOLD_MIN, $recorded / 2 ) ) {
			/**
			 * Whether copies of leads are removed even when most leads vanished from Funnelforms 3 at
			 * once (they are kept by default, as that looks like damage rather than a cleanup).
			 *
			 * @param bool $allow Default false.
			 * @param int  $count Leads that vanished.
			 * @param int  $total Leads recorded before.
			 */
			if ( ! apply_filters( 'funnelforms_migration_allow_mass_removal', false, count( $gone ), $recorded ) ) {
				if ( (int) ( get_option( self::HELD, array() )['count'] ?? 0 ) !== count( $gone ) ) {
					$this->store->audit( 'migration_removal_held', 'entry', 'legacy_deleted', array( 'count' => count( $gone ) ) );
				}
				update_option(
					self::HELD,
					array(
						'count' => count( $gone ),
						'total' => $recorded,
						'at'    => gmdate( 'Y-m-d H:i:s' ),
					),
					false
				);
				return;
			}
		}
		delete_option( self::HELD );
		$removed = 0;
		foreach ( $gone as $legacy_id ) {
			$removed += $this->store->delete_entry( $legacy_id ) ? 1 : 0;
			$this->store->forget( LegacyRepository::LEAD, $legacy_id );
		}
		if ( $removed > 0 ) {
			$changes                = (array) ( $this->state['changes'] ?? array() );
			$changes['removed']     = (int) ( $changes['removed'] ?? 0 ) + $removed;
			$this->state['changes'] = $changes;
			$this->store->audit( 'migration_entries_removed', 'entry', 'legacy_deleted', array( 'count' => $removed ) );
		}
	}

	/**
	 * Booking (af2_terminbuchung). The lead copy it holds is not imported.
	 *
	 * @param array<string,mixed> $row Post row.
	 */
	private function migrate_booking( array $row ): void {
		$id   = (int) $row['ID'];
		$hash = self::hash( (string) $row['post_status'], (string) $row['post_content'] );
		if ( $this->unchanged( LegacyRepository::BOOKING, $id, $hash ) ) {
			return;
		}
		$content = ( new LegacyCodec() )->decode( (string) $row['post_content'] );
		$start   = null;
		if ( null !== $content ) {
			$start = \DateTimeImmutable::createFromFormat( '!d.m.Y H:i', trim( LegacyValue::str( $content['datum'] ?? '' ) ) . ' ' . trim( LegacyValue::str( $content['zeit'] ?? '' ) ), new \DateTimeZone( 'Europe/Amsterdam' ) );
		}
		if ( null === $content || false === $start || null === $start ) {
			$this->record( LegacyRepository::BOOKING, $id, 'booking', null, 'failed', self::VERSION, $hash, array(), array( null === $content ? 'undecodable' : 'unparsable_date' ) );
			return;
		}
		$utc   = new \DateTimeZone( 'UTC' );
		$start = $start->setTimezone( $utc );
		$end   = $start->modify( sprintf( '+%d hours +%d minutes', (int) LegacyValue::int( $content['std'] ?? 0 ), (int) LegacyValue::int( $content['min'] ?? 0 ) ) );

		if ( ! isset( $this->cache['booking_types'] ) ) {
			$this->cache['booking_types'] = $this->store->booking_type_map();
		}
		$event_id   = (int) LegacyValue::int( $content['terminbuchungsid'] ?? 0 );
		$lead_id    = (int) LegacyValue::int( $content['lead_id'] ?? 0 );
		$event_type = $this->legacy->load( $event_id );
		$entry_ids  = $this->store->entry_ids( array( $lead_id ) );
		$notes      = isset( $entry_ids[ $lead_id ] ) ? array() : array( 'entry_missing' );

		$target = $this->store->upsert_booking(
			array(
				'legacy_post_id' => $id,
				'entry_id'       => $entry_ids[ $lead_id ] ?? null,
				'event_type_id'  => isset( $this->cache['booking_types'][ $event_id ] ) ? (string) $this->cache['booking_types'][ $event_id ] : '',
				'resource_id'    => null === $event_type ? '' : LegacyValue::str( $event_type['content']['calendar_typ'] ?? '' ),
				'starts_at'      => $start->format( 'Y-m-d H:i:s' ),
				'ends_at'        => $end->format( 'Y-m-d H:i:s' ),
				'timezone'       => 'Europe/Amsterdam',
				'status'         => 'confirmed',
				'data'           => array(
					'title'         => LegacyValue::str( $content['titel'] ?? '' ),
					'durationLabel' => LegacyValue::str( $content['dauer'] ?? '' ),
					'legacy'        => array(
						'eventTypeId' => $event_id,
						'leadId'      => $lead_id,
					),
				),
			)
		);
		$this->record( LegacyRepository::BOOKING, $id, 'booking', $target, 'migrated', self::VERSION, $hash, array(), $notes );
	}
}
