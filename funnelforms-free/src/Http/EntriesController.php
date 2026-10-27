<?php
/**
 * REST routes for entries (leads) in the admin: list, detail, status, delete, send again.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Admin\EntryPdfDownload;
use Funnelforms\Application\Abandonment;
use Funnelforms\Application\Actions\ActionQueue;
use Funnelforms\Application\Actions\MailServer;
use Funnelforms\Application\DoubleOptIn;
use Funnelforms\Application\LeadStages;
use Funnelforms\Application\LeadMirror;
use Funnelforms\Application\PublicEntries;
use Funnelforms\Application\SubmitEntry;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\EntryRepository;
use Funnelforms\Integrations\Payments\PaymentProvider;
use Funnelforms\Infrastructure\Repository\FileRepository;
use Funnelforms\Domain\Entry\VisitAnalytics;
use Funnelforms\Domain\Form\Document;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Routes under funnelforms/v1/entries for the admin app (and anything else that signs in with a
 * WordPress login or an application password). Entries of the new renderer and entries imported
 * from 3.x come in the same self-describing layout (labels with values, see EntryData).
 *
 *   GET    entries                 page of entries; filters form, status (complete, partial or
 *                                  spam: the spam folder, which other lists leave out), leadStatus,
 *                                  read, archived (default false), search, after, before, tag,
 *                                  assignedTo (0: nobody); headers X-WP-Total, X-WP-TotalPages
 *   GET    entries/<id>            one entry with answers, files, consent, notes and the delivery log
 *   PATCH  entries/<id>            read, archived, leadStatus (key of a lead stage: new, contacted,
 *                                  won, lost or the site's own, see LeadStagesController), tags,
 *                                  assignedTo
 *   POST   entries/bulk            the same changes, addTags, removeTags, delete or notSpam for up
 *                                  to 100 entries
 *   POST   entries/<id>/not-spam   takes the entry out of the spam folder and runs what was held
 *                                  back (SubmitEntry::release_spam())
 *   DELETE entries/<id>            deletes the entry like a privacy request
 *   POST   entries/<id>/resend     runs one action of the form (mail, webhook, CRM) again, or
 *                                   sends the double opt-in link again (action :optin)
 *   POST   entries/<id>/notes      adds an internal note
 *   DELETE entries/<id>/notes/<n>  deletes a note (its author or an admin)
 *   GET    entries/tags            tags in use, most used first
 *   GET    entries/assignees       users who can be assigned entries
 *
 * Reading and changing need the entries capability (FileDownload::capability(), default
 * funnelforms_view_entries, see Application\Capabilities); CSV export is Admin\EntriesExport. Entries go only to users who have that
 * capability; they get a mail when someone else assigns them one (filter
 * funnelforms_notify_assignee).
 */
final class EntriesController {

	private const BASE = '/entries';

	/**
	 * Registers the routes.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Route definitions.
	 */
	public static function routes(): void {
		$allowed = array( self::class, 'allowed' );
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE,
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'index' ),
				'permission_callback' => $allowed,
				'args'                => self::list_args(),
			)
		);
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( self::class, 'show' ),
					'permission_callback' => $allowed,
				),
				array(
					'methods'             => 'PATCH',
					'callback'            => array( self::class, 'update' ),
					'permission_callback' => $allowed,
					'args'                => self::update_args(),
				),
				array(
					'methods'             => 'DELETE',
					'callback'            => array( self::class, 'destroy' ),
					'permission_callback' => $allowed,
				),
			)
		);
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE . '/bulk',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'bulk' ),
				'permission_callback' => $allowed,
				'args'                => self::bulk_args(),
			)
		);
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE . '/(?P<id>\d+)/not-spam',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'not_spam' ),
				'permission_callback' => $allowed,
			)
		);
		if ( Edition::is_free() ) {
			// The lead CRM (tags, assignment, notes) and sending again are Funnelforms Pro.
			return;
		}
		LeadStagesController::routes();
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE . '/tags',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'tags' ),
				'permission_callback' => $allowed,
			)
		);
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE . '/assignees',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'assignees' ),
				'permission_callback' => $allowed,
			)
		);
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE . '/(?P<id>\d+)/notes',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'add_note' ),
				'permission_callback' => $allowed,
				'args'                => self::note_args(),
			)
		);
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE . '/(?P<id>\d+)/notes/(?P<note>\d+)',
			array(
				'methods'             => 'DELETE',
				'callback'            => array( self::class, 'delete_note' ),
				'permission_callback' => $allowed,
			)
		);
		register_rest_route(
			FormsController::NAMESPACE,
			self::BASE . '/(?P<id>\d+)/resend',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'resend' ),
				'permission_callback' => $allowed,
				'args'                => array(
					'action' => array(
						'type'      => 'string',
						'required'  => true,
						'maxLength' => 64,
					),
				),
			)
		);
	}

	/**
	 * Parameters of the list route.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public static function list_args(): array {
		return array(
			'form'       => array(
				'type'    => 'integer',
				'minimum' => 1,
			),
			'status'     => array(
				'type'        => 'string',
				'enum'        => array( 'complete', 'partial', 'spam', 'abandoned' ),
				'description' => 'Without it, every entry but spam and the abandoned ones (visitors who left after giving their address, Pro).',
			),
			'leadStatus' => self::lead_status_arg(),
			'read'       => array( 'type' => 'boolean' ),
			'archived'   => array(
				'type'        => 'boolean',
				'default'     => false,
				'description' => 'true lists the archive instead of the open entries.',
			),
			'public'     => array(
				'type'        => 'boolean',
				'description' => 'true lists the entries shown on the website, false the others.',
			),
			'payment'    => array(
				'type'        => 'string',
				'enum'        => EntryRepository::PAYMENT_STATUSES,
				'description' => 'Only entries whose payment has this status.',
			),
			'device'     => array(
				'type'        => 'string',
				'enum'        => VisitAnalytics::DEVICES,
				'description' => 'Only entries sent from this kind of device.',
			),
			'search'     => array(
				'type'      => 'string',
				'maxLength' => 200,
			),
			'after'      => array(
				'type'   => 'string',
				'format' => 'date-time',
			),
			'before'     => array(
				'type'   => 'string',
				'format' => 'date-time',
			),
			'tag'        => array(
				'type'      => 'string',
				'maxLength' => EntryRepository::MAX_TAG_LENGTH,
			),
			'assignedTo' => array(
				'type'        => 'integer',
				'minimum'     => 0,
				'description' => 'User ID; 0 for entries assigned to nobody.',
			),
			'minScore'   => array(
				'type'        => 'number',
				'description' => 'Only entries with at least this score (forms with a score calculation).',
			),
			'sort'       => array(
				'type'        => 'string',
				'enum'        => array( 'date', 'value', 'score' ),
				'default'     => 'date',
				'description' => 'Newest first (date), or the highest lead value or score first.',
			),
			'optIn'      => array(
				'type'        => 'string',
				'enum'        => array( 'pending', 'confirmed' ),
				'description' => 'Double opt-in: entries waiting for the confirmation, or confirmed ones.',
			),
			'page'       => array(
				'type'    => 'integer',
				'minimum' => 1,
				'default' => 1,
			),
			'per_page'   => array(
				'type'    => 'integer',
				'minimum' => 1,
				'maximum' => 100,
				'default' => 25,
			),
		);
	}

	/**
	 * Parameters of the update route.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public static function update_args(): array {
		return array(
			'read'       => array( 'type' => 'boolean' ),
			'archived'   => array( 'type' => 'boolean' ),
			'public'     => array(
				'type'        => 'boolean',
				'description' => 'Shows the entry on the website ([funnelforms_entries]); needs the visitor\'s consent where the form asks for it.',
			),
			'leadStatus' => self::lead_status_arg(),
			'tags'       => array(
				'type'        => 'array',
				'maxItems'    => EntryRepository::MAX_TAGS,
				'items'       => array(
					'type'      => 'string',
					'maxLength' => 200,
				),
				'description' => 'All tags of the entry; replaces the tags it had.',
			),
			'assignedTo' => array(
				'type'        => 'integer',
				'minimum'     => 0,
				'description' => 'User ID; 0 removes the assignment.',
			),
		);
	}

	/**
	 * Parameters of the bulk route.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public static function bulk_args(): array {
		$tags = array(
			'type'     => 'array',
			'maxItems' => EntryRepository::MAX_TAGS,
			'items'    => array(
				'type'      => 'string',
				'maxLength' => 200,
			),
		);
		return array(
			'ids'        => array(
				'type'     => 'array',
				'required' => true,
				'minItems' => 1,
				'maxItems' => 100,
				'items'    => array(
					'type'    => 'integer',
					'minimum' => 1,
				),
			),
			'addTags'    => $tags,
			'removeTags' => $tags,
			'delete'     => array(
				'type'        => 'boolean',
				'description' => 'Deletes the entries like DELETE entries/<id>; other changes are ignored.',
			),
			'notSpam'    => array(
				'type'        => 'boolean',
				'description' => 'Takes the entries out of the spam folder like POST entries/<id>/not-spam; other changes are ignored.',
			),
		) + array_diff_key( self::update_args(), array( 'tags' => true ) );
	}

	/**
	 * Parameters of the note route.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public static function note_args(): array {
		return array(
			'text' => array(
				'type'      => 'string',
				'required'  => true,
				'minLength' => 1,
				'maxLength' => 5000,
			),
		);
	}

	/**
	 * The parameter leadStatus: the key of a lead stage (GET entries/stages). The stages belong to
	 * the site and can change, so the check is the stages' own, not a fixed list.
	 *
	 * @return array<string,mixed>
	 */
	private static function lead_status_arg(): array {
		return array(
			'type'              => 'string',
			'pattern'           => LeadStages::KEY_PATTERN,
			'description'       => 'Key of a lead stage (GET entries/stages): new, contacted, won and lost, or the stages the site set up.',
			'validate_callback' => static function ( $value, \WP_REST_Request $request, string $param ) {
				$valid = rest_validate_request_arg( $value, $request, $param );
				if ( true !== $valid ) {
					return $valid;
				}
				return LeadStages::exists( $value ) ? true : new \WP_Error( 'rest_invalid_param', __( 'This lead stage does not exist.', 'funnelforms-free' ), array( 'status' => 400 ) );
			},
		);
	}

	/**
	 * Whether the current user may see and change entries.
	 */
	public static function allowed(): bool {
		return current_user_can( FileDownload::capability() );
	}

	/**
	 * GET entries.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function index( \WP_REST_Request $request ): \WP_REST_Response {
		$filter = array();
		foreach (
			array(
				'form'       => 'form_id',
				'status'     => 'status',
				'leadStatus' => 'lead_status',
				'read'       => 'read',
				'archived'   => 'archived',
				'public'     => 'public',
				'payment'    => 'payment',
				'device'     => 'device',
				'search'     => 'search',
				'tag'        => 'tag',
				'assignedTo' => 'assigned_to',
				'minScore'   => 'min_score',
				'optIn'      => 'optin',
				'sort'       => 'sort',
			) as $param => $key
		) {
			if ( null !== $request[ $param ] ) {
				$filter[ $key ] = $request[ $param ];
			}
		}
		foreach ( array( 'after', 'before' ) as $param ) {
			if ( null !== $request[ $param ] ) {
				$filter[ $param ] = gmdate( 'Y-m-d H:i:s', (int) strtotime( (string) $request[ $param ] ) );
			}
		}
		if ( 'spam' === ( $filter['status'] ?? '' ) ) {
			// The spam folder has no archive.
			unset( $filter['archived'] );
		}
		$per_page = (int) $request['per_page'];
		$result   = ( new EntryRepository() )->search( $filter, (int) $request['page'], $per_page );
		$response = new \WP_REST_Response( array_map( array( self::class, 'summary' ), $result['rows'] ), 200 );
		$response->header( 'X-WP-Total', (string) $result['total'] );
		$response->header( 'X-WP-TotalPages', (string) max( 1, (int) ceil( $result['total'] / $per_page ) ) );
		return $response;
	}

	/**
	 * GET entries/<id>.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function show( \WP_REST_Request $request ): \WP_REST_Response {
		$entries = new EntryRepository();
		$entry   = $entries->find( (int) $request['id'] );
		if ( null === $entry ) {
			return self::not_found();
		}
		$files = array();
		foreach ( ( new FileRepository() )->for_entry( (int) $entry['id'] ) as $file ) {
			$files[] = array(
				'id'      => (int) $file['id'],
				'fieldId' => (string) $file['field_id'],
				'name'    => (string) $file['original_name'],
				'type'    => (string) $file['mime_type'],
				'size'    => (int) $file['size'],
				'url'     => FileDownload::url( (int) $file['id'] ),
			);
		}
		$jobs = array();
		foreach ( $entries->jobs( (int) $entry['id'] ) as $job ) {
			$jobs[] = array(
				'id'        => (int) $job['id'],
				'action'    => (string) $job['channel'],
				'status'    => (string) $job['status'],
				'attempts'  => (int) $job['attempts'],
				'error'     => $job['last_error'],
				'updatedAt' => self::time( $job['updated_at'] ),
			);
		}
		$data         = (array) $entry['data'];
		$pdf          = Edition::pro( EntryPdfDownload::class );
		$appointments = Edition::pro( AppointmentsController::class );
		return new \WP_REST_Response(
			self::summary( $entry ) + array(
				'answers'      => $data['answers'] ?? array(),
				'hiddenFields' => (object) ( $data['hiddenFields'] ?? array() ),
				'calculations' => $data['calculations'] ?? array(),
				'page'         => $data['page'] ?? null,
				'utm'          => (object) ( $entry['utm'] ?? array() ),
				'consent'      => $entry['consent'] ?? array(),
				'files'        => $files,
				'pdfUrl'       => null === $pdf ? null : $pdf::url( (int) $entry['id'] ),
				'notes'        => array_map( array( self::class, 'note' ), $entries->notes( (int) $entry['id'] ) ),
				'deliveries'   => $jobs,
				'actions'      => self::actions( $entry ),
				'appointments' => null === $appointments ? array() : $appointments::of_entry( $entry ),
				'visit'        => self::visit( $entry, self::revision_document( $entry ) ),
			),
			200
		);
	}

	/**
	 * PATCH entries/<id>.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function update( \WP_REST_Request $request ): \WP_REST_Response {
		$entries = new EntryRepository();
		$entry   = $entries->find( (int) $request['id'] );
		if ( null === $entry ) {
			return self::not_found();
		}
		$changes = self::changes( $request );
		if ( $changes instanceof \WP_REST_Response ) {
			return $changes;
		}
		if ( ! empty( $changes['is_public'] ) && ! self::publishable( $entry ) ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'no_publication_consent',
					'message' => __( 'The visitor did not agree to show this entry on the website.', 'funnelforms-free' ),
				),
				400
			);
		}
		if ( self::apply( $entries, $entry, $changes ) ) {
			self::notify_assignee( (int) $changes['assigned_to'], array( (array) $entries->find( (int) $entry['id'] ) ) );
		}
		return new \WP_REST_Response( self::summary( (array) $entries->find( (int) $entry['id'] ) ), 200 );
	}

	/**
	 * POST entries/bulk: one change for many entries, or deleting them. Unknown IDs are listed
	 * in missing; an assigned user gets one mail for all entries.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function bulk( \WP_REST_Request $request ): \WP_REST_Response {
		$entries = new EntryRepository();
		$ids     = array_values( array_unique( array_map( 'intval', (array) $request['ids'] ) ) );
		$changes = self::changes( $request );
		if ( $changes instanceof \WP_REST_Response ) {
			return $changes;
		}
		// Tags change by addTags and removeTags here.
		unset( $changes['tags'] );
		$add     = null === $request['addTags'] ? array() : EntryRepository::tags( (array) $request['addTags'] );
		$remove  = null === $request['removeTags'] ? array() : EntryRepository::tags( (array) $request['removeTags'] );
		$missing = array();
		$done    = array();
		$newly   = array();
		foreach ( $ids as $id ) {
			$entry = $entries->find( $id );
			if ( null === $entry ) {
				$missing[] = $id;
				continue;
			}
			if ( true === $request['delete'] ) {
				self::delete_entry( $entries, $entry );
				$done[] = $id;
				continue;
			}
			if ( true === $request['notSpam'] ) {
				if ( SubmitEntry::create()->release_spam( $id )['ok'] ) {
					( new MigrationStore( SecretBox::for_site() ) )->audit( 'entry_not_spam', 'entry', (string) $id, array( 'user' => get_current_user_id() ) );
					$done[] = $id;
				} else {
					$missing[] = $id;
				}
				continue;
			}
			$own = $changes;
			if ( array() !== $add || array() !== $remove ) {
				$tags        = array_merge( EntryRepository::entry_tags( $entry ), $add );
				$own['tags'] = array_values( array_diff( EntryRepository::tags( $tags ), $remove ) );
			}
			if ( self::apply( $entries, $entry, $own ) ) {
				$newly[] = (array) $entries->find( $id );
			}
			$done[] = $id;
		}
		if ( array() !== $newly ) {
			self::notify_assignee( (int) $changes['assigned_to'], $newly );
		}
		return new \WP_REST_Response(
			array(
				( true === $request['delete'] ? 'deleted' : ( true === $request['notSpam'] ? 'released' : 'updated' ) ) => $done,
				'missing' => $missing,
			),
			200
		);
	}

	/**
	 * Changes of a PATCH or bulk request, for EntryRepository::update_flags().
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return array<string,mixed>|\WP_REST_Response Changes, or the answer for an assignee who may not see entries.
	 */
	private static function changes( \WP_REST_Request $request ) {
		$changes = array();
		if ( Edition::is_free() ) {
			foreach ( array( 'public', 'leadStatus', 'tags', 'assignedTo', 'addTags', 'removeTags' ) as $param ) {
				if ( null !== $request[ $param ] ) {
					return new \WP_REST_Response(
						array(
							'code'    => 'pro_feature',
							'message' => __( 'Lead status, tags, assignment and entries on the website are part of Funnelforms Pro.', 'funnelforms-free' ),
						),
						403
					);
				}
			}
		}
		foreach (
			array(
				'read'       => 'is_read',
				'archived'   => 'is_archived',
				'public'     => 'is_public',
				'leadStatus' => 'lead_status',
				'tags'       => 'tags',
			) as $param => $key
		) {
			if ( null !== $request[ $param ] ) {
				$changes[ $key ] = $request[ $param ];
			}
		}
		if ( null !== $request['assignedTo'] ) {
			$assignee = (int) $request['assignedTo'];
			if ( 0 !== $assignee && ! self::assignable( $assignee ) ) {
				return new \WP_REST_Response(
					array(
						'code'    => 'invalid_assignee',
						'message' => __( 'This user cannot be assigned entries.', 'funnelforms-free' ),
					),
					400
				);
			}
			$changes['assigned_to'] = $assignee;
		}
		return $changes;
	}

	/**
	 * Saves the changes of one entry and logs a new assignee.
	 *
	 * @param EntryRepository     $entries Repository.
	 * @param array<string,mixed> $entry   Entry before the change.
	 * @param array<string,mixed> $changes Changes from changes().
	 * @return bool Whether the entry went to another user who should hear of it.
	 */
	private static function apply( EntryRepository $entries, array $entry, array $changes ): bool {
		if ( ! empty( $changes['is_public'] ) && ! self::publishable( $entry ) ) {
			unset( $changes['is_public'] );
		}
		$entries->update_flags( (int) $entry['id'], $changes );
		if ( isset( $changes['is_public'] ) && (bool) (int) $entry['is_public'] !== (bool) $changes['is_public'] ) {
			// What shows on the website is worth a trace.
			( new MigrationStore( SecretBox::for_site() ) )->audit( $changes['is_public'] ? 'entry_published' : 'entry_unpublished', 'entry', (string) $entry['id'] );
		}
		if ( ! isset( $changes['assigned_to'] ) || (int) $entry['assigned_to'] === (int) $changes['assigned_to'] ) {
			return false;
		}
		( new MigrationStore( SecretBox::for_site() ) )->audit(
			'entry_assigned',
			'entry',
			(string) $entry['id'],
			array(
				'user' => get_current_user_id(),
				'to'   => (int) $changes['assigned_to'],
			)
		);
		return 0 !== (int) $changes['assigned_to'] && get_current_user_id() !== (int) $changes['assigned_to'];
	}

	/**
	 * Whether an entry may be shown on the website: complete, and with the visitor's consent where
	 * the form asks for it.
	 *
	 * @param array<string,mixed> $entry Entry.
	 */
	private static function publishable( array $entry ): bool {
		$forms  = new FormRepository();
		$form   = null === $entry['form_id'] ? null : $forms->by_id( (int) $entry['form_id'] );
		$doc    = null === $form || empty( $form['current_revision_id'] ) ? null : $forms->document( (int) $form['current_revision_id'] );
		$public = Edition::pro( PublicEntries::class );
		return 'complete' === $entry['status'] && null !== $doc && null !== $public && $public::consented( $doc, $entry );
	}

	/**
	 * POST entries/<id>/notes.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function add_note( \WP_REST_Request $request ): \WP_REST_Response {
		$entries = new EntryRepository();
		$id      = (int) $request['id'];
		if ( null === $entries->find( $id ) ) {
			return self::not_found();
		}
		$text = trim( sanitize_textarea_field( (string) $request['text'] ) );
		if ( '' === $text ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'empty_note',
					'message' => __( 'The note is empty.', 'funnelforms-free' ),
				),
				400
			);
		}
		$note = $entries->note( $id, $entries->add_note( $id, get_current_user_id(), $text ) );
		return null === $note ? self::not_found() : new \WP_REST_Response( self::note( $note ), 201 );
	}

	/**
	 * DELETE entries/<id>/notes/<note>: by its author or an admin.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function delete_note( \WP_REST_Request $request ): \WP_REST_Response {
		$entries = new EntryRepository();
		$note    = $entries->note( (int) $request['id'], (int) $request['note'] );
		if ( null === $note ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'note_not_found',
					'message' => __( 'Note not found.', 'funnelforms-free' ),
				),
				404
			);
		}
		if ( get_current_user_id() !== (int) $note['user_id'] && ! current_user_can( 'manage_options' ) ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'not_note_author',
					'message' => __( 'Only its author or an administrator can delete this note.', 'funnelforms-free' ),
				),
				403
			);
		}
		$entries->delete_note( (int) $note['id'] );
		return new \WP_REST_Response( array( 'deleted' => true ), 200 );
	}

	/**
	 * GET entries/tags.
	 */
	public static function tags(): \WP_REST_Response {
		$out = array();
		foreach ( ( new EntryRepository() )->tag_counts() as $tag => $count ) {
			$out[] = array(
				'tag'     => (string) $tag,
				'entries' => $count,
			);
		}
		return new \WP_REST_Response( $out, 200 );
	}

	/**
	 * GET entries/assignees.
	 */
	public static function assignees(): \WP_REST_Response {
		$out = array();
		foreach ( self::assignee_users() as $user ) {
			$out[] = array(
				'id'   => (int) $user->ID,
				'name' => (string) $user->display_name,
			);
		}
		return new \WP_REST_Response( $out, 200 );
	}

	/**
	 * Users of roles that have the entries capability, by name; at most 200. (A capability query
	 * of WP_User_Query reads the stored role data and misses the rights administrators get from
	 * Application\Capabilities, so roles are asked one by one.)
	 *
	 * @return \WP_User[]
	 */
	private static function assignee_users(): array {
		$capability = FileDownload::capability();
		$roles      = array();
		foreach ( wp_roles()->role_objects as $slug => $role ) {
			if ( $role->has_cap( $capability ) ) {
				$roles[] = (string) $slug;
			}
		}
		if ( array() === $roles ) {
			return array();
		}
		$users = get_users(
			array(
				'role__in' => $roles,
				'orderby'  => 'display_name',
				'number'   => 200,
			)
		);
		return array_values( array_filter( $users, static fn( $user ): bool => $user instanceof \WP_User && $user->has_cap( $capability ) ) );
	}

	/**
	 * Whether a user may be assigned entries.
	 *
	 * @param int $user_id User ID.
	 */
	private static function assignable( int $user_id ): bool {
		return false !== get_userdata( $user_id ) && user_can( $user_id, FileDownload::capability() );
	}

	/**
	 * Tells a user by mail that entries were assigned to them.
	 *
	 * @param int                            $user_id User ID.
	 * @param array<int,array<string,mixed>> $assigned    Entries with decoded JSON columns.
	 */
	private static function notify_assignee( int $user_id, array $assigned ): void {
		$user = get_userdata( $user_id );
		/**
		 * Whether to mail a user when entries are assigned to them.
		 *
		 * @param bool  $notify  Default true.
		 * @param int   $user_id Assigned user.
		 * @param array $assigned    Entries.
		 */
		if ( array() === $assigned || false === $user || '' === (string) $user->user_email || ! apply_filters( 'funnelforms_notify_assignee', true, $user_id, $assigned ) ) {
			return;
		}
		$switched = switch_to_user_locale( $user_id );
		$by       = wp_get_current_user();
		$name     = $by->exists() ? $by->display_name : __( 'Someone', 'funnelforms-free' );
		if ( 1 === count( $assigned ) ) {
			$summary = self::summary( $assigned[0] );
			/* translators: %s: name of the user who assigned the entry */
			$lines = array( sprintf( __( '%s assigned an entry to you.', 'funnelforms-free' ), $name ), '' );
			if ( null !== $summary['form'] ) {
				/* translators: %s: form title */
				$lines[] = sprintf( __( 'Form: %s', 'funnelforms-free' ), $summary['form']['title'] );
			}
			/* translators: %s: name of the lead stage, such as "Contacted" */
			$lines[] = sprintf( __( 'Lead status: %s', 'funnelforms-free' ), $summary['leadStage'] );
			foreach ( $summary['contact'] as $field ) {
				if ( is_scalar( $field['value'] ) && '' !== (string) $field['value'] ) {
					$lines[] = $field['label'] . ': ' . $field['value'];
				}
			}
			/* translators: %d: entry ID */
			$subject = sprintf( __( 'Entry #%d was assigned to you', 'funnelforms-free' ), (int) $assigned[0]['id'] );
		} else {
			/* translators: 1: name of the user who assigned the entries, 2: number of entries */
			$lines = array( sprintf( __( '%1$s assigned entries to you: %2$d', 'funnelforms-free' ), $name, count( $assigned ) ), '' );
			foreach ( $assigned as $entry ) {
				$summary = self::summary( $entry );
				$parts   = array( '#' . (int) $entry['id'] );
				if ( null !== $summary['form'] ) {
					$parts[] = $summary['form']['title'];
				}
				foreach ( $summary['contact'] as $field ) {
					if ( is_scalar( $field['value'] ) && '' !== (string) $field['value'] ) {
						$parts[] = (string) $field['value'];
						break;
					}
				}
				$lines[] = implode( ' – ', $parts );
			}
			/* translators: %d: number of entries */
			$subject = sprintf( __( 'Entries assigned to you: %d', 'funnelforms-free' ), count( $assigned ) );
		}
		MailServer::send( static fn() => wp_mail( $user->user_email, $subject, implode( "\n", $lines ) ) );
		if ( $switched ) {
			restore_previous_locale();
		}
	}

	/**
	 * DELETE entries/<id>: with its files, delivery log and ended bookings. The copy in the 3.x
	 * lead list goes too; a lead imported from 3.x stays there and is not imported again.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function destroy( \WP_REST_Request $request ): \WP_REST_Response {
		$entries = new EntryRepository();
		$entry   = $entries->find( (int) $request['id'] );
		if ( null === $entry ) {
			return self::not_found();
		}
		return new \WP_REST_Response(
			array(
				'deleted'          => true,
				'legacyLeadRemain' => self::delete_entry( $entries, $entry ),
			),
			200
		);
	}

	/**
	 * Deletes an entry and logs it.
	 *
	 * @param EntryRepository     $entries Repository.
	 * @param array<string,mixed> $entry   Entry.
	 * @return bool Whether the lead stays in the 3.x lead list (imported leads).
	 */
	private static function delete_entry( EntryRepository $entries, array $entry ): bool {
		$entries->delete( (int) $entry['id'], true );
		$legacy_kept = null !== $entry['legacy_post_id'] && LeadMirror::entry_deleted( (int) $entry['legacy_post_id'], 'deleted' );
		( new MigrationStore( SecretBox::for_site() ) )->audit( 'entry_deleted', 'entry', (string) $entry['id'], array( 'user' => get_current_user_id() ) );
		return $legacy_kept;
	}

	/**
	 * POST entries/<id>/not-spam.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function not_spam( \WP_REST_Request $request ): \WP_REST_Response {
		$entries = new EntryRepository();
		if ( null === $entries->find( (int) $request['id'] ) ) {
			return self::not_found();
		}
		$result = SubmitEntry::create()->release_spam( (int) $request['id'] );
		if ( ! $result['ok'] ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'not_spam',
					'message' => __( 'This entry is not in the spam folder.', 'funnelforms-free' ),
				),
				409
			);
		}
		( new MigrationStore( SecretBox::for_site() ) )->audit( 'entry_not_spam', 'entry', (string) $request['id'], array( 'user' => get_current_user_id() ) );
		return new \WP_REST_Response( self::summary( (array) $entries->find( (int) $request['id'] ) ) + array( 'appointmentTaken' => isset( $result['appointment'] ) ), 200 );
	}

	/**
	 * POST entries/<id>/resend: queues the action again as a new delivery.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function resend( \WP_REST_Request $request ): \WP_REST_Response {
		$entries = new EntryRepository();
		$entry   = $entries->find( (int) $request['id'] );
		if ( null === $entry ) {
			return self::not_found();
		}
		$action = (string) $request['action'];
		if ( ! in_array( $action, array_column( self::actions( $entry ), 'id' ), true ) ) {
			return new \WP_REST_Response(
				array(
					'code'    => 'not_resendable',
					'message' => __( 'This action cannot be sent again for this entry.', 'funnelforms-free' ),
				),
				400
			);
		}
		( new ActionQueue( $entries ) )->enqueue( (int) $entry['id'], array( array( 'id' => $action ) ) );
		return new \WP_REST_Response( array( 'queued' => true ), 202 );
	}

	/**
	 * Actions that can run again: those of the revision the visitor sent, for entries of the new
	 * renderer. Entries imported from 3.x have no submission to rebuild.
	 *
	 * @param array<string,mixed> $entry Entry.
	 * @return array<int,array{id:string,kind:string}>
	 */
	private static function actions( array $entry ): array {
		if ( Edition::is_free() ) {
			// Sending again is Funnelforms Pro.
			return array();
		}
		$document = self::revision_document( $entry );
		$out      = array();
		foreach ( (array) ( $document['actions'] ?? array() ) as $action ) {
			if ( in_array( $action['kind'], Document::BROWSER_ACTIONS, true ) ) {
				// Sent once by the visitor's browser; nothing to send again.
				continue;
			}
			$out[] = array(
				'id'   => (string) $action['id'],
				'kind' => (string) $action['kind'],
			);
		}
		$optin = Edition::pro( DoubleOptIn::class );
		if ( 'pending' === ( $entry['optin_status'] ?? '' ) && null !== $optin ) {
			// The confirmation link can be sent again while the visitor has not confirmed.
			$out[] = array(
				'id'   => $optin::JOB,
				'kind' => 'optin',
			);
		}
		return $out;
	}

	/**
	 * The document of the revision an entry was sent with; null for imported entries.
	 *
	 * @param array<string,mixed> $entry Entry.
	 * @return array<string,mixed>|null
	 */
	private static function revision_document( array $entry ): ?array {
		$revision = (int) ( $entry['meta']['v5']['revisionId'] ?? 0 );
		return 0 === $revision ? null : ( new FormRepository() )->document( $revision );
	}

	/**
	 * What lists show of an entry.
	 *
	 * @param array<string,mixed> $entry Entry with decoded JSON columns.
	 * @return array<string,mixed>
	 */
	private static function summary( array $entry ): array {
		$form    = null === $entry['form_id'] ? null : ( new FormRepository() )->by_id( (int) $entry['form_id'] );
		$contact = array();
		foreach ( (array) ( $entry['data']['contact'] ?? array() ) as $field ) {
			if ( is_array( $field ) ) {
				$contact[] = array(
					'label' => (string) ( $field['label'] ?? '' ),
					'type'  => (string) ( $field['type'] ?? '' ),
					'value' => $field['value'] ?? null,
				);
			}
		}
		return array(
			'id'           => (int) $entry['id'],
			'uid'          => (string) $entry['uid'],
			'form'         => null === $form ? null : array(
				'id'       => (int) $form['id'],
				'legacyId' => null === $form['legacy_post_id'] ? null : (int) $form['legacy_post_id'],
				'title'    => (string) $form['title'],
			),
			'status'       => (string) $entry['status'],
			// Why the entry is in the spam folder (SpamCheck::REASONS); null for other entries.
			'spam'         => 'spam' === $entry['status'] ? array( 'reasons' => array_values( array_map( 'strval', (array) ( $entry['meta']['spam']['reasons'] ?? array() ) ) ) ) : null,
			'leadStatus'   => (string) $entry['lead_status'],
			// The name of the stage as the site calls it (Funnelforms → Entries, board).
			'leadStage'    => LeadStages::name( (string) $entry['lead_status'] ),
			'read'         => (bool) (int) $entry['is_read'],
			'archived'     => (bool) (int) ( $entry['is_archived'] ?? 0 ),
			'public'       => (bool) (int) ( $entry['is_public'] ?? 0 ),
			'tags'         => EntryRepository::entry_tags( $entry ),
			'score'        => isset( $entry['score'] ) ? (float) $entry['score'] : null,
			'value'        => isset( $entry['lead_value'] ) ? (float) $entry['lead_value'] : null,
			'variants'     => (object) ( $entry['meta']['v5']['variants'] ?? array() ),
			'optIn'        => '' === (string) ( $entry['optin_status'] ?? '' ) ? null : array(
				'status'      => (string) $entry['optin_status'],
				'confirmedAt' => self::time( $entry['optin_at'] ?? null ),
			),
			'payment'      => self::payment( $entry ),
			'assignedTo'   => self::user( $entry['assigned_to'] ?? null ),
			'imported'     => isset( $entry['meta']['legacy'] ),
			'legacyLeadId' => null === $entry['legacy_post_id'] ? null : (int) $entry['legacy_post_id'],
			'locale'       => (string) $entry['locale'],
			'createdAt'    => self::time( $entry['created_at'] ),
			'completedAt'  => self::time( $entry['completed_at'] ),
			'sourceUrl'    => $entry['source_url'],
			'device'       => (string) ( $entry['device'] ?? '' ),
			'contact'      => $contact,
			'abandon'      => self::abandon( $entry ),
		);
	}

	/**
	 * Of an entry whose visitor left after giving the address: the state of the reminder, the step
	 * where the visitor left and when; null for other entries and in Funnelforms Free.
	 *
	 * @param array<string,mixed> $entry Entry with decoded JSON columns.
	 * @return array<string,mixed>|null
	 */
	private static function abandon( array $entry ): ?array {
		$abandon = Edition::pro( Abandonment::class );
		if ( null === $abandon || ! isset( $entry['meta']['abandon'] ) ) {
			return null;
		}
		$document = self::revision_document( $entry );
		return $abandon::summary( $entry, null === $document ? null : new Document( $document ) );
	}

	/**
	 * How the visitor filled in the form, with the steps named by their first question; null for
	 * entries from before 5.0 or imported ones.
	 *
	 * @param array<string,mixed>      $entry    Entry.
	 * @param array<string,mixed>|null $document Document of the revision the entry was made with.
	 * @return array<string,mixed>|null
	 */
	public static function visit( array $entry, ?array $document ): ?array {
		$visit = $entry['meta']['visit'] ?? null;
		if ( ! is_array( $visit ) ) {
			return null;
		}
		$titles = array();
		foreach ( (array) ( $document['nodes'] ?? array() ) as $node ) {
			$field = $node['fields'][0] ?? null;
			if ( 'contact' === ( $node['type'] ?? '' ) ) {
				$titles[ $node['id'] ] = __( 'Contact details', 'funnelforms-free' );
			} elseif ( is_array( $field ) ) {
				$label                 = $field['label'] ?? array();
				$text                  = is_array( $label ) ? (string) ( $label[ $entry['locale'] ] ?? reset( $label ) ) : '';
				$titles[ $node['id'] ] = trim( wp_strip_all_tags( $text ) );
			}
		}
		$steps = array();
		foreach ( (array) ( $visit['steps'] ?? array() ) as $node => $seconds ) {
			$steps[] = array(
				'node'    => (string) $node,
				'title'   => $titles[ $node ] ?? '',
				'seconds' => (int) $seconds,
			);
		}
		return array(
			'device'   => (string) ( $visit['device'] ?? '' ),
			'browser'  => (string) ( $visit['browser'] ?? '' ),
			'os'       => (string) ( $visit['os'] ?? '' ),
			'referrer' => (string) ( $visit['referrer'] ?? '' ),
			'seconds'  => isset( $visit['seconds'] ) ? (int) $visit['seconds'] : null,
			'steps'    => $steps,
		);
	}

	/**
	 * The payment of an entry as the API shows it; null without one.
	 *
	 * @param array<string,mixed> $entry Entry.
	 * @return array<string,mixed>|null
	 */
	public static function payment( array $entry ): ?array {
		$payment  = $entry['meta']['payment'] ?? null;
		$provider = Edition::pro( PaymentProvider::class );
		if ( ! is_array( $payment ) ) {
			return null;
		}
		return array(
			'status'       => (string) $payment['status'],
			'provider'     => (string) $payment['provider'],
			'mode'         => (string) $payment['mode'],
			'interval'     => $payment['interval'] ?? null,
			'amount'       => (float) $payment['amount'],
			'total'        => (float) $payment['total'],
			'currency'     => (string) $payment['currency'],
			'reference'    => '' === (string) $payment['reference'] ? null : (string) $payment['reference'],
			'subscription' => $payment['subscription'] ?? null,
			'paidAt'       => $payment['paidAt'] ?? null,
			'error'        => $payment['error'] ?? null,
		) + ( null === $provider ? array() : $provider::receipt( $payment ) );
	}

	/**
	 * A note as the API shows it.
	 *
	 * @param array<string,mixed> $note Note row.
	 * @return array<string,mixed>
	 */
	private static function note( array $note ): array {
		return array(
			'id'        => (int) $note['id'],
			'text'      => (string) $note['note'],
			'author'    => self::user( $note['user_id'] ),
			'createdAt' => self::time( $note['created_at'] ),
		);
	}

	/**
	 * A user as the API shows it.
	 *
	 * @param mixed $id User ID or null.
	 * @return array{id:int,name:string}|null
	 */
	private static function user( $id ): ?array {
		$user = (int) $id > 0 ? get_userdata( (int) $id ) : false;
		if ( false === $user ) {
			return (int) $id > 0 ? array(
				'id'   => (int) $id,
				'name' => '',
			) : null;
		}
		return array(
			'id'   => (int) $user->ID,
			'name' => (string) $user->display_name,
		);
	}

	/**
	 * UTC time as ISO 8601.
	 *
	 * @param mixed $time Y-m-d H:i:s in UTC, or null.
	 */
	private static function time( $time ): ?string {
		return is_string( $time ) && '' !== $time ? gmdate( 'Y-m-d\TH:i:s\Z', (int) strtotime( $time . ' UTC' ) ) : null;
	}

	/**
	 * 404 answer.
	 */
	private static function not_found(): \WP_REST_Response {
		return new \WP_REST_Response(
			array(
				'code'    => 'entry_not_found',
				'message' => __( 'Entry not found.', 'funnelforms-free' ),
			),
			404
		);
	}
}
