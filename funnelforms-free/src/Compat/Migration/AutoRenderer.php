<?php
/**
 * Moves every imported form whose check passed to the new renderer on its own.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Application\FormRenderer;
use Funnelforms\Application\SetupFlow;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Safety\Rollback;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * The Funnelforms 3 renderer cannot be used with a keyboard or a screen reader, so a form whose
 * import was checked identical runs on the new renderer without anyone having to move it. One
 * site setting turns this off; switching it off puts back exactly the forms it moved.
 *
 * Only forms whose check passed and that nothing else keeps on 3.x (FormRenderer::blockers())
 * move. A form someone sent back to Funnelforms 3 by hand stays there ("pinned") until it is moved
 * by hand again. Nothing moves while the site went back to Funnelforms 3 or before the update
 * assistant is through, which asks for every form itself.
 */
final class AutoRenderer {

	/** "on" or "off"; empty means the default. */
	public const OPTION = 'funnelforms_auto_renderer';

	/** IDs of the forms this moved, so switching it off can put back exactly these. */
	public const FORMS = 'funnelforms_auto_renderer_forms';

	/** IDs of the forms someone kept on Funnelforms 3 by hand. */
	public const PINNED = 'funnelforms_renderer_pinned';

	/** The default while the setting was never saved. Change here to ship it switched off. */
	private const DEFAULT_ON = true;

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'funnelforms_migration_finished', array( self::class, 'after_run' ) );
		add_action( 'funnelforms_rollforward', array( self::class, 'after_run' ) );
		add_action( 'funnelforms_form_way_back', array( self::class, 'pin' ) );
	}

	/**
	 * Whether checked forms move on their own.
	 */
	public static function enabled(): bool {
		$value = get_option( self::OPTION, '' );
		if ( 'on' === $value || 'off' === $value ) {
			return 'on' === $value;
		}

		/**
		 * Whether checked forms move to the new renderer on their own while the site setting was
		 * never saved.
		 *
		 * @param bool $on Default.
		 */
		return (bool) apply_filters( 'funnelforms_auto_renderer_default', self::DEFAULT_ON );
	}

	/**
	 * Saves the setting and applies it.
	 *
	 * @param bool $on On or off.
	 * @return int Forms moved (on) or put back (off).
	 */
	public static function set( bool $on ): int {
		update_option( self::OPTION, $on ? 'on' : 'off', false );
		return $on ? self::apply() : self::revert();
	}

	/**
	 * After a migration run or the way forward: moves what can move.
	 */
	public static function after_run(): void {
		self::apply();
	}

	/**
	 * Why nothing moves right now, or an empty string.
	 *
	 * @return string off, rollback, assistant or ''.
	 */
	public static function waiting(): string {
		if ( ! self::enabled() ) {
			return 'off';
		}
		if ( Rollback::active() ) {
			return 'rollback';
		}
		// Until the update assistant is through: it shows every form before it goes live, also
		// before anyone opened it (the first page load after the update runs the import).
		$setup = SetupFlow::state();
		if ( 'update' === $setup['path'] && 'open' === $setup['status'] ) {
			return 'assistant';
		}
		return '';
	}

	/**
	 * Moves every checked form that is not pinned and that nothing keeps on 3.x.
	 *
	 * @return int Forms moved.
	 */
	public static function apply(): int {
		if ( '' !== self::waiting() ) {
			return 0;
		}
		$forms     = new FormRepository();
		$store     = new MigrationStore( SecretBox::for_site() );
		$renderers = new FormRenderer( $forms, $store );
		$pinned    = self::pinned();
		$moved     = self::forms();
		$count     = 0;
		foreach ( $forms->with_legacy_ids() as $row ) {
			$id = (int) $row['id'];
			if ( FormRepository::RENDERER_V5 === $row['renderer'] || in_array( $id, $pinned, true ) ) {
				continue;
			}
			$form = $forms->by_id( $id );
			$item = $store->item( LegacyRepository::FORM, (int) $row['legacy_post_id'] );
			if ( null === $form || 'trashed' === $form['status'] || null === $item || FormVerifier::VERIFIED !== $item['status'] || $forms->edited( $form ) || array() !== $renderers->blockers( $form ) ) {
				continue;
			}
			$forms->set_renderer( $id, FormRepository::RENDERER_V5, 'auto' );
			$moved[] = $id;
			++$count;
		}
		if ( $count > 0 ) {
			update_option( self::FORMS, array_values( array_unique( $moved ) ), false );
			FormRepository::flush();
		}
		return $count;
	}

	/**
	 * Puts back on 3.x the forms this moved and that still run on the new renderer.
	 *
	 * @return int Forms put back.
	 */
	public static function revert(): int {
		$forms = new FormRepository();
		$count = 0;
		foreach ( self::forms() as $id ) {
			$form = $forms->by_id( $id );
			if ( null !== $form && FormRepository::RENDERER_V5 === $form['renderer'] && ! $forms->edited( $form ) ) {
				$forms->set_renderer( $id, FormRepository::RENDERER_LEGACY, 'auto_off' );
				++$count;
			}
		}
		delete_option( self::FORMS );
		FormRepository::flush();
		return $count;
	}

	/**
	 * Keeps a form on Funnelforms 3: someone sent it back or chose to keep it there.
	 *
	 * @param int $form_id Form ID.
	 */
	public static function pin( int $form_id ): void {
		$pinned = self::pinned();
		if ( ! in_array( $form_id, $pinned, true ) ) {
			$pinned[] = $form_id;
			update_option( self::PINNED, $pinned, false );
		}
		update_option( self::FORMS, array_values( array_diff( self::forms(), array( $form_id ) ) ), false );
	}

	/**
	 * Forgets that a form was kept on Funnelforms 3 (it was moved by hand).
	 *
	 * @param int $form_id Form ID.
	 */
	public static function unpin( int $form_id ): void {
		update_option( self::PINNED, array_values( array_diff( self::pinned(), array( $form_id ) ) ), false );
	}

	/**
	 * Whether a form was kept on Funnelforms 3 by hand.
	 *
	 * @param int $form_id Form ID.
	 */
	public static function is_pinned( int $form_id ): bool {
		return in_array( $form_id, self::pinned(), true );
	}

	/**
	 * Forms kept on Funnelforms 3 by hand.
	 *
	 * @return int[]
	 */
	public static function pinned(): array {
		return array_map( 'intval', (array) get_option( self::PINNED, array() ) );
	}

	/**
	 * Forms this moved.
	 *
	 * @return int[]
	 */
	public static function forms(): array {
		return array_map( 'intval', (array) get_option( self::FORMS, array() ) );
	}
}
