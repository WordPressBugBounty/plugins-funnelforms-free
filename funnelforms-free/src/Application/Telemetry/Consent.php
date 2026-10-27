<?php
/**
 * The site's choice about diagnostic data for Funnelforms, and the identity of the installation.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Telemetry;

use Funnelforms\Infrastructure\Crypto\SecretBox;

defined( 'ABSPATH' ) || exit;

/**
 * Off until an administrator ticks the box in the setup assistant or under Settings → General.
 * While it is on, the installation has a random ID (inst_ and 24 letters and digits) and a secret
 * of 32 random bytes (base64url), stored encrypted. Neither is linked to the license, the site
 * token or the domain. Turning it off forgets both; turning it on again makes new ones.
 * Contract: docs/api/diagnostics.md.
 */
final class Consent {

	public const OPTION = 'funnelforms_diagnostics';

	/** Last status: a report was taken (202). */
	public const SENT = 'sent';

	/** Last status: the Brain gave no answer or an error; the next weekly run tries again. */
	public const FAILED = 'failed';

	/** Last status: the Brain knew another secret (401); a new identity goes with the next run. */
	public const RENEWED = 'renewed';

	/** Last status: the Brain takes no more reports from this installation (410). */
	public const STOPPED = 'stopped';

	/** Industries a site can name, in the order of the list. */
	public const INDUSTRIES = array( 'craft', 'construction', 'real_estate', 'finance', 'insurance', 'health', 'beauty', 'education', 'coaching', 'agency', 'ecommerce', 'software', 'solar_energy', 'automotive', 'tourism', 'legal', 'other' );

	/**
	 * The stored settings.
	 *
	 * @return array{enabled:bool,site_url:bool,industry:string,install_id:string,secret:string,consented_at:string,last_sent_at:string,last_status:string,next_after:string}
	 */
	public static function get(): array {
		$stored = get_option( self::OPTION, array() );
		return self::clean( is_array( $stored ) ? $stored : array() );
	}

	/**
	 * Whether reports are sent.
	 */
	public static function enabled(): bool {
		$settings = self::get();
		return $settings['enabled'] && '' !== $settings['install_id'];
	}

	/**
	 * Settings with every key and a known value.
	 *
	 * @param array<string,mixed> $stored Stored or changed values.
	 * @return array{enabled:bool,site_url:bool,industry:string,install_id:string,secret:string,consented_at:string,last_sent_at:string,last_status:string,next_after:string}
	 */
	public static function clean( array $stored ): array {
		$enabled = ! empty( $stored['enabled'] );
		$text    = static fn( string $key ): string => is_string( $stored[ $key ] ?? null ) ? $stored[ $key ] : '';
		return array(
			'enabled'      => $enabled,
			// The address goes only with the report, so it is off whenever the report is.
			'site_url'     => $enabled && ! empty( $stored['site_url'] ),
			'industry'     => self::industry( $stored['industry'] ?? '' ),
			'install_id'   => self::valid_id( $text( 'install_id' ) ) ? $text( 'install_id' ) : '',
			'secret'       => $text( 'secret' ),
			'consented_at' => $text( 'consented_at' ),
			'last_sent_at' => $text( 'last_sent_at' ),
			'last_status'  => in_array( $text( 'last_status' ), array( self::SENT, self::FAILED, self::RENEWED, self::STOPPED ), true ) ? $text( 'last_status' ) : '',
			'next_after'   => $text( 'next_after' ),
		);
	}

	/**
	 * Stores settings.
	 *
	 * @param array<string,mixed> $settings Settings (keys of get()).
	 */
	public static function store( array $settings ): void {
		update_option( self::OPTION, self::clean( $settings ), false );
	}

	/**
	 * A submitted industry, or empty for none of the list (no answer).
	 *
	 * @param mixed $value Submitted value.
	 */
	public static function industry( $value ): string {
		return is_string( $value ) && in_array( $value, self::INDUSTRIES, true ) ? $value : '';
	}

	/**
	 * The choice as a form sends it (fields diagnostics, diagnostics_url, diagnostics_industry).
	 * The address and the industry count only while the main toggle is on.
	 *
	 * @param array<string,mixed> $post Submitted fields (unslashed).
	 * @return array{enabled:bool,site_url:bool,industry:string}
	 */
	public static function submitted( array $post ): array {
		$enabled = ! empty( $post['diagnostics'] );
		return array(
			'enabled'  => $enabled,
			'site_url' => $enabled && ! empty( $post['diagnostics_url'] ),
			'industry' => $enabled ? self::industry( isset( $post['diagnostics_industry'] ) ? sanitize_key( (string) $post['diagnostics_industry'] ) : '' ) : '',
		);
	}

	/**
	 * Names of the industries, for the select; the empty key is "no answer".
	 *
	 * @return array<string,string>
	 */
	public static function industry_labels(): array {
		return array(
			''             => __( 'No answer', 'funnelforms-free' ),
			'craft'        => __( 'Craft and trades', 'funnelforms-free' ),
			'construction' => __( 'Construction', 'funnelforms-free' ),
			'real_estate'  => __( 'Real estate', 'funnelforms-free' ),
			'finance'      => __( 'Finance', 'funnelforms-free' ),
			'insurance'    => __( 'Insurance', 'funnelforms-free' ),
			'health'       => __( 'Health and care', 'funnelforms-free' ),
			'beauty'       => __( 'Beauty and wellness', 'funnelforms-free' ),
			'education'    => __( 'Education', 'funnelforms-free' ),
			'coaching'     => __( 'Coaching and consulting', 'funnelforms-free' ),
			'agency'       => __( 'Agency and marketing', 'funnelforms-free' ),
			'ecommerce'    => __( 'Online shop', 'funnelforms-free' ),
			'software'     => __( 'Software and IT', 'funnelforms-free' ),
			'solar_energy' => __( 'Solar and energy', 'funnelforms-free' ),
			'automotive'   => __( 'Automotive', 'funnelforms-free' ),
			'tourism'      => __( 'Tourism and hospitality', 'funnelforms-free' ),
			'legal'        => __( 'Legal and tax', 'funnelforms-free' ),
			'other'        => __( 'Other', 'funnelforms-free' ),
		);
	}

	/**
	 * Applies a choice of the setup assistant or the settings: turning on makes a new identity and
	 * plans the first report shortly after; turning off asks the Brain to delete the reports and
	 * forgets the identity; taking the address out while it stays on sends a report without it at
	 * once.
	 *
	 * @param bool   $enabled  Send reports.
	 * @param bool   $site_url Include the website's address.
	 * @param string $industry Industry key, empty for no answer.
	 * @return string What happened: on, off, changed or same.
	 */
	public static function apply( bool $enabled, bool $site_url, string $industry ): string {
		$before = self::get();
		$after  = array(
			'enabled'  => $enabled,
			'site_url' => $site_url,
			'industry' => $industry,
		) + $before;
		if ( $enabled && ! self::enabled() ) {
			$after = self::identity() + array(
				'consented_at' => gmdate( 'Y-m-d H:i:s' ),
				'last_sent_at' => '',
				'last_status'  => '',
				'next_after'   => '',
			) + $after;
			self::store( $after );
			Sender::schedule();
			Sender::soon();
			return 'on';
		}
		if ( ! $enabled ) {
			if ( ! self::enabled() ) {
				self::store( $after );
				return 'same';
			}
			Sender::forget( $before['install_id'], $before['secret'] );
			self::store( self::forgotten( $after ) );
			Sender::schedule();
			AdminUsage::reset();
			return 'off';
		}
		self::store( $after );
		$after = self::get();
		if ( $before['site_url'] && ! $after['site_url'] ) {
			// The Brain removes the address from the stored reports once a report comes without it.
			Sender::soon( 0 );
		}
		return $after === $before ? 'same' : 'changed';
	}

	/**
	 * Settings without the identity: off, no ID, no secret, no consent time.
	 *
	 * @param array<string,mixed> $settings Settings.
	 * @return array<string,mixed>
	 */
	public static function forgotten( array $settings ): array {
		return array(
			'enabled'      => false,
			'site_url'     => false,
			'install_id'   => '',
			'secret'       => '',
			'consented_at' => '',
			'next_after'   => '',
		) + $settings;
	}

	/**
	 * A new ID and secret, the secret encrypted.
	 *
	 * @return array{install_id:string,secret:string}
	 */
	public static function identity(): array {
		return array(
			'install_id' => self::new_id(),
			'secret'     => SecretBox::for_site()->encrypt( self::new_secret() ),
		);
	}

	/**
	 * The plain secret of the stored settings; empty when there is none or it cannot be read
	 * (the WordPress salts changed).
	 *
	 * @param string $encrypted Stored value.
	 */
	public static function secret( string $encrypted ): string {
		return '' === $encrypted ? '' : (string) SecretBox::for_site()->decrypt( $encrypted );
	}

	/**
	 * A random installation ID: inst_ and 24 letters and digits.
	 */
	public static function new_id(): string {
		$chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		$id    = 'inst_';
		for ( $i = 0; $i < 24; $i++ ) {
			$id .= $chars[ random_int( 0, 61 ) ];
		}
		return $id;
	}

	/**
	 * Whether a text is an installation ID.
	 *
	 * @param string $id Text.
	 */
	public static function valid_id( string $id ): bool {
		return 1 === preg_match( '/^inst_[A-Za-z0-9]{24}$/', $id );
	}

	/**
	 * A random secret: 32 bytes, base64url without padding (43 characters).
	 */
	public static function new_secret(): string {
		return sodium_bin2base64( random_bytes( 32 ), SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING );
	}
}
