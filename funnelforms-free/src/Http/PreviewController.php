<?php
/**
 * REST routes of the builder's preview: the same API as a published form, as a test run.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Application\Bookings;
use Funnelforms\Application\FormPreview;
use Funnelforms\Application\SubmitEntry;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Routes under funnelforms/v1/preview/<token>, which the runtime calls instead of
 * forms/<uid> in the preview frame (Application\FormPreview):
 *   POST token         a dummy submit token
 *   POST entries       checks the answers like a real submit and answers the end; stores nothing
 *   POST calculations  results for content steps and live results, from the draft
 *   POST next          the node after a step, from the draft
 *   POST files         takes the file's name and size; the file is not kept
 *   POST partials      accepted, not stored
 *   POST events        accepted, not counted
 *   POST progress      not available in the preview
 * The frame has no cookies, so the routes are public; the signed token in the address stands for
 * the editor, and every request checks it again.
 */
final class PreviewController {

	private const BASE = '/preview/(?P<token>[0-9a-z]+-\d+-\d+-[0-9a-f]{64})';

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
		$object = array(
			'type'    => 'object',
			'default' => array(),
		);
		$routes = array(
			'token'         => array( 'token', array() ),
			'entries'       => array(
				'submit',
				array(
					'answers'  => $object,
					'contact'  => $object,
					'page'     => $object,
					'locale'   => array(
						'type'    => 'string',
						'default' => '',
					),
					'variants' => $object,
				),
			),
			'calculations'  => array(
				'calculations',
				array(
					'answers' => $object,
					'ids'     => array(
						'type'    => 'array',
						'items'   => array( 'type' => 'string' ),
						'default' => array(),
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
			),
			'next'          => array(
				'next',
				array(
					'answers'  => $object,
					'node'     => array(
						'type'     => 'string',
						'required' => true,
					),
					'variants' => $object,
				),
			),
			'slots'         => array( 'slots', self::slot_args() ),
			'files'         => array(
				'upload',
				array(
					'field' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			),
			'partials'      => array( 'accepted', array() ),
			'events'        => array( 'accepted', array() ),
			'progress'      => array( 'unavailable', array() ),
			'progress/load' => array( 'unavailable', array() ),
		);
		foreach ( $routes as $path => list( $callback, $args ) ) {
			register_rest_route(
				FormsController::NAMESPACE,
				self::BASE . '/' . $path,
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, $callback ),
					// The token in the address is checked by each callback; see the class comment.
					'permission_callback' => '__return_true',
					'args'                => $args,
				)
			);
		}
	}

	/**
	 * POST token.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function token( \WP_REST_Request $request ): \WP_REST_Response {
		return self::with_preview(
			$request,
			static fn(): array => array(
				'ok'    => true,
				'token' => 'preview',
			)
		);
	}

	/**
	 * POST entries: a test submit.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function submit( \WP_REST_Request $request ): \WP_REST_Response {
		return self::with_preview(
			$request,
			static fn( array $form, array $document ): array => self::use_case()->preview(
				$form,
				$document,
				array(
					'answers'  => (array) $request['answers'],
					'contact'  => (array) $request['contact'],
					'page'     => (array) $request['page'],
					'locale'   => (string) $request['locale'],
					'variants' => (array) $request['variants'],
				)
			),
			201
		);
	}

	/**
	 * POST calculations.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function calculations( \WP_REST_Request $request ): \WP_REST_Response {
		return self::with_preview(
			$request,
			static fn( array $form, array $document ): array => self::use_case()->calculate(
				$form,
				array(
					'answers' => (array) $request['answers'],
					'ids'     => (array) $request['ids'],
					'live'    => true === $request['live'],
					'locale'  => (string) $request['locale'],
				),
				$document
			)
		);
	}

	/**
	 * POST next.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function next( \WP_REST_Request $request ): \WP_REST_Response {
		return self::with_preview(
			$request,
			static fn( array $form, array $document ): array => self::use_case()->next(
				$form,
				array(
					'answers'  => (array) $request['answers'],
					'node'     => (string) $request['node'],
					'variants' => (array) $request['variants'],
				),
				$document
			)
		);
	}

	/**
	 * POST slots: free times of a booking field, from the real bookings.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function slots( \WP_REST_Request $request ): \WP_REST_Response {
		return self::with_preview(
			$request,
			static function ( array $form, array $document ) use ( $request ): array {
				$bookings = Edition::pro( Bookings::class );
				return null === $bookings ? array(
					'ok'   => false,
					'code' => 'booking_unavailable',
				) : $bookings::create()->field_slots( $document, $request->get_params(), time() );
			}
		);
	}

	/**
	 * Arguments of the slots routes (here and FormsController).
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public static function slot_args(): array {
		$date = array(
			'type'     => 'string',
			'pattern'  => '^\\d{4}-\\d{2}-\\d{2}$',
			'required' => true,
		);
		return array(
			'field'    => array(
				'type'     => 'string',
				'required' => true,
			),
			'from'     => $date,
			'to'       => $date,
			'duration' => array(
				'type'    => 'integer',
				'default' => 0,
			),
		);
	}

	/**
	 * POST files: the runtime gets a reference as for a real upload; the file is dropped.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function upload( \WP_REST_Request $request ): \WP_REST_Response {
		return self::with_preview(
			$request,
			static function () use ( $request ): array {
				$file = $request->get_file_params()['file'] ?? null;
				if ( ! is_array( $file ) || UPLOAD_ERR_OK !== ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) || ! is_string( $file['name'] ?? null ) ) {
					return array(
						'ok'   => false,
						'code' => 'upload_failed',
					);
				}
				return array(
					'ok'   => true,
					'ref'  => bin2hex( random_bytes( 16 ) ),
					'name' => mb_substr( sanitize_file_name( $file['name'] ), 0, 200 ),
					'size' => (int) ( $file['size'] ?? 0 ),
				);
			},
			201
		);
	}

	/**
	 * POST partials and events: accepted, nothing is kept.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function accepted( \WP_REST_Request $request ): \WP_REST_Response {
		return self::with_preview( $request, static fn(): array => array( 'ok' => true ) );
	}

	/**
	 * POST progress and progress/load: resume links need a real page.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function unavailable( \WP_REST_Request $request ): \WP_REST_Response {
		return self::with_preview(
			$request,
			static fn(): array => array(
				'ok'   => false,
				'code' => 'preview_unavailable',
			)
		);
	}

	/**
	 * Runs a callback for a valid preview token.
	 *
	 * @param \WP_REST_Request $request  Request.
	 * @param callable         $callback Gets form row and document; answers the body.
	 * @param int              $status   HTTP status of a successful answer.
	 */
	private static function with_preview( \WP_REST_Request $request, callable $callback, int $status = 200 ): \WP_REST_Response {
		// From the address: the runtime also sends a (submit) token in the body, which would win.
		$preview = ( new FormPreview( new FormRepository() ) )->check( (string) ( $request->get_url_params()['token'] ?? '' ), time() );
		if ( null === $preview ) {
			return self::response(
				array(
					'ok'   => false,
					'code' => 'preview_expired',
				),
				403
			);
		}
		if ( RateLimiter::exceeded( 'preview', $preview['form']['uid'], 600, 10 * MINUTE_IN_SECONDS ) ) {
			return self::response(
				array(
					'ok'   => false,
					'code' => 'rate_limited',
				),
				429
			);
		}
		$body = $callback( $preview['form'], $preview['document'] );
		if ( empty( $body['ok'] ) ) {
			$code = (string) ( $body['code'] ?? '' );
			return self::response( $body, 'invalid_answers' === $code ? 422 : 400 );
		}
		return self::response( $body, $status );
	}

	/**
	 * The submit use case with the site services (preview() uses none of them for writing).
	 */
	private static function use_case(): SubmitEntry {
		return SubmitEntry::create();
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
