<?php
/**
 * Second way to the form routes for visitors, through admin-ajax.php.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

defined( 'ABSPATH' ) || exit;

/**
 * Bridge in admin-ajax.php: action=funnelforms_form_api&rest_route=/funnelforms/v1/forms/<uid>/…
 * answers like the REST API.
 *
 * Forms on the new renderer send tokens, entries, uploads and the rest to /wp-json/. Some sites
 * refuse the REST API to visitors: security plugins ("REST API only for logged-in users"),
 * firewall rules of the host, or a REST API switched off. Funnelforms 3.x sent everything to
 * admin-ajax.php and worked there, so on such sites the update to 5.0 stopped every entry. The
 * runtime (packages/runtime/src/transport.ts) sends a request that such a rule refused here once
 * more, and every later one of the page.
 *
 * Only the public routes of a form go through, with the same checks and answers as on /wp-json/
 * (token, rate limits, captcha, spam checks, embedding). The browser sends no cookie, as it does
 * to /wp-json/, so the routes see a visitor.
 */
final class FormBridge {

	/** Action in admin-ajax.php. */
	public const ACTION = 'funnelforms_form_api';

	/** Routes the bridge passes on: the public routes of one form (FormsController). */
	private const ROUTE = '#^/' . FormsController::NAMESPACE . '/forms/[0-9a-f-]{36}(/[a-z/]+)?$#';

	/** Parameters of the bridge itself, not of the route. */
	private const OWN = array( 'action', 'rest_route' );

	/**
	 * Registers the handlers.
	 */
	public static function register(): void {
		add_action( 'wp_ajax_' . self::ACTION, array( self::class, 'handle' ) );
		add_action( 'wp_ajax_nopriv_' . self::ACTION, array( self::class, 'handle' ) );
	}

	/**
	 * Address of the bridge for the routes of a form; the runtime appends the path of the route.
	 *
	 * @param string $uid Form uid.
	 */
	public static function url( string $uid ): string {
		return admin_url( 'admin-ajax.php' ) . '?action=' . self::ACTION . '&rest_route=' . rawurlencode( '/' . FormsController::NAMESPACE . '/forms/' . $uid );
	}

	/**
	 * Answers a bridge request.
	 */
	public static function handle(): void {
		// phpcs:disable WordPress.Security.NonceVerification -- public routes of a form; each checks its token like on /wp-json/.
		$server  = wp_unslash( $_SERVER );
		$get     = wp_unslash( $_GET );
		$method  = strtoupper( (string) ( $server['REQUEST_METHOD'] ?? 'POST' ) );
		$query   = array_diff_key( is_array( $get ) ? $get : array(), array_flip( self::OWN ) );
		$request = self::request( $method, (string) ( $get['rest_route'] ?? '' ), $query );
		if ( $request instanceof \WP_REST_Request ) {
			$headers = rest_get_server()->get_headers( $server );
			$body    = \WP_REST_Server::get_raw_data();
			// The runtime sends JSON as text/plain here, so a browser sends it without asking first.
			if ( str_starts_with( strtolower( (string) ( $headers['CONTENT_TYPE'] ?? '' ) ), 'text/plain' ) ) {
				$headers['CONTENT_TYPE'] = 'application/json';
			}
			$request->set_headers( $headers );
			$request->set_body_params( wp_unslash( $_POST ) );
			$request->set_file_params( $_FILES );
			$request->set_body( $body );
		}
		// phpcs:enable WordPress.Security.NonceVerification
		$response = self::dispatch( $request );
		if ( ! headers_sent() ) {
			foreach ( $response->get_headers() as $name => $value ) {
				header( $name . ': ' . $value );
			}
			// Like the REST API: forms of the 3.x embed code run on other websites. No cookie is
			// sent or accepted, and each route checks the website (ExternalEmbed).
			$origin = get_http_origin();
			if ( '' !== $origin ) {
				header( 'Access-Control-Allow-Origin: ' . sanitize_url( $origin ) );
				header( 'Vary: Origin', false );
			}
			nocache_headers();
		}
		wp_send_json( rest_get_server()->response_to_data( $response, false ), $response->get_status() );
	}

	/**
	 * The REST request of a bridge request, or the error when the route is not a public form route.
	 *
	 * @param string              $method HTTP method.
	 * @param string              $route  Route, e.g. /funnelforms/v1/forms/abc/entries.
	 * @param array<string,mixed> $query  Query parameters of the route.
	 * @return \WP_REST_Request|\WP_Error
	 */
	public static function request( string $method, string $route, array $query ) {
		$route = '/' . ltrim( $route, '/' );
		if ( 1 !== preg_match( self::ROUTE, $route ) || str_contains( $route, '..' ) || ! in_array( $method, array( 'GET', 'POST' ), true ) ) {
			return new \WP_Error( 'rest_no_route', __( 'That did not work. Reload the page and try again.', 'funnelforms-free' ), array( 'status' => 404 ) );
		}
		$request = new \WP_REST_Request( $method, $route );
		$request->set_query_params( $query );
		return $request;
	}

	/**
	 * Runs a request through the REST server, as /wp-json/ would.
	 *
	 * @param \WP_REST_Request|\WP_Error $request Request, or the error of request().
	 */
	public static function dispatch( $request ): \WP_REST_Response {
		if ( is_wp_error( $request ) ) {
			return rest_convert_error_to_response( $request );
		}
		$server   = rest_get_server();
		$response = rest_ensure_response( $server->dispatch( $request ) );
		if ( is_wp_error( $response ) ) {
			return rest_convert_error_to_response( $response );
		}
		$response = apply_filters( 'rest_post_dispatch', $response, $server, $request ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- the REST API's own filter.
		return rest_ensure_response( $response );
	}
}
