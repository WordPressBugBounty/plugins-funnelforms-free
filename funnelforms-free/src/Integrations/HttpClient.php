<?php
/**
 * HTTP for integrations.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Integrations;

defined( 'ABSPATH' ) || exit;

/**
 * Sends one HTTP request. Adapters use this interface so tests can answer without a network.
 */
interface HttpClient {

	/**
	 * Sends a request.
	 *
	 * @param string               $method  HTTP method.
	 * @param string               $url     URL.
	 * @param array<string,string> $headers Headers.
	 * @param string|null          $body    Body.
	 * @return array{code:int,body:string} Status 0 when no answer arrived.
	 */
	public function request( string $method, string $url, array $headers = array(), ?string $body = null ): array;
}
