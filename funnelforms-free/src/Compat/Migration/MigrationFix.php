<?php
/**
 * The "Fix" button of the migration: does what can be done without a person and moves the form.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

use Funnelforms\Application\FormEditor;
use Funnelforms\Application\FormRenderer;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Domain\Form\InputMask;
use Funnelforms\Domain\Form\PhoneNumbers;
use Funnelforms\Frontend\TrackingCode;
use Funnelforms\Http\Captcha;
use Funnelforms\Infrastructure\Repository\FormRepository;
use Funnelforms\Infrastructure\Crypto\SecretBox;

defined( 'ABSPATH' ) || exit;

/**
 * For one form imported from Funnelforms 3, in this order:
 *
 *  1. imports it again when its copy is missing or its check failed (the converter of this version
 *     solves the known causes, such as two contact forms with the same field ids);
 *  2. changes the copy where Funnelforms 5 cannot do what Funnelforms 3 did (for a copy whose
 *     comparison found differences only once the person takes it over): a reCAPTCHA field
 *     without usable keys uses the site's spam protection, a phone field confirmed by text message
 *     without an SMS connection stays a phone field without the code, an input mask the new display
 *     does not know is left out; on request it also takes over a copy whose comparison found
 *     differences. The changed copy is published (note "migration_fix"), so from then on it counts
 *     like a version published in the builder;
 *  3. allows the code of forms when the form has tracking code or scripts and the person may add
 *     unfiltered HTML (Funnelforms 3 always ran it);
 *  4. starts a restore point when none exists; the form moves once it is written;
 *  5. moves the form to Funnelforms 5 when nothing is left.
 *
 * Whatever needs a person (a calendar, an appointment type, a field or connection Funnelforms 5
 * does not have yet) stays in the answer, with its reason.
 */
final class MigrationFix {

	/**
	 * Note of a revision the fix published.
	 */
	public const NOTE = 'migration_fix';

	/**
	 * Option: forms waiting for the restore point a fix started.
	 */
	private const WAITING = 'funnelforms_migration_fix_waiting';

	/**
	 * What follows the restore point (LegacyBackup::start()).
	 */
	private const THEN = 'migration_fix';

	/**
	 * Codes of blockers the fix solves by itself (for the button on the page).
	 */
	public const SOLVES = array( 'not_verified', 'check_failed', 'no_document', 'captcha_not_configured', 'sms_not_configured', 'input_mask', 'no_backup', 'tracking_code_not_allowed', 'script_in_content' );

	/**
	 * Registers the step after a restore point written for a fix.
	 */
	public static function register(): void {
		add_action( 'funnelforms_backup_done', array( self::class, 'after_backup' ), 10, 2 );
	}

	/**
	 * Creates the use case for this site.
	 */
	public static function create(): self {
		$forms = new FormRepository();
		$store = new MigrationStore( SecretBox::for_site() );
		return new self( $forms, $store, new FormRenderer( $forms, $store ) );
	}

	/**
	 * Constructor.
	 *
	 * @param FormRepository $forms     Forms.
	 * @param MigrationStore $store     Migration records.
	 * @param FormRenderer   $renderers Renderer switch.
	 */
	public function __construct( private FormRepository $forms, private MigrationStore $store, private FormRenderer $renderers ) {}

	/**
	 * Whether the button can do something for a form of MigrationReport::forms().
	 *
	 * @param array<string,mixed> $form   Report row.
	 * @param bool                $accept Whether differences found by the comparison may be taken over.
	 */
	public static function can_fix( array $form, bool $accept = true ): bool {
		// A form someone sent back to Funnelforms 3 moves only by their own hand.
		if ( 'v5' === ( $form['state'] ?? '' ) || ( ! empty( $form['pinned'] ) && 'ready' === ( $form['state'] ?? '' ) ) ) {
			return false;
		}
		$blockers = (array) ( $form['blockers'] ?? array() );
		if ( $accept && in_array( 'needs_review', $blockers, true ) ) {
			return true;
		}
		return array() !== array_intersect( $blockers, self::SOLVES ) || ( array() === $blockers && 'ready' === ( $form['state'] ?? '' ) );
	}

	/**
	 * Fixes one form and moves it when nothing is left.
	 *
	 * @param int  $legacy_id 3.x form ID.
	 * @param bool $accept    Take over the copy even where the comparison found differences.
	 * @return array{state:string, done:list<string>, left:list<string>, form:int}
	 *         state: v5 (runs on Funnelforms 5), waiting (moves once the restore point is written)
	 *         or stays; done: what was done; left: blockers that need a person.
	 */
	public function run( int $legacy_id, bool $accept ): array {
		$done = array();
		$form = $this->forms->by_legacy_id( $legacy_id );

		// 1. Copy again when there is no usable, checked copy.
		$item = $this->store->item( LegacyRepository::FORM, $legacy_id );
		if ( ( null === $form || ! $this->forms->edited( $form ) ) && ( null === $item || ! in_array( $item['status'], array( FormVerifier::VERIFIED, FormVerifier::NEEDS_REVIEW ), true ) ) ) {
			if ( 'running' !== Migrator::state()['status'] && MigrationRunner::lock() ) {
				try {
					$status = MigrationRunner::migrator()->reimport_form( $legacy_id );
				} finally {
					MigrationRunner::unlock();
				}
				if ( 'not_found' !== $status ) {
					$done[] = 'reimported';
				}
				FormRepository::flush();
				$form = $this->forms->by_legacy_id( $legacy_id );
			}
		}
		if ( null === $form ) {
			return array(
				'state' => 'stays',
				'done'  => $done,
				'left'  => array( 'no_document' ),
				'form'  => 0,
			);
		}
		$form_id = (int) $form['id'];

		// 2. Change the copy where Funnelforms 5 cannot do what Funnelforms 3 did.
		$blockers = $this->renderers->blockers( $form );
		$document = null === $form['current_revision_id'] ? null : $this->forms->document( (int) $form['current_revision_id'] );
		// A copy whose comparison found differences waits for a look: publishing a changed copy would
		// make it count as the builder's version and skip that look.
		$review = in_array( 'needs_review', $blockers, true );
		if ( null !== $document && ( ! $review || $accept ) ) {
			$changes = self::repair( $document, $blockers );
			$take    = $review;
			// Through the builder's codec, so empty props are objects again, and only when valid.
			$fixed = ( array() !== $changes || $take ) ? FormEditor::decode( (string) wp_json_encode( $document ) ) : null;
			if ( null !== $fixed && array() === FormEditor::problems( $fixed ) ) {
				$this->forms->publish( $form_id, FormEditor::encode( $fixed ), (string) ( $document['title'] ?? $form['title'] ), get_current_user_id(), self::NOTE );
				$this->forms->audit(
					'migration_fixed',
					$form_id,
					array(
						'changes'  => $changes,
						'accepted' => $take,
					)
				);
				$done = array_merge( $done, $changes, $take ? array( 'accepted' ) : array() );
				FormRepository::flush();
				$form     = (array) $this->forms->by_id( $form_id );
				$blockers = $this->renderers->blockers( $form );
			}
		}

		// 3. Code in the form ran in Funnelforms 3; allow it where the person may add such code.
		if ( array() !== array_intersect( $blockers, array( 'tracking_code_not_allowed', 'script_in_content' ) ) && current_user_can( 'unfiltered_html' ) ) {
			update_option( TrackingCode::OPTION, '1' );
			$done[]   = 'code_allowed';
			$blockers = $this->renderers->blockers( $form );
		}

		// 4. A restore point first; the form moves once it is written (after_backup()).
		if ( in_array( 'no_backup', $blockers, true ) ) {
			$waiting = self::waiting();
			if ( ! in_array( $form_id, $waiting, true ) ) {
				update_option( self::WAITING, array_merge( $waiting, array( $form_id ) ), false );
			}
			if ( LegacyBackup::running() || LegacyBackup::start( 'manual', self::THEN ) ) {
				$done[] = 'backup_started';
				$left   = array_values( array_diff( $blockers, array( 'no_backup' ) ) );
				return array(
					'state' => array() === $left ? 'waiting' : 'stays',
					'done'  => $done,
					'left'  => $left,
					'form'  => $form_id,
				);
			}
		}

		// 5. Move it.
		if ( array() === $blockers && FormRepository::RENDERER_V5 !== $form['renderer'] ) {
			$blockers = $this->renderers->switch_to( $form_id, FormRepository::RENDERER_V5 );
			if ( array() === $blockers ) {
				AutoRenderer::unpin( $form_id );
				$done[] = 'moved';
			}
		}
		return array(
			'state' => array() === $blockers ? 'v5' : 'stays',
			'done'  => $done,
			'left'  => array_values( $blockers ),
			'form'  => $form_id,
		);
	}

	/**
	 * Forms waiting for a restore point.
	 *
	 * @return int[]
	 */
	public static function waiting(): array {
		return array_map( 'intval', (array) get_option( self::WAITING, array() ) );
	}

	/**
	 * After the restore point a fix started: moves the forms that waited for it.
	 *
	 * @param array<string,mixed> $backup Backup.
	 * @param string              $then   What follows.
	 */
	public static function after_backup( array $backup, string $then ): void {
		unset( $backup );
		if ( self::THEN !== $then ) {
			return;
		}
		$fix = self::create();
		foreach ( self::waiting() as $form_id ) {
			if ( array() === $fix->renderers->switch_to( $form_id, FormRepository::RENDERER_V5 ) ) {
				AutoRenderer::unpin( $form_id );
			}
		}
		delete_option( self::WAITING );
	}

	/**
	 * Changes a document so the new display can show it; what changed, by code.
	 *
	 * @param array<string,mixed> $document Form document (changed in place).
	 * @param string[]            $blockers FormRenderer::blockers() of the form.
	 * @return list<string>
	 */
	public static function repair( array &$document, array $blockers ): array {
		$changes = array();
		foreach ( (array) ( $document['nodes'] ?? array() ) as $n => $node ) {
			foreach ( (array) ( $node['fields'] ?? array() ) as $f => $field ) {
				$props  = (array) ( $field['props'] ?? array() );
				$before = $props;
				// A captcha without usable keys: the site's spam protection (or the hidden checks).
				if ( in_array( 'captcha_not_configured', $blockers, true ) && 'contact' === $node['type'] && 'captcha' === $field['type'] && '' !== (string) ( $props['connectionRef'] ?? '' ) && null === Captcha::site_key( $field ) ) {
					unset( $props['connectionRef'] );
					$changes[] = 'captcha_site_protection';
				}
				// Codes by text message without an SMS connection: a phone field as any other.
				if ( in_array( 'sms_not_configured', $blockers, true ) && 'contact' === $node['type'] && PhoneNumbers::confirms( $field ) ) {
					unset( $props['sms'] );
					$document['nodes'][ $n ]['fields'][ $f ]['type'] = 'phone';
					$changes[]                                       = 'sms_confirmation_off';
				}
				// An input mask the new display does not know: the field takes any input.
				if ( in_array( 'input_mask', $blockers, true ) && isset( $props['mask'] ) && '' !== (string) $props['mask'] && ! InputMask::supported( (string) $props['mask'] ) ) {
					unset( $props['mask'] );
					$changes[] = 'input_mask_removed';
				}
				if ( $props !== $before ) {
					$document['nodes'][ $n ]['fields'][ $f ]['props'] = $props;
				}
			}
		}
		return array_values( array_unique( $changes ) );
	}
}
