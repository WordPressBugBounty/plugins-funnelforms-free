<?php
/**
 * Sends the weekly diagnostic report to the Funnelforms Brain and asks it to delete the reports.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Telemetry;

use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Brain\BrainClient;

defined( 'ABSPATH' ) || exit;

/**
 * Only through WP-Cron or a click in the admin, never while a visitor waits. Once a week at a
 * random time, and once shortly after the box was ticked. The installation signs in with its own
 * secret (Authorization: Bearer), independent of the license and the site token, so Funnelforms
 * Free takes part without an account. Failures are not retried; the next weekly run tries again.
 * Contract: docs/api/diagnostics.md.
 */
final class Sender {

	public const HOOK = 'funnelforms_diagnostics_send';

	/** Single job that repeats a deletion request the Brain did not answer. */
	public const FORGET = 'funnelforms_diagnostics_forget';

	/** Address of the Brain where the Pro client is not part of the build (Funnelforms Free). */
	public const URL = 'https://api.funnelforms.cloud/kunde/v1';

	/** Path of the reports below the base address. */
	public const REPORTS = '/diagnose/berichte';

	/** Path of an installation below the base address. */
	public const INSTALLATIONS = '/diagnose/installationen/';

	private const TIMEOUT = 10;

	/** A week in seconds (also without WordPress, for the unit tests of outcome()). */
	private const WEEK = 604800;

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( self::HOOK, array( self::class, 'run' ) );
		add_action( self::FORGET, array( self::class, 'forget_later' ), 10, 2 );
		add_action( 'init', array( self::class, 'schedule' ) );
		add_action( 'admin_init', array( Report::class, 'note_installed' ) );
	}

	/**
	 * Plans the weekly report at a random time while diagnostics are on, and removes it when they
	 * are off.
	 */
	public static function schedule(): void {
		if ( Consent::enabled() ) {
			if ( false === wp_next_scheduled( self::HOOK ) ) {
				wp_schedule_event( time() + wp_rand( HOUR_IN_SECONDS, WEEK_IN_SECONDS ), 'weekly', self::HOOK );
			}
		} elseif ( false !== wp_next_scheduled( self::HOOK ) || false !== wp_next_scheduled( self::HOOK, array( 'soon' ) ) ) {
			wp_unschedule_hook( self::HOOK );
		}
	}

	/**
	 * Plans one report outside the weekly rhythm (the first after the box was ticked, or one
	 * without the site address once it was taken out).
	 *
	 * @param int $delay Seconds from now.
	 */
	public static function soon( int $delay = MINUTE_IN_SECONDS ): void {
		if ( false === wp_next_scheduled( self::HOOK, array( 'soon' ) ) ) {
			wp_schedule_single_event( time() + $delay, self::HOOK, array( 'soon' ) );
		}
	}

	/**
	 * WP-Cron: sends the report unless the Brain asked to wait (next_after).
	 *
	 * @param string $why soon for a report outside the weekly rhythm.
	 */
	public static function run( $why = '' ): void {
		$settings = Consent::get();
		if ( ! Consent::enabled() ) {
			return;
		}
		$after = '' === $settings['next_after'] ? 0 : (int) strtotime( $settings['next_after'] . ' UTC' );
		if ( 'soon' !== $why && $after > time() ) {
			return;
		}
		self::send();
	}

	/**
	 * Sends the report now and stores the outcome.
	 *
	 * @return string Status (Consent::SENT, FAILED, RENEWED or STOPPED); empty when diagnostics are off.
	 */
	public static function send(): string {
		$settings = Consent::get();
		if ( ! Consent::enabled() ) {
			return '';
		}
		$now    = time();
		$secret = Consent::secret( $settings['secret'] );
		$answer = '' === $secret ? array(
			'status' => 401,
			'body'   => array(),
		) : self::request( 'POST', self::REPORTS, Report::build( $settings, $now ), $secret );
		$after  = self::outcome( $settings, $answer, $now, array( Consent::class, 'identity' ) );
		Consent::store( $after );
		if ( Consent::SENT === $after['last_status'] ) {
			AdminUsage::reset();
		}
		if ( Consent::STOPPED === $after['last_status'] ) {
			wp_unschedule_hook( self::HOOK );
		}
		return $after['last_status'];
	}

	/**
	 * The settings after an answer of the Brain. 202: sent, with the time before which the Brain
	 * takes no new report. 401: the Brain knows another secret for this ID; a new ID and secret go
	 * with the next run. 410: the Brain takes no more reports; diagnostics stop and the identity is
	 * forgotten. Anything else, and no answer: failed, the next weekly run tries again.
	 *
	 * @param array<string,mixed>                             $settings Consent::get().
	 * @param array{status:int,body:array<string,mixed>}|null $answer   Answer; null without one.
	 * @param int                                             $now      Time.
	 * @param callable                                        $identity Makes a new ID and secret (Consent::identity()).
	 * @return array<string,mixed> Settings to store.
	 */
	public static function outcome( array $settings, ?array $answer, int $now, callable $identity ): array {
		$status = null === $answer ? 0 : (int) $answer['status'];
		if ( 202 === $status ) {
			$next = is_string( $answer['body']['next_after'] ?? null ) ? strtotime( $answer['body']['next_after'] ) : false;
			return array(
				'last_sent_at' => gmdate( 'Y-m-d H:i:s', $now ),
				'last_status'  => Consent::SENT,
				// The Brain asks for at most a week of rest; anything longer counts as a week.
				'next_after'   => false === $next ? '' : gmdate( 'Y-m-d H:i:s', min( (int) $next, $now + self::WEEK ) ),
			) + $settings;
		}
		if ( 401 === $status ) {
			return array(
				'last_status' => Consent::RENEWED,
				'next_after'  => '',
			) + $identity() + $settings;
		}
		if ( 410 === $status ) {
			return array( 'last_status' => Consent::STOPPED ) + Consent::forgotten( $settings );
		}
		return array( 'last_status' => Consent::FAILED ) + $settings;
	}

	/**
	 * Asks the Brain to delete everything of an installation (best effort). Without an answer, or
	 * with an error of the Brain, it is asked once more from WP-Cron.
	 *
	 * @param string $install_id Installation ID.
	 * @param string $encrypted  Secret as stored (encrypted).
	 * @return bool Whether the Brain confirmed.
	 */
	public static function forget( string $install_id, string $encrypted ): bool {
		$secret = Consent::secret( $encrypted );
		if ( ! Consent::valid_id( $install_id ) || '' === $secret ) {
			return false;
		}
		$answer = self::request( 'DELETE', self::INSTALLATIONS . $install_id, null, $secret );
		if ( null !== $answer && $answer['status'] < 500 ) {
			return in_array( $answer['status'], array( 200, 202, 204, 404, 410 ), true );
		}
		wp_schedule_single_event( time() + HOUR_IN_SECONDS, self::FORGET, array( $install_id, $encrypted ) );
		return false;
	}

	/**
	 * WP-Cron: the deletion request once more, without another retry.
	 *
	 * @param string $install_id Installation ID.
	 * @param string $encrypted  Secret as stored (encrypted).
	 */
	public static function forget_later( $install_id, $encrypted ): void {
		$secret = Consent::secret( (string) $encrypted );
		if ( Consent::valid_id( (string) $install_id ) && '' !== $secret ) {
			self::request( 'DELETE', self::INSTALLATIONS . $install_id, null, $secret );
		}
	}

	/**
	 * Uninstall: asks the Brain to delete the reports without waiting for the answer. Runs from
	 * uninstall.php, where only this class, Consent and SecretBox are loaded; uninstall.php then
	 * deletes the options and jobs.
	 */
	public static function forget_on_uninstall(): void {
		$settings = Consent::get();
		$secret   = Consent::secret( $settings['secret'] );
		if ( ! $settings['enabled'] || ! Consent::valid_id( $settings['install_id'] ) || '' === $secret ) {
			return;
		}
		wp_remote_request(
			self::own_base() . self::INSTALLATIONS . $settings['install_id'],
			array(
				'method'   => 'DELETE',
				'timeout'  => 1,
				'blocking' => false,
				'headers'  => array(
					'Accept'        => 'application/json',
					'Authorization' => 'Bearer ' . $secret,
				),
			)
		);
	}

	/**
	 * Address of the Brain's customer API, without a trailing slash: the one of the Pro client,
	 * else the same address with the same constant and filter.
	 */
	public static function base(): string {
		$client = Edition::pro( BrainClient::class );
		return null === $client ? self::own_base() : $client::base();
	}

	/**
	 * The address without the Pro client (FUNNELFORMS_BRAIN_URL or the filter funnelforms_brain_url
	 * for staging and tests).
	 */
	private static function own_base(): string {
		$url = defined( 'FUNNELFORMS_BRAIN_URL' ) ? (string) constant( 'FUNNELFORMS_BRAIN_URL' ) : self::URL;
		return untrailingslashit( (string) apply_filters( 'funnelforms_brain_url', $url ) );
	}

	/**
	 * A request to the Brain: through the Pro client, else the same JSON request here.
	 *
	 * @param string                   $method POST or DELETE.
	 * @param string                   $path   Path below the base.
	 * @param array<string,mixed>|null $body   JSON body.
	 * @param string                   $secret Installation secret.
	 * @return array{status:int,body:array<string,mixed>}|null Null when the Brain cannot be reached.
	 */
	private static function request( string $method, string $path, ?array $body, string $secret ): ?array {
		$client = Edition::pro( BrainClient::class );
		if ( null !== $client ) {
			return $client::request( $method, $path, $body, $secret );
		}
		$headers = array(
			'Accept'        => 'application/json',
			'Authorization' => 'Bearer ' . $secret,
		);
		if ( null !== $body ) {
			$headers['Content-Type'] = 'application/json';
		}
		$response = wp_remote_request(
			self::own_base() . $path,
			array(
				'method'  => $method,
				'timeout' => self::TIMEOUT,
				'headers' => $headers,
				'body'    => null === $body ? null : (string) wp_json_encode( $body ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return null;
		}
		$answer = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		return array(
			'status' => (int) wp_remote_retrieve_response_code( $response ),
			'body'   => is_array( $answer ) ? $answer : array(),
		);
	}
}
