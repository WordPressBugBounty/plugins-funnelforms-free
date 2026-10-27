<?php
/**
 * HTTP for integrations through the WordPress HTTP API.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Integrations;

defined( 'ABSPATH' ) || exit;

/**
 * The WordPress HTTP API (proxy settings, pre_http_request for tests), with TLS checks on.
 */
final class WpHttpClient implements HttpClient {

	/**
	 * Sends a request.
	 *
	 * @param string               $method  HTTP method.
	 * @param string               $url     URL.
	 * @param array<string,string> $headers Headers.
	 * @param string|null          $body    Body.
	 * @return array{code:int,body:string}
	 */
	public function request( string $method, string $url, array $headers = array(), ?string $body = null ): array {
		$args = array(
			'method'      => $method,
			'timeout'     => 20,
			'redirection' => 0,
			'headers'     => $headers,
		);
		if ( null !== $body ) {
			$args['body'] = $body;
		}
		$response = wp_remote_request( $url, $args );
		if ( is_wp_error( $response ) ) {
			return array(
				'code' => 0,
				'body' => '',
			);
		}
		return array(
			'code' => (int) wp_remote_retrieve_response_code( $response ),
			'body' => (string) wp_remote_retrieve_body( $response ),
		);
	}
}
