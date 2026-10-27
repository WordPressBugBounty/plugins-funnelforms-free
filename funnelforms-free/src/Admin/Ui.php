<?php
/**
 * Frame and small parts shared by the Funnelforms admin pages.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Every Funnelforms page (Overview, Forms, Entries, Statistics, migration, Settings, Account,
 * Support) sits in the same frame: a top bar with the brand mark, the page's name and its main
 * actions, then the page with its title and one-line lead, all of the same width, in the brand's
 * look (assets/admin/admin.css). The lists of forms and entries are screens of the admin app
 * (packages/builder-ui, ui/Frame.tsx), which renders the same markup; until it starts, the page
 * shows the frame printed here (placeholder()).
 */
final class Ui {

	public const HANDLE = 'funnelforms-admin';

	/** Support forum of Funnelforms Free on wordpress.org. */
	public const FREE_SUPPORT_URL = 'https://wordpress.org/support/plugin/funnelforms-free/';

	/** Help center of Funnelforms. */
	public const HELP_CENTER_URL = 'https://help.funnelforms.io/';

	/**
	 * Hook suffixes of the pages that use the frame.
	 *
	 * @var list<string>
	 */
	private static array $screens = array();

	/**
	 * Where people get help: the support page of Funnelforms Pro, the support forum on
	 * wordpress.org in Funnelforms Free.
	 */
	public static function support_url(): string {
		$page = Edition::pro( SupportPage::class );
		return null === $page ? self::FREE_SUPPORT_URL : admin_url( 'admin.php?page=' . $page::SLUG );
	}

	/**
	 * Address of the help center.
	 */
	public static function help_center_url(): string {
		/**
		 * Address of the Funnelforms help center.
		 *
		 * @param string $url Address.
		 */
		return (string) apply_filters( 'funnelforms_help_center_url', self::HELP_CENTER_URL );
	}

	/**
	 * A link that opens another website in a new tab.
	 *
	 * @param string $label Text.
	 * @param string $url   Address.
	 * @param string $kind  secondary, primary or ghost.
	 */
	public static function external_button( string $label, string $url, string $kind = 'secondary' ): string {
		$class = 'ffx-btn' . ( 'secondary' === $kind ? '' : ' ffx-btn--' . sanitize_html_class( $kind ) );
		return '<a class="' . esc_attr( $class ) . '" href="' . esc_url( $url ) . '" target="_blank" rel="noopener">' . self::icon( 'external' ) . '<span>' . esc_html( $label ) . '</span><span class="screen-reader-text"> ' . esc_html__( '(opens in a new tab)', 'funnelforms-free' ) . '</span></a>';
	}

	/**
	 * Hooks: styles and the body class on the pages that use the frame.
	 */
	public static function register(): void {
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
		add_filter( 'admin_body_class', array( self::class, 'body_class' ) );
	}

	/**
	 * Marks a page (by its hook suffix) as one that uses the frame.
	 *
	 * @param string|false $hook Hook suffix from add_menu_page / add_submenu_page.
	 */
	public static function screen( $hook ): void {
		if ( is_string( $hook ) && '' !== $hook ) {
			self::$screens[] = $hook;
		}
	}

	/**
	 * Whether the current admin page uses the frame.
	 *
	 * @param string $hook Hook suffix of the current page.
	 */
	public static function is_screen( string $hook ): bool {
		return in_array( $hook, self::$screens, true );
	}

	/**
	 * Loads the styles on the pages that use the frame.
	 *
	 * @param string $hook Hook suffix of the current admin page.
	 */
	public static function enqueue( string $hook ): void {
		if ( self::is_screen( $hook ) ) {
			self::styles();
		}
	}

	/**
	 * Loads the styles (also for pages that render the frame on their own).
	 */
	public static function styles(): void {
		wp_enqueue_style( self::HANDLE, plugins_url( 'assets/admin/admin.css', FUNNELFORMS_PLUGIN_FILE ), array(), FUNNELFORMS_ASSET_VERSION );
	}

	/**
	 * Adds the body class that calms the WordPress chrome around the frame.
	 *
	 * @param string $classes Body classes.
	 */
	public static function body_class( string $classes ): string {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( null !== $screen && self::is_screen( (string) $screen->id ) ) {
			$classes .= ' ffx-screen';
		}
		return $classes;
	}

	/**
	 * Opens the frame: top bar, then the page with its heading.
	 *
	 * @param array{title:string,lead?:string,actions?:string,narrow?:bool,head?:bool,notices?:bool} $args Title, lead text, HTML of the main actions (escaped by the caller), narrow (no longer used: every page has the same width), show the heading, take the notices of WordPress into the page.
	 */
	public static function open( array $args ): void {
		self::styles();
		?>
		<div class="ffx-app">
			<header class="ffx-top">
				<a class="ffx-top__brand" href="<?php echo esc_url( admin_url( 'admin.php?page=' . Menu::SLUG ) ); ?>">
					<span class="ffx-top__mark"><?php echo self::mark(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
					<span>Funnelforms</span>
				</a>
				<span class="ffx-top__sep" aria-hidden="true"></span>
				<span class="ffx-top__title"><?php echo esc_html( $args['title'] ); ?></span>
				<?php if ( ! empty( $args['actions'] ) ) : ?>
					<div class="ffx-top__actions"><?php echo $args['actions']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped by the caller. ?></div>
				<?php endif; ?>
			</header>
			<main class="ffx-page">
				<?php if ( ! isset( $args['head'] ) || $args['head'] ) : ?>
					<div class="ffx-page__head">
						<div>
							<h1 class="ffx-page__title"><?php echo esc_html( $args['title'] ); ?></h1>
							<?php if ( ! empty( $args['lead'] ) ) : ?>
								<p class="ffx-page__lead"><?php echo esc_html( $args['lead'] ); ?></p>
							<?php endif; ?>
						</div>
					</div>
				<?php endif; ?>
				<?php if ( ! isset( $args['notices'] ) || $args['notices'] ) : ?>
					<?php
					// WordPress moves the notices of other plugins here, into the page.
					?>
					<hr class="wp-header-end" hidden>
				<?php endif; ?>
		<?php
	}

	/**
	 * The frame of a page of the admin app until the app has started: top bar, title and lead.
	 * The app replaces it with the same frame and its content.
	 *
	 * @param string $title Name of the page.
	 * @param string $lead  Line below the title.
	 */
	public static function placeholder( string $title, string $lead ): void {
		self::open(
			array(
				'title'   => $title,
				'lead'    => $lead,
				// The app replaces the page; notices stay above it.
				'notices' => false,
			)
		);
		echo '<div class="ffx-card ffx-placeholder" aria-busy="true"></div>';
		self::close();
	}

	/**
	 * Closes the frame.
	 */
	public static function close(): void {
		echo '</main></div>';
	}

	/**
	 * A link styled as a button.
	 *
	 * @param string $label Text.
	 * @param string $url   Address.
	 * @param string $kind  primary, secondary or ghost.
	 * @param string $icon  Icon name (see icon()), or empty.
	 */
	public static function button( string $label, string $url, string $kind = 'secondary', string $icon = '' ): string {
		$class = 'ffx-btn' . ( 'secondary' === $kind ? '' : ' ffx-btn--' . sanitize_html_class( $kind ) );
		return '<a class="' . esc_attr( $class ) . '" href="' . esc_url( $url ) . '">' . ( '' === $icon ? '' : self::icon( $icon ) ) . '<span>' . esc_html( $label ) . '</span></a>';
	}

	/**
	 * A small coloured label.
	 *
	 * @param string $label Text.
	 * @param string $tone  success, warning, danger, info or neutral.
	 */
	public static function badge( string $label, string $tone = 'neutral' ): string {
		$class = 'ffx-badge' . ( 'neutral' === $tone ? '' : ' ffx-badge--' . sanitize_html_class( $tone ) );
		return '<span class="' . esc_attr( $class ) . '">' . esc_html( $label ) . '</span>';
	}

	/**
	 * Tabs that are links (one page, a query argument per tab).
	 *
	 * @param array<string,array{label:string,icon?:string}> $tabs    Key => label and icon.
	 * @param string                                         $current Current key.
	 * @param string                                         $base    Address without the tab.
	 * @param string                                         $arg     Query argument.
	 */
	public static function tabs( array $tabs, string $current, string $base, string $arg = 'tab' ): void {
		echo '<nav class="ffx-tabs" aria-label="' . esc_attr__( 'Sections', 'funnelforms-free' ) . '">';
		foreach ( $tabs as $key => $tab ) {
			printf(
				'<a href="%1$s"%2$s>%3$s<span>%4$s</span></a>',
				esc_url( add_query_arg( $arg, $key, $base ) ),
				$key === $current ? ' aria-current="page"' : '',
				empty( $tab['icon'] ) ? '' : self::icon( $tab['icon'] ), // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG.
				esc_html( $tab['label'] )
			);
		}
		echo '</nav>';
	}

	/**
	 * The brand mark (the funnel F), coloured by currentColor.
	 */
	public static function mark(): string {
		return '<svg viewBox="0 0 303.1 262.42" aria-hidden="true" focusable="false"><polygon fill="currentColor" points="303.1 0 0 0 32.93 56.99 55.38 95.86 88.41 153.16 151.55 262.42 184.68 205.12 154.67 153.16 214.69 153.16 247.72 95.86 121.54 95.86 99.19 56.99 270.17 56.99 303.1 0"/></svg>';
	}

	/**
	 * The brand mark as a data address for the WordPress menu (WordPress colours it).
	 */
	public static function menu_icon(): string {
		$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 303.1 262.42"><polygon fill="black" points="303.1 0 0 0 32.93 56.99 55.38 95.86 88.41 153.16 151.55 262.42 184.68 205.12 154.67 153.16 214.69 153.16 247.72 95.86 121.54 95.86 99.19 56.99 270.17 56.99 303.1 0"/></svg>';
		return 'data:image/svg+xml;base64,' . base64_encode( $svg ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- the menu takes the icon as a data address.
	}

	/**
	 * A line icon (Lucide, ISC licence), 24 units, coloured by currentColor.
	 *
	 * @param string $name Icon name.
	 */
	public static function icon( string $name ): string {
		$paths = array(
			'home'       => '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
			'form'       => '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10"/><path d="M7 12h10"/><path d="M7 17h6"/>',
			'inbox'      => '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
			'eye'        => '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
			'chart'      => '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
			'settings'   => '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
			'user'       => '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
			'lifebuoy'   => '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
			'plus'       => '<path d="M5 12h14"/><path d="M12 5v14"/>',
			'arrow'      => '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
			'check'      => '<path d="M20 6 9 17l-5-5"/>',
			'sparkles'   => '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
			'external'   => '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
			'calendar'   => '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
			'shield'     => '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
			'mail'       => '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
			'code'       => '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
			'activity'   => '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
			'key'        => '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
			'history'    => '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
			'layers'     => '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
			'undo'       => '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
			'download'   => '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
			'database'   => '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
			'monitor'    => '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
			'phone'      => '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
			'tablet'     => '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 18h.01"/>',
			'palette'    => '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.12a1.64 1.64 0 0 1 1.67-1.67h2a5.56 5.56 0 0 0 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>',
			'copy'       => '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
			'back'       => '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
			'branch'     => '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
			'globe'      => '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
			'bell'       => '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
			'link'       => '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
			'card'       => '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
			'calculator' => '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8"/><path d="M16 14v4"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
			'rocket'     => '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
		);
		if ( ! isset( $paths[ $name ] ) ) {
			return '';
		}
		return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' . $paths[ $name ] . '</svg>';
	}
}
