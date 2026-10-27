<?php
/**
 * Input masks of 3.x text fields.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

/**
 * The part of the Inputmask syntax that 3.x forms use: 9 a digit, a a letter, * a letter or
 * digit, every other character as typed. Masks with optional parts, alternatives, repeats,
 * escapes or other definitions are not supported and keep the form on the 3.x renderer. The
 * runtime (packages/runtime/src/validate.ts) applies the same rules in the browser.
 */
final class InputMask {

	private const CLASSES = array(
		'9' => '\d',
		'a' => '\p{L}',
		'*' => '[\p{L}\d]',
	);

	/**
	 * Whether the new renderer can apply the mask.
	 *
	 * @param string $mask Mask.
	 */
	public static function supported( string $mask ): bool {
		return '' !== $mask && ! preg_match( '/[\[\]{}()|\\\\#&b-zA-Z]/', $mask );
	}

	/**
	 * Whether a text fills the mask completely.
	 *
	 * @param string $mask Supported mask.
	 * @param string $text Text.
	 */
	public static function matches( string $mask, string $text ): bool {
		$pattern = '';
		foreach ( (array) preg_split( '//u', $mask, -1, PREG_SPLIT_NO_EMPTY ) as $char ) {
			$pattern .= self::CLASSES[ $char ] ?? preg_quote( (string) $char, '/' );
		}
		return 1 === preg_match( '/^' . $pattern . '$/u', $text );
	}
}
