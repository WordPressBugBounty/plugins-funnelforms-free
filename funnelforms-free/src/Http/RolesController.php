<?php
/**
 * REST routes for rights per role.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Application\Capabilities;

defined( 'ABSPATH' ) || exit;

/**
 * GET funnelforms/v1/roles lists roles with their Funnelforms capabilities; PUT sets them
 * ({"roles": {"editor": ["funnelforms_view_entries"]}}; roles left out stay as they are).
 * Administrators only (manage_options).
 */
final class RolesController {

	/**
	 * Registers the routes.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Route definitions.
	 */
	public static function routes(): void {
		$admin = static fn(): bool => current_user_can( 'manage_options' );
		register_rest_route(
			FormsController::NAMESPACE,
			'/roles',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( self::class, 'index' ),
					'permission_callback' => $admin,
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( self::class, 'update' ),
					'permission_callback' => $admin,
					'args'                => array(
						'roles' => array(
							'type'                 => 'object',
							'required'             => true,
							'additionalProperties' => array(
								'type'  => 'array',
								'items' => array(
									'type' => 'string',
									'enum' => Capabilities::ALL,
								),
							),
						),
					),
				),
			)
		);
	}

	/**
	 * GET roles.
	 */
	public static function index(): \WP_REST_Response {
		$roles = array();
		foreach ( Capabilities::roles() as $slug => $role ) {
			$roles[] = array( 'role' => (string) $slug ) + $role;
		}
		return new \WP_REST_Response(
			array(
				'capabilities' => Capabilities::labels(),
				'roles'        => $roles,
			),
			200
		);
	}

	/**
	 * PUT roles.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function update( \WP_REST_Request $request ): \WP_REST_Response {
		Capabilities::save( (array) $request['roles'] );
		return self::index();
	}
}
