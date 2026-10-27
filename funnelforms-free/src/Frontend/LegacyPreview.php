<?php
/**
 * A form as Funnelforms 3 shows it, for the side-by-side preview of the setup assistant.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Frontend;

use Funnelforms\Compat\Legacy\LegacyRepository;

defined( 'ABSPATH' ) || exit;

/**
 * A bare page of the website with only the 3.x form, in its preview mode, for administrators.
 * The 3.x code renders it unchanged; the page only frames it.
 */
final class LegacyPreview {

	public const QUERY = 'funnelforms_legacy_preview';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'template_redirect', array( self::class, 'handle' ), 0 );
	}

	/**
	 * Address of the preview of a 3.x form.
	 *
	 * @param int $legacy_id ID of the 3.x form.
	 */
	public static function url( int $legacy_id ): string {
		return add_query_arg(
			array(
				self::QUERY => $legacy_id,
				'_wpnonce'  => wp_create_nonce( self::QUERY . $legacy_id ),
			),
			home_url( '/' )
		);
	}

	/**
	 * Shows the page.
	 */
	public static function handle(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- verified right below.
		if ( ! isset( $_GET[ self::QUERY ] ) ) {
			return;
		}
		$id    = absint( $_GET[ self::QUERY ] );
		$nonce = isset( $_GET['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ) : '';
		// phpcs:enable WordPress.Security.NonceVerification.Recommended
		if ( ! current_user_can( 'manage_options' ) || false === wp_verify_nonce( $nonce, self::QUERY . $id ) || LegacyRepository::FORM !== get_post_type( $id ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		show_admin_bar( false );
		nocache_headers();
		header( 'X-Frame-Options: SAMEORIGIN' );
		// Rendered first, so the scripts it enqueues are printed in the head and footer.
		$form = do_shortcode( '[funnelforms id="' . $id . '" preview="true"]' );
		?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
		<?php wp_head(); ?>
<style>html,body{margin:0!important;background:#fff}body{padding:24px 16px}</style>
</head>
<body class="funnelforms-legacy-preview">
		<?php
		echo $form; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- markup of the 3.x renderer.
		wp_footer();
		?>
</body>
</html>
		<?php
		exit;
	}
}
