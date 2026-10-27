<?php
/**
 * Use case: the setup assistant, for an update from Funnelforms 3 and for a new installation.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Application\Telemetry\Consent;
use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\AutoRenderer;
use Funnelforms\Compat\Migration\FormVerifier;
use Funnelforms\Compat\Migration\MigrationReport;
use Funnelforms\Compat\Migration\MigrationRunner;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Compat\Migration\Migrator;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Compat\Safety\Rollback;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * The assistant takes one of two paths. After an update from 3.x it shows the restore point and
 * the import, asks what to keep, shows each form old and new, and puts the chosen forms live. On
 * a new installation it explains Funnelforms, connects the account, makes a first form from a
 * template in the site's colours and puts it on a page. Every step is stored, so the assistant
 * can be left and resumed; nothing is changed before "Go live". It is mandatory: nobody can skip it,
 * and a stored status "dismissed" counts as open. Early on, both paths ask for the region of the
 * visitors (which sets the privacy mode) and the language of new forms, which apply when that step
 * is sent, and whether the site sends diagnostic data to Funnelforms and the administrator wants
 * tips and news by email (Newsletter): both without a preselection, so each is an active choice.
 * The diagnostic data start on "Go live", like how long entries are kept.
 */
final class SetupFlow {

	public const OPTION = 'funnelforms_setup';

	public const UPDATE_STEPS = array( 'welcome', 'region', 'import', 'keep', 'preview', 'live', 'done' );
	public const NEW_STEPS    = array( 'welcome', 'intro', 'region', 'account', 'goal', 'brand', 'preview', 'live', 'done' );

	/**
	 * Stored progress.
	 *
	 * @return array{path:string,step:string,status:string,choices:array<string,mixed>,form_id:int,result:array<string,mixed>,newsletter:bool,updated_at:string}
	 *         newsletter: the sign-up for tips and news by email went out (the address is not kept).
	 */
	public static function state(): array {
		$stored = get_option( self::OPTION, null );
		$state  = ( is_array( $stored ) ? $stored : array() ) + array(
			'path'       => '',
			'step'       => 'welcome',
			'status'     => 'open',
			'choices'    => array(),
			'form_id'    => 0,
			'result'     => array(),
			'newsletter' => false,
			'updated_at' => '',
		);
		if ( '' === $state['path'] ) {
			$state['path'] = self::detect();
		}
		// A site that made forms in Funnelforms 5 before the assistant existed needs no first form.
		if ( null === $stored && 'new' === $state['path'] && ( new FormRepository() )->search( array(), 'updated', 1, 1 )['total'] > 0 ) {
			$state['status'] = 'done';
		}
		if ( ! in_array( $state['step'], self::steps( $state['path'] ), true ) ) {
			$state['step'] = 'welcome';
		}
		$state['choices'] = (array) $state['choices'] + self::default_choices( $state['path'] );
		// The assistant is mandatory; "dismissed" (older versions let one skip it) counts as open.
		if ( 'dismissed' === $state['status'] ) {
			$state['status'] = 'open';
		}
		// "Decide later" is gone, forms move on their own; an old stored choice falls back to the default.
		if ( ! in_array( $state['choices']['forms'], array( 'verified', 'pick' ), true ) ) {
			$state['choices']['forms'] = 'verified';
		}
		$state['form_id']    = (int) $state['form_id'];
		$state['result']     = (array) $state['result'];
		$state['newsletter'] = ! empty( $state['newsletter'] );
		return $state;
	}

	/**
	 * Stores changes to the progress.
	 *
	 * @param array<string,mixed> $changes Keys of state().
	 * @return array<string,mixed> New state.
	 */
	public static function save( array $changes ): array {
		$state               = array_merge( self::state(), $changes );
		$state['updated_at'] = gmdate( 'Y-m-d H:i:s' );
		update_option( self::OPTION, $state, false );
		return self::state();
	}

	/**
	 * Which path fits this site: "update" when Funnelforms 3 left data or forms were imported.
	 */
	public static function detect(): string {
		if ( 'idle' !== Migrator::state()['status'] || array() !== ( new FormRepository() )->with_legacy_ids() || ( new LegacyRepository() )->has_data() ) {
			return 'update';
		}
		return 'new';
	}

	/**
	 * The steps of a path.
	 *
	 * @param string $path update or new.
	 * @return string[]
	 */
	public static function steps( string $path ): array {
		if ( 'update' === $path ) {
			return self::UPDATE_STEPS;
		}
		// Funnelforms Free has no account to connect.
		return Edition::is_free() ? array_values( array_diff( self::NEW_STEPS, array( 'account' ) ) ) : self::NEW_STEPS;
	}

	/**
	 * The step after (1) or before (-1) a step; the same step at the ends.
	 *
	 * @param string $path  Path.
	 * @param string $step  Step.
	 * @param int    $delta 1 or -1.
	 */
	public static function neighbour( string $path, string $step, int $delta ): string {
		$steps = self::steps( $path );
		$index = (int) array_search( $step, $steps, true );
		return $steps[ max( 0, min( count( $steps ) - 1, $index + $delta ) ) ];
	}

	/**
	 * Whether the assistant still has something to do.
	 */
	public static function open(): bool {
		return 'open' === self::state()['status'];
	}

	/**
	 * What the user chose before anything was asked.
	 *
	 * @param string $path update or new.
	 * @return array<string,mixed>
	 */
	private static function default_choices( string $path ): array {
		$diagnostics = Consent::get();
		return array(
			// A new site starts with 12 months, an updated one keeps the setting it has.
			'retention'            => 'new' === $path ? Retention::NEW_SITE_DAYS : Retention::site_days(),
			'forms'                => 'verified',
			'picked'               => array(),
			'look'                 => 'classic',
			'approved'             => array(),
			'goal'                 => '',
			'template'             => '',
			'color'                => '#6A30F5',
			'font'                 => '',
			'email'                => (string) get_option( 'admin_email' ),
			'privacy'              => PrivacyMode::current(),
			'language'             => (string) get_option( FormTemplates::LANGUAGE_OPTION, '' ),
			// Nothing is chosen for diagnostic data (null) unless the site turned them on already.
			'diagnostics'          => Consent::enabled() ? true : null,
			'diagnostics_url'      => $diagnostics['site_url'],
			'diagnostics_industry' => $diagnostics['industry'],
		);
	}

	/**
	 * The periods the assistant offers for deleting entries, in days (0 keeps entries). On the
	 * update path the site's own period is offered too when it is none of the usual ones, so
	 * nobody has to change it.
	 *
	 * @param string $path update or new.
	 * @return int[]
	 */
	public static function retention_options( string $path ): array {
		$options = array( 180, 365, 730, 0 );
		$current = Retention::site_days();
		if ( 'update' === $path && ! in_array( $current, $options, true ) ) {
			$options[] = $current;
		}
		return $options;
	}

	/**
	 * A submitted period, or the default of the path when it is none of the offered ones.
	 *
	 * @param mixed  $value Submitted value.
	 * @param string $path  update or new.
	 */
	public static function clean_retention( $value, string $path ): int {
		if ( is_scalar( $value ) && '' !== (string) $value && in_array( (int) $value, self::retention_options( $path ), true ) ) {
			return (int) $value;
		}
		return 'new' === $path ? Retention::NEW_SITE_DAYS : Retention::site_days();
	}

	/**
	 * Saves the chosen period for deleting entries. A choice that equals what applies already
	 * writes nothing, so a site that follows the 3.x setting keeps following it.
	 *
	 * @param int $days Days; 0 keeps entries.
	 */
	public static function apply_retention( int $days ): void {
		$days = Retention::sanitize( $days );
		if ( Retention::site_days() !== $days ) {
			update_option( Retention::OPTION, $days );
		}
	}

	/**
	 * The privacy mode and the language of new forms of the submitted step "Region, language and
	 * privacy", as choices of the assistant; anything unknown keeps what applies.
	 *
	 * @param array<string,mixed> $post Submitted fields (unslashed).
	 * @return array{privacy:string,language:string}
	 */
	public static function region_choice( array $post ): array {
		$language = is_string( $post['language'] ?? null ) ? $post['language'] : '';
		$privacy  = $post['privacy'] ?? '';
		return array(
			// The assistant offers the two modes for a region; any other mode is chosen under Settings.
			'privacy'  => in_array( $privacy, array( PrivacyMode::EU, PrivacyMode::GLOBAL ), true ) ? $privacy : PrivacyMode::current(),
			'language' => in_array( $language, FormTemplates::LANGUAGES, true ) ? $language : '',
		);
	}

	/**
	 * Saves the privacy mode and the language of new forms. Empty language follows WordPress.
	 *
	 * @param array{privacy:string,language:string} $choice region_choice().
	 */
	public static function apply_region( array $choice ): void {
		if ( PrivacyMode::current() !== $choice['privacy'] ) {
			update_option( PrivacyMode::OPTION, PrivacyMode::sanitize( $choice['privacy'] ) );
		}
		if ( '' === $choice['language'] ) {
			delete_option( FormTemplates::LANGUAGE_OPTION );
		} else {
			update_option( FormTemplates::LANGUAGE_OPTION, $choice['language'] );
		}
	}

	/**
	 * The choice about diagnostic data of a submitted step, as choices of the assistant.
	 *
	 * @param array<string,mixed> $post Submitted fields (unslashed).
	 * @return array{diagnostics:bool,diagnostics_url:bool,diagnostics_industry:string}
	 */
	public static function diagnostics_choice( array $post ): array {
		$choice = Consent::submitted( $post );
		return array(
			'diagnostics'          => $choice['enabled'],
			'diagnostics_url'      => $choice['site_url'],
			'diagnostics_industry' => $choice['industry'],
		);
	}

	/**
	 * Applies the choice about diagnostic data on going live, as the settings would.
	 *
	 * @param array<string,mixed> $choices Choices.
	 */
	public static function apply_diagnostics( array $choices ): void {
		Consent::apply( ! empty( $choices['diagnostics'] ), ! empty( $choices['diagnostics_url'] ), (string) ( $choices['diagnostics_industry'] ?? '' ) );
	}

	/*
	 * Update from Funnelforms 3.
	 */

	/**
	 * Where the restore point and the import stand.
	 *
	 * @return array{phase:string,backup:array<string,mixed>,import:array<string,mixed>,summary:array<string,array<string,int>>}
	 *         phase: backup, import, done or failed.
	 */
	public static function import_status(): array {
		$backup    = LegacyBackup::state();
		$migration = Migrator::state();
		$latest    = LegacyBackup::latest();
		if ( LegacyBackup::running() ) {
			$phase = 'backup';
		} elseif ( null === $latest && LegacyBackup::required() && 'failed' === $backup['status'] ) {
			$phase = 'failed';
		} elseif ( 'running' === $migration['status'] || 'idle' === $migration['status'] ) {
			$phase = 'import';
		} else {
			$phase = 'done';
		}
		$current = Migrator::PHASES[ (int) $migration['phase'] ] ?? 'bookings';
		return array(
			'phase'   => $phase,
			'backup'  => array(
				'status' => (string) $backup['status'],
				'error'  => (string) $backup['error'],
				'id'     => (string) ( $latest['id'] ?? '' ),
				'counts' => (array) ( $latest['counts'] ?? $backup['counts'] ),
			),
			'import'  => array(
				'status' => (string) $migration['status'],
				'phase'  => 'done' === $phase ? count( Migrator::PHASES ) : (int) array_search( $current, Migrator::PHASES, true ),
			),
			'summary' => ( new MigrationStore( SecretBox::for_site() ) )->summary(),
		);
	}

	/**
	 * Moves the restore point and the import on while someone watches (also where WP-Cron does
	 * not run), within a few seconds.
	 *
	 * @return array<string,mixed> import_status().
	 */
	public static function drive(): array {
		$until = microtime( true ) + 5.0;
		while ( microtime( true ) < $until ) {
			$status = self::import_status();
			if ( 'backup' === $status['phase'] ) {
				LegacyBackup::step( 3.0 );
			} elseif ( 'import' === $status['phase'] && 'idle' === $status['import']['status'] ) {
				MigrationRunner::start( 'full' );
				if ( 'idle' === Migrator::state()['status'] && ! LegacyBackup::running() ) {
					break;
				}
			} elseif ( 'import' === $status['phase'] ) {
				MigrationRunner::run_step();
			} else {
				break;
			}
		}
		return self::import_status();
	}

	/**
	 * The forms imported from 3.x with their check and what keeps them from going live.
	 *
	 * @return list<array{id:int,legacy_id:int,title:string,check:string,renderer:string,blockers:string[],state:string,checks:array<string,array<string,mixed>>}>
	 *         check: verified, needs_review, failed or edited; state: ready, review or stays
	 *         (MigrationReport::state(), as if the form was not live yet).
	 */
	public static function imported_forms(): array {
		$forms     = new FormRepository();
		$store     = new MigrationStore( SecretBox::for_site() );
		$renderers = new FormRenderer( $forms, $store );
		$out       = array();
		foreach ( $forms->with_legacy_ids() as $row ) {
			$form = $forms->by_id( (int) $row['id'] );
			if ( null === $form || 'trashed' === ( $form['status'] ?? '' ) ) {
				continue;
			}
			$item  = $store->item( LegacyRepository::FORM, (int) $row['legacy_post_id'] );
			$check = null === $item ? 'failed' : (string) $item['status'];
			if ( $forms->edited( $form ) ) {
				$check = 'edited';
			} elseif ( ! in_array( $check, array( FormVerifier::VERIFIED, 'needs_review' ), true ) ) {
				$check = 'failed';
			}
			$blockers = array_values( array_diff( $renderers->blockers( $form ), array( 'rollback_active' ) ) );
			$checks   = null === $item ? array() : json_decode( (string) $item['checks'], true );
			$out[]    = array(
				'id'        => (int) $form['id'],
				'legacy_id' => (int) $row['legacy_post_id'],
				'title'     => (string) $form['title'],
				'check'     => $check,
				'renderer'  => (string) $form['renderer'],
				'blockers'  => $blockers,
				'state'     => MigrationReport::state( false, $blockers ),
				'checks'    => array_filter( is_array( $checks ) ? $checks : array(), 'is_array' ),
			);
		}
		return $out;
	}

	/**
	 * The forms the choices put live.
	 *
	 * @param array<string,mixed> $choices Choices.
	 * @return int[] Form IDs.
	 */
	public static function chosen( array $choices ): array {
		$forms = self::imported_forms();
		if ( 'later' === $choices['forms'] ) {
			return array();
		}
		if ( 'pick' === $choices['forms'] ) {
			$picked = array_map( 'intval', (array) $choices['picked'] );
			return array_values( array_map( static fn( array $f ): int => $f['id'], array_filter( $forms, static fn( array $f ): bool => in_array( $f['id'], $picked, true ) ) ) );
		}
		return array_values( array_map( static fn( array $f ): int => $f['id'], array_filter( $forms, static fn( array $f ): bool => in_array( $f['check'], array( FormVerifier::VERIFIED, 'edited' ), true ) && array() === $f['blockers'] ) ) );
	}

	/**
	 * Puts the chosen forms live. Forms whose old version the user sent back in the preview stay
	 * on 3.x. With the new look, a form gets the Funnelforms design as a new version (unless it has
	 * an unpublished draft from the builder, which is never overwritten).
	 *
	 * @param array<string,mixed> $choices Choices.
	 * @return array{switched:int,stayed:array<int,string[]>,old_hidden:bool}
	 */
	public static function go_live_update( array $choices ): array {
		if ( Rollback::active() ) {
			Rollback::to_v5();
		}
		if ( isset( $choices['retention'] ) ) {
			self::apply_retention( (int) $choices['retention'] );
		}
		self::apply_diagnostics( $choices );
		$forms     = new FormRepository();
		$editor    = FormEditor::create();
		$renderers = new FormRenderer( $forms, new MigrationStore( SecretBox::for_site() ) );
		$rejected  = array_map( 'intval', (array) ( $choices['rejected'] ?? array() ) );
		$out       = array(
			'switched'   => 0,
			'stayed'     => array(),
			'old_hidden' => false,
		);
		foreach ( self::chosen( $choices ) as $form_id ) {
			if ( in_array( $form_id, $rejected, true ) ) {
				continue;
			}
			$form = (array) $forms->by_id( $form_id );
			if ( 'new' === $choices['look'] && null === $forms->draft( $form_id ) ) {
				$document = $editor->editing( $form );
				if ( null !== $document ) {
					$document->style = self::new_look( $document->style ?? null );
					$editor->save_draft( $form, $document );
					$result   = $editor->publish( $form, 'setup:new_look' );
					$blockers = $result['ok'] ? (array) $result['warnings'] : array( (string) $result['code'] );
					FormRepository::flush();
					if ( $result['ok'] && FormRepository::RENDERER_V5 === ( $forms->by_id( $form_id )['renderer'] ?? '' ) ) {
						++$out['switched'];
					} else {
						$out['stayed'][ $form_id ] = array() === $blockers ? array( 'unknown' ) : $blockers;
					}
					continue;
				}
			}
			$blockers = $renderers->switch_to( $form_id, FormRepository::RENDERER_V5 );
			if ( array() === $blockers ) {
				++$out['switched'];
			} else {
				$out['stayed'][ $form_id ] = $blockers;
			}
		}
		// Forms the user kept on Funnelforms 3 here stay there, also when they had moved on their own.
		$moving = array_diff( self::chosen( $choices ), $rejected );
		foreach ( self::imported_forms() as $form ) {
			if ( in_array( $form['id'], $moving, true ) ) {
				AutoRenderer::unpin( $form['id'] );
				continue;
			}
			// Only a form the user left out on purpose; one that could not move yet may move later.
			$left_out = 'later' === $choices['forms'] || in_array( $form['id'], $rejected, true ) || ( 'pick' === $choices['forms'] && 'failed' !== $form['check'] && array() === $form['blockers'] );
			if ( ! $left_out ) {
				continue;
			}
			if ( FormRepository::RENDERER_V5 === $form['renderer'] && in_array( $form['id'], AutoRenderer::forms(), true ) ) {
				$forms->set_renderer( $form['id'], FormRepository::RENDERER_LEGACY, 'setup' );
			}
			AutoRenderer::pin( $form['id'] );
		}
		// The old interface goes by itself once no imported form needs it any more (Menu::legacy_shown).
		FormRepository::flush();
		$out['old_hidden'] = array() === self::still_on_legacy();
		FormRepository::flush();
		return $out;
	}

	/**
	 * IDs of imported forms that still run on 3.x.
	 *
	 * @return int[]
	 */
	public static function still_on_legacy(): array {
		$out = array();
		foreach ( ( new FormRepository() )->with_legacy_ids() as $row ) {
			if ( FormRepository::RENDERER_V5 !== $row['renderer'] ) {
				$out[] = (int) $row['id'];
			}
		}
		return $out;
	}

	/**
	 * A form's style moved to the Funnelforms design, keeping its main colour and font.
	 *
	 * @param mixed $style Style of the document.
	 */
	public static function new_look( $style ): object {
		$tokens = array();
		$old    = is_object( $style ) && isset( $style->tokens ) ? (array) $style->tokens : array();
		foreach ( array( 'color.primary', 'font.family' ) as $key ) {
			if ( isset( $old[ $key ] ) && is_string( $old[ $key ] ) && '' !== $old[ $key ] ) {
				$tokens[ $key ] = $old[ $key ];
			}
		}
		return (object) array(
			'preset' => 'default',
			'tokens' => (object) $tokens,
		);
	}

	/*
	 * New installation.
	 */

	/**
	 * Makes the first form from a template, with the notification going to the site's address.
	 *
	 * @param string $template Template id.
	 * @param string $email    Recipient of the notification.
	 * @return int|null Form ID; null without the template.
	 */
	public static function first_form( string $template, string $email ): ?int {
		$form_id = FormTemplates::create( $template );
		if ( null === $form_id ) {
			return null;
		}
		$form     = (array) ( new FormRepository() )->by_id( $form_id );
		$editor   = FormEditor::create();
		$document = $editor->editing( $form );
		if ( null !== $document ) {
			self::set_recipient( $document, $email );
			self::with_lead( $document );
			$document->style = self::new_look( $document->style ?? null );
			$editor->save_draft( $form, $document );
		}
		return $form_id;
	}

	/**
	 * Puts the lead block ({{lead}}: contact details, results, source) before the answers of the
	 * mails to the site owner, so the first form tells the whole lead.
	 *
	 * @param object $document Document, changed.
	 */
	private static function with_lead( object $document ): void {
		foreach ( is_array( $document->actions ?? null ) ? $document->actions : array() as $action ) {
			if ( ! is_object( $action ) || 'email' !== ( $action->kind ?? '' ) || ! isset( $action->config->body ) || ! is_object( $action->config->body ) ) {
				continue;
			}
			foreach ( get_object_vars( $action->config->body ) as $locale => $body ) {
				$body = (string) $body;
				if ( ! str_contains( $body, '{{lead}}' ) ) {
					$action->config->body->{$locale} = str_contains( $body, '{{answers}}' ) ? (string) preg_replace( '/\{\{answers\}\}/', "{{lead}}\n\n{{answers}}", $body, 1 ) : rtrim( $body ) . "\n\n{{lead}}";
				}
			}
		}
	}

	/**
	 * Puts the brand into the form's draft and keeps it as a saved style for later forms.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $color   Main colour (#rrggbb).
	 * @param string $font    Font family; empty for the default.
	 */
	public static function brand( int $form_id, string $color, string $font ): bool {
		$form = ( new FormRepository() )->by_id( $form_id );
		if ( null === $form ) {
			return false;
		}
		$editor   = FormEditor::create();
		$document = $editor->editing( $form );
		if ( null === $document ) {
			return false;
		}
		$tokens = array( 'color.primary' => $color );
		if ( '' !== $font ) {
			$tokens['font.family'] = $font;
		}
		$document->style = (object) array(
			'preset' => 'default',
			'tokens' => (object) $tokens,
		);
		$editor->save_draft( $form, $document );
		$names = array_column( StyleLibrary::all(), 'name' );
		if ( ! in_array( __( 'My brand', 'funnelforms-free' ), $names, true ) ) {
			StyleLibrary::add( __( 'My brand', 'funnelforms-free' ), $tokens );
		}
		return true;
	}

	/**
	 * Publishes the first form and, when asked, puts it on a new page.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $email   Recipient of the notification.
	 * @param string $page    Title of a new page; empty for none.
	 * @return array{ok:bool,code?:string,problems?:string[],shortcode?:string,page_id?:int,page_url?:string}
	 */
	public static function publish_first( int $form_id, string $email, string $page ): array {
		$forms = new FormRepository();
		$form  = $forms->by_id( $form_id );
		if ( null === $form ) {
			return array(
				'ok'   => false,
				'code' => 'form_not_found',
			);
		}
		$editor   = FormEditor::create();
		$document = $editor->editing( $form );
		if ( null !== $document && is_email( $email ) ) {
			self::set_recipient( $document, $email );
			$editor->save_draft( $form, $document );
		}
		if ( null !== $forms->draft( $form_id ) ) {
			$result = $editor->publish( $form, 'setup' );
			if ( ! $result['ok'] ) {
				return array(
					'ok'       => false,
					'code'     => (string) $result['code'],
					'problems' => (array) ( $result['problems'] ?? $result['missingRights'] ?? array() ),
				);
			}
		}
		FormRepository::flush();
		$form      = (array) $forms->by_id( $form_id );
		$shortcode = '[funnelforms uid="' . $form['uid'] . '"]';
		$out       = array(
			'ok'        => true,
			'shortcode' => $shortcode,
		);
		if ( '' !== $page ) {
			$page_id = wp_insert_post(
				array(
					'post_type'    => 'page',
					'post_status'  => 'publish',
					'post_title'   => $page,
					'post_content' => '<!-- wp:shortcode -->' . $shortcode . '<!-- /wp:shortcode -->',
				),
				true
			);
			if ( ! is_wp_error( $page_id ) ) {
				$out['page_id']  = (int) $page_id;
				$out['page_url'] = (string) get_permalink( (int) $page_id );
			}
		}
		return $out;
	}

	/**
	 * Sends the e-mail notifications of a document to one address; demo senders become the site.
	 *
	 * @param object $document Document, changed.
	 * @param string $email    Recipient.
	 */
	private static function set_recipient( object $document, string $email ): void {
		if ( ! is_email( $email ) || ! isset( $document->actions ) || ! is_array( $document->actions ) ) {
			return;
		}
		$host = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		foreach ( $document->actions as $action ) {
			if ( ! is_object( $action ) || 'email' !== ( $action->kind ?? '' ) || ! isset( $action->config ) ) {
				continue;
			}
			foreach ( array( 'to', 'from', 'fromName' ) as $key ) {
				if ( ! isset( $action->config->{$key} ) || ! is_object( $action->config->{$key} ) ) {
					continue;
				}
				foreach ( get_object_vars( $action->config->{$key} ) as $locale => $value ) {
					$value = (string) $value;
					if ( 'to' === $key ) {
						$action->config->to->{$locale} = $email;
					} elseif ( 'from' === $key && ( '' === $value || str_ends_with( strtolower( $value ), '@demo.de' ) ) ) {
						$action->config->from->{$locale} = 'wordpress@' . preg_replace( '/^www\./', '', $host );
					} elseif ( 'fromName' === $key && in_array( $value, array( '', 'Demo' ), true ) ) {
						$action->config->fromName->{$locale} = (string) get_bloginfo( 'name' );
					}
				}
			}
		}
	}
}
