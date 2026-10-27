<?php
/**
 * How a visitor filled in a form: device, browser, where they came from and how long they took.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Entry;

defined( 'ABSPATH' ) || exit;

/**
 * Kept with each entry (meta.visit, and the device in its own column for the filter). Device,
 * browser and system are read from the user agent, which is not stored; there is no IP address,
 * screen size or anything else that could single out a visitor. The referrer keeps only its
 * address without query, and times are whole seconds the runtime measured.
 */
final class VisitAnalytics {

	public const DEVICES = array( 'desktop', 'tablet', 'mobile' );

	/** Longest time counted: a visitor may continue a saved form weeks later. */
	private const MAX_SECONDS = 90 * DAY_IN_SECONDS;

	/**
	 * The visit of a submit.
	 *
	 * @param mixed    $input      analytics object of the submit: seconds, steps {node: seconds}, referrer.
	 * @param string   $user_agent User agent of the request.
	 * @param string[] $nodes      Nodes on the path; times of other nodes are dropped.
	 * @return array{device:string,browser:string,os:string,referrer:string,seconds:?int,steps:array<string,int>}
	 */
	public static function from_input( $input, string $user_agent, array $nodes ): array {
		$input = is_array( $input ) ? $input : array();
		$steps = array();
		foreach ( is_array( $input['steps'] ?? null ) ? $input['steps'] : array() as $node => $seconds ) {
			if ( in_array( (string) $node, $nodes, true ) && is_numeric( $seconds ) ) {
				$steps[ (string) $node ] = self::seconds( $seconds );
			}
		}
		return array(
			'device'   => self::device( $user_agent ),
			'browser'  => self::browser( $user_agent ),
			'os'       => self::os( $user_agent ),
			'referrer' => self::referrer( $input['referrer'] ?? '' ),
			'seconds'  => is_numeric( $input['seconds'] ?? null ) && $input['seconds'] > 0 ? self::seconds( $input['seconds'] ) : null,
			'steps'    => $steps,
		);
	}

	/**
	 * Desktop, tablet or mobile.
	 *
	 * @param string $ua User agent.
	 */
	public static function device( string $ua ): string {
		if ( 1 === preg_match( '/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i', $ua ) ) {
			return 'tablet';
		}
		if ( 1 === preg_match( '/Mobi|iPhone|iPod|Android|Windows Phone/i', $ua ) ) {
			return 'mobile';
		}
		return 'desktop';
	}

	/**
	 * The name of a device kind, for people.
	 *
	 * @param string $device desktop, tablet or mobile.
	 */
	public static function device_label( string $device ): string {
		$labels = array(
			'desktop' => __( 'Desktop', 'funnelforms-free' ),
			'tablet'  => __( 'Tablet', 'funnelforms-free' ),
			'mobile'  => __( 'Mobile', 'funnelforms-free' ),
		);
		return $labels[ $device ] ?? '';
	}

	/**
	 * A time span as the lead list shows it: "45 s", "3 min 05 s", "1 h 02 min".
	 *
	 * @param int $seconds Seconds.
	 */
	public static function duration( int $seconds ): string {
		$seconds = max( 0, $seconds );
		if ( $seconds < 60 ) {
			/* translators: %d: seconds. */
			return sprintf( __( '%d s', 'funnelforms-free' ), $seconds );
		}
		if ( $seconds < 3600 ) {
			/* translators: 1: minutes, 2: seconds with two digits. */
			return sprintf( __( '%1$d min %2$s s', 'funnelforms-free' ), intdiv( $seconds, 60 ), sprintf( '%02d', $seconds % 60 ) );
		}
		/* translators: 1: hours, 2: minutes with two digits. */
		return sprintf( __( '%1$d h %2$s min', 'funnelforms-free' ), intdiv( $seconds, 3600 ), sprintf( '%02d', intdiv( $seconds % 3600, 60 ) ) );
	}

	/**
	 * The browser's name; the order matters, since most name Chrome and Safari as well.
	 *
	 * @param string $ua User agent.
	 */
	public static function browser( string $ua ): string {
		$browsers = array(
			'Edge'             => '/Edg(e|A|iOS)?\//',
			'Opera'            => '/OPR\/|Opera/',
			'Samsung Internet' => '/SamsungBrowser\//',
			'Firefox'          => '/Firefox\/|FxiOS\//',
			'Chrome'           => '/Chrome\/|CriOS\//',
			'Safari'           => '/Version\/[\d.]+.*Safari\//',
		);
		foreach ( $browsers as $name => $pattern ) {
			if ( 1 === preg_match( $pattern, $ua ) ) {
				return $name;
			}
		}
		return '' === trim( $ua ) ? '' : 'Other';
	}

	/**
	 * The operating system's name.
	 *
	 * @param string $ua User agent.
	 */
	public static function os( string $ua ): string {
		$systems = array(
			'iOS'      => '/iPhone|iPad|iPod/',
			'Android'  => '/Android/',
			'Windows'  => '/Windows/',
			'ChromeOS' => '/CrOS/',
			'macOS'    => '/Mac OS X|Macintosh/',
			'Linux'    => '/Linux/',
		);
		foreach ( $systems as $name => $pattern ) {
			if ( 1 === preg_match( $pattern, $ua ) ) {
				return $name;
			}
		}
		return '' === trim( $ua ) ? '' : 'Other';
	}

	/**
	 * Where the visitor came from: a web address without query and fragment.
	 *
	 * @param mixed $url Referrer from the runtime.
	 */
	private static function referrer( $url ): string {
		$url = is_string( $url ) ? trim( $url ) : '';
		if ( 1 !== preg_match( '#^https?://#i', $url ) ) {
			return '';
		}
		$url = (string) preg_replace( '/[?#].*$/s', '', $url );
		return mb_substr( esc_url_raw( $url, array( 'http', 'https' ) ), 0, 500 );
	}

	/**
	 * Whole seconds within the limits.
	 *
	 * @param mixed $value Seconds.
	 */
	private static function seconds( $value ): int {
		return (int) max( 0, min( self::MAX_SECONDS, round( (float) $value ) ) );
	}
}
