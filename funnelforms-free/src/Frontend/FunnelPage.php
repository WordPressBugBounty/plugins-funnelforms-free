<?php
/**
 * A form on a page of its own: /funnelforms/<slug>, or /?funnelforms=<slug> without pretty permalinks.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

use Funnelforms\Application\SubmitEntry;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * The direct link of Funnelforms 3 and 4 for forms of this plugin: a published form with a slug
 * (forms.public_slug, set in the builder) answers under /funnelforms/<slug> with a page that has
 * only the form, the site's head and footer (scripts, styles, consent tools) and no theme
 * template. 3.x forms keep their links through 3.x (frontend/funnel-link.php), which answers the
 * same addresses later; a slug is never given twice across both. When the 3.x code is not loaded,
 * the link of a moved 3.x form shows the form that took it over. The same page answers under
 * /?funnelforms=<slug>, which reaches WordPress without pretty permalinks and on servers that do
 * not pass /funnelforms/<slug> to WordPress (Apache without the .htaccess of WordPress); with plain
 * permalinks it is the form's address.
 */
final class FunnelPage {

	/** Path below the site address. */
	public const PATH = 'funnelforms';

	/** Parameter of the address that works without pretty permalinks. */
	public const PARAM = 'funnelforms';

	/**
	 * Registers the handler, before 3.x looks at the same address.
	 */
	public static function register(): void {
		add_action( 'template_redirect', array( self::class, 'handle' ), 0 );
	}

	/**
	 * Answers /funnelforms/<slug> and /?funnelforms=<slug> of a published form.
	 */
	public static function handle(): void {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
		$html = self::page( self::slug( $uri ) );
		if ( null === $html ) {
			return;
		}
		echo $html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- the renderer's markup and WordPress's own head and footer.
		exit;
	}

	/**
	 * Address of a form's page: /funnelforms/<slug>, or the address with the parameter when the
	 * site uses plain permalinks.
	 *
	 * @param string $slug Slug.
	 */
	public static function url( string $slug ): string {
		return self::pretty() ? home_url( '/' . self::PATH . '/' . $slug ) : self::fallback_url( $slug );
	}

	/**
	 * Address of a form's page that reaches WordPress on every server: /?funnelforms=<slug>.
	 *
	 * @param string $slug Slug.
	 */
	public static function fallback_url( string $slug ): string {
		return add_query_arg( self::PARAM, $slug, home_url( '/' ) );
	}

	/**
	 * Whether the site uses pretty permalinks.
	 */
	public static function pretty(): bool {
		return '' !== (string) get_option( 'permalink_structure' );
	}

	/**
	 * Cleans a slug as given in the builder: lowercase letters, digits and dashes, at most 100.
	 *
	 * @param string $value Value.
	 */
	public static function clean( string $value ): string {
		return substr( trim( sanitize_title( $value ), '-' ), 0, 100 );
	}

	/**
	 * Slug of a request address under this site: /funnelforms/<slug>, or the front page (also
	 * /index.php) with ?funnelforms=<slug>; null for other addresses.
	 *
	 * @param string $uri Request URI.
	 */
	public static function slug( string $uri ): ?string {
		$path = rawurldecode( (string) wp_parse_url( $uri, PHP_URL_PATH ) );
		$base = rtrim( (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH ), '/' );
		if ( 1 === preg_match( '#^' . preg_quote( $base, '#' ) . '/' . self::PATH . '/([a-z0-9][a-z0-9-]{0,99})/?$#', $path, $m ) ) {
			return $m[1];
		}
		if ( ! in_array( $path, array( $base, $base . '/', $base . '/index.php' ), true ) ) {
			return null;
		}
		parse_str( (string) wp_parse_url( $uri, PHP_URL_QUERY ), $query );
		$slug = $query[ self::PARAM ] ?? null;
		return is_string( $slug ) && 1 === preg_match( '/^[a-z0-9][a-z0-9-]{0,99}$/', $slug ) ? $slug : null;
	}

	/**
	 * The whole page of the form with this slug; null when no published form has it.
	 *
	 * @param string|null $slug Slug.
	 */
	public static function page( ?string $slug ): ?string {
		if ( null === $slug || ! Renderer::available() ) {
			return null;
		}
		$forms = new FormRepository();
		$form  = $forms->by_slug( $slug );
		if ( null === $form && false === has_action( 'template_redirect', 'af2_funnel_link_interceptor' ) ) {
			// Without the 3.x code the funnel link of a 3.x form leads to the form that took it over.
			$form = $forms->by_legacy_slug( $slug );
		}
		$document = null === $form ? null : SubmitEntry::shown_document( $forms, $form );
		if ( null === $document ) {
			return null;
		}
		global $wp_query;
		if ( $wp_query instanceof \WP_Query ) {
			$wp_query->is_404 = false;
		}
		status_header( 200 );
		return self::html( $form, $document );
	}

	/**
	 * The page around one form: the site's head and footer and the form. In a frame (the embed
	 * code for other websites, ExternalEmbed) the page has no background and no space around the
	 * form, and tells the website around it its height.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Shown document.
	 * @param bool                $frame    Whether the page is shown in a frame of another website.
	 */
	public static function html( array $form, array $document, bool $frame = false ): string {
		// The form first, so its scripts and styles are enqueued for the head and footer.
		$body   = Renderer::render( $form, $document );
		$locale = Renderer::locale( $document );
		$style  = $frame
			? 'html,body.ffx-funnel-page{margin:0!important;padding:0!important;background:transparent!important}.ffx-funnel-page__form{box-sizing:border-box;width:100%;padding:1px 0}'
			: 'body.ffx-funnel-page{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--ffx-page-background,#f6f6f8)}.ffx-funnel-page__form{box-sizing:border-box;width:100%;max-width:960px;padding:24px 16px}';
		ob_start();
		?>
<!DOCTYPE html>
<html lang="<?php echo esc_attr( str_replace( '_', '-', $locale ) ); ?>">
<head>
	<meta charset="<?php echo esc_attr( get_bloginfo( 'charset' ) ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
		<?php if ( ! current_theme_supports( 'title-tag' ) ) : ?>
		<title><?php echo esc_html( wp_get_document_title() ); ?></title>
	<?php endif; ?>
		<?php wp_head(); ?>
	<style><?php echo $style; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- fixed CSS above. ?></style>
</head>
<body class="ffx-funnel-page<?php echo $frame ? ' ffx-funnel-page--frame' : ''; ?>">
	<main class="ffx-funnel-page__form">
		<?php echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- markup of the renderer, escaped there. ?>
	</main>
		<?php wp_footer(); ?>
		<?php
		if ( $frame ) {
			// The height of the form for embed.js on the website around the frame; nothing else leaves the frame.
			echo wp_get_inline_script_tag( "(function(){var m=document.querySelector('.ffx-funnel-page__form'),l=0;if(!m||window.parent===window){return;}function s(){var h=Math.ceil(m.getBoundingClientRect().height);if(h!==l){l=h;window.parent.postMessage({funnelforms:'height',height:h},'*');}}if(window.ResizeObserver){new ResizeObserver(s).observe(m);}else{setInterval(s,500);}window.addEventListener('load',s);s();})();" ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- fixed script.
		}
		?>
</body>
</html>
		<?php
		return (string) ob_get_clean();
	}
}
