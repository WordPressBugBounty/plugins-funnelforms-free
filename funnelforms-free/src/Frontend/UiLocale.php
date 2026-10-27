<?php
/**
 * Texts of a form in the language of the form, not of the site.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

defined( 'ABSPATH' ) || exit;

/**
 * A form's document names the language of its interface (settings.uiLocale). On a site in another
 * language, the buttons, hints and error messages of the form still follow the form, as the
 * per-form language of 3.x did. While a form renders, the plugin's texts come from the catalog of
 * that language in languages/; a language without a catalog shows the English texts, unless it is
 * the site's own language. Forms in the site's language use the site's catalogs, including
 * custom ones in wp-content/languages/plugins.
 */
final class UiLocale {

	public const DOMAIN = 'funnelforms-free';

	/**
	 * Catalogs read in this request, by file.
	 *
	 * @var array<string,\MO>
	 */
	private static array $catalogs = array();

	/**
	 * Loads the plugin's catalog of the site's language. A catalog in wp-content/languages/plugins
	 * comes first, so a site can change single texts. A region without a bundled catalog takes the
	 * main one of its language (es_MX → es_ES, fr_CA → fr_FR), as forms do.
	 */
	public static function load_textdomain(): void {
		$locale = determine_locale();
		load_textdomain( self::DOMAIN, WP_LANG_DIR . '/plugins/' . self::DOMAIN . '-' . $locale . '.mo', $locale );
		$bundled = self::file( $locale );
		if ( null !== $bundled ) {
			load_textdomain( self::DOMAIN, $bundled, $locale );
		}
		add_filter( 'load_script_translation_file', array( self::class, 'script_file' ), 10, 3 );
	}

	/**
	 * The bundled JSON catalog of a script for a region without its own: that of the catalog
	 * load_textdomain() took. Filter load_script_translation_file.
	 *
	 * @param string|false $file   JSON file WordPress looks for.
	 * @param string       $handle Script handle.
	 * @param string       $domain Text domain.
	 * @return string|false
	 */
	public static function script_file( $file, $handle, $domain ) {
		unset( $handle );
		if ( self::DOMAIN !== $domain || ! is_string( $file ) || is_readable( $file ) ) {
			return $file;
		}
		$dir = wp_normalize_path( dirname( FUNNELFORMS_PLUGIN_FILE ) . '/languages' );
		if ( wp_normalize_path( dirname( $file ) ) !== $dir ) {
			return $file;
		}
		$locale  = determine_locale();
		$bundled = self::file( $locale );
		if ( null === $bundled ) {
			return $file;
		}
		$main = substr( basename( $bundled, '.mo' ), strlen( self::DOMAIN ) + 1 );
		$name = basename( $file );
		$from = self::DOMAIN . '-' . $locale . '-';
		if ( ! str_starts_with( $name, $from ) ) {
			return $file;
		}
		return $dir . '/' . self::DOMAIN . '-' . $main . '-' . substr( $name, strlen( $from ) );
	}

	/**
	 * Runs $callback with the plugin's texts in $locale.
	 *
	 * @template T
	 * @param string        $locale   Locale of the form, e.g. de_DE_formal.
	 * @param callable(): T $callback Code that translates.
	 * @return T
	 */
	public static function run( string $locale, callable $callback ) {
		$translations = self::translations( $locale );
		if ( null === $translations ) {
			return $callback();
		}
		global $l10n;
		$had      = isset( $l10n[ self::DOMAIN ] );
		$previous = $had ? $l10n[ self::DOMAIN ] : null;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restored below.
		$l10n[ self::DOMAIN ] = $translations;
		try {
			return $callback();
		} finally {
			if ( $had ) {
				$l10n[ self::DOMAIN ] = $previous; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
			} else {
				unset( $l10n[ self::DOMAIN ] );
			}
		}
	}

	/**
	 * Texts for $locale, or null when the site's texts apply.
	 *
	 * @param string $locale Locale.
	 */
	private static function translations( string $locale ): ?\Translations {
		$site = determine_locale();
		if ( '' === $locale || $locale === $site || 1 !== preg_match( '/^[a-zA-Z]{2,3}(_[a-zA-Z0-9]+)*$/', $locale ) ) {
			return null;
		}
		$file = self::file( $locale );
		if ( null === $file ) {
			return self::language( $locale ) === self::language( $site ) ? null : new \Translations();
		}
		if ( ! isset( self::$catalogs[ $file ] ) ) {
			$catalog = new \MO();
			$catalog->import_from_file( $file );
			self::$catalogs[ $file ] = $catalog;
		}
		return self::$catalogs[ $file ];
	}

	/**
	 * Bundled catalog of a locale: the exact one, else the main one of its language (de → de_DE).
	 *
	 * @param string $locale Locale.
	 */
	private static function file( string $locale ): ?string {
		$dir   = dirname( FUNNELFORMS_PLUGIN_FILE ) . '/languages/' . self::DOMAIN . '-';
		$lang  = self::language( $locale );
		$tries = array( $locale, $lang . '_' . strtoupper( $lang ) );
		foreach ( $tries as $try ) {
			if ( is_readable( $dir . $try . '.mo' ) ) {
				return $dir . $try . '.mo';
			}
		}
		$any = glob( $dir . $lang . '_*.mo' );
		return empty( $any ) ? null : $any[0];
	}

	/**
	 * Language of a locale (de_DE_formal → de).
	 *
	 * @param string $locale Locale.
	 */
	private static function language( string $locale ): string {
		return strtolower( explode( '_', $locale )[0] );
	}
}
