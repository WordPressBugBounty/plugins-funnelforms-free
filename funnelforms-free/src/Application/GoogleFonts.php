<?php
/**
 * Google Fonts, downloaded once to the site and served from there.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

defined( 'ABSPATH' ) || exit;

/**
 * Funnelforms 4 offers about 200 Google Fonts and loads them from Google in the visitor's
 * browser. The plugin instead downloads a font once, when someone who edits forms picks it:
 * the site's server asks fonts.googleapis.com for the regular, medium, semibold and bold
 * styles, keeps the Latin and Latin Extended files (WOFF2) in uploads/af2_fonts/google/<slug>
 * and remembers them in an option. Visitors load the files from the site and never contact
 * Google, so no consent is needed for fonts (Frontend\FormFont prints the rules).
 */
final class GoogleFonts {

	/**
	 * Option with the installed fonts: family => [category, faces => [[weight, file, range]]].
	 */
	public const OPTION = 'funnelforms_google_fonts';

	/**
	 * Downloads per user and hour.
	 */
	public const LIMIT = 30;

	/**
	 * Largest file of one style, in bytes.
	 */
	private const MAX_FILE = MB_IN_BYTES;

	/**
	 * Subsets kept; other scripts are left out to keep the files few and small.
	 */
	private const SUBSETS = array( 'latin', 'latin-ext' );

	/**
	 * The families offered (the list of Funnelforms 4 without the bundled Montserrat and
	 * Poppins, each checked against Google Fonts) and their category.
	 */
	private const CATALOG = array(
		'ABeeZee'               => 'sans-serif',
		'Abel'                  => 'sans-serif',
		'Abril Fatface'         => 'display',
		'Acme'                  => 'sans-serif',
		'Alegreya'              => 'serif',
		'Alegreya Sans'         => 'sans-serif',
		'Alfa Slab One'         => 'display',
		'Amatic SC'             => 'handwriting',
		'Anton'                 => 'display',
		'Architects Daughter'   => 'handwriting',
		'Archivo'               => 'sans-serif',
		'Arimo'                 => 'sans-serif',
		'Asap'                  => 'sans-serif',
		'Assistant'             => 'sans-serif',
		'Bad Script'            => 'handwriting',
		'Bangers'               => 'display',
		'Barlow'                => 'sans-serif',
		'Barlow Condensed'      => 'sans-serif',
		'Barlow Semi Condensed' => 'sans-serif',
		'Be Vietnam Pro'        => 'sans-serif',
		'Bebas Neue'            => 'display',
		'Bitter'                => 'serif',
		'Bodoni Moda'           => 'serif',
		'Bree Serif'            => 'serif',
		'Bungee'                => 'display',
		'Bungee Inline'         => 'display',
		'Cabin'                 => 'sans-serif',
		'Cabin Condensed'       => 'sans-serif',
		'Cairo'                 => 'sans-serif',
		'Cardo'                 => 'serif',
		'Catamaran'             => 'sans-serif',
		'Caveat'                => 'handwriting',
		'Chakra Petch'          => 'sans-serif',
		'Chivo'                 => 'sans-serif',
		'Cinzel'                => 'serif',
		'Comfortaa'             => 'display',
		'Commissioner'          => 'sans-serif',
		'Cookie'                => 'handwriting',
		'Cormorant'             => 'serif',
		'Cormorant Garamond'    => 'serif',
		'Courgette'             => 'display',
		'Cousine'               => 'monospace',
		'Covered By Your Grace' => 'handwriting',
		'Crimson Pro'           => 'serif',
		'Crimson Text'          => 'serif',
		'Dancing Script'        => 'handwriting',
		'DM Sans'               => 'sans-serif',
		'DM Serif Display'      => 'serif',
		'DM Serif Text'         => 'serif',
		'Domine'                => 'serif',
		'Dosis'                 => 'sans-serif',
		'EB Garamond'           => 'serif',
		'Encode Sans'           => 'sans-serif',
		'Epilogue'              => 'sans-serif',
		'Exo 2'                 => 'sans-serif',
		'Figtree'               => 'sans-serif',
		'Fira Code'             => 'monospace',
		'Fira Sans'             => 'sans-serif',
		'Frank Ruhl Libre'      => 'serif',
		'Fredoka'               => 'display',
		'Gentium Book Plus'     => 'serif',
		'Geologica'             => 'sans-serif',
		'Gloria Hallelujah'     => 'handwriting',
		'Great Vibes'           => 'handwriting',
		'Handlee'               => 'handwriting',
		'Heebo'                 => 'sans-serif',
		'Hind'                  => 'sans-serif',
		'Hind Madurai'          => 'sans-serif',
		'Hind Siliguri'         => 'sans-serif',
		'IBM Plex Mono'         => 'monospace',
		'IBM Plex Sans'         => 'sans-serif',
		'IBM Plex Serif'        => 'serif',
		'Inconsolata'           => 'monospace',
		'Indie Flower'          => 'handwriting',
		'Instrument Sans'       => 'sans-serif',
		'Instrument Serif'      => 'serif',
		'Inter'                 => 'sans-serif',
		'JetBrains Mono'        => 'monospace',
		'Josefin Sans'          => 'sans-serif',
		'Josefin Slab'          => 'serif',
		'Jost'                  => 'sans-serif',
		'Kalam'                 => 'handwriting',
		'Kanit'                 => 'sans-serif',
		'Karla'                 => 'sans-serif',
		'Kaushan Script'        => 'handwriting',
		'Lato'                  => 'sans-serif',
		'Leckerli One'          => 'handwriting',
		'Lexend'                => 'sans-serif',
		'Libre Barcode 39'      => 'sans-serif',
		'Libre Baskerville'     => 'serif',
		'Libre Franklin'        => 'sans-serif',
		'Lilita One'            => 'display',
		'Literata'              => 'serif',
		'Lobster'               => 'display',
		'Lobster Two'           => 'display',
		'Lora'                  => 'serif',
		'Lusitana'              => 'serif',
		'Mada'                  => 'sans-serif',
		'Manrope'               => 'sans-serif',
		'Marck Script'          => 'handwriting',
		'Martel'                => 'serif',
		'Maven Pro'             => 'sans-serif',
		'Merriweather'          => 'serif',
		'Monoton'               => 'display',
		'Mukta'                 => 'sans-serif',
		'Mulish'                => 'sans-serif',
		'Nanum Gothic'          => 'sans-serif',
		'Nanum Myeongjo'        => 'serif',
		'Neucha'                => 'handwriting',
		'Nothing You Could Do'  => 'handwriting',
		'Noto Sans'             => 'sans-serif',
		'Noto Sans JP'          => 'sans-serif',
		'Noto Sans KR'          => 'sans-serif',
		'Noto Sans Mono'        => 'monospace',
		'Noto Sans SC'          => 'sans-serif',
		'Noto Sans TC'          => 'sans-serif',
		'Noto Serif'            => 'serif',
		'Noto Serif JP'         => 'serif',
		'Nunito'                => 'sans-serif',
		'Nunito Sans'           => 'sans-serif',
		'Old Standard TT'       => 'serif',
		'Open Sans'             => 'sans-serif',
		'Orbitron'              => 'display',
		'Oswald'                => 'sans-serif',
		'Outfit'                => 'sans-serif',
		'Overpass'              => 'sans-serif',
		'Overpass Mono'         => 'monospace',
		'Oxygen'                => 'sans-serif',
		'Pacifico'              => 'handwriting',
		'Patrick Hand'          => 'handwriting',
		'Patua One'             => 'display',
		'Permanent Marker'      => 'display',
		'Philosopher'           => 'serif',
		'Playball'              => 'display',
		'Playfair Display'      => 'serif',
		'Playfair Display SC'   => 'serif',
		'Plus Jakarta Sans'     => 'sans-serif',
		'Press Start 2P'        => 'display',
		'Prompt'                => 'sans-serif',
		'PT Mono'               => 'monospace',
		'PT Sans'               => 'sans-serif',
		'PT Serif'              => 'serif',
		'Public Sans'           => 'sans-serif',
		'Questrial'             => 'sans-serif',
		'Quicksand'             => 'sans-serif',
		'Raleway'               => 'sans-serif',
		'Red Hat Display'       => 'sans-serif',
		'Righteous'             => 'display',
		'Roboto'                => 'sans-serif',
		'Roboto Condensed'      => 'sans-serif',
		'Roboto Flex'           => 'sans-serif',
		'Roboto Mono'           => 'monospace',
		'Roboto Slab'           => 'sans-serif',
		'Rock Salt'             => 'handwriting',
		'Rubik'                 => 'sans-serif',
		'Russo One'             => 'display',
		'Sacramento'            => 'handwriting',
		'Saira'                 => 'sans-serif',
		'Satisfy'               => 'handwriting',
		'Schibsted Grotesk'     => 'sans-serif',
		'Secular One'           => 'display',
		'Sen'                   => 'sans-serif',
		'Shadows Into Light'    => 'handwriting',
		'Signika'               => 'sans-serif',
		'Signika Negative'      => 'sans-serif',
		'Slabo 27px'            => 'serif',
		'Sora'                  => 'sans-serif',
		'Sorts Mill Goudy'      => 'serif',
		'Source Code Pro'       => 'monospace',
		'Source Sans 3'         => 'sans-serif',
		'Source Sans Pro'       => 'sans-serif',
		'Source Serif 4'        => 'serif',
		'Source Serif Pro'      => 'serif',
		'Space Grotesk'         => 'sans-serif',
		'Space Mono'            => 'monospace',
		'Special Elite'         => 'display',
		'Spectral'              => 'serif',
		'Staatliches'           => 'display',
		'Tangerine'             => 'handwriting',
		'Teko'                  => 'display',
		'Tinos'                 => 'serif',
		'Titillium Web'         => 'sans-serif',
		'Ubuntu'                => 'sans-serif',
		'Ubuntu Mono'           => 'monospace',
		'Ultra'                 => 'display',
		'Unna'                  => 'serif',
		'Urbanist'              => 'sans-serif',
		'Varela Round'          => 'sans-serif',
		'Vollkorn'              => 'serif',
		'Wix Madefor Display'   => 'sans-serif',
		'Work Sans'             => 'sans-serif',
		'Yantramanav'           => 'sans-serif',
		'Yellowtail'            => 'handwriting',
		'Yeseva One'            => 'display',
		'Young Serif'           => 'serif',
		'Zilla Slab'            => 'serif',
	);

	/**
	 * The catalogue with what is installed.
	 *
	 * @return list<array{family:string,category:string,installed:bool}>
	 */
	public static function catalog(): array {
		$installed = self::installed();
		$out       = array();
		foreach ( self::CATALOG as $family => $category ) {
			$out[] = array(
				'family'    => $family,
				'category'  => $category,
				'installed' => isset( $installed[ $family ] ),
			);
		}
		return $out;
	}

	/**
	 * Installed fonts.
	 *
	 * @return array<string,array{category:string,faces:list<array{weight:int,file:string,range:string}>}>
	 */
	public static function installed(): array {
		$value = get_option( self::OPTION, array() );
		return is_array( $value ) ? $value : array();
	}

	/**
	 * An installed font by its family, in any case; null when it is not installed.
	 *
	 * @param string $family Family.
	 * @return array{family:string,category:string,faces:list<array{weight:int,file:string,range:string}>}|null
	 */
	public static function find( string $family ): ?array {
		foreach ( self::installed() as $name => $font ) {
			if ( 0 === strcasecmp( $name, $family ) ) {
				return array( 'family' => (string) $name ) + $font;
			}
		}
		return null;
	}

	/**
	 * The name of a family in the catalogue, in any case; null when it is not listed.
	 *
	 * @param string $family Family.
	 */
	public static function listed( string $family ): ?string {
		foreach ( array_keys( self::CATALOG ) as $name ) {
			if ( 0 === strcasecmp( $name, trim( $family ) ) ) {
				return $name;
			}
		}
		return null;
	}

	/**
	 * The folder of a font's files.
	 *
	 * @param string $family Family.
	 */
	public static function dir( string $family = '' ): string {
		return FontLibrary::dir() . '/google' . ( '' === $family ? '' : '/' . self::slug( $family ) );
	}

	/**
	 * Downloads a font of the catalogue to the site.
	 *
	 * @param string $family Family, as in the catalogue.
	 * @param int    $user   User, for the limit of downloads.
	 * @return array{family:string,category:string}|string The font, or an error code:
	 *         unknown_font, rate_limited, download_failed.
	 */
	public static function install( string $family, int $user ) {
		$family = self::listed( $family );
		if ( null === $family ) {
			return 'unknown_font';
		}
		$category = self::CATALOG[ $family ];
		if ( null !== self::find( $family ) ) {
			return array(
				'family'   => $family,
				'category' => $category,
			);
		}
		$key   = 'funnelforms_gfonts_' . $user;
		$count = (int) get_transient( $key );
		if ( $count >= self::LIMIT ) {
			return 'rate_limited';
		}
		set_transient( $key, $count + 1, HOUR_IN_SECONDS );

		$css = self::get( 'https://fonts.googleapis.com/css2?family=' . str_replace( '%20', '+', rawurlencode( $family ) ) . ':wght@400;500;600;700&display=swap', 512 * KB_IN_BYTES );
		if ( null === $css ) {
			return 'download_failed';
		}
		$faces = self::faces( $css );
		if ( array() === $faces ) {
			return 'download_failed';
		}
		$dir = self::dir( $family );
		wp_mkdir_p( $dir );
		$files = array();
		$out   = array();
		foreach ( $faces as $face ) {
			// Variable fonts give the same file for every weight; it is downloaded once.
			if ( ! isset( $files[ $face['url'] ] ) ) {
				$data = self::get( $face['url'], self::MAX_FILE );
				if ( null === $data || ! str_starts_with( $data, 'wOF2' ) ) {
					self::remove_files( $family );
					return 'download_failed';
				}
				$name = self::slug( $family ) . '-' . count( $files ) . '.woff2';
				if ( false === file_put_contents( $dir . '/' . $name, $data ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- a font file in the uploads folder.
					self::remove_files( $family );
					return 'download_failed';
				}
				$files[ $face['url'] ] = $name;
			}
			$out[] = array(
				'weight' => $face['weight'],
				'file'   => $files[ $face['url'] ],
				'range'  => $face['range'],
			);
		}
		$installed            = self::installed();
		$installed[ $family ] = array(
			'category' => $category,
			'faces'    => $out,
		);
		update_option( self::OPTION, $installed, false );
		return array(
			'family'   => $family,
			'category' => $category,
		);
	}

	/**
	 * Removes a downloaded font. Forms that still name it fall back to the next font.
	 *
	 * @param string $family Family.
	 */
	public static function remove( string $family ): bool {
		$font = self::find( $family );
		if ( null === $font ) {
			return false;
		}
		$installed = self::installed();
		unset( $installed[ $font['family'] ] );
		update_option( self::OPTION, $installed, false );
		self::remove_files( $font['family'] );
		return true;
	}

	/**
	 * The CSS fallback of a category.
	 *
	 * @param string $category Category of the catalogue.
	 */
	public static function fallback( string $category ): string {
		$fallbacks = array(
			'serif'       => 'serif',
			'monospace'   => 'monospace',
			'handwriting' => 'cursive',
		);
		return $fallbacks[ $category ] ?? 'sans-serif';
	}

	/**
	 * The @font-face blocks of the subsets kept, from Google's CSS.
	 *
	 * @param string $css CSS of fonts.googleapis.com.
	 * @return list<array{weight:int,url:string,range:string}>
	 */
	private static function faces( string $css ): array {
		preg_match_all( '#/\*\s*([a-z-]+)\s*\*/\s*@font-face\s*\{([^}]*)\}#', $css, $blocks, PREG_SET_ORDER );
		$out = array();
		foreach ( $blocks as [ , $subset, $body ] ) {
			if ( ! in_array( $subset, self::SUBSETS, true )
				|| 1 !== preg_match( '/font-style:\s*normal/', $body )
				|| 1 !== preg_match( '/font-weight:\s*([1-9]00)\s*;/', $body, $weight )
				|| 1 !== preg_match( '#src:\s*url\((https://fonts\.gstatic\.com/[A-Za-z0-9/._-]+\.woff2)\)#', $body, $url )
				|| 1 !== preg_match( '/unicode-range:\s*([U+0-9A-Fa-f?,\s-]{1,2000});/', $body, $range ) ) {
				continue;
			}
			$out[] = array(
				'weight' => (int) $weight[1],
				'url'    => $url[1],
				'range'  => trim( (string) preg_replace( '/\s+/', ' ', $range[1] ) ),
			);
		}
		return $out;
	}

	/**
	 * A file from Google; null when it cannot be loaded.
	 *
	 * @param string $url   Address.
	 * @param int    $limit Most bytes.
	 */
	private static function get( string $url, int $limit ): ?string {
		$response = wp_safe_remote_get(
			$url,
			array(
				'timeout'             => 15,
				'redirection'         => 0,
				'limit_response_size' => $limit,
				// Google answers WOFF2 only to browsers that read it.
				'user-agent'          => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
			)
		);
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return null;
		}
		$body = (string) wp_remote_retrieve_body( $response );
		return '' === $body || strlen( $body ) >= $limit ? null : $body;
	}

	/**
	 * Deletes the folder of a font.
	 *
	 * @param string $family Family.
	 */
	private static function remove_files( string $family ): void {
		if ( ! is_dir( self::dir( $family ) ) ) {
			return;
		}
		if ( ! class_exists( '\WP_Filesystem_Direct' ) ) {
			require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-base.php';
			require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-direct.php';
		}
		( new \WP_Filesystem_Direct( null ) )->rmdir( self::dir( $family ), true );
	}

	/**
	 * Folder and file name of a family.
	 *
	 * @param string $family Family.
	 */
	private static function slug( string $family ): string {
		return strtolower( (string) preg_replace( '/[^A-Za-z0-9]+/', '-', $family ) );
	}
}
