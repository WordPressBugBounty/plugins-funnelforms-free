<?php
/**
 * The designed layout of mails: the text on a card in the colour of the form.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application\Actions;

use Funnelforms\Domain\Entry\Submission;

defined( 'ABSPATH' ) || exit;

/**
 * Mails with layout "branded" (EmailConfig) are wrapped here: the logo of the website on top, a
 * bar in the accent colour of the form, the text, and a footer with the website. Mail programs
 * understand little CSS, so the layout is a table with inline styles, at most 600 px wide, and
 * readable without images. In the admin mail a button opens the entry.
 */
final class MailLayout {

	private const FALLBACK_COLOR = '#6a30f5';

	private const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

	/**
	 * The body inside the layout.
	 *
	 * @param string     $body  HTML of the mail text, tokens filled in.
	 * @param Submission $s     Submission.
	 * @param bool       $admin Mail to the site (button to the entry) or to the visitor.
	 */
	public static function wrap( string $body, Submission $s, bool $admin ): string {
		$color = self::color( (string) ( $s->document->raw()['style']['tokens']['color.primary'] ?? '' ) );
		$site  = wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES );
		$home  = home_url( '/' );
		$logo  = self::logo();
		$head  = null === $logo
			? '<span style="font-family:' . esc_attr( self::FONT ) . ';font-size:18px;font-weight:700;color:' . esc_attr( $color ) . ';">' . esc_html( $site ) . '</span>'
			: '<img src="' . esc_url( $logo ) . '" alt="' . esc_attr( $site ) . '" height="40" style="display:block;height:40px;width:auto;max-width:220px;border:0;">';

		$button = '';
		if ( $admin && $s->entry_id > 0 ) {
			$button = '<tr><td style="padding:8px 32px 32px;">' . self::button( admin_url( 'admin.php?page=funnelforms-entries&entry=' . $s->entry_id ), __( 'Open the entry', 'funnelforms-free' ), $s ) . '</td></tr>';
		}
		$footer = $admin
			/* translators: 1: name of the form, 2: name of the website. */
			? sprintf( __( 'Sent by the form "%1$s" on %2$s.', 'funnelforms-free' ), (string) ( $s->document->raw()['title'] ?? '' ), $site )
			: $site;

		return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
			. '<body style="margin:0;padding:0;background:#f3f4f7;">'
			. '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f7;"><tr><td align="center" style="padding:32px 12px;">'
			. '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;border-top:6px solid ' . esc_attr( $color ) . ';">'
			. '<tr><td style="padding:28px 32px 4px;">' . $head . '</td></tr>'
			. '<tr><td style="padding:16px 32px 24px;font-family:' . esc_attr( self::FONT ) . ';font-size:15px;line-height:1.6;color:#1f2330;">' . $body . '</td></tr>'
			. $button
			. '</table>'
			. '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;"><tr><td style="padding:16px 32px;font-family:' . esc_attr( self::FONT ) . ';font-size:12px;line-height:1.5;color:#7a7f8c;text-align:center;">'
			. esc_html( $footer ) . '<br><a href="' . esc_url( $home ) . '" style="color:#7a7f8c;">' . esc_html( (string) wp_parse_url( $home, PHP_URL_HOST ) ) . '</a>'
			. '</td></tr></table>'
			. '</td></tr></table></body></html>';
	}

	/**
	 * A button with a link, in the accent colour of the form and the form's button text colour
	 * (else white or near-black, whichever reads better).
	 *
	 * @param string     $url   Address.
	 * @param string     $label Text of the button (plain text).
	 * @param Submission $s     Submission.
	 */
	public static function button( string $url, string $label, Submission $s ): string {
		$tokens = $s->document->raw()['style']['tokens'] ?? array();
		$color  = self::color( (string) ( $tokens['color.primary'] ?? '' ) );
		$on     = self::color( (string) ( $tokens['color.onPrimary'] ?? '' ), self::readable_on( $color ) );
		return '<a href="' . esc_url( $url ) . '" style="display:inline-block;background:' . esc_attr( $color ) . ';color:' . esc_attr( $on ) . ';font-family:' . esc_attr( self::FONT ) . ';font-size:15px;font-weight:600;line-height:20px;text-decoration:none;padding:12px 22px;border-radius:8px;">'
			. esc_html( $label ) . '</a>';
	}

	/**
	 * The answers as a table: question above, answer below, a thin line between them. Without line
	 * breaks between the tags, so "Keep line breaks" leaves the table as it is.
	 *
	 * @param array<int,array{label:string,value:string}> $rows Escaped HTML of label and answer.
	 */
	public static function answers( array $rows ): string {
		if ( array() === $rows ) {
			return '';
		}
		$html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;border-collapse:collapse;">';
		foreach ( $rows as $row ) {
			$html .= '<tr><td style="padding:10px 0;border-bottom:1px solid #eceef2;font-family:' . esc_attr( self::FONT ) . ';">'
				. '<div style="font-size:13px;line-height:1.4;color:#6b7080;">' . $row['label'] . '</div>'
				. '<div style="font-size:15px;line-height:1.5;color:#1f2330;font-weight:600;">' . ( '' === $row['value'] ? '–' : $row['value'] ) . '</div>'
				. '</td></tr>';
		}
		return $html . '</table>';
	}

	/**
	 * A colour token as #rrggbb; the fallback (the brand colour) when it is empty or no hex colour.
	 *
	 * @param string $value    Token value.
	 * @param string $fallback Colour when the value is none.
	 */
	public static function color( string $value, string $fallback = self::FALLBACK_COLOR ): string {
		$value = strtolower( trim( $value ) );
		if ( 1 === preg_match( '/^#([0-9a-f])([0-9a-f])([0-9a-f])$/', $value, $m ) ) {
			return '#' . $m[1] . $m[1] . $m[2] . $m[2] . $m[3] . $m[3];
		}
		return 1 === preg_match( '/^#[0-9a-f]{6}$/', $value ) ? $value : $fallback;
	}

	/**
	 * White or near-black text, whichever reads better on the colour (WCAG relative luminance).
	 *
	 * @param string $color #rrggbb.
	 */
	public static function readable_on( string $color ): string {
		$channel = static function ( string $hex ): float {
			$c = hexdec( $hex ) / 255;
			return $c <= 0.03928 ? $c / 12.92 : ( ( $c + 0.055 ) / 1.055 ) ** 2.4;
		};
		$l       = 0.2126 * $channel( substr( $color, 1, 2 ) ) + 0.7152 * $channel( substr( $color, 3, 2 ) ) + 0.0722 * $channel( substr( $color, 5, 2 ) );
		// Contrast with white (1.05 / (l + 0.05)) against contrast with black ((l + 0.05) / 0.05).
		return 1.05 / ( $l + 0.05 ) >= ( $l + 0.05 ) / 0.05 ? '#ffffff' : '#111111';
	}

	/**
	 * Address of the website's logo (Customizer), else of its site icon; null without both.
	 */
	private static function logo(): ?string {
		$id  = (int) get_theme_mod( 'custom_logo' );
		$url = $id > 0 ? wp_get_attachment_image_url( $id, 'medium' ) : false;
		if ( ! is_string( $url ) || '' === $url ) {
			$url = get_site_icon_url( 128 );
		}
		return '' === (string) $url ? null : (string) $url;
	}
}
