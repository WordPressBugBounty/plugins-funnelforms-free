<?php
/**
 * The weekly diagnostic report (format v1) from the plugin's own data.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Telemetry;

use Funnelforms\Application\FormStats;
use Funnelforms\Application\FormTemplates;
use Funnelforms\Application\PrivacyMode;
use Funnelforms\Application\SetupFlow;
use Funnelforms\Application\StatsPeriod;
use Funnelforms\Compat\Migration\FormVerifier;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Domain\Form\Document;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\FormBlock;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Database\Schema;
use Funnelforms\Infrastructure\Repository\EntryFigures;
use Funnelforms\Infrastructure\Repository\EventRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- counts over this plugin's tables and the posts, once a week, fresh on purpose.

/**
 * Two halves. collect() reads what the site has (it may hold titles, IDs and texts); assemble()
 * keeps only what the report may carry: versions, the environment named by fixed lists, counts,
 * shares and the shape of the forms. It never carries texts, labels, answers, entries, e-mail or IP
 * addresses, form IDs, slugs or addresses, except the site's own address when the box is ticked.
 * Forms in per_form have no ID, come in random order, need 20 views in the period and are at most
 * 50. The report stays below 64 KB; per_form rows go first. Format: docs/api/diagnostics.md.
 */
final class Report {

	public const SCHEMA = 1;

	/**
	 * Name of the Elementor widget (ElementorWidget::NAME; that class needs Elementor to load).
	 */
	private const ELEMENTOR_WIDGET = 'funnelforms';

	/** Option: the first version of Funnelforms 5 seen on this site and when. */
	public const INSTALLED = 'funnelforms_installed';

	/** Days the report covers. */
	public const PERIOD_DAYS = 7;

	/** Largest report in bytes (JSON as sent). */
	public const MAX_BYTES = 65536;

	/** Views in the period a form needs for a row of its own. */
	public const MIN_VIEWS = 20;

	/** Rows of per_form at most. */
	public const MAX_FORMS = 50;

	/** Themes named in the report (template slug); any other is "other". */
	public const THEMES = array( 'astra', 'avada', 'betheme', 'blocksy', 'bricks', 'colibri-wp', 'divi', 'enfold', 'extra', 'flatsome', 'generatepress', 'hello-biz', 'hello-elementor', 'hestia', 'impreza', 'jupiter', 'kadence', 'neve', 'oceanwp', 'ollie', 'porto', 'salient', 'storefront', 'sydney', 'the7', 'twentytwenty', 'twentytwentyone', 'twentytwentytwo', 'twentytwentythree', 'twentytwentyfour', 'twentytwentyfive', 'uncode', 'woodmart', 'zakra' );

	/** Page builders by plugin folder. Divi and Bricks as themes count too (see builders()). */
	public const BUILDERS = array(
		'elementor'                     => 'elementor',
		'elementor-pro'                 => 'elementor',
		'beaver-builder-lite-version'   => 'beaver-builder',
		'bb-plugin'                     => 'beaver-builder',
		'divi-builder'                  => 'divi',
		'js_composer'                   => 'wpbakery',
		'oxygen'                        => 'oxygen',
		'breakdance'                    => 'breakdance',
		'brizy'                         => 'brizy',
		'thrive-visual-editor'          => 'thrive-architect',
		'siteorigin-panels'             => 'siteorigin',
		'fusion-builder'                => 'avada-builder',
		'ultimate-addons-for-gutenberg' => 'spectra',
		'kadence-blocks'                => 'kadence-blocks',
		'generateblocks'                => 'generateblocks',
	);

	/** Consent tools by plugin folder. */
	public const CONSENT_TOOLS = array(
		'complianz-gdpr'              => 'complianz',
		'complianz-gdpr-premium'      => 'complianz',
		'borlabs-cookie'              => 'borlabs-cookie',
		'real-cookie-banner'          => 'real-cookie-banner',
		'real-cookie-banner-pro'      => 'real-cookie-banner',
		'cookiebot'                   => 'cookiebot',
		'cookie-notice'               => 'cookie-notice',
		'cookie-law-info'             => 'cookieyes',
		'gdpr-cookie-compliance'      => 'gdpr-cookie-compliance',
		'iubenda-cookie-law-solution' => 'iubenda',
		'uk-cookie-consent'           => 'termly',
	);

	/** Other plugins named in the report by plugin folder: consent, languages, cache. */
	public const PLUGINS = array(
		'wp-consent-api'              => 'wp-consent-api',
		'sitepress-multilingual-cms'  => 'wpml',
		'polylang'                    => 'polylang',
		'polylang-pro'                => 'polylang',
		'translatepress-multilingual' => 'translatepress',
		'weglot'                      => 'weglot',
		'gtranslate'                  => 'gtranslate',
		'wp-rocket'                   => 'wp-rocket',
		'w3-total-cache'              => 'w3-total-cache',
		'wp-super-cache'              => 'wp-super-cache',
		'litespeed-cache'             => 'litespeed-cache',
		'wp-fastest-cache'            => 'wp-fastest-cache',
		'autoptimize'                 => 'autoptimize',
		'sg-cachepress'               => 'sg-optimizer',
		'breeze'                      => 'breeze',
		'hummingbird-performance'     => 'hummingbird',
		'perfmatters'                 => 'perfmatters',
		'flying-press'                => 'flying-press',
		'nitropack'                   => 'nitropack',
		'wp-optimize'                 => 'wp-optimize',
		'woocommerce'                 => 'woocommerce',
	);

	/** CRM and newsletter tools a CRM action names (config.provider). */
	public const CRM_PROVIDERS = array( 'activecampaign', 'brevo', 'cleverreach', 'dealsnprojects', 'fincrm', 'getresponse', 'googlesheets', 'hellohq', 'hubspot', 'klicktipp', 'mailchimp', 'pipedrive' );

	/** Features counted per form; keys of Edition::pro_features() with the name in the report. */
	private const FEATURES = array(
		'calculations'  => 'calculations',
		'quiz'          => 'quiz',
		'experiments'   => 'ab_tests',
		'payment'       => 'payments',
		'save_progress' => 'save_progress',
		'double_opt_in' => 'double_opt_in',
		'time_limit'    => 'time_limit',
		'multilingual'  => 'languages',
		'custom_css'    => 'custom_css',
	);

	/** Action kinds counted per form (a CRM action counts as crm:<provider>). */
	private const ACTIONS = array( 'email', 'autoresponder', 'webhook', 'chat', 'sms', 'whatsapp', 'conversion', 'googleAds' );

	/**
	 * The report of this site now.
	 *
	 * @param array<string,mixed> $settings Consent::get().
	 * @param int                 $now      Time.
	 * @return array<string,mixed>
	 */
	public static function build( array $settings, int $now ): array {
		return self::cap( self::assemble( self::collect( $settings, $now ) ), self::MAX_BYTES );
	}

	/**
	 * The report as JSON for people (the preview in the settings and the assistant).
	 *
	 * @param array<string,mixed> $report Report.
	 */
	public static function pretty( array $report ): string {
		return (string) wp_json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	}

	/*
	 * Keeping what may go.
	 */

	/**
	 * The report from the facts of collect(). Only fixed keys, counts and names from the lists
	 * above leave here.
	 *
	 * @param array<string,mixed> $facts Facts.
	 * @return array<string,mixed>
	 */
	public static function assemble( array $facts ): array {
		$site    = (array) ( $facts['site'] ?? array() );
		$found   = self::environment( (array) ( $site['plugins'] ?? array() ), (string) ( $site['theme'] ?? '' ) );
		$forms   = self::forms( (array) ( $facts['forms'] ?? array() ), (array) ( $facts['templates'] ?? array() ) );
		$usage   = (array) ( $facts['usage'] ?? array() );
		$views   = max( 0, (int) ( $usage['views'] ?? 0 ) );
		$admin   = (array) ( $facts['admin'] ?? array() );
		$health  = (array) ( $facts['health'] ?? array() );
		$embeds  = (array) ( $facts['embeds'] ?? array() );
		$migrate = (array) ( $facts['migration'] ?? array() );
		$url     = $site['url'] ?? null;
		return array(
			'schema'      => self::SCHEMA,
			'install_id'  => (string) ( $facts['install_id'] ?? '' ),
			'sent_at'     => gmdate( 'Y-m-d\TH:i:s\Z', (int) ( $facts['now'] ?? 0 ) ),
			'period_days' => self::PERIOD_DAYS,
			'site'        => array(
				'edition'        => Edition::FREE === ( $site['edition'] ?? '' ) ? Edition::FREE : Edition::PRO,
				'plugin_version' => self::version( (string) ( $site['plugin_version'] ?? '' ) ),
				'wp_version'     => self::major_minor( (string) ( $site['wp_version'] ?? '' ) ),
				'php_version'    => self::major_minor( (string) ( $site['php_version'] ?? '' ) ),
				'db'             => self::database( (string) ( $site['db'] ?? '' ) ),
				'locale'         => self::locale( (string) ( $site['locale'] ?? '' ) ),
				'timezone'       => self::timezone( (string) ( $site['timezone'] ?? '' ) ),
				'multisite'      => ! empty( $site['multisite'] ),
				'industry'       => '' === Consent::industry( $site['industry'] ?? '' ) ? null : Consent::industry( $site['industry'] ),
				'url'            => is_string( $url ) && 1 === preg_match( '#^https?://#i', $url ) ? $url : null,
				'privacy_mode'   => PrivacyMode::sanitize( $site['privacy_mode'] ?? '' ),
				'consent_tool'   => $found['consent_tool'],
				'from_3x'        => ! empty( $site['from_3x'] ),
				'first_version'  => self::first_version( (string) ( $site['first_version'] ?? '' ) ),
				'installed_days' => max( 0, (int) ( $site['installed_days'] ?? 0 ) ),
				'theme'          => self::theme( (string) ( $site['theme'] ?? '' ) ),
				'builders'       => $found['builders'],
				'plugins'        => $found['plugins'],
				'object_cache'   => ! empty( $site['object_cache'] ),
				'cron'           => empty( $site['cron_disabled'] ) ? 'wp-cron' : 'system',
			),
			'migration'   => array(
				'forms_total'     => max( 0, (int) ( $migrate['forms_total'] ?? 0 ) ),
				'verified'        => max( 0, (int) ( $migrate['verified'] ?? 0 ) ),
				'failed'          => max( 0, (int) ( $migrate['failed'] ?? 0 ) ),
				'on_new_renderer' => max( 0, (int) ( $migrate['on_new_renderer'] ?? 0 ) ),
			),
			'forms'       => $forms['summary'] + array(
				'embeds' => array(
					'shortcode'   => max( 0, (int) ( $embeds['shortcode'] ?? 0 ) ),
					'block'       => max( 0, (int) ( $embeds['block'] ?? 0 ) ),
					'elementor'   => max( 0, (int) ( $embeds['elementor'] ?? 0 ) ),
					'funnel_page' => max( 0, (int) ( $embeds['funnel_page'] ?? 0 ) ),
				),
			),
			'usage'       => array(
				'views'          => $views,
				'starts'         => max( 0, (int) ( $usage['starts'] ?? 0 ) ),
				'completions'    => max( 0, (int) ( $usage['completions'] ?? 0 ) ),
				'extended_share' => $views > 0 ? round( min( 1.0, max( 0, (int) ( $usage['extended'] ?? 0 ) ) / $views ), 2 ) : 0,
				'devices'        => self::shares( (array) ( $usage['devices'] ?? array() ), array( 'mobile', 'desktop', 'tablet' ) ),
				'hours'          => self::hours( (array) ( $usage['hours'] ?? array() ) ),
				'per_form'       => self::pick( $forms['rows'] ),
				'by_field_type'  => self::map( $forms['by_type'] ),
			),
			'admin'       => array(
				'pages'                  => self::map( self::page_counts( (array) ( $admin['pages'] ?? array() ) ) ),
				'builder_analytics_mode' => max( 0, (int) ( $admin['builder_analytics_mode'] ?? 0 ) ),
			),
			'health'      => array(
				'mail_failures'    => max( 0, (int) ( $health['mail_failures'] ?? 0 ) ),
				'webhook_failures' => max( 0, (int) ( $health['webhook_failures'] ?? 0 ) ),
				'cron_late'        => ! empty( $health['cron_late'] ),
				'php_errors'       => null,
			),
		);
	}

	/**
	 * Keeps the report below a size: drops per_form rows from the end first, then the hours, then
	 * the figures per field type, then the templates.
	 *
	 * @param array<string,mixed> $report Report.
	 * @param int                 $max    Bytes.
	 * @return array<string,mixed>
	 */
	public static function cap( array $report, int $max ): array {
		while ( self::size( $report ) > $max && array() !== ( $report['usage']['per_form'] ?? array() ) ) {
			array_pop( $report['usage']['per_form'] );
		}
		foreach ( array( array( 'usage', 'hours', array() ), array( 'usage', 'by_field_type', new \stdClass() ), array( 'forms', 'templates', new \stdClass() ) ) as list( $part, $key, $empty ) ) {
			if ( self::size( $report ) > $max && isset( $report[ $part ][ $key ] ) ) {
				$report[ $part ][ $key ] = $empty;
			}
		}
		return $report;
	}

	/**
	 * Bytes of the report as JSON the way it is sent (slashes and Unicode escaped).
	 *
	 * @param array<string,mixed> $report Report.
	 */
	public static function size( array $report ): int {
		return strlen( (string) json_encode( $report ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- the same bytes as wp_json_encode(), also without WordPress (unit tests).
	}

	/**
	 * Theme of the report: the slug of the (parent) theme when it is on the list, else other.
	 *
	 * @param string $slug Template slug.
	 */
	public static function theme( string $slug ): string {
		$slug = strtolower( $slug );
		return in_array( $slug, self::THEMES, true ) ? $slug : 'other';
	}

	/**
	 * Builders, other plugins and the consent tool of the active plugins (folder/file.php). A
	 * plugin that is on no list shows as "other" once in plugins; Funnelforms itself not at all.
	 *
	 * @param array<int,mixed> $active Plugin files.
	 * @param string           $theme  Template slug of the theme (Divi, Extra and Bricks build pages).
	 * @return array{builders:list<string>,plugins:list<string>,consent_tool:string|null}
	 */
	public static function environment( array $active, string $theme ): array {
		$builders = array();
		$plugins  = array();
		$consent  = null;
		$other    = false;
		foreach ( $active as $file ) {
			$folder = strtolower( strtok( (string) $file, '/' ) );
			if ( '' === $folder || in_array( $folder, array( 'funnelforms-free', 'funnelforms-free' ), true ) ) {
				continue;
			}
			if ( isset( self::BUILDERS[ $folder ] ) ) {
				$builders[] = self::BUILDERS[ $folder ];
			} elseif ( isset( self::CONSENT_TOOLS[ $folder ] ) ) {
				$plugins[] = self::CONSENT_TOOLS[ $folder ];
				$consent   = $consent ?? self::CONSENT_TOOLS[ $folder ];
			} elseif ( isset( self::PLUGINS[ $folder ] ) ) {
				$plugins[] = self::PLUGINS[ $folder ];
			} else {
				$other = true;
			}
		}
		$theme = strtolower( $theme );
		if ( in_array( $theme, array( 'divi', 'extra' ), true ) ) {
			$builders[] = 'divi';
		} elseif ( 'bricks' === $theme ) {
			$builders[] = 'bricks';
		}
		$builders = array_values( array_unique( $builders ) );
		$plugins  = array_values( array_unique( $plugins ) );
		sort( $builders );
		sort( $plugins );
		if ( $other ) {
			$plugins[] = 'other';
		}
		return array(
			'builders'     => $builders,
			'plugins'      => $plugins,
			'consent_tool' => $consent,
		);
	}

	/**
	 * Database server and its version: "mariadb 11.4" or "mysql 8.0"; "other" when unreadable.
	 *
	 * @param string $server What the server reports (such as 5.5.5-10.11.6-MariaDB-0ubuntu or 8.0.36).
	 */
	public static function database( string $server ): string {
		$maria = false !== stripos( $server, 'mariadb' );
		$clean = $maria ? (string) preg_replace( '/^5\.5\.5-/', '', $server ) : $server;
		$minor = self::major_minor( $clean );
		if ( '' === $minor ) {
			return 'other';
		}
		return ( $maria ? 'mariadb ' : 'mysql ' ) . $minor;
	}

	/**
	 * Major and minor of a version (7.1 of 7.1.2-beta); empty when it is none.
	 *
	 * @param string $version Version.
	 */
	public static function major_minor( string $version ): string {
		return 1 === preg_match( '/^(\d{1,3})\.(\d{1,3})/', $version, $match ) ? $match[1] . '.' . $match[2] : '';
	}

	/**
	 * A version as the Brain reads it: digits, dots and a short suffix, at most 20 characters.
	 *
	 * @param string $version Version.
	 */
	public static function version( string $version ): string {
		return 1 === preg_match( '/^[0-9]{1,3}(\.[0-9]{1,4}){0,3}(-[0-9A-Za-z.]{1,12})?/', $version, $match ) ? substr( $match[0], 0, 20 ) : '';
	}

	/**
	 * The first version: a 5.x version, or 3.x for a site that came from Funnelforms 3.
	 *
	 * @param string $version Version.
	 */
	private static function first_version( string $version ): string {
		return '3.x' === $version ? $version : self::version( $version );
	}

	/**
	 * A WordPress locale (de_DE, de_DE_formal, en_US); en_US for anything else.
	 *
	 * @param string $locale Locale.
	 */
	private static function locale( string $locale ): string {
		return 1 === preg_match( '/^[a-z]{2,3}(_[A-Z]{2})?(_[a-z0-9]{2,12})?$/', $locale ) ? $locale : 'en_US';
	}

	/**
	 * A time zone name (Europe/Berlin) or offset (+02:00); UTC for anything else.
	 *
	 * @param string $zone Time zone.
	 */
	private static function timezone( string $zone ): string {
		return 1 === preg_match( '#^([A-Za-z_]{2,20}(/[A-Za-z0-9_+-]{1,30}){0,2}|[+-]\d{2}:\d{2})$#', $zone ) ? $zone : 'UTC';
	}

	/**
	 * Shares of a count per key, two decimals; zero for all when there is nothing.
	 *
	 * @param array<string,mixed> $counts Counts.
	 * @param string[]            $keys   Keys in the report.
	 * @return array<string,float|int>
	 */
	private static function shares( array $counts, array $keys ): array {
		$total = 0;
		foreach ( $keys as $key ) {
			$total += max( 0, (int) ( $counts[ $key ] ?? 0 ) );
		}
		$out = array();
		foreach ( $keys as $key ) {
			$out[ $key ] = $total > 0 ? round( max( 0, (int) ( $counts[ $key ] ?? 0 ) ) / $total, 2 ) : 0;
		}
		return $out;
	}

	/**
	 * Entries per weekday (0 Sunday) and hour as [weekday, hour, count], only cells above zero.
	 *
	 * @param array<int|string,mixed> $grid Weekday => hour => count.
	 * @return list<array{0:int,1:int,2:int}>
	 */
	private static function hours( array $grid ): array {
		$out = array();
		for ( $day = 0; $day < 7; $day++ ) {
			for ( $hour = 0; $hour < 24; $hour++ ) {
				$n = (int) ( $grid[ $day ][ $hour ] ?? 0 );
				if ( $n > 0 ) {
					$out[] = array( $day, $hour, $n );
				}
			}
		}
		return $out;
	}

	/**
	 * Counters of admin pages, only known keys.
	 *
	 * @param array<string,mixed> $pages Counters.
	 * @return array<string,int>
	 */
	private static function page_counts( array $pages ): array {
		$known = array_merge( array_values( AdminUsage::PAGES ), array( 'legacy' ) );
		$out   = array();
		foreach ( $pages as $key => $n ) {
			if ( in_array( $key, $known, true ) && (int) $n > 0 ) {
				$out[ (string) $key ] = (int) $n;
			}
		}
		return $out;
	}

	/**
	 * A map that stays a JSON object when it is empty.
	 *
	 * @param array<string,mixed> $map Map.
	 * @return array<string,mixed>|\stdClass
	 */
	private static function map( array $map ) {
		return array() === $map ? new \stdClass() : $map;
	}

	/**
	 * The rows of forms with enough views, in random order, at most MAX_FORMS.
	 *
	 * @param list<array<string,mixed>> $rows Rows (views included).
	 * @return list<array<string,mixed>>
	 */
	public static function pick( array $rows ): array {
		$rows = array_values( array_filter( $rows, static fn( array $row ): bool => (int) $row['views'] >= self::MIN_VIEWS ) );
		for ( $i = count( $rows ) - 1; $i > 0; $i-- ) {
			$j          = random_int( 0, $i );
			$swap       = $rows[ $i ];
			$rows[ $i ] = $rows[ $j ];
			$rows[ $j ] = $swap;
		}
		return array_slice( $rows, 0, self::MAX_FORMS );
	}

	/**
	 * The forms part: counts over all forms, a row per form on the new renderer that was viewed,
	 * and the figures per field type.
	 *
	 * @param list<array<string,mixed>> $forms     Facts per form.
	 * @param string[]                  $templates Template IDs that exist.
	 * @return array{summary:array<string,mixed>,rows:list<array<string,mixed>>,by_type:array<string,array<string,int>>}
	 */
	private static function forms( array $forms, array $templates ): array {
		$summary = array(
			'total'          => 0,
			'published'      => 0,
			'draft'          => 0,
			'field_types'    => array(),
			'contact_fields' => array(),
			'features'       => array_fill_keys( array_merge( array( 'conditions' ), array_values( self::FEATURES ) ), 0 ),
			'actions'        => array_fill_keys( self::ACTIONS, 0 ),
			'templates'      => array(),
		);
		$rows    = array();
		$by_type = array();
		foreach ( $forms as $form ) {
			$status = (string) ( $form['status'] ?? '' );
			if ( 'trashed' === $status ) {
				continue;
			}
			++$summary['total'];
			if ( 'published' === $status ) {
				++$summary['published'];
			} elseif ( 'draft' === $status ) {
				++$summary['draft'];
			}
			$document = is_array( $form['document'] ?? null ) ? $form['document'] : null;
			if ( null === $document ) {
				continue;
			}
			$shape = self::shape( $document );
			foreach ( array( 'field_types', 'contact_fields' ) as $key ) {
				foreach ( $shape[ $key ] as $type => $n ) {
					$summary[ $key ][ $type ] = ( $summary[ $key ][ $type ] ?? 0 ) + $n;
				}
			}
			foreach ( $shape['features'] as $feature ) {
				++$summary['features'][ $feature ];
			}
			foreach ( $shape['actions'] as $kind ) {
				$summary['actions'][ $kind ] = ( $summary['actions'][ $kind ] ?? 0 ) + 1;
			}
			$template = (string) ( $document['meta']['template'] ?? '' );
			if ( '' !== $template && in_array( $template, $templates, true ) ) {
				$summary['templates'][ $template ] = ( $summary['templates'][ $template ] ?? 0 ) + 1;
			}
			if ( empty( $form['v5'] ) || (int) ( $form['views'] ?? 0 ) <= 0 ) {
				continue;
			}
			$step_rows = self::step_rows( $shape, (array) ( $form['steps'] ?? array() ), (array) ( $form['invalid'] ?? array() ) );
			foreach ( $step_rows as $i => $row ) {
				foreach ( array_unique( $row['types'] ) as $type ) {
					$by_type[ $type ] = $by_type[ $type ] ?? array(
						'steps'   => 0,
						'reached' => 0,
						'left'    => 0,
						'invalid' => 0,
					);
					++$by_type[ $type ]['steps'];
					$by_type[ $type ]['reached'] += $row['reached'];
					$by_type[ $type ]['left']    += $row['left'];
					$by_type[ $type ]['invalid'] += $row['by_type'][ $type ] ?? 0;
				}
				// The invalid answers per field type count only in by_field_type.
				unset( $step_rows[ $i ]['by_type'] );
			}
			$seconds = array_values( array_filter( array_map( 'intval', (array) ( $form['seconds'] ?? array() ) ), static fn( int $s ): bool => $s > 0 ) );
			$rows[]  = array(
				'steps'          => count( $shape['nodes'] ),
				'fields'         => $shape['fields'],
				'types'          => array_map( static fn( array $node ): string => $node['type'], $shape['nodes'] ),
				'views'          => max( 0, (int) $form['views'] ),
				'starts'         => max( 0, (int) ( $form['starts'] ?? 0 ) ),
				'completions'    => max( 0, (int) ( $form['completions'] ?? 0 ) ),
				'median_seconds' => count( $seconds ) >= FormStats::MIN_VALUES ? FormStats::median( $seconds ) : null,
				'step_rows'      => $step_rows,
			);
		}
		ksort( $summary['field_types'] );
		ksort( $summary['contact_fields'] );
		ksort( $summary['templates'] );
		ksort( $by_type );
		$summary['field_types']    = self::map( $summary['field_types'] );
		$summary['contact_fields'] = self::map( $summary['contact_fields'] );
		$summary['templates']      = self::map( $summary['templates'] );
		return array(
			'summary' => $summary,
			'rows'    => $rows,
			'by_type' => $by_type,
		);
	}

	/**
	 * The shape of a document without its texts: steps in the order a visitor meets them (from the
	 * start along the paths, then the rest), their field types, and which features and actions
	 * the form uses. Field types and actions not on the lists are "other".
	 *
	 * @param array<string,mixed> $document Document.
	 * @return array{nodes:list<array{id:string,type:string,types:list<string>,fields:array<string,string>}>,fields:int,field_types:array<string,int>,contact_fields:array<string,int>,features:list<string>,actions:list<string>}
	 */
	public static function shape( array $document ): array {
		$step_types    = array_merge( Edition::FREE_STEP_FIELDS, Edition::PRO_STEP_FIELDS );
		$contact_types = array_merge( Edition::FREE_CONTACT_FIELDS, Edition::PRO_CONTACT_FIELDS );
		$nodes         = array();
		foreach ( (array) ( $document['nodes'] ?? array() ) as $node ) {
			if ( is_array( $node ) && in_array( $node['type'] ?? '', array( 'step', 'contact' ), true ) && is_scalar( $node['id'] ?? null ) ) {
				$nodes[ (string) $node['id'] ] = $node;
			}
		}
		$out = array(
			'nodes'          => array(),
			'fields'         => 0,
			'field_types'    => array(),
			'contact_fields' => array(),
			'features'       => array(),
			'actions'        => array(),
		);
		foreach ( self::order( $document, array_keys( $nodes ) ) as $id ) {
			$node    = $nodes[ $id ];
			$contact = 'contact' === $node['type'];
			$types   = array();
			$fields  = array();
			foreach ( (array) ( $node['fields'] ?? array() ) as $field ) {
				if ( ! is_array( $field ) ) {
					continue;
				}
				$type = (string) ( $field['type'] ?? '' );
				$type = in_array( $type, $contact ? $contact_types : $step_types, true ) ? $type : 'other';
				++$out['fields'];
				$key                  = $contact ? 'contact_fields' : 'field_types';
				$out[ $key ][ $type ] = ( $out[ $key ][ $type ] ?? 0 ) + 1;
				$types[]              = $contact ? 'contact' : $type;
				if ( is_scalar( $field['id'] ?? null ) ) {
					$fields[ (string) $field['id'] ] = $contact ? 'contact' : $type;
				}
			}
			$types          = $contact ? array( 'contact' ) : $types;
			$out['nodes'][] = array(
				'id'     => (string) $id,
				'type'   => $contact ? 'contact' : ( $types[0] ?? 'other' ),
				'types'  => $types,
				'fields' => $fields,
			);
		}
		$features = Edition::pro_features( $document );
		foreach ( self::FEATURES as $key => $name ) {
			if ( in_array( $key, $features, true ) ) {
				$out['features'][] = $name;
			}
		}
		foreach ( (array) ( $document['edges'] ?? array() ) as $edge ) {
			if ( is_array( $edge ) && ! empty( $edge['when'] ) ) {
				array_unshift( $out['features'], 'conditions' );
				break;
			}
		}
		foreach ( (array) ( $document['actions'] ?? array() ) as $action ) {
			$kind = is_array( $action ) ? (string) ( $action['kind'] ?? '' ) : '';
			if ( 'crm' === $kind ) {
				$provider = (string) ( $action['config']['provider'] ?? '' );
				$kind     = 'crm:' . ( in_array( $provider, self::CRM_PROVIDERS, true ) ? $provider : 'other' );
			} elseif ( ! in_array( $kind, self::ACTIONS, true ) ) {
				$kind = 'other';
			}
			$out['actions'][] = $kind;
		}
		$out['actions'] = array_values( array_unique( $out['actions'] ) );
		return $out;
	}

	/**
	 * Step and contact nodes in the order a visitor meets them: from the start along the paths
	 * (in the order of the edges), then those no path reaches, in the order of the document.
	 *
	 * @param array<string,mixed> $document Document.
	 * @param string[]            $ids      IDs of the step and contact nodes.
	 * @return list<string>
	 */
	private static function order( array $document, array $ids ): array {
		$next = array();
		foreach ( (array) ( $document['edges'] ?? array() ) as $edge ) {
			if ( is_array( $edge ) && is_scalar( $edge['from'] ?? null ) && is_scalar( $edge['to'] ?? null ) ) {
				$next[ (string) $edge['from'] ][] = (string) $edge['to'];
			}
		}
		$queue = is_scalar( $document['start'] ?? null ) ? array( (string) $document['start'] ) : array();
		$seen  = array();
		$out   = array();
		while ( array() !== $queue ) {
			$id = array_shift( $queue );
			if ( isset( $seen[ $id ] ) ) {
				continue;
			}
			$seen[ $id ] = true;
			if ( in_array( $id, $ids, true ) ) {
				$out[] = $id;
			}
			foreach ( $next[ $id ] ?? array() as $to ) {
				$queue[] = $to;
			}
		}
		return array_values( array_merge( $out, array_diff( $ids, $out ) ) );
	}

	/**
	 * The rows of a form's steps: position, field types, sessions that reached the step and that
	 * ended there, and answers that failed the check in its fields (invalid events by field ID).
	 * by_type holds the invalid answers per field type, for by_field_type.
	 *
	 * @param array<string,mixed>               $shape   shape().
	 * @param array<string,array<string,mixed>> $steps   Reached and left by node ID.
	 * @param array<string,int>                 $invalid Sessions with an invalid answer by field ID.
	 * @return list<array<string,mixed>>
	 */
	private static function step_rows( array $shape, array $steps, array $invalid ): array {
		$rows = array();
		foreach ( $shape['nodes'] as $i => $node ) {
			$wrong = 0;
			$types = array();
			foreach ( $node['fields'] as $field_id => $type ) {
				$n              = max( 0, (int) ( $invalid[ $field_id ] ?? 0 ) );
				$wrong         += $n;
				$types[ $type ] = ( $types[ $type ] ?? 0 ) + $n;
			}
			$rows[] = array(
				'pos'     => $i + 1,
				'types'   => $node['types'],
				'reached' => max( 0, (int) ( $steps[ $node['id'] ]['reached'] ?? 0 ) ),
				'left'    => max( 0, (int) ( $steps[ $node['id'] ]['left'] ?? 0 ) ),
				'invalid' => $wrong,
				'by_type' => $types,
			);
		}
		return $rows;
	}

	/*
	 * Reading the site.
	 */

	/**
	 * What the site has for the report. These facts may hold titles and IDs; assemble() drops them.
	 *
	 * @param array<string,mixed> $settings Consent::get().
	 * @param int                 $now      Time.
	 * @return array<string,mixed>
	 */
	public static function collect( array $settings, int $now ): array {
		global $wpdb;
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$period  = StatsPeriod::last( self::PERIOD_DAYS, $now );
		$start   = $period->start();
		$end     = $period->end();
		$offset  = $period->offset();
		$figures = new EntryFigures();
		$events  = new EventRepository();
		$from_3x = 'update' === SetupFlow::state()['path'];
		$active  = (array) get_option( 'active_plugins', array() );
		if ( is_multisite() ) {
			$active = array_merge( $active, array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) ) );
		}
		$counts = $events->daily_all( $start, $end, $offset );
		$forms  = self::form_facts( $counts, $events, $figures, $start, $end, $offset );
		return array(
			'install_id' => (string) $settings['install_id'],
			'now'        => $now,
			'site'       => array(
				'edition'        => Edition::current(),
				'plugin_version' => (string) FUNNELFORMS_VERSION,
				'wp_version'     => (string) get_bloginfo( 'version' ),
				'php_version'    => PHP_VERSION,
				'db'             => (string) $wpdb->db_server_info(),
				'locale'         => (string) get_locale(),
				'timezone'       => wp_timezone_string(),
				'multisite'      => is_multisite(),
				'industry'       => (string) $settings['industry'],
				'url'            => ! empty( $settings['site_url'] ) ? untrailingslashit( home_url() ) : null,
				'privacy_mode'   => PrivacyMode::current(),
				'from_3x'        => $from_3x,
				'first_version'  => $from_3x ? '3.x' : (string) ( self::installed()['version'] ?? '' ),
				'installed_days' => self::installed_days( $now ),
				'theme'          => (string) get_template(),
				'plugins'        => $active,
				'object_cache'   => wp_using_ext_object_cache(),
				'cron_disabled'  => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
			),
			'migration'  => self::migration(),
			'forms'      => $forms,
			'templates'  => array_values( array_filter( array_unique( array_map( static fn( array $f ): string => (string) ( $f['document']['meta']['template'] ?? '' ), $forms ) ), array( FormTemplates::class, 'exists' ) ) ),
			'embeds'     => self::embeds(),
			'usage'      => array(
				'views'       => array_sum( array_map( static fn( array $r ): int => 'view' === $r['event'] ? (int) $r['n'] : 0, $counts ) ),
				'starts'      => array_sum( array_map( static fn( array $r ): int => 'start' === $r['event'] ? (int) $r['n'] : 0, $counts ) ),
				'completions' => array_sum( array_map( static fn( array $r ): int => (int) $r['n'], $figures->daily( null, $start, $end, $offset ) ) ),
				'extended'    => self::extended( $start, $end ),
				'devices'     => $figures->devices( null, $start, $end ),
				'hours'       => $figures->hours( null, $start, $end, $offset ),
			),
			'admin'      => AdminUsage::counts(),
			'health'     => self::health( $start, $now ),
		);
	}

	/**
	 * Notes the first version of Funnelforms 5 on this site, once.
	 */
	public static function note_installed(): void {
		if ( false === get_option( self::INSTALLED, false ) ) {
			add_option(
				self::INSTALLED,
				array(
					'version' => (string) FUNNELFORMS_VERSION,
					'at'      => time(),
				)
			);
		}
	}

	/**
	 * The first version and time noted.
	 *
	 * @return array{version?:string,at?:int}
	 */
	private static function installed(): array {
		$stored = get_option( self::INSTALLED, array() );
		return is_array( $stored ) ? $stored : array();
	}

	/**
	 * Days since Funnelforms came to the site: the earliest of the noted first version, the
	 * oldest form and the oldest form or lead of Funnelforms 3.
	 *
	 * @param int $now Time.
	 */
	private static function installed_days( int $now ): int {
		global $wpdb;
		$times = array();
		$noted = (int) ( self::installed()['at'] ?? 0 );
		if ( $noted > 0 ) {
			$times[] = $noted;
		}
		$form = $wpdb->get_var( $wpdb->prepare( 'SELECT MIN(created_at) FROM %i', Schema::table( 'forms' ) ) );
		$old  = $wpdb->get_var( $wpdb->prepare( "SELECT MIN(post_date_gmt) FROM {$wpdb->posts} WHERE post_type IN (%s, %s) AND post_date_gmt > %s", LegacyRepository::FORM, LegacyRepository::LEAD, '1970-01-02 00:00:00' ) );
		foreach ( array( $form, $old ) as $time ) {
			if ( is_string( $time ) && '' !== $time ) {
				$times[] = (int) strtotime( $time . ' UTC' );
			}
		}
		return array() === $times ? 0 : (int) floor( max( 0, $now - min( $times ) ) / DAY_IN_SECONDS );
	}

	/**
	 * Forms of Funnelforms 3: imported, checked, failed and running on the new renderer.
	 *
	 * @return array<string,int>
	 */
	private static function migration(): array {
		global $wpdb;
		$summary = ( new MigrationStore( SecretBox::for_site() ) )->summary();
		$forms   = (array) ( $summary[ LegacyRepository::FORM ] ?? array() );
		return array(
			'forms_total'     => array_sum( array_map( 'intval', $forms ) ),
			'verified'        => (int) ( $forms[ FormVerifier::VERIFIED ] ?? 0 ),
			'failed'          => (int) ( $forms[ FormVerifier::FAILED ] ?? 0 ),
			'on_new_renderer' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE legacy_post_id IS NOT NULL AND renderer = %s AND status <> %s', Schema::table( 'forms' ), FormRepository::RENDERER_V5, 'trashed' ) ),
		);
	}

	/**
	 * Facts per form: status, document (the published one, else the draft) and, for forms on the
	 * new renderer that were viewed in the period, the counts of the period.
	 *
	 * @param array<int,array<string,string>> $counts  Views and starts per form and day (EventRepository::daily_all()).
	 * @param EventRepository                 $events  Events.
	 * @param EntryFigures                    $figures Entries.
	 * @param string                          $start   Start (UTC).
	 * @param string                          $end     End (UTC).
	 * @param int                             $offset  Seconds of the site's time zone.
	 * @return list<array<string,mixed>>
	 */
	private static function form_facts( array $counts, EventRepository $events, EntryFigures $figures, string $start, string $end, int $offset ): array {
		global $wpdb;
		$repo  = new FormRepository();
		$rows  = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, status, renderer, current_revision_id, draft FROM %i WHERE status <> %s ORDER BY id', Schema::table( 'forms' ), 'trashed' ), ARRAY_A );
		$per   = array();
		$done  = array();
		$table = Schema::table( 'events' );
		foreach ( $counts as $row ) {
			$key                                  = 'view' === $row['event'] ? 'views' : 'starts';
			$per[ (int) $row['form_id'] ][ $key ] = ( $per[ (int) $row['form_id'] ][ $key ] ?? 0 ) + (int) $row['n'];
		}
		foreach ( $figures->daily( null, $start, $end, $offset, true ) as $row ) {
			$done[ (int) $row['form_id'] ] = ( $done[ (int) $row['form_id'] ] ?? 0 ) + (int) $row['n'];
		}
		$out = array();
		foreach ( $rows as $row ) {
			$id       = (int) $row['id'];
			$document = null === $row['current_revision_id'] ? null : $repo->document( (int) $row['current_revision_id'] );
			if ( null === $document && is_string( $row['draft'] ) ) {
				$draft    = json_decode( $row['draft'], true );
				$document = is_array( $draft ) ? $draft : null;
			}
			$fact = array(
				'id'       => $id,
				'status'   => (string) $row['status'],
				'v5'       => FormRepository::RENDERER_V5 === $row['renderer'],
				'document' => $document,
				'views'    => (int) ( $per[ $id ]['views'] ?? 0 ),
				'starts'   => (int) ( $per[ $id ]['starts'] ?? 0 ),
			);
			if ( $fact['v5'] && $fact['views'] > 0 && null !== $document ) {
				$fact['completions'] = (int) ( $done[ $id ] ?? 0 );
				$fact['steps']       = $events->steps( $id, $start, $end );
				$fact['invalid']     = array();
				$invalid             = (array) $wpdb->get_results( $wpdb->prepare( "SELECT step, COUNT(DISTINCT session_hash) AS n FROM %i WHERE form_id = %d AND event = 'invalid' AND created_at >= %s AND created_at < %s GROUP BY step", $table, $id, $start, $end ), ARRAY_A );
				foreach ( $invalid as $wrong ) {
					$fact['invalid'][ (string) $wrong['step'] ] = (int) $wrong['n'];
				}
				$fact['seconds'] = array();
				if ( $fact['views'] >= self::MIN_VIEWS ) {
					$figures->each(
						$id,
						$start,
						$end,
						1000,
						static function ( array $meta ) use ( &$fact ): void {
							$seconds = $meta['visit']['seconds'] ?? null;
							if ( is_int( $seconds ) && $seconds > 0 ) {
								$fact['seconds'][] = $seconds;
							}
						},
						false
					);
				}
			}
			$out[] = $fact;
		}
		return $out;
	}

	/**
	 * Page views with the extended statistics (device or visitor events, sent only with the
	 * visitor's consent to statistics).
	 *
	 * @param string $start Start (UTC).
	 * @param string $end   End (UTC).
	 */
	private static function extended( string $start, string $end ): int {
		global $wpdb;
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT form_id, session_hash) FROM %i WHERE event IN ('device', 'visitor') AND created_at >= %s AND created_at < %s", Schema::table( 'events' ), $start, $end ) );
	}

	/**
	 * Published pages and posts with a form: by shortcode, block or Elementor widget, and forms
	 * on a page of their own (/funnelforms/<slug>).
	 *
	 * @return array<string,int>
	 */
	private static function embeds(): array {
		global $wpdb;
		$count = static fn( string $like ): int => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_type NOT IN ('revision', 'nav_menu_item') AND post_content LIKE %s", '%' . $wpdb->esc_like( $like ) . '%' ) );
		return array(
			'shortcode'   => $count( '[funnelforms' ) + $count( '[anfrageformular2' ),
			'block'       => $count( '<!-- wp:' . FormBlock::NAME . ' ' ) + $count( '<!-- wp:' . FormBlock::NAME . ' /-->' ),
			'elementor'   => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT m.post_id) FROM {$wpdb->postmeta} m JOIN {$wpdb->posts} p ON p.ID = m.post_id WHERE p.post_status = 'publish' AND m.meta_key = %s AND m.meta_value LIKE %s", '_elementor_data', '%' . $wpdb->esc_like( '"widgetType":"' . self::ELEMENTOR_WIDGET . '"' ) . '%' ) ),
			'funnel_page' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE status = %s AND public_slug IS NOT NULL AND public_slug <> %s', Schema::table( 'forms' ), 'published', '' ) ),
		);
	}

	/**
	 * Failed mails and webhooks of the period, and whether WP-Cron is more than an hour late.
	 *
	 * @param string $start Start (UTC).
	 * @param int    $now   Time.
	 * @return array<string,mixed>
	 */
	private static function health( string $start, int $now ): array {
		global $wpdb;
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT e.form_id, j.channel, COUNT(*) AS n FROM %i j LEFT JOIN %i e ON e.id = j.entry_id WHERE j.status = %s AND j.updated_at >= %s GROUP BY e.form_id, j.channel',
				Schema::table( 'jobs_log' ),
				Schema::table( 'entries' ),
				'failed',
				$start
			),
			ARRAY_A
		);
		$repo  = new FormRepository();
		$out   = array(
			'mail_failures'    => 0,
			'webhook_failures' => 0,
			'cron_late'        => false,
		);
		$kinds = array();
		foreach ( $rows as $row ) {
			$form_id = (int) $row['form_id'];
			if ( ! isset( $kinds[ $form_id ] ) ) {
				$form              = $form_id > 0 ? $repo->by_id( $form_id ) : null;
				$document          = null === $form || null === $form['current_revision_id'] ? null : $repo->document( (int) $form['current_revision_id'] );
				$kinds[ $form_id ] = null === $document ? null : new Document( $document );
			}
			$action = null === $kinds[ $form_id ] ? null : $kinds[ $form_id ]->action( (string) $row['channel'] );
			$kind   = (string) ( $action['kind'] ?? '' );
			if ( in_array( $kind, array( 'email', 'autoresponder' ), true ) ) {
				$out['mail_failures'] += (int) $row['n'];
			} elseif ( 'webhook' === $kind ) {
				$out['webhook_failures'] += (int) $row['n'];
			}
		}
		$cron = function_exists( '_get_cron_array' ) ? _get_cron_array() : array();
		if ( is_array( $cron ) && array() !== $cron ) {
			$out['cron_late'] = (int) min( array_keys( $cron ) ) < $now - HOUR_IN_SECONDS;
		}
		return $out;
	}
}
