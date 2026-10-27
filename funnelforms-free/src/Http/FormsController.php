<?php
/**
 * Public REST routes of forms shown by the new renderer.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Application\Abandonment;
use Funnelforms\Application\Bookings;
use Funnelforms\Application\FormAccess;
use Funnelforms\Application\FormStats;
use Funnelforms\Application\PhoneVerification;
use Funnelforms\Application\SpamCheck;
use Funnelforms\Application\SaveProgress;
use Funnelforms\Application\SubmitEntry;
use Funnelforms\Application\UploadFile;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Repository\FileRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;
use Funnelforms\Frontend\ExternalEmbed;
use Funnelforms\Frontend\Renderer;

defined( 'ABSPATH' ) || exit;

/**
 * Routes under funnelforms/v1/forms/<uid>:
 *   POST token         a submit token (see SubmitToken)
 *   POST entries       submit an entry
 *   POST calculations  results for content steps, computed on the server as in 3.x
 *   POST next          the node after a step whose edges compare calculation results
 *   POST files         upload one file for a file field (multipart: token, field, file)
 *   POST events        what a page view saw (view, start, steps), for the form statistics
 *   POST unlock        password of a protected form: the form's content and an unlock key, which
 *                      every other route then needs (parameter unlock)
 *   POST progress      save the answers so far for a resume link (forms with saveProgress)
 *   POST progress/load the answers of a resume link
 *   POST phone/send    text a code to the number of a phone field that is confirmed by text
 *                      message (Funnelforms Pro; token, field, number, locale)
 *   POST phone/confirm check the code; answers the proof the submit needs (token, field, number, code)
 *   POST abandon       the address and answers of a visitor who has not sent the form yet, for
 *                      the reminder (forms with abandonment)
 * They are public on purpose (visitors are not logged in); every route checks that the form is
 * published on the new renderer, and limits requests per visitor.
 */
final class FormsController {

	public const NAMESPACE = 'funnelforms/v1';

	/** Requests per IP address and form in 10 minutes: results of steps and paths, and live results. */
	public const CALC_LIMIT = 1000;
	public const LIVE_LIMIT = 2000;

	private const UID = '(?P<uid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

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
		// Visitors submit forms without an account; see the class comment.
		$public = '__return_true';
		register_rest_route(
			self::NAMESPACE,
			'/forms/' . self::UID . '/unlock',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'unlock' ),
				'permission_callback' => $public,
				'args'                => array(
					'password' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/forms/' . self::UID . '/token',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'token' ),
				'permission_callback' => $public,
				'args'                => array(
					'started' => array(
						'type'        => 'string',
						'default'     => '',
						'description' => 'Signed start of the visit from an earlier token answer, so a new token keeps the time limit running.',
					),
					'extend'  => array(
						'type'        => 'boolean',
						'default'     => false,
						'description' => 'The visitor asked for more time before the limit ran out: the time starts again (WCAG 2.2.1).',
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/forms/' . self::UID . '/entries',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'submit' ),
				'permission_callback' => $public,
				'args'                => array(
					'token'     => array(
						'type'     => 'string',
						'required' => true,
					),
					'answers'   => array(
						'type'    => 'object',
						'default' => array(),
					),
					'contact'   => array(
						'type'    => 'object',
						'default' => array(),
					),
					'page'      => array(
						'type'    => 'object',
						'default' => array(),
					),
					'locale'    => array(
						'type'    => 'string',
						'default' => '',
					),
					'website'   => array(
						'type'        => 'string',
						'default'     => '',
						'description' => 'Honeypot; must stay empty.',
					),
					'draft'     => array(
						'type'        => 'string',
						'default'     => '',
						'description' => 'Key of the incomplete entry saved so far, if any.',
					),
					'sid'       => array(
						'type'        => 'string',
						'default'     => '',
						'description' => 'Random id of the page view, for the form statistics.',
					),
					'progress'  => array(
						'type'        => 'string',
						'default'     => '',
						'description' => 'Key of the resume link the visitor came from, if any; its saved answers are deleted.',
					),
					'tracking'  => array(
						'type'        => 'object',
						'default'     => array(),
						'description' => 'Consent (marketing, statistics) and pixel identifiers for server-side conversions.',
					),
					'variants'  => array(
						'type'        => 'object',
						'default'     => array(),
						'description' => 'Variant of each A/B test shown, by experiment id.',
					),
					'started'   => array(
						'type'        => 'string',
						'default'     => '',
						'description' => 'Signed start of the visit from the token answer, for forms with a time limit.',
					),
					'analytics' => array(
						'type'        => 'object',
						'default'     => array(),
						'description' => 'How the visitor filled in the form: seconds, steps (seconds by node id) and referrer (address without query).',
					),
				),
			)
		);
		// Save and continue later, file uploads and appointments are Funnelforms Pro.
		if ( null !== Edition::pro( SaveProgress::class ) ) {
			register_rest_route(
				self::NAMESPACE,
				'/forms/' . self::UID . '/progress',
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'save_progress' ),
					'permission_callback' => $public,
					'args'                => array(
						'token'    => array(
							'type'     => 'string',
							'required' => true,
						),
						'answers'  => array(
							'type'    => 'object',
							'default' => array(),
						),
						'key'      => array(
							'type'        => 'string',
							'default'     => '',
							'description' => 'Key of an earlier save; the link stays the same.',
						),
						'locale'   => array(
							'type'    => 'string',
							'default' => '',
						),
						'variants' => array(
							'type'        => 'object',
							'default'     => array(),
							'description' => 'Variant of each A/B test shown, by experiment id.',
						),
						'stop'     => array(
							'type'        => 'boolean',
							'default'     => false,
							'description' => 'The visitor said "Don\'t remind me" under the field: the entry of the draft is deleted.',
						),
					),
				)
			);
		}
		// Resume links.
		if ( null !== Edition::pro( SaveProgress::class ) ) {
			register_rest_route(
				self::NAMESPACE,
				'/forms/' . self::UID . '/progress/load',
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'load_progress' ),
					'permission_callback' => $public,
					'args'                => array(
						'key' => array(
							'type'     => 'string',
							'required' => true,
						),
					),
				)
			);
		}
		// Reminders to visitors who leave are Funnelforms Pro.
		if ( null !== Edition::pro( Abandonment::class ) ) {
			register_rest_route(
				self::NAMESPACE,
				'/forms/' . self::UID . '/abandon',
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'abandon' ),
					'permission_callback' => $public,
					'args'                => array(
						'token'    => array(
							'type'     => 'string',
							'required' => true,
						),
						'contact'  => array(
							'type'        => 'object',
							'default'     => array(),
							'description' => 'The e-mail field, name and salutation of the contact step and, for basis consent, the box.',
						),
						'answers'  => array(
							'type'    => 'object',
							'default' => array(),
						),
						'draft'    => array(
							'type'        => 'string',
							'default'     => '',
							'description' => 'Key of the incomplete entry or of an earlier call, if any.',
						),
						'node'     => array(
							'type'        => 'string',
							'default'     => '',
							'description' => 'Step the visitor is at.',
						),
						'page'     => array(
							'type'    => 'object',
							'default' => array(),
						),
						'locale'   => array(
							'type'    => 'string',
							'default' => '',
						),
						'variants' => array(
							'type'        => 'object',
							'default'     => array(),
							'description' => 'Variant of each A/B test shown, by experiment id.',
						),
						'stop'     => array(
							'type'        => 'boolean',
							'default'     => false,
							'description' => 'The visitor said "Don\'t remind me" under the field: the entry of the draft is deleted.',
						),
					),
				)
			);
		}
		register_rest_route(
			self::NAMESPACE,
			'/forms/' . self::UID . '/partials',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'partial' ),
				'permission_callback' => $public,
				'args'                => array(
					'token'    => array(
						'type'     => 'string',
						'required' => true,
					),
					'answers'  => array(
						'type'    => 'object',
						'default' => array(),
					),
					'draft'    => array(
						'type'    => 'string',
						'default' => '',
					),
					'page'     => array(
						'type'    => 'object',
						'default' => array(),
					),
					'locale'   => array(
						'type'    => 'string',
						'default' => '',
					),
					'variants' => array(
						'type'        => 'object',
						'default'     => array(),
						'description' => 'Variant of each A/B test shown, by experiment id.',
					),
				),
			)
		);
		// Uploads.
		if ( null !== Edition::pro( UploadFile::class ) ) {
			register_rest_route(
				self::NAMESPACE,
				'/forms/' . self::UID . '/files',
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'upload' ),
					'permission_callback' => $public,
					'args'                => array(
						'token' => array(
							'type'     => 'string',
							'required' => true,
						),
						'field' => array(
							'type'     => 'string',
							'required' => true,
						),
					),
				)
			);
		}
		register_rest_route(
			self::NAMESPACE,
			'/forms/' . self::UID . '/events',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'events' ),
				'permission_callback' => $public,
				'args'                => array(
					'sid'     => array(
						'type'     => 'string',
						'required' => true,
					),
					'events'  => array(
						'type'     => 'array',
						'required' => true,
					),
					'consent' => array(
						'type' => 'string',
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/forms/' . self::UID . '/calculations',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'calculations' ),
				'permission_callback' => $public,
				'args'                => array(
					'answers' => array(
						'type'    => 'object',
						'default' => array(),
					),
					'ids'     => array(
						'type'     => 'array',
						'items'    => array( 'type' => 'string' ),
						'required' => true,
					),
					'live'    => array(
						'type'    => 'boolean',
						'default' => false,
					),
					'locale'  => array(
						'type'    => 'string',
						'default' => '',
					),
				),
			)
		);
		// Free times of booking fields.
		if ( null !== Edition::pro( Bookings::class ) ) {
			register_rest_route(
				self::NAMESPACE,
				'/forms/' . self::UID . '/slots',
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'slots' ),
					'permission_callback' => $public,
					'args'                => PreviewController::slot_args(),
				)
			);
		}
		register_rest_route(
			self::NAMESPACE,
			'/forms/' . self::UID . '/next',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'next' ),
				'permission_callback' => $public,
				'args'                => array(
					'answers'  => array(
						'type'    => 'object',
						'default' => array(),
					),
					'node'     => array(
						'type'     => 'string',
						'required' => true,
					),
					'variants' => array(
						'type'        => 'object',
						'default'     => array(),
						'description' => 'Variant of each A/B test shown, by experiment id.',
					),
				),
			)
		);
		// Phone numbers confirmed by text message.
		if ( null !== Edition::pro( PhoneVerification::class ) ) {
			$phone = array(
				'token'  => array(
					'type'     => 'string',
					'required' => true,
				),
				'field'  => array(
					'type'     => 'string',
					'required' => true,
				),
				'number' => array(
					'type'      => 'string',
					'required'  => true,
					'maxLength' => 40,
				),
			);
			register_rest_route(
				self::NAMESPACE,
				'/forms/' . self::UID . '/phone/send',
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'phone_send' ),
					'permission_callback' => $public,
					'args'                => $phone + array(
						'locale' => array(
							'type'    => 'string',
							'default' => '',
						),
					),
				)
			);
			register_rest_route(
				self::NAMESPACE,
				'/forms/' . self::UID . '/phone/confirm',
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'phone_confirm' ),
					'permission_callback' => $public,
					'args'                => $phone + array(
						'code' => array(
							'type'     => 'string',
							'required' => true,
						),
					),
				)
			);
		}
	}

	/**
	 * POST token.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function token( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		if ( RateLimiter::exceeded( 'token', $form['uid'], 60, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, true );
		if ( null !== $denied ) {
			return $denied;
		}
		$now  = time();
		$body = array( 'token' => SubmitToken::issue( $form['uid'], $now ) );
		$time = TimeLimit::seconds( (array) SubmitEntry::shown_document( new FormRepository(), $form ) );
		if ( $time > 0 ) {
			$started  = TimeLimit::started( (string) $request['started'], $form['uid'] ) ?? $now;
			$extended = TimeLimit::extended( (string) $request['started'], $form['uid'] );
			$left     = $time - ( $now - $started );
			if ( $left <= 0 ) {
				return self::error( 'time_up', 403 );
			}
			// More time once per visit; the time limit would mean nothing otherwise.
			if ( $request['extend'] && ! $extended ) {
				$started  = $now;
				$left     = $time;
				$extended = true;
			}
			$body['started']  = TimeLimit::stamp( $form['uid'], $started, $extended );
			$body['timeLeft'] = $left;
		}
		return self::response( $body, 200 );
	}

	/**
	 * POST entries.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function submit( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		/** This filter is documented in readme: submits per visitor and form within ten minutes. */
		$limit = (int) apply_filters( 'funnelforms_submit_rate_limit', 10, $form );
		if ( RateLimiter::exceeded( 'submit', $form['uid'], $limit, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$spam = SpamCheck::settings();
		if ( $spam['hourly'] > 0 && RateLimiter::exceeded( 'hourly', 'site', $spam['hourly'], HOUR_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, true );
		if ( null !== $denied ) {
			return $denied;
		}
		$token_error = SubmitToken::redeem( (string) $request['token'], $form['uid'], time() );
		if ( null !== $token_error ) {
			return self::error( $token_error, 'too_fast' === $token_error ? 429 : 403 );
		}
		// Signals that can be wrong about people put the entry into the spam folder (SpamCheck):
		// browsers sometimes fill the honeypot, and some people are fast.
		$signals = array();
		if ( '' !== (string) $request['website'] ) {
			$signals[] = 'honeypot';
		}
		if ( $spam['minSeconds'] > 0 && time() - SubmitToken::issued( (string) $request['token'] ) < $spam['minSeconds'] ) {
			$signals[] = 'too_fast';
		}
		$time = TimeLimit::seconds( (array) SubmitEntry::shown_document( new FormRepository(), $form ) );
		if ( $time > 0 ) {
			$started = TimeLimit::started( (string) $request['started'], $form['uid'] );
			if ( null === $started || time() - $started > $time + TimeLimit::GRACE ) {
				return self::error( 'time_up', 403 );
			}
		}

		$result = self::use_case()->handle(
			$form,
			array(
				'answers'   => (array) $request['answers'],
				'contact'   => (array) $request['contact'],
				'page'      => (array) $request['page'],
				'locale'    => (string) $request['locale'],
				'draft'     => (string) $request['draft'],
				'tracking'  => (array) $request['tracking'],
				'variants'  => (array) $request['variants'],
				'analytics' => (array) $request['analytics'],
				'progress'  => (string) $request['progress'],
				'ip'        => isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '',
				'userAgent' => (string) $request->get_header( 'user_agent' ),
				'signals'   => $signals,
			)
		);
		if ( ! $result['ok'] ) {
			return self::response( $result, 'invalid_answers' === $result['code'] ? 422 : 400 );
		}
		if ( ! empty( $result['spam'] ) ) {
			// Answered like any entry, so a bot learns nothing; spam counts in no figure.
			unset( $result['spam'] );
			self::progress()?->forget( $form, (string) $request['progress'] );
			return self::response( $result, 201 );
		}
		$path = (array) ( $result['path'] ?? array() );
		unset( $result['path'] );
		FormStats::completed( (int) $form['id'], (string) $request['sid'], time(), (string) ( $path['contact'] ?? '' ), (string) ( $path['end'] ?? '' ) );
		self::progress()?->forget( $form, (string) $request['progress'] );
		return self::response( $result, 201 );
	}

	/**
	 * POST progress: saves the answers so far; answers the key of the resume link.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function save_progress( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		if ( RateLimiter::exceeded( 'progress', $form['uid'], 30, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, true );
		if ( null !== $denied ) {
			return $denied;
		}
		$token_error = SubmitToken::check( (string) $request['token'], $form['uid'], time() );
		if ( null !== $token_error ) {
			return self::error( $token_error, 403 );
		}
		$progress = self::progress();
		if ( null === $progress ) {
			return self::error( 'not_available', 404 );
		}
		$result = $progress->save(
			$form,
			array(
				'answers'  => (array) $request['answers'],
				'key'      => (string) $request['key'],
				'locale'   => (string) $request['locale'],
				'variants' => (array) $request['variants'],
				'stop'     => (bool) $request['stop'],
			)
		);
		return self::response( $result, $result['ok'] ? 200 : 400 );
	}

	/**
	 * POST progress/load: the answers of a resume link.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function load_progress( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		// Few attempts, so keys cannot be guessed (they have 128 random bits anyway).
		if ( RateLimiter::exceeded( 'resume', $form['uid'], 30, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, false );
		if ( null !== $denied ) {
			return $denied;
		}
		$progress = self::progress();
		if ( null === $progress ) {
			return self::error( 'not_available', 404 );
		}
		$result = $progress->load( $form, (string) $request['key'] );
		return self::response( $result, $result['ok'] ? 200 : ( 'progress_not_found' === $result['code'] ? 404 : 400 ) );
	}

	/**
	 * POST events: what visitors saw, for the form statistics (FormStats).
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function events( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		if ( RateLimiter::exceeded( 'events', $form['uid'], 200, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, false );
		if ( null !== $denied ) {
			return $denied;
		}
		// consent: 'statistics' marks a page view with the extended level (docs/api/stats.md).
		$stored = FormStats::record( $form, (array) SubmitEntry::shown_document( new FormRepository(), $form ), (string) $request['sid'], $request['events'], time(), 'statistics' === $request['consent'] );
		if ( $stored < 0 ) {
			return self::error( 'invalid_events', 400 );
		}
		return self::response( array( 'ok' => true ), 200 );
	}

	/**
	 * POST partials: the answers so far of forms that keep incomplete entries.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function partial( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		if ( RateLimiter::exceeded( 'partial', $form['uid'], 100, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, true );
		if ( null !== $denied ) {
			return $denied;
		}
		$token_error = SubmitToken::check( (string) $request['token'], $form['uid'], time() );
		if ( null !== $token_error ) {
			return self::error( $token_error, 403 );
		}
		$result = self::use_case()->save_partial(
			$form,
			array(
				'answers'  => (array) $request['answers'],
				'draft'    => (string) $request['draft'],
				'page'     => (array) $request['page'],
				'locale'   => (string) $request['locale'],
				'variants' => (array) $request['variants'],
				'stop'     => (bool) $request['stop'],
			)
		);
		return self::response( $result, $result['ok'] ? 200 : 400 );
	}

	/**
	 * POST abandon: the address and answers so far of a visitor, for the reminder.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function abandon( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		// The runtime calls it when a field is left or the page is hidden, and only on changes.
		if ( RateLimiter::exceeded( 'abandon', $form['uid'], 30, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, true );
		if ( null !== $denied ) {
			return $denied;
		}
		$token_error = SubmitToken::check( (string) $request['token'], $form['uid'], time() );
		if ( null !== $token_error ) {
			return self::error( $token_error, 403 );
		}
		$abandon = Edition::pro( Abandonment::class );
		if ( null === $abandon ) {
			return self::error( 'not_available', 404 );
		}
		$result = $abandon::create()->capture(
			$form,
			array(
				'contact'  => (array) $request['contact'],
				'answers'  => (array) $request['answers'],
				'draft'    => (string) $request['draft'],
				'node'     => (string) $request['node'],
				'page'     => (array) $request['page'],
				'locale'   => (string) $request['locale'],
				'variants' => (array) $request['variants'],
				'stop'     => (bool) $request['stop'],
			)
		);
		return self::response( $result, $result['ok'] ? 200 : 400 );
	}

	/**
	 * POST files.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function upload( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		if ( RateLimiter::exceeded( 'upload', $form['uid'], 30, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, true );
		if ( null !== $denied ) {
			return $denied;
		}
		$token_error = SubmitToken::check( (string) $request['token'], $form['uid'], time() );
		if ( null !== $token_error ) {
			return self::error( $token_error, 403 );
		}
		$files = $request->get_file_params();
		if ( ! isset( $files['file'] ) || ! is_array( $files['file'] ) || is_array( $files['file']['name'] ?? null ) ) {
			return self::error( 'upload_failed', 400 );
		}
		$upload = Edition::pro( UploadFile::class );
		if ( null === $upload ) {
			return self::error( 'not_available', 404 );
		}
		$result = ( new $upload( new FormRepository(), new FileRepository() ) )->handle( $form, (string) $request['field'], $files['file'], true );
		if ( ! $result['ok'] ) {
			return self::response( $result, 'file_too_large' === $result['code'] ? 413 : ( 'too_many_uploads' === $result['code'] ? 429 : 400 ) );
		}
		return self::response( $result, 201 );
	}

	/**
	 * POST calculations.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function calculations( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		// Live results ask while the visitor answers (at most every 250 ms, after a pause); they
		// count apart, so they never use up the requests for the next step. The limits leave room
		// for many visitors behind one address (offices, mobile networks).
		$live = true === $request['live'];
		if ( RateLimiter::exceeded( $live ? 'live' : 'calc', $form['uid'], $live ? self::LIVE_LIMIT : self::CALC_LIMIT, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, false );
		if ( null !== $denied ) {
			return $denied;
		}
		$result = self::use_case()->calculate(
			$form,
			array(
				'answers' => (array) $request['answers'],
				'ids'     => (array) $request['ids'],
				'live'    => $live,
				'locale'  => (string) $request['locale'],
			)
		);
		return self::response( $result, $result['ok'] ? 200 : 400 );
	}

	/**
	 * POST slots: free times of a booking field.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function slots( \WP_REST_Request $request ): \WP_REST_Response {
		$forms = new FormRepository();
		$form  = $forms->by_uid( (string) $request['uid'] );
		$doc   = null === $form ? null : SubmitEntry::shown_document( $forms, $form );
		if ( null === $form || null === $doc ) {
			return self::error( 'form_unavailable', 404 );
		}
		if ( RateLimiter::exceeded( 'slots', $form['uid'], 300, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, false );
		if ( null !== $denied ) {
			return $denied;
		}
		$bookings = Edition::pro( Bookings::class );
		if ( null === $bookings ) {
			return self::error( 'booking_unavailable', 404 );
		}
		$result = $bookings::create()->field_slots( $doc, $request->get_params(), time() );
		return self::response( $result, $result['ok'] ? 200 : ( 'booking_unavailable' === $result['code'] ? 404 : 400 ) );
	}

	/**
	 * POST next.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function next( \WP_REST_Request $request ): \WP_REST_Response {
		$form = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		if ( RateLimiter::exceeded( 'calc', $form['uid'], self::CALC_LIMIT, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, false );
		if ( null !== $denied ) {
			return $denied;
		}
		$result = self::use_case()->next(
			$form,
			array(
				'answers'  => (array) $request['answers'],
				'node'     => (string) $request['node'],
				'variants' => (array) $request['variants'],
				'stop'     => (bool) $request['stop'],
			)
		);
		return self::response( $result, $result['ok'] ? 200 : 400 );
	}

	/**
	 * POST phone/send: texts a code to the number of a phone field.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function phone_send( \WP_REST_Request $request ): \WP_REST_Response {
		return self::phone( $request, 'send', 5 );
	}

	/**
	 * POST phone/confirm: checks the code; answers the proof for the submit.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function phone_confirm( \WP_REST_Request $request ): \WP_REST_Response {
		return self::phone( $request, 'confirm', 20 );
	}

	/**
	 * The phone routes: form, limit per visitor, password, token, then the use case.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @param string           $step    send or confirm.
	 * @param int              $limit   Requests per visitor and form within ten minutes.
	 */
	private static function phone( \WP_REST_Request $request, string $step, int $limit ): \WP_REST_Response {
		$forms = new FormRepository();
		$form  = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		if ( RateLimiter::exceeded( 'sms_' . $step, $form['uid'], $limit, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		$denied = self::gate( $form, $request, true );
		if ( null !== $denied ) {
			return $denied;
		}
		$token_error = SubmitToken::check( (string) $request['token'], $form['uid'], time() );
		if ( null !== $token_error ) {
			return self::error( $token_error, 403 );
		}
		$verification = Edition::pro( PhoneVerification::class );
		if ( null === $verification ) {
			return self::error( 'not_available', 404 );
		}
		$document = (array) SubmitEntry::shown_document( $forms, $form );
		$result   = 'send' === $step
			? $verification::create()->send( $form, $document, (string) $request['field'], (string) $request['number'], (string) $request['locale'], time() )
			: $verification::create()->confirm( $form, $document, (string) $request['field'], (string) $request['number'], (string) $request['code'], time() );
		if ( $result['ok'] ) {
			return self::response( $result, 200 );
		}
		return self::response( $result, 'rate_limited' === $result['code'] ? 429 : ( 'sms_failed' === $result['code'] ? 502 : 400 ) );
	}

	/**
	 * POST unlock.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function unlock( \WP_REST_Request $request ): \WP_REST_Response {
		$forms = new FormRepository();
		$form  = self::form( (string) $request['uid'] );
		if ( null === $form ) {
			return self::error( 'form_unavailable', 404 );
		}
		// Few attempts, so passwords cannot be guessed.
		if ( RateLimiter::exceeded( 'unlock', $form['uid'], 10, 10 * MINUTE_IN_SECONDS ) ) {
			return self::error( 'rate_limited', 429 );
		}
		if ( ! self::embed_allowed( $request ) ) {
			return self::error( 'embed_not_allowed', 403 );
		}
		$document = (array) SubmitEntry::shown_document( $forms, $form );
		if ( FormAccess::OPEN !== FormAccess::state( (int) $form['id'], $document, time() ) ) {
			return self::error( 'form_closed', 403 );
		}
		// A form for members also wants the key the page gave the logged-in visitor.
		$user = FormAccess::login_required( $document ) ? FormAccess::member( $form['uid'], (string) $request['unlock'], time() ) : 0;
		if ( FormAccess::login_required( $document ) && 0 === $user ) {
			return self::error( 'unlock_required', 403 );
		}
		$key = FormAccess::unlock( $form['uid'], $document, (string) $request['password'], time(), $user );
		if ( null === $key ) {
			return self::error( 'wrong_password', 403 );
		}
		return self::response(
			array(
				'ok'     => true,
				'config' => array( 'unlock' => $key ) + Renderer::config( $form, $document ),
			),
			200
		);
	}

	/**
	 * Password and availability of a form, for a request. Null lets the request through.
	 *
	 * @param array<string,mixed> $form    Form row.
	 * @param \WP_REST_Request    $request Request.
	 * @param bool                $entries Whether the request leads to an entry (token, entries,
	 *                                     partials, files): those also need the form to be open.
	 */
	private static function gate( array $form, \WP_REST_Request $request, bool $entries ): ?\WP_REST_Response {
		if ( ! self::embed_allowed( $request ) ) {
			return self::error( 'embed_not_allowed', 403 );
		}
		$document = (array) SubmitEntry::shown_document( new FormRepository(), $form );
		if ( ! FormAccess::unlocked( $form['uid'], $document, (string) $request['unlock'], time() ) ) {
			return self::error( 'unlock_required', 403 );
		}
		if ( $entries && FormAccess::OPEN !== FormAccess::state( (int) $form['id'], $document, time() ) ) {
			return self::error( 'form_closed', 403 );
		}
		return null;
	}

	/**
	 * A form that is published on the new renderer.
	 *
	 * @param string $uid Form uid.
	 * @return array<string,mixed>|null
	 */
	private static function form( string $uid ): ?array {
		$forms = new FormRepository();
		$form  = $forms->by_uid( $uid );
		return null !== $form && null !== SubmitEntry::shown_document( $forms, $form ) ? $form : null;
	}

	/**
	 * Whether the website that sent a request may show forms (embedding on other websites is
	 * Funnelforms Pro; Free answers every website, as Funnelforms 3 did).
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	private static function embed_allowed( \WP_REST_Request $request ): bool {
		$embed = Edition::pro( ExternalEmbed::class );
		return null === $embed || $embed::allowed( (string) $request->get_header( 'origin' ) );
	}

	/**
	 * The save-progress use case with the site services; null in Funnelforms Free.
	 *
	 * @return SaveProgress|null
	 */
	private static function progress(): ?object {
		$progress = Edition::pro( SaveProgress::class );
		return null === $progress ? null : $progress::create();
	}

	/**
	 * The submit use case with the site services.
	 */
	private static function use_case(): SubmitEntry {
		return SubmitEntry::create();
	}

	/**
	 * Error response.
	 *
	 * @param string $code   Error code.
	 * @param int    $status HTTP status.
	 */
	private static function error( string $code, int $status ): \WP_REST_Response {
		return self::response(
			array(
				'ok'   => false,
				'code' => $code,
			),
			$status
		);
	}

	/**
	 * JSON response that caches never keep.
	 *
	 * @param array<string,mixed> $data   Body.
	 * @param int                 $status HTTP status.
	 */
	private static function response( array $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}
}
