<?php
/**
 * The website's logo and its colours, for the design of a form.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Domain\Form\Branding;

defined( 'ABSPATH' ) || exit;

/**
 * The logo of the Customizer (else the site icon) as an attachment of the media library. Its
 * colours are read from the file on this server (SVG: the colours it names; PNG, JPEG, GIF and
 * WebP: the pixels, with GD where PHP has it), never over the network.
 */
final class SiteLogo {

	/** Largest file read, in bytes. */
	private const MAX_FILE = 4 * 1024 * 1024;

	/** Side of the square the picture is shrunk to before its pixels are counted. */
	private const SAMPLE = 48;

	/**
	 * Attachment of the logo, else of the site icon; 0 without both.
	 */
	public static function id(): int {
		$id = (int) get_theme_mod( 'custom_logo' );
		if ( $id <= 0 || ! wp_attachment_is_image( $id ) ) {
			$id = (int) get_option( 'site_icon' );
		}
		return $id > 0 && wp_attachment_is_image( $id ) ? $id : 0;
	}

	/**
	 * Address of the logo (full size); null without one.
	 */
	public static function url(): ?string {
		$id  = self::id();
		$url = $id > 0 ? wp_get_attachment_image_url( $id, 'full' ) : false;
		return is_string( $url ) && '' !== $url ? $url : null;
	}

	/**
	 * The colourful colours of the logo, the most used first (#rrggbb); white, black and grey are
	 * left out, so is what is transparent.
	 *
	 * @param int $id Attachment.
	 * @return list<string>
	 */
	public static function colors( int $id ): array {
		$file = $id > 0 ? get_attached_file( $id ) : false;
		if ( ! is_string( $file ) || ! is_readable( $file ) || (int) filesize( $file ) > self::MAX_FILE ) {
			return array();
		}
		$data = (string) file_get_contents( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- A file of the media library on this server.
		$svg  = 'image/svg+xml' === get_post_mime_type( $id ) || str_ends_with( strtolower( $file ), '.svg' );
		return $svg ? self::svg_colors( $data ) : self::pixel_colors( $data );
	}

	/**
	 * Colours an SVG names in fill, stroke and stop-color, by how often.
	 *
	 * @param string $svg Markup.
	 * @return list<string>
	 */
	public static function svg_colors( string $svg ): array {
		$counts = array();
		if ( preg_match_all( '/(?:fill|stroke|stop-color)\s*[=:]\s*["\']?\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/i', $svg, $m ) ) {
			foreach ( $m[1] as $value ) {
				$color = Branding::color( $value );
				if ( null !== $color && Branding::colourful( $color ) ) {
					$counts[ $color ] = ( $counts[ $color ] ?? 0 ) + 1;
				}
			}
		}
		arsort( $counts );
		return self::distinct( array_map( 'strval', array_keys( $counts ) ) );
	}

	/**
	 * Colours of a raster image by the share of its opaque, colourful pixels; empty without GD
	 * or when PHP cannot read the file.
	 *
	 * @param string $data File.
	 * @return list<string>
	 */
	public static function pixel_colors( string $data ): array {
		if ( ! function_exists( 'imagecreatefromstring' ) || '' === $data ) {
			return array();
		}
		$image = @imagecreatefromstring( $data ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- A file GD cannot read is no logo to read colours from.
		if ( false === $image ) {
			return array();
		}
		$small = imagecreatetruecolor( self::SAMPLE, self::SAMPLE );
		imagealphablending( $small, false );
		imagesavealpha( $small, true );
		imagefill( $small, 0, 0, (int) imagecolorallocatealpha( $small, 0, 0, 0, 127 ) );
		imagecopyresampled( $small, $image, 0, 0, 0, 0, self::SAMPLE, self::SAMPLE, imagesx( $image ), imagesy( $image ) );
		$buckets = array();
		for ( $x = 0; $x < self::SAMPLE; $x++ ) {
			for ( $y = 0; $y < self::SAMPLE; $y++ ) {
				$pixel = (int) imagecolorat( $small, $x, $y );
				if ( ( ( $pixel >> 24 ) & 0x7f ) > 48 ) {
					continue;
				}
				$rgb   = array( ( $pixel >> 16 ) & 0xff, ( $pixel >> 8 ) & 0xff, $pixel & 0xff );
				$color = vsprintf( '#%02x%02x%02x', $rgb );
				if ( ! Branding::colourful( $color ) ) {
					continue;
				}
				// Similar shades (anti-aliased edges) fall into one bucket; its colour is their average.
				$key             = ( $rgb[0] >> 5 ) . '-' . ( $rgb[1] >> 5 ) . '-' . ( $rgb[2] >> 5 );
				$sum             = $buckets[ $key ] ?? array( 0, 0, 0, 0 );
				$buckets[ $key ] = array( $sum[0] + 1, $sum[1] + $rgb[0], $sum[2] + $rgb[1], $sum[3] + $rgb[2] );
			}
		}
		usort( $buckets, static fn( array $a, array $b ): int => $b[0] <=> $a[0] );
		$total  = array_sum( array_column( $buckets, 0 ) );
		$colors = array();
		foreach ( $buckets as [ $count, $r, $g, $b ] ) {
			// Specks below 4 % of the colourful pixels are no colour of the logo.
			if ( $count * 25 >= $total ) {
				$colors[] = sprintf( '#%02x%02x%02x', (int) round( $r / $count ), (int) round( $g / $count ), (int) round( $b / $count ) );
			}
		}
		return self::distinct( $colors );
	}

	/**
	 * Up to three colours that can be told apart.
	 *
	 * @param array<string> $colors Colours, the most used first.
	 * @return list<string>
	 */
	private static function distinct( array $colors ): array {
		$out = array();
		foreach ( $colors as $color ) {
			if ( count( $out ) < 3 && ! Branding::near_any( $color, $out ) ) {
				$out[] = $color;
			}
		}
		return $out;
	}
}
