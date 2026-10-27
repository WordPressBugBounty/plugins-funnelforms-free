<?php
/**
 * Where visitors came from: sources, media and the channels they belong to.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

defined( 'ABSPATH' ) || exit;

/**
 * The runtime sends with the view the address the visitor came from and the query of the page;
 * detect() keeps of them only utm_source, utm_medium and utm_campaign, else whether an ad click id
 * is there, else the host of the referrer with the medium organic (search engines), social or
 * referral; "internal" for a page of the same site. Page views without a source came directly, or
 * their browser did not say.
 */
final class TrafficSources {

	/** Channels in the order they are shown. */
	public const CHANNELS = array( 'direct', 'search', 'paid', 'social', 'email', 'referral', 'internal', 'other' );

	/** Hosts of search engines: the engine itself or a country, search or news part of it (not mail or docs). */
	private const SEARCH = '/^([a-z]{2}\.)?(m\.|search\.|images\.|news\.)?(google|bing|yahoo|duckduckgo|ecosia|qwant|startpage|baidu|yandex|naver|seznam|ask|brave)(\.[a-z]{2,3}){1,2}$/';

	/** Hosts of social networks and their short links. */
	private const SOCIAL = '/(^|\.)(facebook|fb|instagram|linkedin|lnkd|twitter|x|t|pinterest|reddit|tiktok|youtube|youtu|xing|threads|snapchat|whatsapp|telegram|mastodon\.social)(\.[a-z]{2,3})?$/';

	/** Longest address or query read; anything longer is no real visit. */
	private const MAX_INPUT = 4096;

	/**
	 * Source, medium and campaign of a page view.
	 *
	 * @param mixed    $referrer Address the visitor came from (document.referrer).
	 * @param mixed    $search   Query of the page (location.search).
	 * @param string[] $own      Hosts of this site.
	 * @return array{source:string,medium:string,campaign:string}|null Null for input that is no address.
	 */
	public static function detect( $referrer, $search, array $own ): ?array {
		if ( ! is_string( $referrer ) || ! is_string( $search ) || strlen( $referrer ) > self::MAX_INPUT || strlen( $search ) > self::MAX_INPUT ) {
			return null;
		}
		parse_str( ltrim( $search, '?' ), $query );
		$param    = static fn( string $key ): string => is_string( $query[ $key ] ?? null ) ? $query[ $key ] : '';
		$campaign = FormStats::tag( $param( 'utm_campaign' ), false );
		$source   = FormStats::tag( $param( 'utm_source' ), true );
		$medium   = FormStats::tag( $param( 'utm_medium' ), true );
		if ( '' !== $source || '' !== $medium ) {
			return compact( 'source', 'medium', 'campaign' );
		}
		foreach ( array(
			'gclid'   => 'google',
			'gbraid'  => 'google',
			'wbraid'  => 'google',
			'msclkid' => 'bing',
		) as $key => $network ) {
			if ( isset( $query[ $key ] ) ) {
				return array(
					'source'   => $network,
					'medium'   => 'cpc',
					'campaign' => $campaign,
				);
			}
		}
		$host = in_array( strtolower( (string) wp_parse_url( $referrer, PHP_URL_SCHEME ) ), array( 'http', 'https' ), true ) ? self::host( (string) wp_parse_url( $referrer, PHP_URL_HOST ) ) : '';
		if ( '' === $host ) {
			$medium = '';
		} elseif ( in_array( $host, array_map( array( self::class, 'host' ), $own ), true ) ) {
			$medium = 'internal';
		} else {
			$source = FormStats::tag( $host, true );
			$medium = self::by_host( $host ) ?? 'referral';
		}
		return compact( 'source', 'medium', 'campaign' );
	}

	/**
	 * A host in lower case without "www.".
	 *
	 * @param string $host Host.
	 */
	private static function host( string $host ): string {
		return (string) preg_replace( '/^www\./', '', strtolower( $host ) );
	}

	/**
	 * The medium of a search engine or social network by its host or name; null for others.
	 *
	 * @param string $host Host, or a name such as "google".
	 */
	private static function by_host( string $host ): ?string {
		if ( 1 === preg_match( self::SEARCH, str_contains( $host, '.' ) ? $host : $host . '.com' ) ) {
			return 'organic';
		}
		return 1 === preg_match( self::SOCIAL, $host ) ? 'social' : null;
	}

	/**
	 * Rows per source and medium with their channel and conversion, the direct page views
	 * included, the most viewed first.
	 *
	 * @param array<string,array{source:string,medium:string,views:int,completions:int}> $grouped Counts from EventRepository::sources().
	 * @param int                                                                        $views   Page views of the period.
	 * @return list<array{source:string,medium:string,channel:string,views:int,completions:int,rate:?float}>
	 */
	public static function rows( array $grouped, int $views ): array {
		$direct = $grouped['|'] ?? array(
			'source'      => '',
			'medium'      => '',
			'views'       => 0,
			'completions' => 0,
		);
		unset( $grouped['|'] );
		$known           = array_sum( array_column( $grouped, 'views' ) );
		$direct['views'] = max( 0, $views - $known );
		$out             = array();
		foreach ( array_merge( array( $direct ), array_values( $grouped ) ) as $row ) {
			if ( 0 === $row['views'] + $row['completions'] ) {
				continue;
			}
			$out[] = $row + array(
				'channel' => self::channel( $row['source'], $row['medium'] ),
				'rate'    => $row['views'] > 0 ? min( 1.0, $row['completions'] / $row['views'] ) : null,
			);
		}
		usort( $out, static fn( array $a, array $b ): int => array( $b['views'], $b['completions'], $a['source'], $a['medium'] ) <=> array( $a['views'], $a['completions'], $b['source'], $b['medium'] ) );
		return $out;
	}

	/**
	 * Page views and sent forms per channel, every channel listed.
	 *
	 * @param list<array{channel:string,views:int,completions:int}> $rows Rows from rows().
	 * @return array<string,array{views:int,completions:int}>
	 */
	public static function channels( array $rows ): array {
		$out = array_fill_keys(
			self::CHANNELS,
			array(
				'views'       => 0,
				'completions' => 0,
			)
		);
		foreach ( $rows as $row ) {
			$out[ $row['channel'] ]['views']       += $row['views'];
			$out[ $row['channel'] ]['completions'] += $row['completions'];
		}
		return $out;
	}

	/**
	 * The channel of a source and medium.
	 *
	 * @param string $source Source.
	 * @param string $medium Medium.
	 */
	public static function channel( string $source, string $medium ): string {
		if ( '' === $source && '' === $medium ) {
			return 'direct';
		}
		$map = array(
			'internal' => '/^internal$/',
			'search'   => '/^(organic|seo|search)$/',
			'paid'     => '/^(cpc|ppc|cpm|cpv|paid.*|display|banner|ads?|retargeting|affiliate)$/',
			'social'   => '/^(social.*|sm)$/',
			'email'    => '/^(e-?mail|newsletter)$/',
			'referral' => '/^(referral|link)$/',
		);
		foreach ( $map as $channel => $pattern ) {
			if ( 1 === preg_match( $pattern, $medium ) ) {
				return $channel;
			}
		}
		// utm_source=google without a medium.
		$by_host = '' === $medium ? self::by_host( $source ) : null;
		return null === $by_host ? 'other' : self::channel( $source, $by_host );
	}

	/**
	 * The name of a channel, for people.
	 *
	 * @param string $channel Channel.
	 */
	public static function channel_label( string $channel ): string {
		$labels = array(
			'direct'   => __( 'Direct', 'funnelforms-free' ),
			'search'   => __( 'Search engines', 'funnelforms-free' ),
			'paid'     => __( 'Ads', 'funnelforms-free' ),
			'social'   => __( 'Social networks', 'funnelforms-free' ),
			'email'    => __( 'E-mail', 'funnelforms-free' ),
			'referral' => __( 'Other websites', 'funnelforms-free' ),
			'internal' => __( 'Your website', 'funnelforms-free' ),
			'other'    => __( 'Other campaigns', 'funnelforms-free' ),
		);
		return $labels[ $channel ] ?? $channel;
	}

	/**
	 * A source with its medium, for people: "google / cpc", or the channel's name for direct and
	 * internal page views.
	 *
	 * @param string $source Source.
	 * @param string $medium Medium.
	 */
	public static function label( string $source, string $medium ): string {
		if ( '' === $source ) {
			return '' === $medium || 'internal' === $medium ? self::channel_label( self::channel( $source, $medium ) ) : $medium;
		}
		return '' === $medium ? $source : $source . ' / ' . $medium;
	}
}
