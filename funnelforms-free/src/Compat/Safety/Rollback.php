<?php
/**
 * One click back to Funnelforms 3, and forward again.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Safety;

use Funnelforms\Application\FormRenderer;
use Funnelforms\Application\LeadMirror;
use Funnelforms\Compat\Migration\MigrationReport;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * Going back puts every form imported from 3.x on the 3.x renderer again and brings back the
 * Funnelforms 3 menu as it was. The 3.x data was never changed, so the old forms work as before;
 * the copy in Funnelforms 5 stays and keeps in step with 3.x. Going forward again switches exactly
 * the forms back that were live on Funnelforms 5. Forms made in Funnelforms 5 have no 3.x version
 * and keep running.
 */
final class Rollback {

	/** "legacy" while Funnelforms 3 is back. */
	public const MODE = 'funnelforms_mode';

	/** What going back changed: the forms and whether the "Funnelforms 3" entry was shown. */
	public const RECORD = 'funnelforms_rollback';

	/**
	 * Whether Funnelforms 3 is back.
	 */
	public static function active(): bool {
		return 'legacy' === get_option( self::MODE, '' );
	}

	/**
	 * Goes back to Funnelforms 3.
	 *
	 * @return int Forms put back on the 3.x renderer.
	 */
	public static function to_legacy(): int {
		$forms  = new FormRepository();
		$record = self::record();
		if ( ! self::active() ) {
			$record = array(
				'forms'  => array(),
				'since'  => gmdate( 'Y-m-d H:i:s' ),
				'backup' => (string) ( LegacyBackup::latest()['id'] ?? '' ),
			);
		}
		$moved = 0;
		foreach ( $forms->with_legacy_ids() as $row ) {
			if ( FormRepository::RENDERER_V5 !== $row['renderer'] ) {
				continue;
			}
			$forms->set_renderer( (int) $row['id'], FormRepository::RENDERER_LEGACY, 'rollback' );
			$record['forms'][] = (int) $row['id'];
			++$moved;
		}
		$record['forms'] = array_values( array_unique( $record['forms'] ) );
		update_option( self::RECORD, $record, false );
		update_option( self::MODE, 'legacy', false );
		FormRepository::flush();

		/**
		 * After Funnelforms 3 was brought back.
		 *
		 * @param int[] $forms IDs of the forms that are on the 3.x renderer again.
		 */
		do_action( 'funnelforms_rollback', $record['forms'] );
		return $moved;
	}

	/**
	 * Goes forward to Funnelforms 5 again.
	 *
	 * @return array{switched:int,stayed:array<int,string[]>} Forms live again, and the ones that
	 *                                                         cannot be yet with the reasons.
	 */
	public static function to_v5(): array {
		$record = self::record();
		delete_option( self::MODE );
		$renderers = new FormRenderer( new FormRepository(), new MigrationStore( SecretBox::for_site() ) );
		$out       = array(
			'switched' => 0,
			'stayed'   => array(),
		);
		foreach ( $record['forms'] as $form_id ) {
			$blockers = $renderers->switch_to( (int) $form_id, FormRepository::RENDERER_V5 );
			if ( array() === $blockers ) {
				++$out['switched'];
			} elseif ( array( 'form_not_found' ) !== $blockers ) {
				$out['stayed'][ (int) $form_id ] = $blockers;
			}
		}
		delete_option( self::RECORD );
		FormRepository::flush();

		/**
		 * After going forward to Funnelforms 5 again.
		 *
		 * @param array{switched:int,stayed:array<int,string[]>} $result Result.
		 */
		do_action( 'funnelforms_rollforward', $out );
		return $out;
	}

	/**
	 * Puts one form from Funnelforms 3 back on the 3.x renderer, without the rest of the site.
	 * Nothing is deleted: its entries from Funnelforms 5 stay, and its version in the Funnelforms 5
	 * builder is kept for the way forward.
	 *
	 * @param int $form_id Form ID.
	 * @return array{ok:bool,code:string,title:string,impact:array<string,int>}
	 */
	public static function form_to_legacy( int $form_id ): array {
		$forms = new FormRepository();
		$form  = $forms->by_id( $form_id );
		if ( null === $form || null === $form['legacy_post_id'] ) {
			return array(
				'ok'     => false,
				'code'   => 'form_not_found',
				'title'  => '',
				'impact' => array(),
			);
		}
		$impact = self::form_impact( $form );
		if ( FormRepository::RENDERER_V5 === $form['renderer'] ) {
			$forms->set_renderer( $form_id, FormRepository::RENDERER_LEGACY, 'way_back' );
			FormRepository::flush();
		}

		/**
		 * After one form was put back on Funnelforms 3.
		 *
		 * @param int $form_id Form ID.
		 */
		do_action( 'funnelforms_form_way_back', $form_id );
		return array(
			'ok'     => true,
			'code'   => '',
			'title'  => (string) $form['title'],
			'impact' => $impact,
		);
	}

	/**
	 * What going back to Funnelforms 3 means for the data, for the page that asks first.
	 *
	 * @return array{forms:int,own_forms:int,edited:int,new_entries:int,mirrored:int,own_entries:int,mirror:bool,backup:string}
	 *         forms: imported forms that run on Funnelforms 5 now; own_forms: forms made in
	 *         Funnelforms 5 (they keep running); edited: imported forms changed in the builder;
	 *         new_entries: entries that came in on Funnelforms 5 for imported forms, mirrored: of
	 *         those, also in the Funnelforms 3 lead list; own_entries: entries of forms made in 5.
	 */
	public static function impact(): array {
		$forms  = new FormRepository();
		$on_v5  = array();
		$edited = 0;
		foreach ( $forms->with_legacy_ids() as $row ) {
			$form = $forms->by_id( (int) $row['id'] );
			if ( null === $form || FormRepository::RENDERER_V5 !== $form['renderer'] ) {
				continue;
			}
			$on_v5[] = (int) $form['id'];
			$edited += $forms->edited( $form ) ? 1 : 0;
		}
		$new = MigrationReport::new_entries();
		return array(
			'forms'       => count( $on_v5 ),
			'own_forms'   => count( $forms->made_in_builder() ),
			'edited'      => $edited,
			'new_entries' => $new['imported_forms'],
			'mirrored'    => $new['mirrored'],
			'own_entries' => $new['own_forms'],
			'mirror'      => LeadMirror::enabled(),
			'backup'      => (string) ( LegacyBackup::latest()['id'] ?? '' ),
		);
	}

	/**
	 * What going back means for one form.
	 *
	 * @param array<string,mixed> $form Form row.
	 * @return array{new_entries:int,mirrored:int,from3:int,edited:int,on_v5:int}
	 */
	public static function form_impact( array $form ): array {
		$entries = MigrationReport::entries_by_form( array( (int) $form['id'] ) )[ (int) $form['id'] ];
		return array(
			'new_entries' => $entries['new'],
			'mirrored'    => $entries['mirrored'],
			'from3'       => $entries['from3'],
			'edited'      => ( new FormRepository() )->edited( $form ) ? 1 : 0,
			'on_v5'       => FormRepository::RENDERER_V5 === $form['renderer'] ? 1 : 0,
		);
	}

	/**
	 * What going back changed.
	 *
	 * @return array{forms:int[],since:string,backup:string}
	 */
	public static function record(): array {
		$record = get_option( self::RECORD, array() );
		$record = ( is_array( $record ) ? $record : array() ) + array(
			'forms'  => array(),
			'since'  => '',
			'backup' => '',
		);
		return array(
			'forms'  => array_map( 'intval', (array) $record['forms'] ),
			'since'  => (string) $record['since'],
			'backup' => (string) $record['backup'],
		);
	}
}
