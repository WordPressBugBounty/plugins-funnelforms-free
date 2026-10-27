<?php
/**
 * REST routes of the lead stages (the columns of the entries board).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Http;

use Funnelforms\Application\LeadStages;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Infrastructure\Crypto\SecretBox;

defined( 'ABSPATH' ) || exit;

/**
 * Routes under funnelforms/v1 (Funnelforms Pro, registered by EntriesController):
 *
 *   GET entries/stages  the stages in their order: key, name, tone, standard (the name is the
 *                       standard one, in the reader's language), locked (cannot be deleted) and
 *                       entries (how many entries are in it)
 *   PUT entries/stages  stages (the whole list in its new order; key left out for a new stage),
 *                       moveTo (deleted key => key of the stage that takes its entries)
 *
 * Reading needs the entries capability, as the board does; changing the stages changes them for
 * everyone, so it needs the right to edit forms as well. The WordPress REST nonce comes with every
 * request of the admin app.
 */
final class LeadStagesController {

	/**
	 * Route definitions.
	 */
	public static function routes(): void {
		register_rest_route(
			FormsController::NAMESPACE,
			'/entries/stages',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( self::class, 'index' ),
					'permission_callback' => array( EntriesController::class, 'allowed' ),
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( self::class, 'update' ),
					'permission_callback' => array( self::class, 'may_change' ),
					'args'                => array(
						'stages' => array(
							'type'     => 'array',
							'required' => true,
							'minItems' => 1,
							'maxItems' => LeadStages::MAX,
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'key'  => array(
										'type'    => 'string',
										'pattern' => LeadStages::KEY_PATTERN,
									),
									'name' => array(
										'type'      => 'string',
										'minLength' => 1,
										'maxLength' => 200,
									),
									'tone' => array(
										'type' => 'string',
										'enum' => LeadStages::TONES,
									),
								),
								'required'   => array( 'name' ),
							),
						),
						'moveTo' => array(
							'type'                 => 'object',
							'description'          => 'Key of a deleted stage => key of the stage that takes its entries; needed for every deleted stage with entries.',
							'additionalProperties' => array(
								'type'    => 'string',
								'pattern' => LeadStages::KEY_PATTERN,
							),
						),
					),
				),
			)
		);
	}

	/**
	 * Whether the current user may change the stages of the site.
	 */
	public static function may_change(): bool {
		return EntriesController::allowed() && current_user_can( \Funnelforms\Application\Capabilities::EDIT_FORMS );
	}

	/**
	 * The stages with the number of entries in each.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function list(): array {
		$counts = LeadStages::counts();
		return array_map(
			static fn( array $stage ): array => $stage + array( 'entries' => $counts[ $stage['key'] ] ?? 0 ),
			LeadStages::all()
		);
	}

	/**
	 * GET entries/stages.
	 */
	public static function index(): \WP_REST_Response {
		return new \WP_REST_Response( self::list(), 200 );
	}

	/**
	 * PUT entries/stages.
	 *
	 * @param \WP_REST_Request $request Request.
	 */
	public static function update( \WP_REST_Request $request ): \WP_REST_Response {
		$before = LeadStages::stored();
		$result = LeadStages::save( $request['stages'], $request['moveTo'] ?? array() );
		if ( ! $result['ok'] ) {
			$messages = array(
				'no_stages'         => __( 'Keep at least one stage.', 'funnelforms-free' ),
				/* translators: %d: most stages */
				'too_many_stages'   => sprintf( __( 'The board has room for %d stages.', 'funnelforms-free' ), LeadStages::MAX ),
				'empty_name'        => __( 'Every stage needs a name.', 'funnelforms-free' ),
				'duplicate_stage'   => __( 'A stage appears twice.', 'funnelforms-free' ),
				'stage_locked'      => __( 'New entries arrive in this stage, so it stays. Rename it as you like.', 'funnelforms-free' ),
				'stage_has_entries' => __( 'Choose the stage that takes the entries of the deleted stage.', 'funnelforms-free' ),
			);
			return new \WP_REST_Response(
				array(
					'code'    => $result['code'],
					'message' => $messages[ $result['code'] ] ?? $result['code'],
					// The stage the problem is about.
					'stage'   => $result['stage'] ?? null,
					'data'    => array( 'status' => 400 ),
				),
				400
			);
		}
		$after = LeadStages::stored();
		if ( $after !== $before ) {
			// Who changed the pipeline of everyone, and how many entries changed stage with it.
			( new MigrationStore( SecretBox::for_site() ) )->audit(
				'lead_stages_changed',
				'site',
				'lead_stages',
				array(
					'user'    => get_current_user_id(),
					'stages'  => array_column( $after, 'key' ),
					'removed' => array_values( array_diff( array_column( $before, 'key' ), array_column( $after, 'key' ) ) ),
					'moved'   => (int) ( $result['moved'] ?? 0 ),
				)
			);
		}
		return new \WP_REST_Response( self::list(), 200 );
	}
}
