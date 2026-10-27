<?php
/**
 * The font of a form (style token font.family) as CSS.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

use Funnelforms\Application\GoogleFonts;

defined( 'ABSPATH' ) || exit;

/**
 * Values as 3.x stored them (setting "Font family"): Montserrat (the default, bundled in
 * plugin/fonts like Poppins, which the builder's themes use), a generic family such as inherit
 * (theme-based) or serif, or the file name of a font uploaded to uploads/af2_fonts. New in 5.0: the
 * family of a Google Font downloaded to the site (Application\GoogleFonts) and font stacks of fonts devices already have (STACKS). 3.x loaded Montserrat and uploaded fonts itself; so does
 * the new renderer, with a fallback family, so a form never falls back to the browser's serif.
 */
final class FormFont {

	private const GENERIC = array( 'inherit', 'serif', 'sans-serif', 'cursive', 'fantasy', 'monospace', 'system-ui' );

	/**
	 * Font stacks of fonts most devices already have, by name: the themes of the builder use them
	 * for a look of their own without loading a font (builder: src/fonts.ts, keep both the same).
	 */
	private const STACKS = array(
		'serif-classic'  => '"Iowan Old Style","Palatino Linotype",Palatino,"URW Palladio L",P052,Georgia,serif',
		'serif-modern'   => 'Didot,"Bodoni MT","Noto Serif Display","Big Caslon",Georgia,serif',
		'sans-humanist'  => 'Seravek,"Gill Sans Nova",Ubuntu,Calibri,"DejaVu Sans",source-sans-pro,sans-serif',
		'sans-geometric' => 'Avenir,"Avenir Next","Century Gothic",Corbel,"URW Gothic",source-sans-pro,sans-serif',
		'rounded'        => 'ui-rounded,"Hiragino Maru Gothic ProN",Quicksand,Comfortaa,"Arial Rounded MT",Calibri,sans-serif',
		'slab'           => 'Rockwell,"Rockwell Nova","Roboto Slab","DejaVu Serif","Sitka Small",serif',
		'condensed'      => 'Bahnschrift,"DIN Alternate","Franklin Gothic Medium","Nimbus Sans Narrow",sans-serif',
		'mono-code'      => 'ui-monospace,"Cascadia Code","Source Code Pro",Menlo,Consolas,"DejaVu Sans Mono",monospace',
	);

	/**
	 * Fonts bundled in plugin/fonts: family => weight => file (without extension). Poppins is
	 * there for the themes; 3.x shipped it without using it.
	 */
	private const BUNDLED = array(
		'Montserrat' => array(
			400 => 'Montserrat/Montserrat-Regular',
			600 => 'Montserrat/Montserrat-SemiBold',
			700 => 'Montserrat/Montserrat-Bold',
		),
		'Poppins'    => array(
			400 => 'Poppins/poppins-v20-latin-regular',
			600 => 'Poppins/poppins-v20-latin-600',
			700 => 'Poppins/poppins-v20-latin-700',
		),
	);

	/**
	 * Largest uploaded font that is embedded (see resolve()).
	 */
	private const MAX_EMBED = 2 * MB_IN_BYTES;

	private const FORMATS = array(
		'ttf'   => 'truetype',
		'otf'   => 'opentype',
		'woff'  => 'woff',
		'woff2' => 'woff2',
	);

	/**
	 * CSS value of font-family, and the @font-face rules it needs ('' when none).
	 *
	 * @param string $value Value of the token.
	 * @param bool   $embed Fonts as data URLs: the builder's preview frame has an origin of its
	 *                      own, and font requests from there need CORS headers sites do not send.
	 * @return array{family:string,css:string} Family '' when the value is not usable.
	 */
	public static function resolve( string $value, bool $embed = false ): array {
		$value = trim( $value );
		if ( in_array( strtolower( $value ), self::GENERIC, true ) ) {
			return array(
				'family' => strtolower( $value ),
				'css'    => '',
			);
		}
		if ( isset( self::STACKS[ $value ] ) ) {
			return array(
				'family' => self::STACKS[ $value ],
				'css'    => '',
			);
		}
		foreach ( self::BUNDLED as $family => $files ) {
			if ( 0 === strcasecmp( $value, $family ) ) {
				return array(
					'family' => '"' . $family . '", sans-serif',
					'css'    => self::bundled( $family, $files, $embed ),
				);
			}
		}
		$google = '' !== $value ? GoogleFonts::find( $value ) : null;
		if ( null !== $google ) {
			return array(
				'family' => '"' . $google['family'] . '", ' . GoogleFonts::fallback( $google['category'] ),
				'css'    => self::google( $google, $embed ),
			);
		}
		if ( 1 === preg_match( '/^([A-Za-z0-9 _-]{1,60})\.(ttf|otf|woff2?)$/i', $value, $m ) ) {
			// A font uploaded in 3.x; it stays in its folder.
			$name    = trim( $m[1] );
			$uploads = wp_upload_dir( null, false );
			$format  = self::FORMATS[ strtolower( $m[2] ) ];
			$data    = $embed ? self::data_url( $uploads['basedir'] . '/af2_fonts/' . $value, $format ) : null;
			$url     = $data ?? esc_url( $uploads['baseurl'] . '/af2_fonts/' . rawurlencode( $value ) );
			return array(
				'family' => '"' . $name . '", sans-serif',
				'css'    => sprintf(
					'@font-face{font-family:"%1$s";font-weight:100 900;font-display:swap;src:url("%2$s") format("%3$s")}',
					$name,
					$url,
					$format
				),
			);
		}
		if ( 1 === preg_match( '/^[A-Za-z0-9 _-]{1,60}$/', $value ) ) {
			// A family the site loads itself.
			return array(
				'family' => '"' . $value . '", sans-serif',
				'css'    => '',
			);
		}
		return array(
			'family' => '',
			'css'    => '',
		);
	}

	/**
	 * The @font-face rules of a bundled font.
	 *
	 * @param string            $family Family.
	 * @param array<int,string> $files  Weight => file.
	 * @param bool              $embed  As data URLs.
	 */
	private static function bundled( string $family, array $files, bool $embed ): string {
		$css = '';
		foreach ( $files as $weight => $file ) {
			$data = $embed ? self::data_url( FUNNELFORMS_PLUGIN_DIR . '/fonts/' . $file . '.woff2', 'woff2' ) : null;
			$url  = plugins_url( 'fonts/' . $file, FUNNELFORMS_PLUGIN_FILE );
			$css .= sprintf(
				'@font-face{font-family:"%1$s";font-style:normal;font-weight:%2$d;font-display:swap;src:%3$s}',
				$family,
				$weight,
				null !== $data
					? 'url("' . $data . '") format("woff2")'
					: 'url("' . esc_url( $url . '.woff2' ) . '") format("woff2"),url("' . esc_url( $url . '.woff' ) . '") format("woff")'
			);
		}
		return $css;
	}

	/**
	 * The @font-face rules of a Google Font downloaded to the site (Application\GoogleFonts).
	 *
	 * @param array{family:string,category:string,faces:list<array{weight:int,file:string,range:string}>} $font  Font.
	 * @param bool                                                                                        $embed As data URLs.
	 */
	private static function google( array $font, bool $embed ): string {
		$css = '';
		$dir = GoogleFonts::dir( $font['family'] );
		$url = wp_upload_dir( null, false )['baseurl'] . '/af2_fonts/google/' . basename( $dir ) . '/';
		foreach ( $font['faces'] as $face ) {
			$file = basename( (string) $face['file'] );
			$data = $embed ? self::data_url( $dir . '/' . $file, 'woff2' ) : null;
			$css .= sprintf(
				'@font-face{font-family:"%1$s";font-style:normal;font-weight:%2$d;font-display:swap;src:url("%3$s") format("woff2");unicode-range:%4$s}',
				$font['family'],
				(int) $face['weight'],
				$data ?? esc_url( $url . $file ),
				preg_replace( '/[^U+0-9A-Fa-f?, -]/', '', (string) $face['range'] )
			);
		}
		return $css;
	}

	/**
	 * A font file as data URL; null when it is missing or too large.
	 *
	 * @param string $path   File.
	 * @param string $format CSS format name (woff2, truetype, …).
	 */
	private static function data_url( string $path, string $format ): ?string {
		if ( ! is_readable( $path ) || filesize( $path ) > self::MAX_EMBED ) {
			return null;
		}
		$types = array(
			'truetype' => 'font/ttf',
			'opentype' => 'font/otf',
			'woff'     => 'font/woff',
			'woff2'    => 'font/woff2',
		);
		return 'data:' . $types[ $format ] . ';base64,' . base64_encode( (string) file_get_contents( $path ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode, WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- A local font file for a data URL.
	}
}
