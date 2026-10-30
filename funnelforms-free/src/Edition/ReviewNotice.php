<?php
/**
 * The one request of Funnelforms Free for a review on wordpress.org.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Edition;

use Funnelforms\Application\Capabilities;
use Funnelforms\Compat\Migration\Migrator;
use Funnelforms\Infrastructure\Repository\EntryRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Once the site has 10 complete entries, people who can change the settings see a request for a
 * review on the dashboard, the plugin list and the Funnelforms pages. Two links answer it, "Write
 * a review" (opens the reviews of wordpress.org in a new tab) and "No, thanks"; either one ends it
 * for the whole site, for good. Nothing is promised for a review and nothing asks for a rating.
 * Not shown while a notice about the move to version 5 is up (FreeSite::notices()).
 */
final class ReviewNotice {

	/** Where reviews of Funnelforms Free are written. */
	public const URL = 'https://wordpress.org/support/plugin/funnelforms-free/reviews/#new-post';

	/** Site option: how the request was answered ('review' or 'no') and when; unset while open. */
	public const OPTION = 'funnelforms_free_review';

	/** Action of both links on admin-post.php. */
	public const ACTION = 'funnelforms_free_review';

	/** Complete entries before the request shows. */
	public const MIN_ENTRIES = 10;

	/**
	 * Registers the hooks.
	 */
	public static function register(): void {
		add_action( 'admin_notices', array( self::class, 'notice' ) );
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle' ) );
	}

	/**
	 * Whether the request is open: nobody answered it yet.
	 */
	public static function open(): bool {
		return false === get_option( self::OPTION );
	}

	/**
	 * The request, on the dashboard, the plugin list and the Funnelforms pages.
	 */
	public static function notice(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) || ! self::open() ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		$here   = null === $screen ? '' : (string) $screen->id;
		if ( ! in_array( $here, array( 'dashboard', 'plugins' ), true ) && ! str_contains( $here, 'funnelforms' ) ) {
			return;
		}
		if ( 'running' === Migrator::state()['status'] || array() !== FreeSite::stayed() || ! ( new EntryRepository() )->has_complete( self::MIN_ENTRIES ) ) {
			return;
		}
		?>
		<div class="notice notice-info ffx-review-notice" style="border-left-color:#6a30f5">
			<p>
				<strong><?php esc_html_e( 'Do you like Funnelforms?', 'funnelforms-free' ); ?></strong>
				<br><?php esc_html_e( 'Your forms are collecting entries. If Funnelforms helps you, a short review on wordpress.org helps other people find it.', 'funnelforms-free' ); ?>
			</p>
			<p style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
				<a class="button button-primary" href="<?php echo esc_url( self::link( 'review' ) ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'Write a review', 'funnelforms-free' ); ?></a>
				<a href="<?php echo esc_url( self::link( 'no' ) ); ?>"><?php esc_html_e( 'No, thanks', 'funnelforms-free' ); ?></a>
			</p>
		</div>
		<?php
	}

	/**
	 * Address of an answer, with its nonce.
	 *
	 * @param string $answer 'review' or 'no'.
	 */
	public static function link( string $answer ): string {
		$url = add_query_arg(
			array(
				'action' => self::ACTION,
				'answer' => $answer,
			),
			admin_url( 'admin-post.php' )
		);
		return wp_nonce_url( $url, self::ACTION );
	}

	/**
	 * Stores the answer, then goes to the reviews on wordpress.org or back to the page.
	 */
	public static function handle(): void {
		if ( ! current_user_can( Capabilities::MANAGE_SETTINGS ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::ACTION );
		$answer = isset( $_GET['answer'] ) && 'review' === $_GET['answer'] ? 'review' : 'no';
		update_option(
			self::OPTION,
			array(
				'answer' => $answer,
				'at'     => time(),
			),
			false
		);
		if ( 'review' === $answer ) {
			add_filter( 'allowed_redirect_hosts', array( self::class, 'allow_wordpress_org' ) );
			wp_safe_redirect( self::URL );
			exit;
		}
		wp_safe_redirect( wp_get_referer() ? wp_get_referer() : admin_url() );
		exit;
	}

	/**
	 * Lets wp_safe_redirect() go to wordpress.org for the review.
	 *
	 * @param mixed $hosts Allowed hosts.
	 * @return string[]
	 */
	public static function allow_wordpress_org( $hosts ): array {
		$hosts   = is_array( $hosts ) ? $hosts : array();
		$hosts[] = 'wordpress.org';
		return $hosts;
	}
}
