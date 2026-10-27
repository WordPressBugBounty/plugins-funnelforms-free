<?php
/**
 * The site's privacy mode: EU (consent first), global (opt-out) or unrestricted.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

defined( 'ABSPATH' ) || exit;

/**
 * EU (default, also after an update): identifiers, IP address, user agent, conversions, tracking
 * code and the scripts of other services need the visitor's yes through the consent tool (WP
 * Consent API), and every conversion requires consent whatever its action says. Global: without a
 * consent tool consent counts as given; a no of the tool and Global Privacy Control still count.
 * Unrestricted: everything runs, every conversion is sent and full IP addresses are kept without
 * consent; the consent tool and Global Privacy Control are ignored. The site owner chooses it at
 * their own risk and confirms that when turning it on (save(), stored with date and user). The
 * server reads the mode from the option and never from the browser.
 */
final class PrivacyMode {

	public const OPTION = 'funnelforms_privacy_mode';

	public const EU     = 'eu';
	public const GLOBAL = 'global';
	public const OPEN   = 'open';

	/** Field of the settings form that confirms the unrestricted mode. */
	public const CONFIRM = 'funnelforms_privacy_open_confirm';

	/** Who confirmed the unrestricted mode, and when: {user: ID, at: Y-m-d H:i:s UTC}. */
	public const CONFIRMED = 'funnelforms_privacy_open_confirmed';

	/**
	 * The mode: eu, global or open.
	 */
	public static function current(): string {
		return self::sanitize( get_option( self::OPTION, self::EU ) );
	}

	/**
	 * Whether the EU mode applies.
	 */
	public static function eu(): bool {
		return self::EU === self::current();
	}

	/**
	 * Whether the unrestricted mode applies: no consent needed or asked for anything.
	 */
	public static function open(): bool {
		return self::OPEN === self::current();
	}

	/**
	 * Saved value: global or unrestricted only when chosen, anything else is the EU mode.
	 *
	 * @param mixed $value Submitted value.
	 */
	public static function sanitize( $value ): string {
		return in_array( $value, array( self::GLOBAL, self::OPEN ), true ) ? $value : self::EU;
	}

	/**
	 * Saves the settings form: only an administrator can switch to the unrestricted mode, and only
	 * with the box that confirms the owner's own responsibility; otherwise the mode stays as it was. The confirmation is kept with
	 * the user and the time.
	 *
	 * @param mixed $value Submitted value.
	 */
	public static function save( $value ): string {
		$mode = self::sanitize( $value );
		if ( self::OPEN === $mode && ! self::open() && ! current_user_can( 'manage_options' ) ) {
			add_settings_error( self::OPTION, 'funnelforms_privacy_open', __( 'Only an administrator can switch on the unrestricted privacy mode.', 'funnelforms-free' ) );
			return self::current();
		}
		// options.php checked the nonce of the settings form before it calls this.
		if ( self::OPEN === $mode && ! self::open() && empty( $_POST[ self::CONFIRM ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Missing
			add_settings_error( self::OPTION, 'funnelforms_privacy_open', __( 'Confirm that you have checked the unrestricted privacy mode is lawful for your website.', 'funnelforms-free' ) );
			return self::current();
		}
		if ( self::OPEN === $mode && ! self::open() ) {
			update_option(
				self::CONFIRMED,
				array(
					'user' => get_current_user_id(),
					'at'   => gmdate( 'Y-m-d H:i:s' ),
				),
				false
			);
		}
		return $mode;
	}

	/**
	 * The confirmation of the unrestricted mode, or null when there is none.
	 *
	 * @return array{user:int,at:string}|null
	 */
	public static function confirmed(): ?array {
		$saved = get_option( self::CONFIRMED );
		if ( ! is_array( $saved ) || ! is_string( $saved['at'] ?? null ) ) {
			return null;
		}
		return array(
			'user' => (int) ( $saved['user'] ?? 0 ),
			'at'   => $saved['at'],
		);
	}
}
