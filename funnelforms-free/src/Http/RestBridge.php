<?php
/**
 * Second way to the REST routes for the admin screens, through admin-ajax.php.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

defined( 'ABSPATH' ) || exit;

/**
 * Bridge in admin-ajax.php: action=funnelforms_rest&rest_route=/funnelforms/v1/… answers like the REST API.
 *
 * The admin screens talk to /wp-json/ with the login cookie and the wp_rest nonce. On some sites
 * the cookie does not arrive there and WordPress answers every request with "Cookie check failed":
 * the site address and the WordPress address differ (www or not, a subfolder, another domain),
 * or a server cache drops cookies outside /wp-admin/. Funnelforms 3.x only used admin-ajax.php,
 * so sites that worked with 3.x broke with the update to 5.0. The screens send such a request
 * once more here (builder-ui/src/rest-bridge.ts), where the cookie always arrives.
 *
 * The request runs through the REST server like one to /wp-json/: same authentication check
 * (the filter rest_authentication_errors, which plugins that limit the REST API use), same routes,
 * same permission checks, same answers. Like the REST API with a cookie it needs the wp_rest
 * nonce, which protects against requests from other sites. Only the routes of Funnelforms and the
 * pages of the site (/wp/v2/pages, the page picker of the builder) go through.
 */
final class RestBridge {

	/** Action in admin-ajax.php. */
	public const ACTION = 'funnelforms_rest';

	/** Routes the bridge passes on. */
	private const ROUTES = array( '/funnelforms/v1/', '/wp/v2/pages/' );

	/** Parameters of the bridge itself, not of the route. */
	private const OWN = array( 'action', 'rest_route', '_wpnonce', '_method' );

	/**
	 * Registers the handlers.
	 */
	public static function register(): void {
		add_action( 'wp_ajax_' . self::ACTION, array( self::class, 'handle' ) );
		add_action( 'wp_ajax_nopriv_' . self::ACTION, array( self::class, 'logged_out' ) );
	}

	/**
	 * Answers a request of a logged-in user.
	 */
	public static function handle(): void {
		// phpcs:disable WordPress.Security.NonceVerification -- the wp_rest nonce is checked in request(), as the REST API does.
		$server = wp_unslash( $_SERVER );
		$get    = wp_unslash( $_GET );
		$method = strtoupper( (string) ( $server['REQUEST_METHOD'] ?? 'GET' ) );
		if ( isset( $get['_method'] ) ) {
			$method = strtoupper( (string) $get['_method'] );
		} elseif ( isset( $server['HTTP_X_HTTP_METHOD_OVERRIDE'] ) ) {
			$method = strtoupper( (string) $server['HTTP_X_HTTP_METHOD_OVERRIDE'] );
		}
		$nonce   = (string) ( $server['HTTP_X_WP_NONCE'] ?? ( $get['_wpnonce'] ?? '' ) );
		$query   = array_diff_key( is_array( $get ) ? $get : array(), array_flip( self::OWN ) );
		$route   = (string) ( $get['rest_route'] ?? '' );
		$rest    = rest_get_server();
		$request = self::request( $method, $route, $query, $nonce );
		if ( $request instanceof \WP_REST_Request ) {
			$request->set_headers( $rest->get_headers( $server ) );
			$request->set_body_params( wp_unslash( $_POST ) );
			$request->set_file_params( $_FILES );
			$request->set_body( \WP_REST_Server::get_raw_data() );
		}
		// phpcs:enable WordPress.Security.NonceVerification
		$response = self::dispatch( $request );
		if ( ! headers_sent() ) {
			foreach ( $response->get_headers() as $name => $value ) {
				header( $name . ': ' . $value );
			}
			// A fresh nonce, as /wp-json/ sends one; it keeps an editor open all day working.
			header( 'X-WP-Nonce: ' . wp_create_nonce( 'wp_rest' ) );
			nocache_headers();
		}
		wp_send_json( self::data( $response, $query ), $response->get_status() );
	}

	/**
	 * Answers a request without a login: the session ended, or the cookie did not arrive here either.
	 */
	public static function logged_out(): void {
		wp_send_json( self::error_data( self::not_logged_in() ), 401 );
	}

	/**
	 * The REST request of a bridge request, or the error when the nonce or the route does not fit.
	 *
	 * @param string              $method HTTP method, after the override.
	 * @param string              $route  Route, e.g. /funnelforms/v1/admin/forms/7.
	 * @param array<string,mixed> $query  Query parameters of the route.
	 * @param string              $nonce  wp_rest nonce.
	 * @return \WP_REST_Request|\WP_Error
	 */
	public static function request( string $method, string $route, array $query, string $nonce ) {
		if ( ! is_user_logged_in() ) {
			return self::not_logged_in();
		}
		if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			return new \WP_Error( 'rest_cookie_invalid_nonce', __( 'Your WordPress login could not be confirmed. Reload the page; if that does not help, log out and in again.', 'funnelforms-free' ), array( 'status' => 403 ) );
		}
		$route = '/' . ltrim( $route, '/' );
		$known = false;
		foreach ( self::ROUTES as $prefix ) {
			$known = $known || str_starts_with( $route . '/', $prefix );
		}
		if ( ! $known || str_contains( $route, '..' ) ) {
			return new \WP_Error( 'rest_no_route', __( 'That did not work. Reload the page and try again.', 'funnelforms-free' ), array( 'status' => 404 ) );
		}
		$request = new \WP_REST_Request( in_array( $method, array( 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS' ), true ) ? $method : 'GET', $route );
		$request->set_query_params( $query );
		return $request;
	}

	/**
	 * Runs a request through the REST server, as /wp-json/ would: first the authentication check
	 * of WP_REST_Server::serve_request(), so a site that refuses the REST API to some users
	 * (filter rest_authentication_errors) refuses it here too.
	 *
	 * @param \WP_REST_Request|\WP_Error $request Request, or the error of request().
	 */
	public static function dispatch( $request ): \WP_REST_Response {
		$server = rest_get_server();
		if ( is_wp_error( $request ) ) {
			return rest_convert_error_to_response( $request );
		}
		$auth = $server->check_authentication();
		if ( is_wp_error( $auth ) ) {
			return rest_convert_error_to_response( $auth );
		}
		$response = rest_ensure_response( $server->dispatch( $request ) );
		if ( is_wp_error( $response ) ) {
			return rest_convert_error_to_response( $response );
		}
		// Like WP_REST_Server::serve_request(), e.g. for _fields.
		$response = apply_filters( 'rest_post_dispatch', $response, $server, $request ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- the REST API's own filter.
		return rest_ensure_response( $response );
	}

	/**
	 * The body of an answer, with links and embedded objects as /wp-json/ gives them.
	 *
	 * @param \WP_REST_Response   $response Answer.
	 * @param array<string,mixed> $query    Query parameters of the request.
	 * @return mixed
	 */
	public static function data( \WP_REST_Response $response, array $query ) {
		$embed = isset( $query['_embed'] ) ? rest_parse_embed_param( $query['_embed'] ) : false;
		return rest_get_server()->response_to_data( $response, $embed );
	}

	/**
	 * The error for a request without a login.
	 */
	private static function not_logged_in(): \WP_Error {
		return new \WP_Error( 'rest_not_logged_in', __( 'Your WordPress login has ended. Please log in again and reopen this page.', 'funnelforms-free' ), array( 'status' => 401 ) );
	}

	/**
	 * An error as the REST API writes it.
	 *
	 * @param \WP_Error $error Error.
	 * @return array<string,mixed>
	 */
	private static function error_data( \WP_Error $error ): array {
		return array(
			'code'    => $error->get_error_code(),
			'message' => $error->get_error_message(),
			'data'    => $error->get_error_data(),
		);
	}
}
