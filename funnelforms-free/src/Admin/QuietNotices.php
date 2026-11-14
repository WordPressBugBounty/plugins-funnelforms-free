<?php
/**
 * Only the notices of Funnelforms on the Funnelforms pages.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

defined( 'ABSPATH' ) || exit;

/**
 * On every Funnelforms page (the pages of the menu, the builder, the pages of Funnelforms 3 while
 * it is back) the notices of other plugins and themes are not shown: cookie banners asking for a
 * new scan, cache plugins, reviews, sales. What stays:
 *
 * - every notice of Funnelforms itself (5.0 and the 3.x code: any callback whose code lies in this
 *   plugin's folder), such as "Your forms run on Funnelforms 3 again";
 * - the notices of WordPress that matter for the site (CORE): recovery mode after a fatal error,
 *   plugins that failed to load or were switched off, a failed automatic update, a new e-mail
 *   address to confirm, the default password. "A new WordPress version is available" is left to
 *   the dashboard.
 *
 * Right before WordPress prints the notices (in_admin_header) the foreign callbacks are taken off
 * the four notice hooks; the hooks are cleaned once more when they run, for callbacks added late.
 * What is printed is marked as kept (class KEEP). Other plugins also print notices elsewhere in the
 * header (in_admin_header) or insert them with JavaScript; a small script marks those (class
 * FOREIGN) before WordPress moves the notices into the page, and a style hides them.
 *
 * Other pages of the admin (dashboard, plugin list, other plugins) are not touched.
 */
final class QuietNotices {

	/** The hooks WordPress prints notices on. */
	public const HOOKS = array( 'network_admin_notices', 'user_admin_notices', 'admin_notices', 'all_admin_notices' );

	/**
	 * Notices of WordPress that stay.
	 *
	 * @var list<string>
	 */
	public const CORE = array(
		'wp_recovery_mode_nag',
		'paused_plugins_notice',
		'deactivated_plugins_notice',
		'maintenance_nag',
		'site_admin_notice',
		'new_user_email_admin_notice',
		'default_password_nag',
	);

	/** Class on what the kept notices print. */
	public const KEEP = 'ffx-keep';

	/** Class the script gives the notices of other plugins it finds. */
	public const FOREIGN = 'ffx-foreign';

	/** Body class of the pages that show only these notices. */
	public const BODY_CLASS = 'ffx-quiet';

	/**
	 * Output buffer level while a notice hook runs; -1 when none is open.
	 *
	 * @var array<string,int>
	 */
	private static array $buffers = array();

	/**
	 * Hooks: clean the notice hooks right before they run, the body class and the style.
	 */
	public static function register(): void {
		add_action( 'in_admin_header', array( self::class, 'start' ), PHP_INT_MAX );
		add_filter( 'admin_body_class', array( self::class, 'body_class' ) );
		add_action( 'admin_head', array( self::class, 'style' ) );
		add_action( 'admin_footer', array( self::class, 'script' ) );
	}

	/**
	 * Whether the current admin page is a Funnelforms page.
	 */
	public static function applies(): bool {
		global $plugin_page;
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		$ours   = ( null !== $screen && Ui::is_screen( (string) $screen->id ) )
			|| ( is_string( $plugin_page ) && ( str_starts_with( $plugin_page, Menu::SLUG ) || str_starts_with( $plugin_page, 'af2_' ) ) );
		/**
		 * Whether a page shows only the notices of Funnelforms and the important ones of WordPress.
		 *
		 * @param bool $ours Whether the current page is a Funnelforms page.
		 */
		return (bool) apply_filters( 'funnelforms_quiet_notices', $ours );
	}

	/**
	 * Takes the foreign notices off and wraps the notice hooks (in_admin_header, right before
	 * WordPress prints them).
	 */
	public static function start(): void {
		if ( ! self::applies() ) {
			return;
		}
		foreach ( self::HOOKS as $hook ) {
			self::clean( $hook );
			add_action( $hook, array( self::class, 'open' ), PHP_INT_MIN );
			add_action( $hook, array( self::class, 'close' ), PHP_INT_MAX );
		}
	}

	/**
	 * First on a notice hook: cleans it again and collects what the kept callbacks print.
	 */
	public static function open(): void {
		$hook = (string) current_filter();
		self::clean( $hook );
		ob_start();
		self::$buffers[ $hook ] = ob_get_level();
	}

	/**
	 * Last on a notice hook: prints what was collected, marked as kept.
	 */
	public static function close(): void {
		$hook  = (string) current_filter();
		$level = self::$buffers[ $hook ] ?? -1;
		unset( self::$buffers[ $hook ] );
		if ( $level < 1 || ob_get_level() !== $level ) {
			// A callback closed the buffer or opened its own; leave the output as it is.
			return;
		}
		echo self::mark( (string) ob_get_clean() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- printed by the kept callbacks, only marked here.
	}

	/**
	 * Takes every callback off a hook that is neither Funnelforms' nor an important one of WordPress.
	 *
	 * @param string $hook Hook name.
	 */
	public static function clean( string $hook ): void {
		global $wp_filter;
		if ( ! isset( $wp_filter[ $hook ] ) || ! $wp_filter[ $hook ] instanceof \WP_Hook ) {
			return;
		}
		foreach ( $wp_filter[ $hook ]->callbacks as $priority => $callbacks ) {
			foreach ( $callbacks as $callback ) {
				if ( ! self::keeps( $callback['function'], $hook ) ) {
					remove_action( $hook, $callback['function'], $priority );
				}
			}
		}
	}

	/**
	 * Whether a notice callback stays: one of Funnelforms (its code lies in this plugin's folder) or
	 * one of CORE.
	 *
	 * @param mixed  $callback Callback.
	 * @param string $hook     Hook name.
	 */
	public static function keeps( $callback, string $hook = 'admin_notices' ): bool {
		if ( is_string( $callback ) && in_array( $callback, self::CORE, true ) ) {
			$keep = true;
		} else {
			$file = self::file_of( $callback );
			$keep = null !== $file && str_starts_with( wp_normalize_path( $file ), trailingslashit( wp_normalize_path( FUNNELFORMS_PLUGIN_DIR ) ) );
		}
		/**
		 * Whether a notice stays on the Funnelforms pages.
		 *
		 * @param bool   $keep     True for notices of Funnelforms and the important ones of WordPress.
		 * @param mixed  $callback Callback that prints the notice.
		 * @param string $hook     Notice hook.
		 */
		return (bool) apply_filters( 'funnelforms_keep_admin_notice', $keep, $callback, $hook );
	}

	/**
	 * The file a callback is written in; null when it cannot be told.
	 *
	 * @param mixed $callback Callback.
	 */
	public static function file_of( $callback ): ?string {
		try {
			if ( is_string( $callback ) && str_contains( $callback, '::' ) ) {
				$callback = explode( '::', $callback, 2 );
			}
			if ( is_array( $callback ) && 2 === count( $callback ) && ( is_object( $callback[0] ) || is_string( $callback[0] ) ) && is_string( $callback[1] ) ) {
				$reflection = new \ReflectionMethod( $callback[0], $callback[1] );
			} elseif ( $callback instanceof \Closure || is_string( $callback ) ) {
				$reflection = new \ReflectionFunction( $callback );
			} elseif ( is_object( $callback ) && method_exists( $callback, '__invoke' ) ) {
				$reflection = new \ReflectionMethod( $callback, '__invoke' );
			} else {
				return null;
			}
		} catch ( \ReflectionException $e ) {
			return null;
		}
		$file = $reflection->getFileName();
		return false === $file ? null : $file;
	}

	/**
	 * Marks the notices a kept callback printed (every div with a class) so the style lets them through.
	 *
	 * @param string $html Output of the kept callbacks.
	 */
	public static function mark( string $html ): string {
		if ( '' === $html ) {
			return '';
		}
		return (string) preg_replace( '/<div\b([^>]*?)\bclass=(["\'])/i', '<div$1class=$2' . self::KEEP . ' ', $html );
	}

	/**
	 * Adds the body class on the Funnelforms pages.
	 *
	 * @param string $classes Body classes.
	 */
	public static function body_class( string $classes ): string {
		return self::applies() ? $classes . ' ' . self::BODY_CLASS : $classes;
	}

	/**
	 * Hides the notices the script found and, also without JavaScript, notices without the mark
	 * where other plugins put them: in the header and at the top of the page. Notices inside the
	 * page itself (inline, or in the Funnelforms frame) are not touched.
	 */
	public static function style(): void {
		if ( ! self::applies() ) {
			return;
		}
		$notice = ':is(div.notice,div.error,div.updated,div.update-nag,.update-nag)';
		$where  = ':is(#wpcontent,#wpbody,#wpbody-content,#wpbody-content>.wrap)';
		printf(
			'<style id="ffx-quiet-notices">body.%1$s .%2$s,body.%1$s %3$s>%4$s:not(.%5$s,.inline,.below-h2){display:none!important}</style>' . "\n",
			esc_attr( self::BODY_CLASS ),
			esc_attr( self::FOREIGN ),
			$where, // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static selector.
			$notice, // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static selector.
			esc_attr( self::KEEP )
		);
	}

	/**
	 * Marks the notices of other plugins that did not come through the notice hooks: printed in
	 * the header, outside the page, or inserted later with JavaScript. It runs at the end of the
	 * page, before WordPress moves the notices into the page (common.js, when the page is ready),
	 * so it still sees where each notice was printed. Funnelforms inserts no notices with
	 * JavaScript; its pages print theirs inside the page.
	 */
	public static function script(): void {
		if ( ! self::applies() ) {
			return;
		}
		$script = '(function(){var s="div.notice,div.error,div.updated,div.update-nag,.update-nag",k=".' . self::KEEP . ',.inline,.below-h2",f="' . self::FOREIGN . '",b=document.getElementById("wpbody-content"),seen=new WeakSet();'
			. 'function inPage(n){var p=n.parentElement;return !!b&&b.contains(n)&&p!==b&&!(p&&p.parentElement===b&&p.classList.contains("wrap"));}'
			. 'function first(n){seen.add(n);if(!n.matches(k)&&!inPage(n)){n.classList.add(f);}}'
			. 'function later(n){if(seen.has(n)){return;}seen.add(n);if(!n.matches(k)){n.classList.add(f);}}'
			. 'document.querySelectorAll(s).forEach(first);'
			. 'new MutationObserver(function(l){l.forEach(function(m){m.addedNodes.forEach(function(n){if(1!==n.nodeType){return;}if(n.matches(s)){later(n);}n.querySelectorAll(s).forEach(later);});});}).observe(document.body,{childList:true,subtree:true});})();';
		wp_print_inline_script_tag( $script, array( 'id' => 'ffx-quiet-notices-js' ) );
	}
}
