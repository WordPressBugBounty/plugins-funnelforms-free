<?php
/**
 * Use case: a visitor submits a form shown by the new renderer.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Application\Actions\ActionQueue;
use Funnelforms\Domain\Entry\AnswerValidator;
use Funnelforms\Domain\Entry\EntryData;
use Funnelforms\Domain\Entry\Submission;
use Funnelforms\Domain\Entry\Templates;
use Funnelforms\Domain\Entry\VisitAnalytics;
use Funnelforms\Domain\Entry\VisitorTracking;
use Funnelforms\Domain\Form\Calculator;
use Funnelforms\Domain\Form\Document;
use Funnelforms\Domain\Form\Experiments;
use Funnelforms\Domain\Form\PhoneNumbers;
use Funnelforms\Domain\Form\RendererSupport;
use Funnelforms\Domain\Form\Walker;
use Funnelforms\Edition\Edition;
use Funnelforms\Http\Captcha;
use Funnelforms\Http\FileDownload;
use Funnelforms\Infrastructure\Repository\EntryRepository;
use Funnelforms\Infrastructure\Repository\FileRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;
use Funnelforms\Integrations\Akismet;
use Funnelforms\Frontend\UiLocale;

defined( 'ABSPATH' ) || exit;

/**
 * Checks the answers again on the server, stores the entry and queues its mails and webhooks.
 * Knows nothing about HTTP; the REST controller passes plain arrays.
 */
final class SubmitEntry {

	/**
	 * Creates the use case.
	 *
	 * @param FormRepository  $forms   Forms.
	 * @param EntryRepository $entries Entries.
	 * @param ActionQueue     $queue   Background delivery.
	 * @param FileRepository  $files   Uploaded files.
	 * @param Payments|null   $payments Payments of forms that take one; null in Funnelforms Free.
	 * @param Bookings|null   $bookings Appointments of booking fields; the site's when null.
	 */
	public function __construct(
		private FormRepository $forms,
		private EntryRepository $entries,
		private ActionQueue $queue,
		private FileRepository $files,
		private ?object $payments = null,
		private ?object $bookings = null
	) {}

	/**
	 * Use case with the site services; Funnelforms Free has no payments.
	 */
	public static function create(): self {
		$entries  = new EntryRepository();
		$payments = Edition::pro( Payments::class );
		return new self( new FormRepository(), $entries, new ActionQueue( $entries ), new FileRepository(), null === $payments ? null : $payments::create() );
	}

	/**
	 * Handles one submission.
	 *
	 * An entry the spam checks (SpamCheck) put into the spam folder is stored with the status spam
	 * and nothing else happens: no payment, appointment, mail, action or conversion. The visitor
	 * sees the same end as for any entry; the answer has no entry ID and no event ID, and spam=true
	 * for the route, which takes it out.
	 *
	 * @param array<string,mixed> $form  Form row.
	 * @param array<string,mixed> $input answers, contact, page (url, query, title), locale, and
	 *                                   signals (spam reasons the route found: honeypot, too_fast).
	 * @return array<string,mixed> ok=true with entry, end and path (contact step and end node), or
	 *                             ok=false with code and fields.
	 */
	public function handle( array $form, array $input ): array {
		$document = self::shown_document( $this->forms, $form );
		if ( null === $document ) {
			return self::failure( 'form_unavailable' );
		}
		$checked = $this->check( $form, $document, $input, false );
		if ( ! $checked['ok'] ) {
			return $checked;
		}
		$doc        = $checked['doc'];
		$walk       = $checked['walk'];
		$contact    = $checked['contact'];
		$file_ids   = $checked['files'];
		$submission = $checked['submission'];
		$judged     = SpamCheck::judge( $submission, array_merge( $checked['signals'], array_map( 'strval', (array) ( $input['signals'] ?? array() ) ) ), (string) ( $input['ip'] ?? '' ), (string) ( $input['userAgent'] ?? '' ) );
		if ( 'reject' === $judged['verdict'] ) {
			return self::failure( 'rejected' );
		}
		$spam    = 'spam' === $judged['verdict'];
		$payment = null === $this->payments || $spam ? null : $this->payments::settings( $submission );
		$amounts = null === $payment ? null : $this->payments::amounts( $payment, $submission );
		if ( false === $amounts || ( null !== $amounts && ! $this->payments->available( $payment ) ) ) {
			// The amount must be known and the provider connected before the entry is taken.
			return self::failure( 'payment_unavailable' );
		}

		// Appointments are booked before the entry is stored, so a time taken meanwhile can still
		// be chosen again; they are freed when the entry cannot be stored.
		$booked = $spam ? array(
			'ids'    => array(),
			'errors' => array(),
		) : $this->book( $submission, false );
		if ( array() !== $booked['errors'] ) {
			return self::failure( 'invalid_answers', $booked['errors'] );
		}

		$legacy_form = null === $form['legacy_post_id'] ? null : (int) $form['legacy_post_id'];
		$row         = EntryData::row( $submission, (int) $form['current_revision_id'] );
		$actions     = $doc->submit_actions( $walk['contact'] );
		$public      = Edition::pro( PublicEntries::class );
		if ( null !== $public && $public::publish_on_submit( $document, $contact ) ) {
			$row['is_public'] = 1;
		}
		$row['meta']['visit'] = VisitAnalytics::from_input( $input['analytics'] ?? null, (string) ( $input['userAgent'] ?? '' ), $walk['nodes'] );
		$row['device']        = $row['meta']['visit']['device'];
		$submission->visit    = $row['meta']['visit'];
		if ( in_array( 'conversion', array_column( $actions, 'kind' ), true ) ) {
			$tracking = VisitorTracking::from_input( $input['tracking'] ?? null, (string) ( $input['ip'] ?? '' ), (string) ( $input['userAgent'] ?? '' ), PrivacyMode::eu(), PrivacyMode::open() );
			if ( null !== $tracking ) {
				$row['meta']['tracking'] = $tracking;
			}
		}
		if ( $spam ) {
			$row['status']       = 'spam';
			$row['meta']['spam'] = array(
				'reasons' => $judged['reasons'],
				'at'      => gmdate( 'Y-m-d H:i:s' ),
			) + ( isset( $judged['akismet'] ) ? array( 'akismet' => $judged['akismet'] ) : array() );
		}
		$draft    = self::draft_key( $input['draft'] ?? null );
		$abandon  = Edition::pro( Abandonment::class );
		$recovery = null === $abandon ? null : $abandon::create()->recovery( $form, $draft, $input['progress'] ?? null, $submission );
		$entry_id = 0;
		if ( null !== $recovery && null !== $recovery['meta'] ) {
			// The visitor had left once: the entry says whether the reminder brought them back.
			$row['meta']['abandon'] = $recovery['meta'];
		}
		if ( null !== $recovery && $recovery['id'] > 0 ) {
			$entry_id = $this->entries->replace( $recovery['id'], array( 'draft_hash' => null ) + $row ) ? $recovery['id'] : 0;
		}
		if ( 0 === $entry_id && null !== $draft && ! empty( $doc->raw()['settings']['savePartialEntries'] ) ) {
			$entry_id = $this->entries->complete_partial( (int) $form['id'], hash( 'sha256', $draft ), $row );
		}
		if ( 0 === $entry_id ) {
			$entry_id = $this->entries->insert( (int) $form['id'], $legacy_form, $row );
		}
		if ( 0 === $entry_id ) {
			$this->bookings()?->release( $booked['ids'] );
			return self::failure( 'storage_failed' );
		}
		$submission->entry_id = $entry_id;
		if ( null !== $recovery ) {
			$abandon::create()->recovered( $recovery );
		}
		$this->bookings()?->attach( $booked['ids'], $entry_id );
		$this->files->attach( $file_ids['public'] ?? array(), $entry_id, gmdate( 'Y-m-d H:i:s', time() + FileDownload::public_link_days() * DAY_IN_SECONDS ) );
		$this->files->attach( $file_ids['private'] ?? array(), $entry_id, null );
		if ( $spam ) {
			/**
			 * Fires after the new renderer put an entry into the spam folder; nothing was sent.
			 *
			 * @param int      $entry_id Entry ID.
			 * @param int      $form_id  Form ID.
			 * @param string[] $reasons  Why (SpamCheck::REASONS).
			 */
			do_action( 'funnelforms_entry_spam', $entry_id, (int) $form['id'], $judged['reasons'] );
			return array(
				'ok'      => true,
				'entry'   => 0,
				'eventId' => '',
				'end'     => self::end_response( $submission ),
				'spam'    => true,
			);
		}
		$this->deliver( $submission, (int) $form['id'], $actions, array() !== $booked['ids'] );

		$out         = array(
			'ok'      => true,
			'entry'   => $entry_id,
			'eventId' => self::event_id( $entry_id ),
			'end'     => self::end_response( $submission ),
			// For the statistics (FormStats::completed()); the route takes it out of the answer.
			'path'    => array(
				'contact' => (string) $walk['contact'],
				'end'     => (string) ( $submission->end ?? '' ),
			),
		);
		$conversions = self::browser_conversions( $doc->browser_actions( $walk['contact'] ), $submission );
		if ( array() !== $conversions ) {
			$out['conversions'] = $conversions;
		}
		if ( null !== $amounts && null !== $payment ) {
			// The browser goes on to the payment page; the end follows when the visitor comes back.
			$out['payment'] = $this->payments->start( $submission, $payment, $amounts );
		}
		return $out;
	}

	/**
	 * Whether the number of a contact field may be sent: fields confirmed by text message need the
	 * proof the phone/confirm route gave for this number (Funnelforms Pro; Free sends no codes, so
	 * such fields block the form there, see Edition).
	 *
	 * @param array<string,mixed> $form  Form row.
	 * @param array<string,mixed> $field Contact field.
	 * @param string              $value Number as stored (E.164).
	 * @param mixed               $proof Proof from the browser.
	 */
	private static function phone_proven( array $form, array $field, string $value, $proof ): bool {
		if ( ! PhoneNumbers::confirms( $field ) ) {
			return true;
		}
		$verification = Edition::pro( PhoneVerification::class );
		return null !== $verification && $verification::proven( (string) $form['uid'], (string) $field['id'], $value, $proof, time() );
	}

	/**
	 * What follows a stored entry: the 3.x lead list, the double opt-in, the actions, the
	 * invitations of booked appointments and the hook for other plugins.
	 *
	 * @param Submission                     $s            Submission with entry_id.
	 * @param int                            $form_id      Form ID.
	 * @param array<int,array<string,mixed>> $actions      Actions of the submit.
	 * @param bool                           $appointments Whether appointments were booked.
	 */
	private function deliver( Submission $s, int $form_id, array $actions, bool $appointments ): void {
		$entry_id = $s->entry_id;
		$optin    = Edition::pro( DoubleOptIn::class );
		$confirm  = null !== $optin && $optin::applies( $s );
		if ( $confirm ) {
			// The rest waits for the confirmation of the address, the 3.x lead included.
			$actions = ( new $optin( $this->entries, $this->forms, $this->queue ) )->start( $s, $actions );
		} else {
			LeadMirror::write( $entry_id, $s );
		}
		$this->queue->enqueue( $entry_id, $actions );
		$notices = Edition::pro( BookingNotices::class );
		if ( $appointments && ! $confirm && null !== $notices ) {
			// With double opt-in the invitation waits for the confirmed address too.
			$notices::create()->schedule( $entry_id, $this->queue, time() );
		}

		/**
		 * Fires after the new renderer stored an entry; mails and webhooks are queued at this point.
		 * For an entry taken out of the spam folder it fires then.
		 *
		 * @param int $entry_id Entry ID.
		 * @param int $form_id  Form ID.
		 */
		do_action( 'funnelforms_entry_created', $entry_id, $form_id );
	}

	/**
	 * "Not spam": takes an entry out of the spam folder and runs what was held back, as if it had
	 * just been sent: the appointments are booked now (a time taken meanwhile is reported, the
	 * entry is taken anyway), then the 3.x lead, double opt-in, mails and actions follow. Akismet
	 * learns that it was wrong. Payments are not started; the visitor has left the form.
	 *
	 * @param int $entry_id Entry ID.
	 * @return array<string,mixed> ok=true, with appointment=taken when a time could not be booked;
	 *                             ok=false with code not_spam.
	 */
	public function release_spam( int $entry_id ): array {
		$entry = $this->entries->find( $entry_id );
		if ( null === $entry || 'spam' !== $entry['status'] ) {
			return self::failure( 'not_spam' );
		}
		$meta    = is_array( $entry['meta'] ) ? $entry['meta'] : array();
		$akismet = (array) ( $meta['spam']['akismet'] ?? array() );
		$reasons = (array) ( $meta['spam']['reasons'] ?? array() );
		unset( $meta['spam'] );
		$meta['spamReleased'] = array(
			'at'      => gmdate( 'Y-m-d H:i:s' ),
			'user'    => get_current_user_id(),
			'reasons' => $reasons,
		);
		if ( ! $this->entries->release_spam( $entry_id, $meta ) ) {
			return self::failure( 'not_spam' );
		}
		if ( array() !== $akismet ) {
			Akismet::report_ham( array_map( 'strval', $akismet ) );
		}
		$revision = (int) ( $meta['v5']['revisionId'] ?? 0 );
		$raw      = 0 === $revision ? null : $this->forms->document( $revision );
		$out      = array( 'ok' => true );
		if ( null === $raw ) {
			return $out;
		}
		$entry['meta'] = $meta;
		$s             = EntryData::submission( $entry, new Document( $raw ) );
		$booked        = $this->book( $s, false );
		if ( array() !== $booked['errors'] ) {
			$out['appointment'] = 'taken';
		} elseif ( array() !== $booked['ids'] ) {
			$this->bookings()?->attach( $booked['ids'], $entry_id );
			$row        = EntryData::row( $s, $revision );
			$meta['v5'] = $row['meta']['v5'];
			$this->entries->update_answers( $entry_id, $row['data'], $meta );
		}
		$this->deliver( $s, (int) $entry['form_id'], $s->document->submit_actions( $s->contact ), array() !== $booked['ids'] );
		return $out;
	}

	/**
	 * A test run of a submission in the builder's preview: the answers are checked like a real
	 * one, but nothing is stored or sent; uploads and captchas are taken as they are.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document The document previewed (usually the draft).
	 * @param array<string,mixed> $input    As for handle().
	 * @return array<string,mixed> ok=true with the end, or ok=false with code and fields.
	 */
	public function preview( array $form, array $document, array $input ): array {
		$checked = $this->check( $form, $document, $input, true );
		if ( ! $checked['ok'] ) {
			return $checked;
		}
		$booked = $this->book( $checked['submission'], true );
		if ( array() !== $booked['errors'] ) {
			return self::failure( 'invalid_answers', $booked['errors'] );
		}
		return array(
			'ok'      => true,
			'entry'   => 0,
			'eventId' => '',
			'end'     => self::end_response( $checked['submission'] ),
			'preview' => true,
		);
	}

	/**
	 * Checks a submission: the answers on the path, the contact step, files and captchas.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Document.
	 * @param array<string,mixed> $input    As for handle().
	 * @param bool                $preview  Test run: files and captchas are not looked up.
	 * @return array<string,mixed> ok=false with code and fields, or ok=true with doc, walk,
	 *                             contact, files (ids by visibility), submission and signals
	 *                             (spam reasons of the captcha check).
	 */
	private function check( array $form, array $document, array $input, bool $preview ): array {
		$doc    = new Document( $document );
		$locale = self::locale( $doc, (string) ( $input['locale'] ?? '' ) );

		$raw_answers = is_array( $input['answers'] ?? null ) ? $input['answers'] : array();
		$answers     = array();
		$errors      = array();
		foreach ( $raw_answers as $field_id => $value ) {
			$field = $doc->field( (string) $field_id );
			if ( null === $field || 'contact' === ( $doc->node( self::node_of( $doc, (string) $field_id ) )['type'] ?? '' ) ) {
				continue;
			}
			$result = AnswerValidator::step_field( $field, $value, $locale );
			if ( null !== $result['error'] ) {
				$errors[ $field_id ] = $result['error'];
			} elseif ( null !== $result['value'] ) {
				$answers[ $field_id ] = $result['value'];
			}
		}

		$variants = self::variants( $document, $input['variants'] ?? null );
		$walk     = Walker::walk( $doc, $answers, $variants );
		if ( null !== $walk['error'] ) {
			return self::failure( 'path_' . $walk['error'] );
		}
		if ( null === $walk['contact'] ) {
			return self::failure( 'no_contact_step' );
		}

		// Only the steps on the path count; answers the visitor left by going back are dropped.
		$field_errors = array();
		$path_answers = array();
		foreach ( $walk['fields'] as $field_id ) {
			$field = $doc->field( $field_id );
			if ( self::node_of( $doc, $field_id ) === $walk['contact'] ) {
				continue;
			}
			if ( isset( $errors[ $field_id ] ) ) {
				$field_errors[ $field_id ] = $errors[ $field_id ];
			} elseif ( array_key_exists( $field_id, $answers ) ) {
				$path_answers[ $field_id ] = $answers[ $field_id ];
			} elseif ( null !== AnswerValidator::step_field( $field, null )['error'] ) {
				$field_errors[ $field_id ] = 'required';
			}
		}

		$raw_contact = is_array( $input['contact'] ?? null ) ? $input['contact'] : array();
		$contact     = array();
		$captchas    = array();
		$signals     = array();
		foreach ( $doc->node( $walk['contact'] )['fields'] as $field ) {
			$result = AnswerValidator::contact_field( $field, $raw_contact[ $field['id'] ] ?? null, $locale );
			if ( null !== $result['error'] ) {
				$field_errors[ $field['id'] ] = $result['error'];
			} elseif ( ! $preview && '' !== (string) $result['value'] && ! self::phone_proven( $form, $field, (string) $result['value'], $raw_contact[ $field['id'] . ':proof' ] ?? null ) ) {
				$field_errors[ $field['id'] ] = 'phone_not_confirmed';
			} elseif ( 'captcha' === $field['type'] ) {
				// Checked with Google last, and never stored.
				$captchas[] = array( $field, (string) $result['value'] );
			} elseif ( null !== $result['value'] ) {
				$contact[ $field['id'] ] = $result['value'];
			}
		}
		$file_ids = array();
		foreach ( $path_answers as $field_id => $refs ) {
			if ( ! Document::holds_files( (array) $doc->field( (string) $field_id ) ) ) {
				continue;
			}
			if ( $preview ) {
				$path_answers[ $field_id ] = array_map(
					static fn( string $ref ): array => array(
						'id'   => 0,
						'name' => $ref,
						'size' => 0,
					),
					(array) $refs
				);
				continue;
			}
			$rows = $this->files->pending( (int) $form['id'], (string) $field_id, $refs, gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS ) );
			if ( count( $rows ) !== count( $refs ) ) {
				$field_errors[ $field_id ] = 'invalid_file';
				continue;
			}
			$path_answers[ $field_id ] = array();
			foreach ( $rows as $row ) {
				$file_ids[ $row['visibility'] ][] = (int) $row['id'];
				$path_answers[ $field_id ][]      = array(
					'id'   => (int) $row['id'],
					'name' => (string) $row['original_name'],
					'size' => (int) $row['size'],
				);
			}
		}

		if ( array() === $field_errors && ! $preview ) {
			foreach ( $captchas as list( $field, $response ) ) {
				$result = Captcha::check( $field, $response );
				if ( 'failed' === $result ) {
					$field_errors[ $field['id'] ] = 'captcha_failed';
				} elseif ( 'low' === $result ) {
					// reCAPTCHA v3 doubts the visitor: the spam folder, not a refusal.
					$signals[] = 'captcha_score';
				}
			}
		}
		if ( array() !== $field_errors ) {
			return self::failure( 'invalid_answers', $field_errors );
		}

		$page                 = is_array( $input['page'] ?? null ) ? $input['page'] : array();
		$submission           = new Submission(
			$doc,
			$locale,
			$walk['nodes'],
			$walk['fields'],
			$walk['contact'],
			$walk['end'],
			$path_answers,
			$contact,
			array(
				'url'   => self::page_value( $page['url'] ?? '', 2000 ),
				'query' => self::page_value( $page['query'] ?? '', 2000 ),
				'title' => self::page_value( $page['title'] ?? '', 500 ),
			),
			0,
			gmdate( 'Y-m-d H:i:s' )
		);
		$submission->variants = $variants;
		return array(
			'ok'         => true,
			'doc'        => $doc,
			'walk'       => $walk,
			'contact'    => $contact,
			'files'      => $file_ids,
			'submission' => $submission,
			'signals'    => $signals,
		);
	}

	/**
	 * Books the appointments of the booking fields on the path; their answers become what was
	 * booked (time, duration, type, readable text).
	 *
	 * @param Submission $s       Submission.
	 * @param bool       $preview Only check that the times are free.
	 * @return array{ids:list<int>,errors:array<string,string>}
	 */
	private function book( Submission $s, bool $preview ): array {
		$ids    = array();
		$errors = array();
		foreach ( $s->fields as $field_id ) {
			$field = $s->document->field( $field_id );
			if ( null === $field || 'booking' !== $field['type'] || ! is_array( $s->answers[ $field_id ] ?? null ) ) {
				continue;
			}
			$bookings = $this->bookings();
			$type     = $bookings?->type_of( $field );
			$start    = null === $bookings ? null : $bookings::parse_iso( $s->answers[ $field_id ]['start'] ?? null );
			$duration = (int) ( $s->answers[ $field_id ]['duration'] ?? 0 );
			if ( null === $bookings || null === $type || null === $start ) {
				$errors[ $field_id ] = 'booking_unavailable';
				continue;
			}
			if ( $preview ) {
				$new = $bookings->is_free( $type, $start, $duration, time() ) ? array() : null;
			} else {
				$new = $bookings->book( $type, $start, $duration, time() );
				$new = array() === $new ? null : $new;
			}
			if ( null === $new ) {
				$errors[ $field_id ] = 'slot_taken';
				continue;
			}
			$ids                     = array_merge( $ids, $new );
			$s->answers[ $field_id ] = $bookings::answer( $type, $start, $duration, $new );
		}
		if ( array() !== $errors && array() !== $ids ) {
			$this->bookings()?->release( $ids );
			$ids = array();
		}
		return array(
			'ids'    => $ids,
			'errors' => $errors,
		);
	}

	/**
	 * Appointments; null in Funnelforms Free.
	 *
	 * @return Bookings|null
	 */
	private function bookings(): ?object {
		if ( null === $this->bookings ) {
			$bookings       = Edition::pro( Bookings::class );
			$this->bookings = null === $bookings ? null : $bookings::create();
		}
		return $this->bookings;
	}

	/**
	 * The variants of A/B tests the visitor saw (A/B tests are Funnelforms Pro).
	 *
	 * @param array<string,mixed> $document Form document.
	 * @param mixed               $given    Variants the browser sent.
	 * @return array<string,string>
	 */
	private static function variants( array $document, $given ): array {
		$experiments = Edition::pro( Experiments::class );
		return null === $experiments ? array() : $experiments::resolve( $document, $given );
	}

	/**
	 * ID of the entry's conversion event, the same for the browser (dataLayer) and the server-side
	 * conversions, so the platforms count the lead once; unique across sites that share a pixel.
	 *
	 * @param int $entry_id Entry ID.
	 */
	public static function event_id( int $entry_id ): string {
		return 'ffx-' . substr( md5( home_url() ), 0, 8 ) . '-' . $entry_id;
	}

	/**
	 * Keeps the answers so far as an incomplete entry, for forms set to "save incomplete entries"
	 * (3.x saved them after every step). Answers that are invalid or off the path are left out, as
	 * are uploads and contact data; nothing is sent.
	 *
	 * @param array<string,mixed> $form  Form row.
	 * @param array<string,mixed> $input answers, draft (key from an earlier call), page, locale.
	 * @return array<string,mixed> ok=true with the draft key, or ok=false with code.
	 */
	public function save_partial( array $form, array $input ): array {
		$document = self::shown_document( $this->forms, $form );
		if ( null === $document ) {
			return self::failure( 'form_unavailable' );
		}
		$doc = new Document( $document );
		if ( empty( $doc->raw()['settings']['savePartialEntries'] ) ) {
			return self::failure( 'partial_entries_off' );
		}
		$path         = self::partial_path( $doc, $input['answers'] ?? null, $input['variants'] ?? null );
		$nodes        = $path['nodes'];
		$fields       = $path['fields'];
		$variants     = $path['variants'];
		$path_answers = $path['answers'];
		$draft        = self::draft_key( $input['draft'] ?? null ) ?? bin2hex( random_bytes( 16 ) );
		if ( array() === $path_answers ) {
			return array(
				'ok'    => true,
				'draft' => $draft,
			);
		}

		$page                 = is_array( $input['page'] ?? null ) ? $input['page'] : array();
		$submission           = new Submission(
			$doc,
			self::locale( $doc, (string) ( $input['locale'] ?? '' ) ),
			$nodes,
			$fields,
			'',
			null,
			$path_answers,
			array(),
			array(
				'url'   => self::page_value( $page['url'] ?? '', 2000 ),
				'query' => self::page_value( $page['query'] ?? '', 2000 ),
				'title' => self::page_value( $page['title'] ?? '', 500 ),
			),
			0,
			gmdate( 'Y-m-d H:i:s' )
		);
		$submission->variants = $variants;
		$legacy_form          = null === $form['legacy_post_id'] ? null : (int) $form['legacy_post_id'];
		$entry_id             = $this->entries->save_partial( (int) $form['id'], $legacy_form, hash( 'sha256', $draft ), EntryData::row( $submission, (int) $form['current_revision_id'] ) );
		return 0 === $entry_id ? self::failure( 'storage_failed' ) : array(
			'ok'    => true,
			'draft' => $draft,
		);
	}

	/**
	 * The valid step answers of a visitor who has not sent the form yet, on the path up to the
	 * first step without an answer (where the visitor is now). Uploads are left out.
	 *
	 * @param Document $doc      Document.
	 * @param mixed    $answers  Answers by field id as the browser sent them.
	 * @param mixed    $variants Variants of the A/B tests as the browser sent them.
	 * @return array{answers:array<string,mixed>,nodes:string[],fields:string[],variants:array<string,string>}
	 */
	public static function partial_path( Document $doc, $answers, $variants ): array {
		$valid = array();
		foreach ( is_array( $answers ) ? $answers : array() as $field_id => $value ) {
			$field = $doc->field( (string) $field_id );
			if ( null === $field || Document::holds_files( $field ) || 'step' !== ( $doc->node( self::node_of( $doc, (string) $field_id ) )['type'] ?? '' ) ) {
				continue;
			}
			$result = AnswerValidator::step_field( $field, $value );
			if ( null === $result['error'] && null !== $result['value'] ) {
				$valid[ $field_id ] = $result['value'];
			}
		}

		$variants = self::variants( $doc->raw(), $variants );
		$walk     = Walker::walk( $doc, $valid, $variants );
		$nodes    = array();
		$fields   = array();
		foreach ( $walk['nodes'] as $node_id ) {
			$node = $doc->node( $node_id );
			if ( 'step' !== $node['type'] ) {
				break;
			}
			$ids = array_column( $node['fields'], 'id' );
			if ( array() === array_intersect( $ids, array_keys( $valid ) ) && array() !== array_diff( array_column( $node['fields'], 'type' ), array( 'content', 'result' ) ) ) {
				break;
			}
			$nodes[] = $node_id;
			$fields  = array_merge( $fields, $ids );
		}
		return array(
			'answers'  => array_intersect_key( $valid, array_flip( $fields ) ),
			'nodes'    => $nodes,
			'fields'   => $fields,
			'variants' => $variants,
		);
	}

	/**
	 * A draft key as the browser sends it: 32 hex characters, or null.
	 *
	 * @param mixed $value Submitted value.
	 */
	public static function draft_key( $value ): ?string {
		return is_string( $value ) && 1 === preg_match( '/^[a-f0-9]{32}$/', $value ) ? $value : null;
	}

	/**
	 * Computes the calculations shown in a content step from the answers so far. With `live`
	 * (live results, ResultField) the numbers come along, so the browser can count up to them.
	 * An id "<id>:text" asks for the text of the range the result lies in (Calculation.texts).
	 * Calculations a live result keeps locked until the contact step (Calculator::locked()) give
	 * neither number nor text, only a placeholder.
	 *
	 * @param array<string,mixed>      $form     Form row.
	 * @param array<string,mixed>      $input    answers, the calculation ids wanted and live.
	 * @param array<string,mixed>|null $document Document to use instead of the shown one (preview).
	 * @return array<string,mixed>
	 */
	public function calculate( array $form, array $input, ?array $document = null ): array {
		$document ??= self::shown_document( $this->forms, $form );
		if ( null === $document ) {
			return self::failure( 'form_unavailable' );
		}
		$calculator = Edition::pro( Calculator::class );
		if ( null === $calculator ) {
			return self::failure( 'calculations_unavailable' );
		}
		$doc                     = new Document( $document );
		list( $answers, $order ) = self::valid_answers( $doc, $input['answers'] ?? null );
		$values                  = $calculator::values( $doc, $order, $answers );
		$out                     = array();
		$numbers                 = array();
		$locked                  = $calculator::locked( $document );
		$locale                  = is_string( $input['locale'] ?? null ) && 1 === preg_match( '/^[A-Za-z]{2,3}(?:_[A-Za-z0-9]{2,8}){0,2}$/', $input['locale'] ) ? $input['locale'] : '';
		foreach ( array_slice( (array) ( $input['ids'] ?? array() ), 0, 50 ) as $id ) {
			$text = str_ends_with( (string) $id, ':text' );
			$calc = $doc->calculation( $text ? substr( (string) $id, 0, -5 ) : (string) $id );
			if ( null === $calc ) {
				continue;
			}
			if ( isset( $locked[ $calc['id'] ] ) ) {
				$out[ $id ]     = '•••';
				$numbers[ $id ] = null;
				continue;
			}
			$result = $calculator::compute( $calc, $values );
			if ( $text ) {
				$range          = $calculator::range_text( $calc, $result['ok'] ? (float) $result['value'] : null );
				$out[ $id ]     = null === $range ? '' : trim( wp_strip_all_tags( $doc->text( $range, $locale ) ) );
				$numbers[ $id ] = null;
				continue;
			}
			$out[ $id ]     = $result['ok'] ? $result['formatted'] : __( 'An error occurred in the calculation!', 'funnelforms-free' );
			$numbers[ $id ] = $result['ok'] && is_finite( (float) $result['value'] ) ? (float) $result['value'] : null;
		}
		return array(
			'ok'           => true,
			'calculations' => (object) $out,
		) + ( empty( $input['live'] ) ? array() : array( 'values' => (object) $numbers ) );
	}

	/**
	 * The node after a step whose edges compare calculations (the browser has no formulas).
	 * The answers so far decide, like for calculate(); the entry walks the path again anyway.
	 *
	 * @param array<string,mixed>      $form     Form row.
	 * @param array<string,mixed>      $input    answers and node.
	 * @param array<string,mixed>|null $document Document to use instead of the shown one (preview).
	 * @return array<string,mixed>
	 */
	public function next( array $form, array $input, ?array $document = null ): array {
		$document ??= self::shown_document( $this->forms, $form );
		if ( null === $document ) {
			return self::failure( 'form_unavailable' );
		}
		$doc  = new Document( $document );
		$node = $doc->node( (string) ( $input['node'] ?? '' ) );
		if ( null === $node || 'step' !== $node['type'] ) {
			return self::failure( 'unknown_node' );
		}
		list( $answers, $order ) = self::valid_answers( $doc, $input['answers'] ?? null );
		return array(
			'ok'   => true,
			'next' => \Funnelforms\Domain\Form\Conditions::next( $document, $node['id'], $answers, Walker::calculation( $doc, $order, $answers ), self::variants( $document, $input['variants'] ?? null ) ),
		);
	}

	/**
	 * The valid step answers among those sent, with their field ids in the order sent.
	 *
	 * @param Document $doc     Document.
	 * @param mixed    $answers Answers by field id.
	 * @return array{0:array<string,mixed>,1:string[]}
	 */
	private static function valid_answers( Document $doc, $answers ): array {
		$valid = array();
		$order = array();
		foreach ( is_array( $answers ) ? $answers : array() as $field_id => $value ) {
			$field = $doc->field( (string) $field_id );
			if ( null === $field ) {
				continue;
			}
			$result = AnswerValidator::step_field( $field, $value );
			if ( null === $result['error'] && null !== $result['value'] ) {
				$valid[ $field_id ] = $result['value'];
				$order[]            = (string) $field_id;
			}
		}
		return array( $valid, $order );
	}

	/**
	 * The document visitors see: the current revision, only while the form uses the new renderer
	 * and the renderer supports everything in it; with the site-wide captcha when one is set.
	 *
	 * @param FormRepository      $forms Forms.
	 * @param array<string,mixed> $form  Form row.
	 * @return array<string,mixed>|null
	 */
	public static function shown_document( FormRepository $forms, array $form ): ?array {
		if ( FormRepository::RENDERER_V5 !== $form['renderer'] || 'published' !== $form['status'] || null === $form['current_revision_id'] ) {
			return null;
		}
		$document = $forms->document( (int) $form['current_revision_id'] );
		return null !== $document && array() === RendererSupport::problems( $document ) ? Captcha::with_site_captcha( $document ) : null;
	}

	/**
	 * Google Ads conversions for the browser to send through the site's Google tag, with the value
	 * computed here (visitors never get the formulas).
	 *
	 * @param array<int,array<string,mixed>> $actions    Browser actions of the submit.
	 * @param Submission                     $submission Submission.
	 * @return array<int,array<string,mixed>>
	 */
	private static function browser_conversions( array $actions, Submission $submission ): array {
		$out = array();
		// The EU privacy mode requires consent for every conversion, the unrestricted mode for none.
		$eu   = PrivacyMode::eu();
		$open = PrivacyMode::open();
		foreach ( $actions as $action ) {
			if ( isset( $action['when'] ) && is_array( $action['when'] ) && ! $submission->meets( $action['when'] ) ) {
				continue;
			}
			$config = $action['config'];
			$value  = null;
			if ( isset( $config['valueCalculation'] ) ) {
				$result = $submission->calculations[ $config['valueCalculation'] ] ?? null;
				$value  = is_array( $result ) && $result['ok'] ? round( (float) $result['value'], 2 ) : null;
			}
			$out[] = array(
				'platform'       => 'googleAds',
				'sendTo'         => (string) $config['sendTo'],
				'value'          => $value,
				'currency'       => null === $value ? null : (string) ( $config['currency'] ?? 'EUR' ),
				'requireConsent' => $eu || ( ! $open && (bool) $config['requireConsent'] ),
				'enhanced'       => ! empty( $config['enhanced'] ),
			);
		}
		return $out;
	}

	/**
	 * What the browser shows after the submit: success text and/or redirect.
	 *
	 * @param Submission $s Submission.
	 * @return array<string,mixed>
	 */
	public static function end_response( Submission $s ): array {
		// Texts of the plugin in the answers ("Signed", the number of files) in the form's language.
		$ui     = (string) ( $s->document->raw()['settings']['uiLocale'] ?? '' );
		$locale = '' !== $ui && strtok( $ui, '_' ) === strtok( $s->locale, '_' ) ? $ui : $s->locale;
		return UiLocale::run( $locale, static fn(): array => self::end_screen( $s ) );
	}

	/**
	 * The image of a success screen. The standard image of 3.x points into the folder of the
	 * plugin that imported the form (Funnelforms Free, an older Pro); it is shown from this one,
	 * so it survives deleting the other plugin.
	 *
	 * @param string $image Address in the document.
	 */
	private static function success_image( string $image ): string {
		return str_ends_with( (string) wp_parse_url( $image, PHP_URL_PATH ), '/res/images/success_standard.png' )
			? plugins_url( 'res/images/success_standard.png', FUNNELFORMS_PLUGIN_FILE )
			: $image;
	}

	/**
	 * The success text and/or redirect of end_response().
	 *
	 * @param Submission $s Submission.
	 * @return array<string,mixed>
	 */
	private static function end_screen( Submission $s ): array {
		$node = null === $s->end ? null : $s->document->node( $s->end );
		$out  = array(
			'success'  => null,
			'redirect' => null,
		);
		if ( null === $node || 'end' !== $node['type'] ) {
			return $out;
		}
		if ( is_array( $node['success'] ) ) {
			$success        = $node['success'];
			$plain          = static fn( $text ): string => trim( wp_strip_all_tags( Templates::render( $s->document->text( is_array( $text ) ? $text : array(), $s->locale ), $s, Templates::TEXT ) ) );
			$out['success'] = array(
				'show'      => (bool) $success['show'],
				// Tokens such as the points of a quiz ({{calc:<id>}}, {{quiz:max}}) are filled in.
				'html'      => wp_kses_post( Templates::render( $s->document->text( $success['text'], $s->locale ), $s, Templates::HTML ) ),
				'image'     => isset( $success['image'] ) ? esc_url_raw( self::success_image( (string) $success['image'] ) ) : null,
				'heading'   => $plain( $success['heading'] ?? array() ),
				'animation' => in_array( $success['animation'] ?? null, array( 'check', 'confetti' ), true ) ? $success['animation'] : null,
				'button'    => null,
				'downloads' => array(),
				'answers'   => null,
			);
			if ( is_array( $success['button'] ?? null ) ) {
				$label = $plain( $success['button']['label'] );
				$url   = esc_url_raw( Templates::render( $s->document->text( $success['button']['url'], $s->locale ), $s, Templates::URL ), array( 'http', 'https' ) );
				if ( '' !== $label && '' !== $url ) {
					$out['success']['button'] = array(
						'label'  => $label,
						'url'    => $url,
						'newTab' => ! empty( $success['button']['newTab'] ),
					);
				}
			}
			foreach ( (array) ( $success['downloads'] ?? array() ) as $download ) {
				$url = esc_url_raw( (string) ( $download['url'] ?? '' ), array( 'http', 'https' ) );
				if ( '' !== $url ) {
					$label                         = $plain( $download['label'] ?? array() );
					$out['success']['downloads'][] = array(
						'label' => '' === $label ? wp_basename( (string) wp_parse_url( $url, PHP_URL_PATH ) ) : $label,
						'url'   => $url,
					);
				}
			}
			if ( ! empty( $success['showAnswers'] ) ) {
				$out['success']['answers'] = array_map(
					static fn( array $item ): array => array(
						'title'  => trim( wp_strip_all_tags( $item['title'] ) ),
						'answer' => $item['answer'],
					),
					Templates::summary( $s, true )
				);
			}
		}
		if ( is_array( $node['redirect'] ) ) {
			$url    = Templates::render( $s->document->text( $node['redirect']['url'], $s->locale ), $s, Templates::URL );
			$params = array();
			foreach ( $node['redirect']['params'] as $param ) {
				$value = Templates::render( $s->document->text( $param['value'], $s->locale ), $s, Templates::TEXT );
				// Spaces as "+", like the 3.x redirect parameters.
				$params[] = rawurlencode( (string) $param['name'] ) . '=' . urlencode( $value ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.urlencode_urlencode -- 3.x format.
			}
			if ( array() !== $params ) {
				$url .= ( str_contains( $url, '?' ) ? '&' : '?' ) . implode( '&', $params );
			}
			$out['redirect'] = array(
				'url'       => esc_url_raw( $url ),
				'newTab'    => (bool) $node['redirect']['newTab'],
				'delayMs'   => (int) $node['redirect']['delayMs'],
				'countdown' => ! empty( $node['redirect']['countdown'] ),
			);
		}
		return $out;
	}

	/**
	 * Node that holds a field.
	 *
	 * @param Document $doc      Document.
	 * @param string   $field_id Field id.
	 */
	private static function node_of( Document $doc, string $field_id ): string {
		foreach ( $doc->nodes() as $id => $node ) {
			foreach ( $node['fields'] ?? array() as $field ) {
				if ( $field['id'] === $field_id ) {
					return $id;
				}
			}
		}
		return '';
	}

	/**
	 * Locale of the texts: the visitor's if the form has it, else the form default.
	 *
	 * @param Document $doc    Document.
	 * @param string   $wanted Locale sent by the browser.
	 */
	private static function locale( Document $doc, string $wanted ): string {
		$available = (array) ( $doc->raw()['locales']['available'] ?? array() );
		return in_array( $wanted, $available, true ) ? $wanted : $doc->locale();
	}

	/**
	 * A page value sent by the browser, cut to a maximum length.
	 *
	 * @param mixed $value Value.
	 * @param int   $max   Maximum length.
	 */
	public static function page_value( $value, int $max ): string {
		// Kept as text (escaped on output); sanitize_text_field would strip the %-encoding of URLs.
		return is_string( $value ) ? mb_substr( (string) preg_replace( '/[\x00-\x1F\x7F]/', '', wp_check_invalid_utf8( $value ) ), 0, $max ) : '';
	}

	/**
	 * A failed submission.
	 *
	 * @param string               $code   Error code.
	 * @param array<string,string> $fields Errors by field id.
	 * @return array<string,mixed>
	 */
	private static function failure( string $code, array $fields = array() ): array {
		return array(
			'ok'     => false,
			'code'   => $code,
			'fields' => (object) $fields,
		);
	}
}
