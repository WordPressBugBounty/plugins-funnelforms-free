<?php
/**
 * Section of the Funnelforms page: rights per role.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;

defined( 'ABSPATH' ) || exit;

/**
 * A table of roles and the four Funnelforms capabilities. Only administrators (manage_options)
 * see and change it, so nobody can widen their own rights.
 */
final class RoleRights {

	private const ACTION = 'funnelforms_role_rights';

	/**
	 * Registers the form handler.
	 */
	public static function register(): void {
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle' ) );
	}

	/**
	 * Saves the table.
	 */
	public static function handle(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::ACTION );
		$posted = isset( $_POST['caps'] ) && is_array( $_POST['caps'] ) ? map_deep( wp_unslash( $_POST['caps'] ), 'sanitize_key' ) : array();
		$grants = array();
		foreach ( array_keys( Capabilities::roles() ) as $role ) {
			$grants[ $role ] = array_keys( (array) ( $posted[ $role ] ?? array() ) );
		}
		Capabilities::save( $grants );
		wp_safe_redirect( add_query_arg( 'roles', '1', SettingsPage::url( 'rights', 'ffx-roles' ) ) );
		exit;
	}

	/**
	 * The section.
	 */
	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$labels = Capabilities::labels();
		?>
		<h2 id="ffx-roles"><?php esc_html_e( 'Rights per role', 'funnelforms-free' ); ?></h2>
		<p><?php esc_html_e( 'Who may edit forms, see and export entries and change these settings. Administrators always may. Exporting includes seeing entries.', 'funnelforms-free' ); ?></p>
		<?php if ( isset( $_GET['roles'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only. ?>
			<div class="notice notice-success inline"><p><?php esc_html_e( 'Rights saved.', 'funnelforms-free' ); ?></p></div>
		<?php endif; ?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>">
			<?php wp_nonce_field( self::ACTION ); ?>
			<table class="widefat striped" style="max-width:56rem">
				<thead>
					<tr>
						<th scope="col"><?php esc_html_e( 'Role', 'funnelforms-free' ); ?></th>
						<?php foreach ( $labels as $label ) : ?>
							<th scope="col"><?php echo esc_html( $label ); ?></th>
						<?php endforeach; ?>
					</tr>
				</thead>
				<tbody>
					<?php foreach ( Capabilities::roles() as $slug => $role ) : ?>
						<tr>
							<th scope="row"><?php echo esc_html( $role['name'] ); ?></th>
							<?php foreach ( $labels as $cap => $label ) : ?>
								<td>
									<label>
										<input type="checkbox" name="caps[<?php echo esc_attr( $slug ); ?>][<?php echo esc_attr( $cap ); ?>]" value="1" <?php checked( in_array( $cap, $role['capabilities'], true ) ); ?> <?php disabled( $role['fixed'] ); ?>>
										<span class="screen-reader-text"><?php echo esc_html( $role['name'] . ': ' . $label ); ?></span>
									</label>
								</td>
							<?php endforeach; ?>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
			<?php SettingsPage::save_row( __( 'Save rights', 'funnelforms-free' ) ); ?>
		</form>
		<?php
	}
}
