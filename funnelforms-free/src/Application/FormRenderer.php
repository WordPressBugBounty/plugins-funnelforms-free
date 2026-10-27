<?php
/**
 * Use case: switch a form between the 3.x renderer and the new one.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\FormVerifier;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Compat\Safety\Rollback;
use Funnelforms\Domain\Form\PhoneNumbers;
use Funnelforms\Domain\Form\RendererSupport;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\GoogleMaps;
use Funnelforms\Frontend\Renderer;
use Funnelforms\Frontend\TrackingCode;
use Funnelforms\Http\Captcha;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * A migrated form may move to the new renderer only when its migration was verified and the
 * renderer supports everything in it. When a later import of a changed 3.x form is no longer
 * verified, the form falls back to the 3.x renderer on its own. A form imported from 3.x goes live
 * only once a restore point of the 3.x data exists.
 */
final class FormRenderer {

	/**
	 * Creates the use case.
	 *
	 * @param FormRepository $forms Forms.
	 * @param MigrationStore $store Migration records.
	 */
	public function __construct( private FormRepository $forms, private MigrationStore $store ) {}

	/**
	 * Why a form cannot use the new renderer; empty when it can.
	 *
	 * @param array<string,mixed> $form Form row.
	 * @return string[]
	 */
	public function blockers( array $form ): array {
		$out = array();
		if ( ! Renderer::available() ) {
			$out[] = 'runtime_not_built';
		}
		// The 3.x check only matters while the form is the imported version, not after builder edits.
		if ( null !== $form['legacy_post_id'] && ! $this->forms->edited( $form ) ) {
			$item = $this->store->item( LegacyRepository::FORM, (int) $form['legacy_post_id'] );
			if ( null === $item || FormVerifier::VERIFIED !== $item['status'] ) {
				// Differences found by the check get their own code, so they can be explained apart.
				$out[] = null !== $item && FormVerifier::NEEDS_REVIEW === $item['status'] ? 'needs_review' : 'not_verified';
			}
		}
		if ( null !== $form['legacy_post_id'] && LegacyBackup::required() && null === LegacyBackup::latest() ) {
			$out[] = 'no_backup';
		}
		if ( null !== $form['legacy_post_id'] && Rollback::active() ) {
			$out[] = 'rollback_active';
		}
		$document = null === $form['current_revision_id'] ? null : $this->forms->document( (int) $form['current_revision_id'] );
		if ( null === $document ) {
			$out[] = 'no_document';
			return $out;
		}
		$phone = Edition::pro( PhoneVerification::class );
		foreach ( $document['nodes'] as $node ) {
			foreach ( 'contact' === $node['type'] ? $node['fields'] : array() as $field ) {
				// A captcha field without a connection of its own uses the site's protection, or is left out.
				if ( 'captcha' === $field['type'] && '' !== (string) ( $field['props']['connectionRef'] ?? '' ) && null === Captcha::site_key( $field ) ) {
					$out[] = 'captcha_not_configured';
				}
				// Numbers confirmed by text message need an SMS connection; Free blocks the field itself (Edition).
				if ( null !== $phone && PhoneNumbers::confirms( $field ) && null === $phone::create()->connection( $field ) ) {
					$out[] = 'sms_not_configured';
				}
			}
		}
		if ( TrackingCode::used( $document ) && ! TrackingCode::allowed() ) {
			$out[] = 'tracking_code_not_allowed';
		}
		if ( RendererSupport::has_scripts( $document ) && ! TrackingCode::allowed() ) {
			$out[] = 'script_in_content';
		}
		$maps = Edition::pro( GoogleMaps::class );
		if ( null !== $maps && $maps::needed( $document ) && '' === $maps::key() ) {
			$out[] = 'google_maps_key_missing';
		}
		$bookings = Edition::pro( Bookings::class );
		return array_merge( $out, RendererSupport::problems( $document ), null === $bookings ? array() : $bookings::create()->problems( $document ) );
	}

	/**
	 * Switches the renderer.
	 *
	 * @param int    $form_id  Form ID.
	 * @param string $renderer FormRepository::RENDERER_V5 or RENDERER_LEGACY.
	 * @return string[] Blockers; empty when switched.
	 */
	public function switch_to( int $form_id, string $renderer ): array {
		$form = $this->forms->by_id( $form_id );
		if ( null === $form ) {
			return array( 'form_not_found' );
		}
		if ( FormRepository::RENDERER_V5 === $renderer ) {
			$blockers = $this->blockers( $form );
			if ( array() !== $blockers ) {
				return $blockers;
			}
		} elseif ( FormRepository::RENDERER_LEGACY !== $renderer ) {
			return array( 'unknown_renderer' );
		}
		if ( $form['renderer'] !== $renderer ) {
			$this->forms->set_renderer( $form_id, $renderer, 'admin' );
		}
		return array();
	}

	/**
	 * Switches every form imported from 3.x that is not on the renderer yet; forms that cannot
	 * use the new renderer stay where they are.
	 *
	 * @param string $renderer FormRepository::RENDERER_V5 or RENDERER_LEGACY.
	 * @return array{switched:int,stayed:int}
	 */
	public function switch_all( string $renderer ): array {
		$out = array(
			'switched' => 0,
			'stayed'   => 0,
		);
		foreach ( $this->forms->with_legacy_ids() as $row ) {
			if ( $renderer === $row['renderer'] ) {
				continue;
			}
			$key         = array() === $this->switch_to( (int) $row['id'], $renderer ) ? 'switched' : 'stayed';
			$out[ $key ] = $out[ $key ] + 1;
		}
		return $out;
	}

	/**
	 * After a form was imported again: back to the 3.x renderer if it no longer qualifies.
	 *
	 * @param int $form_id Form ID.
	 */
	public function recheck( int $form_id ): void {
		$form = $this->forms->by_id( $form_id );
		if ( null === $form || FormRepository::RENDERER_V5 !== $form['renderer'] ) {
			return;
		}
		$blockers = array_diff( $this->blockers( $form ), array( 'runtime_not_built', 'no_backup', 'rollback_active' ) );
		if ( array() !== $blockers ) {
			$this->forms->set_renderer( $form_id, FormRepository::RENDERER_LEGACY, 'reimport:' . implode( ',', $blockers ) );
		}
	}
}
