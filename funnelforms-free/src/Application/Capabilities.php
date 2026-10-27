<?php
/**
 * Rights per role: who edits forms, sees and exports entries and changes settings.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Infrastructure\Crypto\SecretBox;

defined( 'ABSPATH' ) || exit;

/**
 * Four WordPress capabilities. Users who can manage options (administrators) always have all
 * of them, without a change to their role; other roles get them on the Funnelforms page or
 * through the roles API. Exporting entries includes seeing them. The 3.x admin pages keep their
 * own check (manage_options).
 */
final class Capabilities {

	/** Create and change forms (builder, renderer switch). */
	public const EDIT_FORMS = 'funnelforms_edit_forms';

	/** See entries, their files and statistics, use the app, be assigned entries. */
	public const VIEW_ENTRIES = 'funnelforms_view_entries';

	/** Export entries as CSV. */
	public const EXPORT_ENTRIES = 'funnelforms_export_entries';

	/** Change the plugin's settings (spam protection, mail, webhooks, automation tokens). */
	public const MANAGE_SETTINGS = 'funnelforms_manage_settings';

	public const ALL = array( self::EDIT_FORMS, self::VIEW_ENTRIES, self::EXPORT_ENTRIES, self::MANAGE_SETTINGS );

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_filter( 'user_has_cap', array( self::class, 'grant_admins' ), 10, 4 );
		// Role checks too, so user queries by capability find administrators.
		add_filter( 'role_has_cap', array( self::class, 'grant_admin_roles' ) );
	}

	/**
	 * Gives roles that can manage options all Funnelforms capabilities.
	 *
	 * @param array<string,bool> $capabilities Capabilities of the role.
	 * @return array<string,bool>
	 */
	public static function grant_admin_roles( $capabilities ): array {
		return self::grant_admins( $capabilities, null, null, null );
	}

	/**
	 * Gives users who can manage options all Funnelforms capabilities.
	 *
	 * @param array<string,bool> $allcaps Capabilities of the user.
	 * @param mixed              $caps    Requested primitive capabilities.
	 * @param mixed              $args    Arguments of the check.
	 * @param mixed              $user    User.
	 * @return array<string,bool>
	 */
	public static function grant_admins( $allcaps, $caps, $args, $user ): array {
		unset( $caps, $args, $user );
		$allcaps = (array) $allcaps;
		if ( ! empty( $allcaps['manage_options'] ) ) {
			foreach ( self::ALL as $cap ) {
				$allcaps[ $cap ] = true;
			}
		}
		return $allcaps;
	}

	/**
	 * Readable names of the capabilities.
	 *
	 * @return array<string,string>
	 */
	public static function labels(): array {
		return array(
			self::EDIT_FORMS      => __( 'Edit forms', 'funnelforms-free' ),
			self::VIEW_ENTRIES    => __( 'See entries', 'funnelforms-free' ),
			self::EXPORT_ENTRIES  => __( 'Export entries', 'funnelforms-free' ),
			self::MANAGE_SETTINGS => __( 'Change settings', 'funnelforms-free' ),
		);
	}

	/**
	 * Roles with the Funnelforms capabilities each has. Roles that can manage options are marked
	 * fixed: they have all of them.
	 *
	 * @return array<string,array{name:string,fixed:bool,capabilities:string[]}>
	 */
	public static function roles(): array {
		$out = array();
		foreach ( wp_roles()->role_objects as $slug => $role ) {
			$fixed        = $role->has_cap( 'manage_options' );
			$out[ $slug ] = array(
				'name'         => translate_user_role( (string) ( wp_roles()->role_names[ $slug ] ?? $slug ) ),
				'fixed'        => $fixed,
				'capabilities' => $fixed ? self::ALL : array_values( array_filter( self::ALL, array( $role, 'has_cap' ) ) ),
			);
		}
		return $out;
	}

	/**
	 * Sets the Funnelforms capabilities of roles. Roles that can manage options and unknown roles
	 * are left alone; exporting brings seeing entries with it.
	 *
	 * @param array<string,array<int,mixed>> $grants Role slug => capabilities it should have.
	 * @return array<string,string[]> What changed: role slug => its capabilities now.
	 */
	public static function save( array $grants ): array {
		$changed = array();
		foreach ( $grants as $slug => $caps ) {
			$role = get_role( (string) $slug );
			if ( null === $role || $role->has_cap( 'manage_options' ) ) {
				continue;
			}
			$caps = array_values( array_intersect( self::ALL, array_map( 'strval', (array) $caps ) ) );
			if ( in_array( self::EXPORT_ENTRIES, $caps, true ) && ! in_array( self::VIEW_ENTRIES, $caps, true ) ) {
				$caps[] = self::VIEW_ENTRIES;
			}
			$before = array_values( array_filter( self::ALL, array( $role, 'has_cap' ) ) );
			foreach ( self::ALL as $cap ) {
				if ( in_array( $cap, $caps, true ) ) {
					$role->add_cap( $cap );
				} else {
					$role->remove_cap( $cap );
				}
			}
			$after = array_values( array_intersect( self::ALL, $caps ) );
			if ( $before !== $after ) {
				$changed[ (string) $slug ] = $after;
			}
		}
		if ( array() !== $changed ) {
			( new MigrationStore( SecretBox::for_site() ) )->audit(
				'role_capabilities_changed',
				'site',
				'',
				array(
					'user'  => get_current_user_id(),
					'roles' => $changed,
				)
			);
		}
		return $changed;
	}
}
