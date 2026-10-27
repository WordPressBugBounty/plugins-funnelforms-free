<?php
/**
 * Amounts of payments.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Entry;

defined( 'ABSPATH' ) || exit;

/**
 * Amounts in a currency and in its smallest unit (cents), as the payment providers want them.
 */
final class Money {

	/** Currencies without minor units (Stripe's list). */
	private const ZERO_DECIMAL = array( 'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF' );

	/**
	 * An amount in the smallest unit of its currency, rounded half away from zero.
	 *
	 * @param float  $amount   Amount in the currency.
	 * @param string $currency ISO 4217 code.
	 */
	public static function minor( float $amount, string $currency ): int {
		return (int) round( $amount * self::unit( $currency ) );
	}

	/**
	 * Smallest units in one unit of the currency: 100, or 1 for currencies without cents.
	 *
	 * @param string $currency ISO 4217 code.
	 */
	public static function unit( string $currency ): int {
		return in_array( $currency, self::ZERO_DECIMAL, true ) ? 1 : 100;
	}

	/**
	 * An amount in the smallest unit as the decimal string PayPal and Mollie expect ("12.50").
	 *
	 * @param int    $minor    Amount in the smallest unit.
	 * @param string $currency ISO 4217 code.
	 */
	public static function decimal( int $minor, string $currency ): string {
		return 1 === self::unit( $currency ) ? (string) $minor : number_format( $minor / 100, 2, '.', '' );
	}

	/**
	 * An amount with its currency for people, e.g. "49.00 EUR".
	 *
	 * @param float  $amount   Amount.
	 * @param string $currency ISO 4217 code.
	 */
	public static function format( float $amount, string $currency ): string {
		$decimals = 1 === self::unit( $currency ) ? 0 : 2;
		return number_format_i18n( $amount, $decimals ) . ' ' . $currency;
	}

	/**
	 * Name of a payment status for people.
	 *
	 * @param string $status open, pending, paid, failed, canceled, refunded or disputed.
	 */
	public static function status_label( string $status ): string {
		$labels = array(
			'open'     => __( 'Not paid yet', 'funnelforms-free' ),
			'pending'  => __( 'Payment processing', 'funnelforms-free' ),
			'paid'     => __( 'Paid', 'funnelforms-free' ),
			'failed'   => __( 'Payment failed', 'funnelforms-free' ),
			'canceled' => __( 'Payment canceled', 'funnelforms-free' ),
			'refunded' => __( 'Refunded', 'funnelforms-free' ),
			'disputed' => __( 'Payment disputed', 'funnelforms-free' ),
		);
		return $labels[ $status ] ?? $status;
	}
}
