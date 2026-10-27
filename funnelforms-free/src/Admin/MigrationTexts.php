<?php
/**
 * Plain words for the migration: problems with their fixes, checks and the timeline.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Compat\Legacy\LegacyRepository;
use Funnelforms\Compat\Migration\FormVerifier;
use Funnelforms\Compat\Safety\LegacyBackup;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Repository\FormRepository;

defined( 'ABSPATH' ) || exit;

/**
 * The migration page and the setup assistant speak to people who never saw the inside of a form:
 * every technical code gets a title, an explanation and, where there is one, the fix with a link.
 */
final class MigrationTexts {

	/**
	 * A reason that keeps a form on Funnelforms 3, explained.
	 *
	 * @param string $code    Blocker code (FormRenderer::blockers()).
	 * @param int    $form_id Form ID, for links into the builder.
	 * @return array{title:string,text:string,fix:string,link:string,url:string}
	 */
	public static function blocker( string $code, int $form_id = 0 ): array {
		$parts   = explode( ':', $code );
		$detail  = implode( ':', array_slice( $parts, 1 ) );
		$builder = $form_id > 0 ? add_query_arg( 'form', $form_id, admin_url( 'admin.php?page=' . BuilderPage::SLUG ) ) : admin_url( 'admin.php?page=' . BuilderPage::SLUG );
		$open    = __( 'Open in the form builder', 'funnelforms-free' );
		// Funnelforms Free: a Pro feature keeps the form off (Edition::problems()).
		if ( str_starts_with( $code, 'pro feature ' ) ) {
			$label = MigrationPage::blocker_label( $code );
			return array(
				'title' => $label,
				/* translators: %s: name of a Pro feature */
				'text'  => sprintf( __( 'The form uses “%s”, which is part of Funnelforms Pro, so Funnelforms Free cannot publish it.', 'funnelforms-free' ), $label ),
				'fix'   => __( 'Open the form in the form builder; it shows what is missing.', 'funnelforms-free' ),
				'link'  => $open,
				'url'   => $builder,
			);
		}
		$text = match ( $parts[0] ) {
			'needs_review'               => array(
				__( 'The comparison found differences', 'funnelforms-free' ),
				__( 'Funnelforms played every path and calculation of this form in Funnelforms 3 and in Funnelforms 5 and found differences. Often they are in Funnelforms 3 itself, for example an answer that leads nowhere. So that your visitors see exactly what they know, the form stays on Funnelforms 3 until you had a look.', 'funnelforms-free' ),
				__( 'Read what was found and compare both versions side by side. Then open the form in the form builder, fix what is needed and publish it: from then on the published version counts and the form moves to Funnelforms 5.', 'funnelforms-free' ),
				$open,
				$builder,
			),
			'not_verified'               => array(
				__( 'The form has not been checked yet', 'funnelforms-free' ),
				__( 'The copy of this form has not been compared with Funnelforms 3 yet, or the comparison could not finish. Until it has, the form stays on Funnelforms 3.', 'funnelforms-free' ),
				__( 'Import the form again on its page under Migration → Forms. That copies and checks it once more.', 'funnelforms-free' ),
				__( 'See the details', 'funnelforms-free' ),
				$form_id > 0 ? MigrationPage::url(
					array(
						'tab'  => 'forms',
						'form' => $form_id,
					)
				) : MigrationPage::url( array( 'tab' => 'forms' ) ),
			),
			'runtime_not_built'          => array(
				__( 'The new form display is missing', 'funnelforms-free' ),
				__( 'This installation of Funnelforms 5 is incomplete: the script that shows forms to visitors is missing.', 'funnelforms-free' ),
				( Edition::is_free() ? __( 'Install the plugin again from wordpress.org. If that does not help, ask in the support forum.', 'funnelforms-free' ) : __( 'Install the plugin again from your Funnelforms account. If that does not help, our support will.', 'funnelforms-free' ) ),
				( Edition::is_free() ? __( 'Support forum', 'funnelforms-free' ) : __( 'Contact support', 'funnelforms-free' ) ),
				Ui::support_url(),
			),
			'no_document'                => array(
				__( 'The form could not be read', 'funnelforms-free' ),
				__( 'Funnelforms 3 stored this form in a way that could not be read, so there is no copy yet. The form keeps running on Funnelforms 3, unchanged.', 'funnelforms-free' ),
				__( 'Open the form in Funnelforms 3, save it once and import it again here. If it still fails, send us a support request; the diagnosis tells us what we need.', 'funnelforms-free' ),
				'',
				'',
			),
			'no_backup'                  => array(
				__( 'No restore point yet', 'funnelforms-free' ),
				__( 'Forms move to Funnelforms 5 only once a restore point of your Funnelforms 3 data exists, so you can always go back.', 'funnelforms-free' ),
				( MigrationPage::way_back() ? __( 'Create a restore point. It takes a few seconds.', 'funnelforms-free' ) : __( 'The restore point could not be saved. Please ask in the support forum.', 'funnelforms-free' ) ),
				( MigrationPage::way_back() ? __( 'Go to the way back', 'funnelforms-free' ) : __( 'Support forum', 'funnelforms-free' ) ),
				( MigrationPage::way_back() ? MigrationPage::url( array( 'tab' => 'wayback' ) ) : Ui::support_url() ),
			),
			'rollback_active'            => array(
				__( 'You went back to Funnelforms 3', 'funnelforms-free' ),
				__( 'While your site runs on Funnelforms 3 again, no form moves to Funnelforms 5.', 'funnelforms-free' ),
				__( 'Go forward to Funnelforms 5 with one click; the forms that ran there before come along.', 'funnelforms-free' ),
				__( 'Go to the way back', 'funnelforms-free' ),
				MigrationPage::url( array( 'tab' => 'wayback' ) ),
			),
			'tracking_code_not_allowed', 'script_in_content' => array(
				__( 'The form contains tracking code or scripts', 'funnelforms-free' ),
				__( 'Code in a form runs on your website. Funnelforms 5 runs it only once an administrator has allowed code in forms.', 'funnelforms-free' ),
				__( 'If you trust the code, allow tracking code under Settings → General. Otherwise remove it in the form builder.', 'funnelforms-free' ),
				__( 'Open the settings', 'funnelforms-free' ),
				SettingsPage::url(),
			),
			'input_mask'                 => array(
				__( 'A field with an input mask Funnelforms 5 does not know', 'funnelforms-free' ),
				__( 'A field of this form makes visitors type in a fixed pattern (an input mask). Funnelforms 5 knows the common masks of digits, letters and fixed characters, but not this one.', 'funnelforms-free' ),
				__( 'Keep the form on Funnelforms 3 for now, or change or remove the input mask in the form builder and check the field there.', 'funnelforms-free' ),
				$open,
				$builder,
			),
			'captcha_not_configured'     => array(
				__( 'The spam protection has no keys', 'funnelforms-free' ),
				__( 'The form asks visitors to pass a captcha (such as reCAPTCHA), but Funnelforms 5 has no keys for it. Without them nobody could send the form.', 'funnelforms-free' ),
				__( 'Choose Cloudflare Turnstile or hCaptcha with its keys under Settings → Entries and spam, then remove the old captcha field in the form builder. Every form also keeps its hidden spam checks.', 'funnelforms-free' ),
				__( 'Open the settings', 'funnelforms-free' ),
				SettingsPage::url( 'entries' ),
			),
			'sms_not_configured'         => array(
				__( 'The text messages have no connection', 'funnelforms-free' ),
				__( 'A phone field of this form asks visitors to confirm their number with a code by text message, but no SMS connection of Twilio or Bird is chosen for it. Funnelforms 3 sent these codes through MessageBird, which Funnelforms 5 no longer supports; until then the form keeps running on Funnelforms 3.', 'funnelforms-free' ),
				__( 'Open the form in the form builder, select the phone field and choose or add a Twilio or Bird connection under "Confirm by text message".', 'funnelforms-free' ),
				$open,
				$builder,
			),
			'google_maps_key_missing'    => array(
				__( 'The Google Maps key is missing', 'funnelforms-free' ),
				__( 'An address field of this form suggests addresses with Google Maps, which needs your Google Maps key.', 'funnelforms-free' ),
				__( 'Enter the key under Settings → General.', 'funnelforms-free' ),
				__( 'Open the settings', 'funnelforms-free' ),
				SettingsPage::url(),
			),
			'booking_type_missing'       => array(
				__( 'An appointment type is missing', 'funnelforms-free' ),
				__( 'A booking question of this form points to an appointment type that no longer exists.', 'funnelforms-free' ),
				__( 'Open the form in the form builder and choose the appointment type of the booking question.', 'funnelforms-free' ),
				$open,
				$builder,
			),
			'booking_calendar_reconnect' => array(
				__( 'A calendar needs to be connected again', 'funnelforms-free' ),
				__( 'An appointment type of this form was connected to a calendar through Cronofy, which Funnelforms 5 no longer uses. Without the calendar, booked times could overlap with your other appointments.', 'funnelforms-free' ),
				__( 'Connect the calendar again in the form builder at the appointment type, or save the appointment type there once to use it without a calendar.', 'funnelforms-free' ),
				$open,
				$builder,
			),
			'field_type'                 => array(
				__( 'A kind of field Funnelforms 5 cannot show yet', 'funnelforms-free' ),
				/* translators: %s: technical name of a field type, e.g. file. */
				sprintf( __( 'The form uses a field of the type "%s", which the new form display does not support yet.', 'funnelforms-free' ), $detail ),
				__( 'Keep the form on Funnelforms 3 for now. Funnelforms moves it as soon as an update supports the field.', 'funnelforms-free' ),
				'',
				'',
			),
			'action'                     => array(
				__( 'A connection Funnelforms 5 does not offer yet', 'funnelforms-free' ),
				/* translators: %s: technical name of a connection, e.g. crm:hubspot. */
				sprintf( __( 'After sending, the form passes its entries to "%s". Funnelforms 5 cannot do that yet.', 'funnelforms-free' ), $detail ),
				__( 'Keep the form on Funnelforms 3 for now, or replace the connection in the form builder (for example with a webhook).', 'funnelforms-free' ),
				$open,
				$builder,
			),
			default                      => array(
				MigrationPage::blocker_label( $code ),
				__( 'This keeps the form on Funnelforms 3 for now.', 'funnelforms-free' ),
				__( 'Open the form in the form builder; it shows what is missing.', 'funnelforms-free' ),
				$open,
				$builder,
			),
		};
		return array(
			'title' => $text[0],
			'text'  => $text[1],
			'fix'   => $text[2],
			'link'  => $text[3],
			'url'   => $text[4],
		);
	}

	/**
	 * The five checks of a form, in words.
	 *
	 * @return array<string,string>
	 */
	public static function checks(): array {
		return array(
			'references'   => __( 'The form is complete and consistent', 'funnelforms-free' ),
			'nodes'        => __( 'Every question and contact form is there', 'funnelforms-free' ),
			'navigation'   => __( 'Every answer leads to the same next step', 'funnelforms-free' ),
			'calculations' => __( 'Every calculation gives the same result', 'funnelforms-free' ),
			'notes'        => __( 'Nothing unusual in the Funnelforms 3 form', 'funnelforms-free' ),
		);
	}

	/**
	 * A finding of a check, in words (the technical detail is shown beside it for support).
	 *
	 * @param string $check  Check name.
	 * @param string $detail Technical detail.
	 */
	public static function finding( string $check, string $detail ): string {
		$code = explode( ':', $detail, 2 )[0];
		$text = match ( $code ) {
			'missing_post'                 => __( 'The form uses a question or contact form that was deleted in Funnelforms 3.', 'funnelforms-free' ),
			'unexpected_post_type'         => __( 'The form points to something that is not a question or contact form.', 'funnelforms-free' ),
			'unknown_node'                 => __( 'A step of the form has a kind Funnelforms does not know.', 'funnelforms-free' ),
			'unknown_question_type'        => __( 'A question has a kind Funnelforms 5 does not know; it was left out.', 'funnelforms-free' ),
			'unknown_contact_field_type'   => __( 'A contact field has a kind Funnelforms 5 does not know; it was left out.', 'funnelforms-free' ),
			'connection_to_missing_node'   => __( 'An answer leads to a step that does not exist.', 'funnelforms-free' ),
			'dead_end_in_3x'               => __( 'In Funnelforms 3, one answer leads nowhere: visitors get stuck there today.', 'funnelforms-free' ),
			'calculation_fails_in_3x'      => __( 'A calculation already fails in Funnelforms 3.', 'funnelforms-free' ),
			'missing_calculation'          => __( 'The form uses a calculation that was deleted in Funnelforms 3.', 'funnelforms-free' ),
			'booking_without_event_type'   => __( 'A booking question has no appointment type.', 'funnelforms-free' ),
			'interface_shifts_nodes_in_3x' => __( 'The Funnelforms 3 editor had moved steps of this form; the order was taken as Funnelforms 3 shows it.', 'funnelforms-free' ),
			default                        => '',
		};
		if ( '' !== $text ) {
			return $text;
		}
		return match ( $check ) {
			'navigation'   => __( 'An answer leads to a different step than in Funnelforms 3.', 'funnelforms-free' ),
			'calculations' => __( 'A calculation gives a different result than in Funnelforms 3.', 'funnelforms-free' ),
			'nodes'        => str_contains( $detail, 'sends no mail' ) ? __( 'A contact form sends no e-mail.', 'funnelforms-free' ) : __( 'A question or contact form was not taken over completely.', 'funnelforms-free' ),
			'references'   => __( 'The copy has a part that points nowhere.', 'funnelforms-free' ),
			default        => __( 'Something in the Funnelforms 3 form needs a look.', 'funnelforms-free' ),
		};
	}

	/**
	 * Label of the check of a form, as a badge.
	 *
	 * @param string $check   verified, needs_review, failed or edited.
	 * @param bool   $blocked Whether something keeps the form on Funnelforms 3.
	 */
	public static function check_badge( string $check, bool $blocked = false ): string {
		return match ( $check ) {
			FormVerifier::VERIFIED     => Ui::badge( __( 'Checked', 'funnelforms-free' ), 'success' ),
			'edited'                   => Ui::badge( __( 'Edited in Funnelforms 5', 'funnelforms-free' ), 'info' ),
			FormVerifier::NEEDS_REVIEW => Ui::badge( __( 'Please have a look', 'funnelforms-free' ), 'warning' ),
			default                    => $blocked ? Ui::badge( __( 'Stays on Funnelforms 3', 'funnelforms-free' ) ) : Ui::badge( __( 'Could not be copied', 'funnelforms-free' ), 'danger' ),
		};
	}

	/**
	 * Where a form stands, as a badge: on 5, ready to move, to look at, or staying on 3.
	 *
	 * @param string $state MigrationReport::state().
	 * @param string $check verified, needs_review, failed or edited.
	 */
	public static function state_badge( string $state, string $check ): string {
		return match ( $state ) {
			'v5'     => Ui::badge( __( 'On Funnelforms 5', 'funnelforms-free' ), 'success' ),
			'review' => Ui::badge( __( 'Please have a look', 'funnelforms-free' ), 'warning' ),
			'stays'  => FormVerifier::FAILED === $check ? Ui::badge( __( 'Could not be checked', 'funnelforms-free' ), 'danger' ) : Ui::badge( __( 'Stays on Funnelforms 3', 'funnelforms-free' ) ),
			default  => 'edited' === $check ? Ui::badge( __( 'Edited in Funnelforms 5', 'funnelforms-free' ), 'info' ) : Ui::badge( __( 'Checked and ready', 'funnelforms-free' ), 'success' ),
		};
	}

	/**
	 * What the checks of a form found, in words, each finding once.
	 *
	 * @param array<string,mixed> $checks Checks of the form (name => status and details).
	 * @return list<string>
	 */
	public static function findings( array $checks ): array {
		$out = array();
		foreach ( array_keys( self::checks() ) as $name ) {
			foreach ( (array) ( $checks[ $name ]['details'] ?? array() ) as $detail ) {
				$out[] = self::finding( $name, (string) $detail );
			}
		}
		return array_values( array_unique( $out ) );
	}

	/**
	 * In one line why a form does not run on Funnelforms 5 yet: the first finding of its check
	 * when it needs a look, else the first reason that keeps it on Funnelforms 3.
	 *
	 * @param array<string,mixed> $form MigrationReport::forms() or SetupFlow::imported_forms() row.
	 */
	public static function why( array $form ): string {
		if ( 'review' === ( $form['state'] ?? '' ) ) {
			$findings = self::findings( (array) ( $form['checks'] ?? array() ) );
			return $findings[0] ?? self::blocker( 'needs_review' )['title'];
		}
		$blockers = (array) ( $form['blockers'] ?? array() );
		return array() === $blockers ? '' : self::blocker( (string) $blockers[0], (int) ( $form['id'] ?? 0 ) )['title'];
	}

	/**
	 * Name of a kind of 3.x data.
	 *
	 * @param string $kind forms, leads, bookings, booking_types, files.
	 */
	public static function kind( string $kind ): string {
		return match ( $kind ) {
			'forms'         => __( 'Forms', 'funnelforms-free' ),
			'leads'         => __( 'Leads', 'funnelforms-free' ),
			'bookings'      => __( 'Appointments', 'funnelforms-free' ),
			'booking_types' => __( 'Appointment types', 'funnelforms-free' ),
			'files'         => __( 'Uploaded files', 'funnelforms-free' ),
			default         => $kind,
		};
	}

	/**
	 * Name of a kind of row in a restore point.
	 *
	 * @param string $kind Post type, meta or options.
	 */
	public static function row_kind( string $kind ): string {
		return match ( $kind ) {
			LegacyRepository::FORM         => __( 'Forms', 'funnelforms-free' ),
			LegacyRepository::QUESTION     => __( 'Questions', 'funnelforms-free' ),
			LegacyRepository::CONTACT_FORM => __( 'Contact forms', 'funnelforms-free' ),
			LegacyRepository::CALCULATION  => __( 'Calculations', 'funnelforms-free' ),
			LegacyRepository::LEAD         => __( 'Leads', 'funnelforms-free' ),
			LegacyRepository::BOOKING      => __( 'Appointments', 'funnelforms-free' ),
			LegacyRepository::BOOKING_TYPE => __( 'Appointment types', 'funnelforms-free' ),
			'meta'                         => __( 'Additional values', 'funnelforms-free' ),
			'options'                      => __( 'Settings', 'funnelforms-free' ),
			default                        => __( 'Other', 'funnelforms-free' ),
		};
	}

	/**
	 * One event of the timeline, in words.
	 *
	 * @param array<string,mixed> $event MigrationLog::timeline() event.
	 * @return array{icon:string,tone:string,title:string,text:string}
	 */
	public static function event( array $event ): array {
		$d     = (array) $event['details'];
		$count = (int) $event['count'];
		switch ( $event['action'] ) {
			case 'migration_started':
				return self::line( 'database', 'info', __( 'Copy of your Funnelforms 3 data started', 'funnelforms-free' ), __( 'Forms, leads, appointments and connections are copied; Funnelforms 3 is only read.', 'funnelforms-free' ) );
			case 'migration_finished':
				if ( 'full' === $event['object'] ) {
					$summary = (array) ( $d['summary'] ?? $d );
					$forms   = array_sum( array_map( 'intval', (array) ( $summary[ LegacyRepository::FORM ] ?? array() ) ) );
					$leads   = array_sum( array_map( 'intval', (array) ( $summary[ LegacyRepository::LEAD ] ?? array() ) ) );
					/* translators: 1: number of forms, 2: number of leads. */
					return self::line( 'check', 'success', __( 'Copy finished', 'funnelforms-free' ), sprintf( __( '%1$s forms and %2$s leads are in Funnelforms 5 and were checked.', 'funnelforms-free' ), number_format_i18n( $forms ), number_format_i18n( $leads ) ) );
				}
				$changes = (array) ( $d['changes'] ?? array() );
				$parts   = array();
				if ( ! empty( $changes[ LegacyRepository::LEAD ] ) ) {
					$n = (int) $changes[ LegacyRepository::LEAD ];
					/* translators: %s: number of leads. */
					$parts[] = sprintf( _n( '%s new or changed lead copied', '%s new or changed leads copied', $n, 'funnelforms-free' ), number_format_i18n( $n ) );
				}
				if ( ! empty( $changes[ LegacyRepository::FORM ] ) ) {
					$n = (int) $changes[ LegacyRepository::FORM ];
					/* translators: %s: number of forms. */
					$parts[] = sprintf( _n( '%s changed form copied again', '%s changed forms copied again', $n, 'funnelforms-free' ), number_format_i18n( $n ) );
				}
				if ( ! empty( $changes[ LegacyRepository::BOOKING ] ) ) {
					$n = (int) $changes[ LegacyRepository::BOOKING ];
					/* translators: %s: number of appointments. */
					$parts[] = sprintf( _n( '%s appointment copied', '%s appointments copied', $n, 'funnelforms-free' ), number_format_i18n( $n ) );
				}
				if ( ! empty( $changes['removed'] ) ) {
					$n = (int) $changes['removed'];
					/* translators: %s: number of leads. */
					$parts[] = sprintf( _n( '%s copy removed', '%s copies removed', $n, 'funnelforms-free' ), number_format_i18n( $n ) );
				}
				return self::line( 'history', 'info', __( 'Funnelforms 5 caught up with Funnelforms 3', 'funnelforms-free' ), array() === $parts ? __( 'New and changed data of Funnelforms 3 was copied.', 'funnelforms-free' ) : implode( ', ', $parts ) . '.' );
			case 'migration_entries_removed':
				$n = (int) ( $d['count'] ?? 0 );
				/* translators: %s: number of leads. */
				return self::line( 'inbox', 'neutral', __( 'Copies of deleted leads removed', 'funnelforms-free' ), sprintf( _n( '%s lead was deleted in Funnelforms 3, so its copy went too.', '%s leads were deleted in Funnelforms 3, so their copies went too.', $n, 'funnelforms-free' ), number_format_i18n( $n ) ) );
			case 'migration_removal_held':
				$n = (int) ( $d['count'] ?? 0 );
				/* translators: %s: number of leads. */
				return self::line( 'shield', 'warning', __( 'Copies kept to be safe', 'funnelforms-free' ), sprintf( _n( '%s lead vanished from Funnelforms 3 at once with many others. Its copy in Funnelforms 5 was kept.', '%s leads vanished from Funnelforms 3 at once. Their copies in Funnelforms 5 were kept.', $n, 'funnelforms-free' ), number_format_i18n( $n ) ) );
			case 'migration_form_reimported':
				$title = self::form_title( 0, (int) $event['object'] );
				return self::line( 'history', FormVerifier::VERIFIED === ( $d['status'] ?? '' ) ? 'success' : 'warning', __( 'Form imported again', 'funnelforms-free' ), $title . ' · ' . wp_strip_all_tags( self::check_badge( (string) ( $d['status'] ?? '' ) ) ) );
			case 'form_renderer':
				$v5     = FormRepository::RENDERER_V5 === ( $d['renderer'] ?? '' );
				$reason = (string) ( $d['reason'] ?? '' );
				$title  = 1 === $count ? self::form_title( (int) $event['object'] ) : '';
				if ( $v5 && 'auto' === $reason ) {
					/* translators: %s: number of forms. */
					$text = 1 === $count ? $title : sprintf( _n( '%s form', '%s forms', $count, 'funnelforms-free' ), number_format_i18n( $count ) );
					return self::line( 'rocket', 'success', 1 === $count ? __( 'A checked form moved to Funnelforms 5 on its own', 'funnelforms-free' ) : __( 'Checked forms moved to Funnelforms 5 on their own', 'funnelforms-free' ), $text );
				}
				if ( 'auto_off' === $reason ) {
					/* translators: %s: number of forms. */
					$text = 1 === $count ? $title : sprintf( _n( '%s form', '%s forms', $count, 'funnelforms-free' ), number_format_i18n( $count ) );
					return self::line( 'undo', 'neutral', __( 'Automatic move switched off', 'funnelforms-free' ), $text . ' · ' . __( 'back on Funnelforms 3', 'funnelforms-free' ) );
				}
				if ( $v5 ) {
					/* translators: %s: number of forms. */
					$text = 1 === $count ? $title : sprintf( _n( '%s form', '%s forms', $count, 'funnelforms-free' ), number_format_i18n( $count ) );
					return self::line( 'rocket', 'success', 1 === $count ? __( 'A form moved to Funnelforms 5', 'funnelforms-free' ) : __( 'Forms moved to Funnelforms 5', 'funnelforms-free' ), $text );
				}
				if ( str_starts_with( $reason, 'reimport' ) ) {
					return self::line( 'undo', 'warning', __( 'Back on Funnelforms 3 after a change', 'funnelforms-free' ), $title . ' · ' . __( 'The form was changed in Funnelforms 3 and needs a look before it moves again.', 'funnelforms-free' ) );
				}
				/* translators: %s: number of forms. */
				$text = 1 === $count ? $title : sprintf( _n( '%s form', '%s forms', $count, 'funnelforms-free' ), number_format_i18n( $count ) );
				return self::line( 'undo', 'neutral', 1 === $count ? __( 'A form went back to Funnelforms 3', 'funnelforms-free' ) : __( 'Forms went back to Funnelforms 3', 'funnelforms-free' ), $text );
			case 'backup_written':
				$forms = (int) ( $d['forms'] ?? 0 );
				$leads = (int) ( $d['leads'] ?? 0 );
				/* translators: 1: occasion, 2: number of forms, 3: number of leads, 4: file size. */
				return self::line( 'database', 'success', __( 'Restore point saved', 'funnelforms-free' ), sprintf( __( '%1$s · %2$s forms, %3$s leads · %4$s', 'funnelforms-free' ), SafetySection::reason_label( (string) ( $d['reason'] ?? '' ) ), number_format_i18n( $forms ), number_format_i18n( $leads ), size_format( (int) ( $d['bytes'] ?? 0 ) ) ) );
			case 'backup_failed':
				return self::line( 'database', 'danger', __( 'Restore point could not be saved', 'funnelforms-free' ), SafetySection::error_label( (string) ( $d['error'] ?? '' ) ) );
			case 'backups_deleted':
				$n = (int) ( $d['count'] ?? 0 );
				return self::line(
					'database',
					'neutral',
					_n( 'Restore point deleted', 'Restore points deleted', $n, 'funnelforms-free' ),
					'age' === ( $d['why'] ?? '' )
						/* translators: %d: number of days (30 or more). */
						? sprintf( _n( 'The move is complete, and the restore point was older than %d days.', 'The move is complete, and the restore points were older than %d days.', $n, 'funnelforms-free' ), LegacyBackup::max_age() )
						: __( 'Deleted on request.', 'funnelforms-free' )
				);
			case 'restore_started':
				/* translators: %s: date and time of the restore point. */
				return self::line( 'history', 'info', __( 'Restore started', 'funnelforms-free' ), sprintf( __( 'Funnelforms 3 is put back to the restore point of %s.', 'funnelforms-free' ), SafetySection::date( (string) ( $d['created_at'] ?? '' ) ) ) );
			case 'restore_done':
				/* translators: 1: rows put back, 2: rows changed back. */
				return self::line( 'history', 'success', __( 'Restore finished', 'funnelforms-free' ), sprintf( __( '%1$s rows put back, %2$s changed back. Newer data was kept.', 'funnelforms-free' ), number_format_i18n( (int) ( $d['restored'] ?? 0 ) ), number_format_i18n( (int) ( $d['updated'] ?? 0 ) ) ) );
			case 'legacy_check':
				$missing = (int) ( $d['missing'] ?? 0 );
				$changed = (int) ( $d['changed'] ?? 0 );
				if ( 0 === $missing && 0 === $changed ) {
					return self::line( 'shield', 'success', __( 'Funnelforms 3 data checked', 'funnelforms-free' ), __( 'Everything of the restore point is still there, unchanged.', 'funnelforms-free' ) );
				}
				/* translators: 1: rows missing, 2: rows changed. */
				return self::line( 'shield', 0 < $missing ? 'warning' : 'info', __( 'Funnelforms 3 data checked', 'funnelforms-free' ), sprintf( __( 'Since the restore point: %1$s rows missing, %2$s changed.', 'funnelforms-free' ), number_format_i18n( $missing ), number_format_i18n( $changed ) ) );
			case 'rollback':
				$n = (int) ( $d['forms'] ?? 0 );
				/* translators: %s: number of forms. */
				return self::line( 'undo', 'warning', __( 'Back to Funnelforms 3', 'funnelforms-free' ), sprintf( _n( '%s form runs on Funnelforms 3 again, and its menu is back.', '%s forms run on Funnelforms 3 again, and its menu is back.', $n, 'funnelforms-free' ), number_format_i18n( $n ) ) );
			case 'rollforward':
				$n = (int) ( $d['switched'] ?? 0 );
				/* translators: %s: number of forms. */
				return self::line( 'rocket', 'success', __( 'Forward to Funnelforms 5 again', 'funnelforms-free' ), sprintf( _n( '%s form runs on Funnelforms 5 again.', '%s forms run on Funnelforms 5 again.', $n, 'funnelforms-free' ), number_format_i18n( $n ) ) );
		}
		return self::line( 'activity', 'neutral', (string) $event['action'], '' );
	}

	/**
	 * Who did something: the person, or Funnelforms on its own.
	 *
	 * @param int $user User ID; 0 for automatic.
	 */
	public static function actor( int $user ): string {
		$data = $user > 0 ? get_userdata( $user ) : false;
		return false === $data ? __( 'Automatically', 'funnelforms-free' ) : (string) $data->display_name;
	}

	/**
	 * Title of a form for the timeline.
	 *
	 * @param int $form_id   Form ID (or 0).
	 * @param int $legacy_id 3.x form ID (or 0).
	 */
	private static function form_title( int $form_id, int $legacy_id = 0 ): string {
		$forms = new FormRepository();
		$form  = $form_id > 0 ? $forms->by_id( $form_id ) : $forms->by_legacy_id( $legacy_id );
		if ( null === $form ) {
			/* translators: %d: ID of the form. */
			return sprintf( __( 'Form #%d', 'funnelforms-free' ), $form_id > 0 ? $form_id : $legacy_id );
		}
		return '' !== (string) $form['title'] ? (string) $form['title'] : __( '(no title)', 'funnelforms-free' );
	}

	/**
	 * An event line.
	 *
	 * @param string $icon  Icon.
	 * @param string $tone  success, warning, danger, info or neutral.
	 * @param string $title Title.
	 * @param string $text  Text.
	 * @return array{icon:string,tone:string,title:string,text:string}
	 */
	private static function line( string $icon, string $tone, string $title, string $text ): array {
		return array(
			'icon'  => $icon,
			'tone'  => $tone,
			'title' => $title,
			'text'  => $text,
		);
	}
}
