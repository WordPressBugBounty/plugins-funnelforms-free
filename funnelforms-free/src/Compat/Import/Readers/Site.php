<?php
/**
 * What readers need from the site they run on.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

defined( 'ABSPATH' ) || exit;

/**
 * Links of pages that a confirmation names by id. Without WordPress (unit tests) there are none.
 */
final class Site {

	/**
	 * Address of a page, or empty.
	 *
	 * @param mixed $id Page id.
	 */
	public static function page_url( $id ): string {
		if ( ! is_numeric( $id ) || (int) $id <= 0 || ! function_exists( 'get_permalink' ) ) {
			return '';
		}
		$url = get_permalink( (int) $id );
		return is_string( $url ) ? $url : '';
	}

	/**
	 * A confirmation that leads to a page: a redirect when its address is known, else a note.
	 *
	 * @param mixed    $page_id Page id.
	 * @param string[] $notes   Notes (added to).
	 * @return array<string,string>|null
	 */
	public static function page_confirmation( $page_id, array &$notes ): ?array {
		$url = self::page_url( $page_id );
		if ( '' === $url ) {
			$notes[] = 'confirmation_page_not_found:' . Values::str( $page_id );
			return null;
		}
		return array(
			'type' => 'redirect',
			'url'  => $url,
		);
	}
}
