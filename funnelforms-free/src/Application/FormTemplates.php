<?php
/**
 * Templates for new forms: ready-made funnels by industry and goal.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Application\Telemetry\Consent;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\Icons;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * The templates lie in plugin/templates, written by tools/templates/build.ts: index.json lists
 * them for the gallery, <id>.json holds the form document with every text in each language a
 * template is written in (LANGUAGES). A new form keeps one language: the site's, or the one chosen
 * in the gallery. Languages the templates are not written in get the English texts.
 */
final class FormTemplates {

	/**
	 * What a template is for. The same list as TEMPLATE_GOALS of the builder
	 * (packages/builder-ui/src/templateTaxonomy.ts); tests compare them.
	 */
	public const GOALS = array( 'quote', 'calculator', 'consultation', 'booking', 'application', 'quiz', 'registration', 'feedback', 'leadmagnet' );

	/**
	 * Industries, in the order of the gallery: the businesses that ask most for leads in
	 * German-speaking countries first. The same list as TEMPLATE_CATEGORIES of the builder.
	 */
	public const CATEGORIES = array( 'craft', 'energy', 'realestate', 'finance', 'hr', 'health', 'legal', 'home', 'auto', 'beauty', 'education', 'coaching', 'b2b', 'agency', 'events', 'ecommerce', 'general' );

	/**
	 * The template category of each industry the site can name (Telemetry\Consent::INDUSTRIES).
	 */
	private const INDUSTRY_CATEGORIES = array(
		'craft'        => 'craft',
		'construction' => 'craft',
		'real_estate'  => 'realestate',
		'finance'      => 'finance',
		'insurance'    => 'finance',
		'health'       => 'health',
		'beauty'       => 'beauty',
		'education'    => 'education',
		'coaching'     => 'coaching',
		'agency'       => 'agency',
		'ecommerce'    => 'ecommerce',
		'software'     => 'b2b',
		'solar_energy' => 'energy',
		'automotive'   => 'auto',
		'tourism'      => 'events',
		'legal'        => 'legal',
	);

	/**
	 * Currency of the amounts the templates compute (their calculations carry it as " €").
	 */
	private const CURRENCY = '€';

	/**
	 * The languages the templates are written in; German in both forms of address.
	 */
	public const LANGUAGES = array( 'de_DE', 'de_DE_formal', 'en_US', 'es_ES', 'fr_FR', 'it_IT' );

	/** Language new forms start in, chosen in the setup assistant; empty for the site's language. */
	public const LANGUAGE_OPTION = 'funnelforms_form_language';

	private const DIR = 'templates';

	/**
	 * The catalog, once read.
	 *
	 * @var array<string,array<string,mixed>>|null
	 */
	private static ?array $catalog = null;

	/**
	 * The templates in catalog order: id, title and description in the language of the admin;
	 * goal, category, icon, theme and features; search words, the rank of recommended ones and
	 * whether it needs Funnelforms Pro (pro: shown locked, there is no document); the number of
	 * question steps and of questions; the first question and a sample of its answers in the
	 * language of the form.
	 *
	 * @param string $locale Language of the form; the site's without.
	 * @return array<int,array<string,mixed>>
	 */
	public static function all( string $locale = '' ): array {
		$form  = self::source( self::language( $locale ) );
		$admin = self::source( get_user_locale() );
		$out   = array();
		foreach ( self::catalog() as $entry ) {
			$sample  = (array) $entry['sample'];
			$options = array();
			foreach ( (array) ( $sample['options'] ?? array() ) as $option ) {
				$options[] = array(
					'label' => self::pick( $option['label'], $form ),
					'icon'  => (string) $option['icon'],
				);
			}
			$out[] = array(
				'id'            => (string) $entry['id'],
				'title'         => self::pick( $entry['title'], $admin ),
				'description'   => self::pick( $entry['description'], $admin ),
				'goal'          => (string) $entry['goal'],
				'category'      => (string) $entry['category'],
				'icon'          => (string) $entry['icon'],
				'theme'         => (string) ( $entry['theme'] ?? '' ),
				'features'      => array_values( array_map( 'strval', (array) $entry['features'] ) ),
				'keywords'      => array_values( array_map( 'strval', (array) ( $entry['keywords'] ?? array() ) ) ),
				'rank'          => isset( $entry['rank'] ) ? (int) $entry['rank'] : null,
				'pro'           => ! empty( $entry['pro'] ),
				'steps'         => (int) $entry['steps'],
				'questions'     => (int) ( $entry['questions'] ?? $entry['steps'] ),
				'firstQuestion' => self::pick( $sample['question'], $form ),
				'sample'        => array(
					'kind'    => (string) $sample['kind'],
					'options' => $options,
					'max'     => (int) ( $sample['max'] ?? 0 ),
					'style'   => (string) ( $sample['style'] ?? '' ),
				),
			);
		}
		return $out;
	}

	/**
	 * The Lucide icons the gallery draws for these templates: of each template and of its sample.
	 *
	 * @param array<int,array<string,mixed>> $templates Templates (all()).
	 * @return array<string,mixed> Name => elements.
	 */
	public static function icons( array $templates ): array {
		$names = array();
		foreach ( $templates as $template ) {
			$names[] = (string) $template['icon'];
			foreach ( $template['sample']['options'] as $option ) {
				$names[] = (string) $option['icon'];
			}
		}
		$set = Icons::all();
		$out = array();
		foreach ( array_unique( array_filter( $names ) ) as $name ) {
			if ( isset( $set[ $name ] ) ) {
				$out[ $name ] = $set[ $name ];
			}
		}
		return $out;
	}

	/**
	 * Whether a template exists and can make a form: a template of Funnelforms Pro that Funnelforms
	 * Free only shows (pro) cannot.
	 *
	 * @param string $id Template id.
	 */
	public static function exists( string $id ): bool {
		return isset( self::catalog()[ $id ] ) && empty( self::catalog()[ $id ]['pro'] );
	}

	/**
	 * Whether a template is one of Funnelforms Pro that Funnelforms Free only shows locked.
	 *
	 * @param string $id Template id.
	 */
	public static function needs_pro( string $id ): bool {
		return ! empty( self::catalog()[ $id ]['pro'] );
	}

	/**
	 * The template category of the site's industry, for the gallery to start with: the industry
	 * named in the diagnostic data settings, otherwise the industry of the template the setup
	 * assistant started with; empty when neither says.
	 */
	public static function site_category(): string {
		$industry = Consent::get()['industry'];
		if ( isset( self::INDUSTRY_CATEGORIES[ $industry ] ) ) {
			return self::INDUSTRY_CATEGORIES[ $industry ];
		}
		$setup    = get_option( SetupFlow::OPTION, array() );
		$template = is_array( $setup ) && is_array( $setup['choices'] ?? null ) ? (string) ( $setup['choices']['template'] ?? '' ) : '';
		$category = (string) ( self::catalog()[ $template ]['category'] ?? '' );
		return 'general' === $category ? '' : $category;
	}

	/**
	 * The language a new form gets: the given locale or the site's, when the templates are
	 * written in it, otherwise English.
	 *
	 * @param string $locale Locale such as de_AT or de_DE_formal; empty for the site's.
	 */
	public static function language( string $locale = '' ): string {
		if ( 1 !== preg_match( '/^[a-z]{2,3}(_[A-Z]{2})?(_formal|_informal)?$/', $locale ) ) {
			$locale = self::site_language();
		}
		return in_array( substr( $locale, 0, 2 ), array( 'de', 'en', 'es', 'fr', 'it' ), true ) ? $locale : 'en_US';
	}

	/**
	 * The site's language for forms: the one chosen in the setup assistant (LANGUAGE_OPTION), or
	 * the language of WordPress.
	 */
	public static function site_language(): string {
		$chosen = get_option( self::LANGUAGE_OPTION, '' );
		return in_array( $chosen, self::LANGUAGES, true ) ? $chosen : get_locale();
	}

	/**
	 * The language of the template texts for a locale: German in the form of address of the
	 * locale, the language itself otherwise; English for all others.
	 *
	 * @param string $locale Locale.
	 */
	public static function source( string $locale ): string {
		if ( in_array( $locale, self::LANGUAGES, true ) ) {
			return $locale;
		}
		$language = substr( $locale, 0, 2 );
		if ( 'de' === $language ) {
			return str_ends_with( $locale, '_formal' ) ? 'de_DE_formal' : 'de_DE';
		}
		foreach ( self::LANGUAGES as $source ) {
			if ( str_starts_with( $source, $language . '_' ) ) {
				return $source;
			}
		}
		return 'en_US';
	}

	/**
	 * The document of a template in one language; null when there is none. The notification mail
	 * goes to the site's address, the consent links to its privacy policy, and a booking field
	 * shows the times of the template's appointment type (or the site's first one) when there is one.
	 *
	 * @param string $id     Template id.
	 * @param string $locale Language of the form; the site's without.
	 */
	public static function document( string $id, string $locale = '' ): ?object {
		return self::make( $id, $locale, false );
	}

	/**
	 * The id that stands for a template in a preview token (letters and digits only): the
	 * template id, followed by the number of the language when it is not the site's.
	 *
	 * @param string $id     Template id.
	 * @param string $locale Language of the preview; the site's without.
	 */
	public static function preview_id( string $id, string $locale = '' ): string {
		$locale = self::language( $locale );
		$index  = array_search( $locale, self::LANGUAGES, true );
		return $id . ( false === $index || self::language() === $locale ? '' : (string) ( $index + 1 ) );
	}

	/**
	 * The document of a preview id (preview_id()); null when there is none.
	 *
	 * @param string $preview_id Preview id.
	 */
	public static function preview_document( string $preview_id ): ?object {
		if ( 1 !== preg_match( '/^([a-z]+)([1-9]?)$/', $preview_id, $m ) ) {
			return null;
		}
		return self::document( $m[1], '' === $m[2] ? '' : ( self::LANGUAGES[ (int) $m[2] - 1 ] ?? '' ) );
	}

	/**
	 * Creates a draft form from a template. A template with a booking field gets its appointment
	 * type, made with the usual settings when the site has none of that name.
	 *
	 * @param string $id     Template id.
	 * @param string $locale Language of the form; the site's without.
	 * @return int|null Form ID; null without the template.
	 */
	public static function create( string $id, string $locale = '' ): ?int {
		$document = self::make( $id, $locale, true );
		if ( null === $document ) {
			return null;
		}
		$form_id = FormEditor::create()->new_form( (string) $document->title, '', $document );
		( new FormRepository() )->audit(
			'form_from_template',
			$form_id,
			array(
				'template' => $id,
				'locale'   => (string) $document->locales->default,
			)
		);
		return $form_id;
	}

	/**
	 * Title of a template in the language of the admin.
	 *
	 * @param string $id Template id.
	 */
	public static function title( string $id ): string {
		$entry = self::catalog()[ $id ] ?? null;
		return null === $entry ? $id : self::pick( $entry['title'], self::source( get_user_locale() ) );
	}

	/**
	 * The document of a template.
	 *
	 * @param string $id      Template id.
	 * @param string $locale  Language of the form; the site's without.
	 * @param bool   $booking Whether to create the appointment type a booking field needs.
	 */
	private static function make( string $id, string $locale, bool $booking ): ?object {
		$entry = self::catalog()[ $id ] ?? null;
		$path  = FUNNELFORMS_PLUGIN_DIR . '/' . self::DIR . '/' . $id . '.json';
		if ( null === $entry || ! empty( $entry['pro'] ) || ! is_readable( $path ) ) {
			return null;
		}
		$data = json_decode( (string) file_get_contents( $path ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file of the plugin.
		if ( ! is_object( $data ) ) {
			return null;
		}
		$locale = self::language( $locale );
		$doc    = self::localize( $data, self::source( $locale ), $locale );

		$doc->title = self::title( $id );
		if ( self::language() !== $locale ) {
			// Buttons and messages in the language of the texts, not the page's.
			$doc->settings->uiLocale = $locale;
		}
		$format = self::number_format( $locale );
		foreach ( $doc->calculations as $calculation ) {
			$calculation->format = (object) ( self::affixes( (array) $calculation->format, $locale ) + array( 'decimals' => (int) $calculation->format->decimals ) + $format );
		}
		foreach ( $doc->nodes as $node ) {
			foreach ( $node->fields ?? array() as $field ) {
				if ( 'slider' === $field->type && ! empty( $field->props->thousandsSeparator ) ) {
					// Sliders know . , space and ' (the Swiss ’ is written as ').
					$field->props->separator = '’' === $format['thousandsSeparator'] ? "'" : $format['thousandsSeparator'];
				}
			}
		}
		foreach ( $doc->actions as $action ) {
			if ( 'email' === $action->kind ) {
				$action->config->to = (object) array( $locale => (string) get_option( 'admin_email' ) );
			}
			$action->config->fromName = (object) array( $locale => wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES ) );
		}
		$bookings = Edition::pro( Bookings::class );
		if ( isset( $entry['booking'] ) && null !== $bookings ) {
			$ref = $bookings::template_type( (array) $entry['booking'], self::pick( $entry['booking']['title'], self::source( $locale ) ), $booking );
			foreach ( $doc->nodes as $node ) {
				foreach ( $node->fields ?? array() as $field ) {
					if ( 'booking' === $field->type ) {
						$field->props->bookingTypeRef = $ref;
					}
				}
			}
		}
		return $doc;
	}

	/**
	 * A template document in one language: each text keeps the string of its source language,
	 * under the locale of the form. Swiss German writes ss for ß.
	 *
	 * @param object $data   Template document.
	 * @param string $source Language of the texts (LANGUAGES).
	 * @param string $locale Locale of the form.
	 */
	private static function localize( object $data, string $source, string $locale ): object {
		$keys = self::LANGUAGES;
		sort( $keys );
		$privacy      = get_privacy_policy_url();
		$swiss        = str_starts_with( $locale, 'de_CH' );
		$images       = self::images_url();
		$walk         = static function ( $value ) use ( &$walk, $keys, $source, $locale, $privacy, $swiss, $images ) {
			if ( is_string( $value ) && str_starts_with( $value, '%template_images%' ) ) {
				// A picture of an answer (media.value), served from the plugin's folder.
				return esc_url_raw( $images . substr( $value, strlen( '%template_images%' ) ) );
			}
			if ( is_array( $value ) ) {
				return array_map( $walk, $value );
			}
			if ( ! is_object( $value ) ) {
				return $value;
			}
			$found = array_keys( get_object_vars( $value ) );
			sort( $found );
			if ( $found !== $keys ) {
				foreach ( get_object_vars( $value ) as $key => $item ) {
					$value->{$key} = $walk( $item );
				}
				return $value;
			}
			$text = (string) $value->{$source};
			// A link to the site, e.g. the shop button of a product finder.
			$text = str_replace( '%home_url%', esc_url_raw( home_url( '/' ) ), $text );
			if ( str_contains( $text, '%privacy_url%' ) ) {
				// Without a privacy page the link would lead nowhere; its text stays.
				$text = '' === $privacy ? (string) preg_replace( '#<a href="%privacy_url%"[^>]*>(.*?)</a>#', '$1', $text ) : str_replace( '%privacy_url%', esc_url( $privacy ), $text );
			}
			return (object) array( $locale => $swiss ? str_replace( 'ß', 'ss', $text ) : $text );
		};
		$doc          = $walk( $data );
		$doc->locales = (object) array(
			'default'   => $locale,
			'available' => array( $locale ),
		);
		foreach ( $doc->calculations as $calculation ) {
			// A calculation's label is a plain string.
			$calculation->label = is_object( $calculation->label ) ? (string) ( get_object_vars( $calculation->label )[ $locale ] ?? '' ) : (string) $calculation->label;
		}
		return $doc;
	}

	/**
	 * The text before and after a result in a language: amounts carry the currency after the
	 * number (" €"), English puts it before ("€1,200").
	 *
	 * @param array<string,mixed> $format Format of the template's calculation.
	 * @param string              $locale Locale of the form.
	 * @return array<string,string>
	 */
	public static function affixes( array $format, string $locale ): array {
		$prefix = (string) ( $format['prefix'] ?? '' );
		$suffix = (string) ( $format['suffix'] ?? '' );
		if ( ' ' . self::CURRENCY === $suffix && str_starts_with( $locale, 'en' ) ) {
			$prefix = self::CURRENCY;
			$suffix = '';
		}
		return array_filter(
			array(
				'prefix' => $prefix,
				'suffix' => $suffix,
			),
			static fn( string $value ): bool => '' !== $value
		);
	}

	/**
	 * Address of the pictures of template answers (plugin/templates/images), with a slash at the end.
	 */
	public static function images_url(): string {
		return plugins_url( self::DIR . '/images/', FUNNELFORMS_PLUGIN_FILE );
	}

	/**
	 * Separators of numbers in a language, as the builder sets them for new calculations.
	 *
	 * @param string $locale Locale.
	 * @return array{decimalSeparator:string,thousandsSeparator:string}
	 */
	public static function number_format( string $locale ): array {
		$language = substr( $locale, 0, 2 );
		if ( 'fr' === $language ) {
			return array(
				'decimalSeparator'   => ',',
				'thousandsSeparator' => ' ',
			);
		}
		if ( str_starts_with( $locale, 'de_CH' ) ) {
			return array(
				'decimalSeparator'   => '.',
				'thousandsSeparator' => '’',
			);
		}
		if ( in_array( $language, array( 'de', 'it', 'es' ), true ) ) {
			return array(
				'decimalSeparator'   => ',',
				'thousandsSeparator' => '.',
			);
		}
		return array(
			'decimalSeparator'   => '.',
			'thousandsSeparator' => ',',
		);
	}

	/**
	 * The catalog by template id.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	private static function catalog(): array {
		if ( null === self::$catalog ) {
			$path          = FUNNELFORMS_PLUGIN_DIR . '/' . self::DIR . '/index.json';
			$data          = is_readable( $path ) ? json_decode( (string) file_get_contents( $path ), true ) : null; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a file of the plugin.
			self::$catalog = array();
			foreach ( is_array( $data ) ? (array) ( $data['templates'] ?? array() ) : array() as $entry ) {
				if ( is_array( $entry ) && isset( $entry['id'] ) && 1 === preg_match( '/^[a-z]+$/', (string) $entry['id'] ) ) {
					self::$catalog[ (string) $entry['id'] ] = $entry;
				}
			}
		}
		return self::$catalog;
	}

	/**
	 * A text of the catalog in a language, English when it is missing.
	 *
	 * @param mixed  $text   Text by language.
	 * @param string $source Language (LANGUAGES).
	 */
	private static function pick( $text, string $source ): string {
		if ( ! is_array( $text ) ) {
			return '';
		}
		return (string) ( $text[ $source ] ?? $text['en_US'] ?? '' );
	}
}
