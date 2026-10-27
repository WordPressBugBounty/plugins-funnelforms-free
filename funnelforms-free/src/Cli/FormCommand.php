<?php
/**
 * WP-CLI: wp funnelforms form.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Cli;

use Funnelforms\Application\FormRenderer;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\FormRepository;
use WP_CLI;

defined( 'ABSPATH' ) || exit;

/**
 * Switches forms between the 3.x renderer and the new renderer.
 */
final class FormCommand {

	/**
	 * Shows or changes the renderer of a form.
	 *
	 * ## OPTIONS
	 *
	 * <legacy-id>
	 * : ID of the form in Funnelforms 3 (the id of the shortcode).
	 *
	 * [<renderer>]
	 * : v5 or legacy. Without it, the current renderer and any blockers are shown.
	 *
	 * ## EXAMPLES
	 *
	 *     wp funnelforms form renderer 123 v5
	 *
	 * @param array<int,string> $args Positional arguments.
	 */
	public function renderer( array $args ): void {
		$forms     = new FormRepository();
		$renderers = new FormRenderer( $forms, new MigrationStore( SecretBox::for_site() ) );
		$form      = $forms->by_legacy_id( (int) $args[0] );
		if ( null === $form ) {
			WP_CLI::error( 'No imported form with this ID. Run "wp funnelforms migration run" first.' );
		}
		if ( ! isset( $args[1] ) ) {
			WP_CLI::log( 'Renderer: ' . $form['renderer'] );
			$blockers = $renderers->blockers( $form );
			WP_CLI::log( 'Blockers for v5: ' . ( array() === $blockers ? 'none' : implode( ', ', $blockers ) ) );
			return;
		}
		$blockers = $renderers->switch_to( (int) $form['id'], $args[1] );
		if ( array() !== $blockers ) {
			WP_CLI::error( 'Not switched: ' . implode( ', ', $blockers ) );
		}
		WP_CLI::success( 'Renderer set to ' . $args[1] . '.' );
	}
}
