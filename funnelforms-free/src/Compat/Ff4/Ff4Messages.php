<?php
/**
 * Notes of the import from Funnelforms 4, in words.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Ff4;

use Funnelforms\Compat\Import\Importer;

defined( 'ABSPATH' ) || exit;

/**
 * Ff4Converter notes what it changed or left behind as codes ("code" or "code:detail"); the
 * import shows them with these texts. Codes it shares with the import of other plugins are
 * described there (Importer::describe()).
 */
final class Ff4Messages {

	/**
	 * Texts of notes, each once.
	 *
	 * @param string[] $notes Notes.
	 * @return string[]
	 */
	public static function describe_all( array $notes ): array {
		$out = array();
		foreach ( $notes as $note ) {
			$out[] = self::describe( (string) $note );
		}
		return array_values( array_unique( $out ) );
	}

	/**
	 * Text of one note.
	 *
	 * @param string $note Note.
	 */
	public static function describe( string $note ): string {
		$parts  = explode( ':', $note, 2 );
		$detail = $parts[1] ?? '';
		switch ( $parts[0] ) {
			case 'ff4_no_logic_linear_order':
				return __( 'The form had no logic; its questions follow one another in their order.', 'funnelforms-free' );
			case 'ff4_start_not_connected':
				return __( 'The start of the logic led nowhere; the form starts with its first step. Check the order of the steps.', 'funnelforms-free' );
			case 'ff4_no_contact_step':
				return __( 'The form had no contact form; add a contact step before publishing.', 'funnelforms-free' );
			case 'ff4_node_without_field':
				return __( 'A step of the logic had no question and was left out.', 'funnelforms-free' );
			case 'ff4_condition_not_imported':
				/* translators: %s: label of a field */
				return sprintf( __( 'A condition on "%s" (range or region) has no counterpart; that path was left out. Rebuild it with branches.', 'funnelforms-free' ), $detail );
			case 'ff4_condition_now_works':
				/* translators: %s: label of a field */
				return sprintf( __( 'A path after "%s" checked whether an answer is empty or does not contain a text. Funnelforms 4 never took it; now it is taken. Check it.', 'funnelforms-free' ), $detail );
			case 'ff4_action_on_path_passed':
				return __( 'A webhook or AI call on a path of the logic was not taken over as a step; webhooks are sent with every entry.', 'funnelforms-free' );
			case 'ff4_webhooks_imported':
				return __( 'Webhooks send their data in the format of Funnelforms 4, so Zaps and scenarios keep working. Zapier and Make connected through the app must be connected again.', 'funnelforms-free' );
			case 'ff4_webhook_method_post':
				/* translators: %s: HTTP method such as PUT */
				return sprintf( __( 'A webhook used %s; it is sent with POST now.', 'funnelforms-free' ), $detail );
			case 'ff4_ai_leadcaller_not_imported':
				return __( 'The AI lead caller is a service of Funnelforms 4 and was not taken over.', 'funnelforms-free' );
			case 'ff4_sms_not_imported':
			case 'ff4_whatsapp_not_imported':
				return __( 'SMS and WhatsApp messages were not taken over; send them through a webhook or an integration.', 'funnelforms-free' );
			case 'ff4_admin_mail_without_recipient':
				return __( 'The e-mail to you had no recipient and was left out; the form sends no e-mail to you yet.', 'funnelforms-free' );
			case 'ff4_confirmation_without_email_field':
				return __( 'The confirmation e-mail had no e-mail field to send to and was left out.', 'funnelforms-free' );
			case 'ff4_actions_without_contact_step':
				return __( 'E-mails and webhooks are sent when the form is submitted; add a contact step so that it can be.', 'funnelforms-free' );
			case 'ff4_booking_calendar_not_imported':
				return __( 'Appointments: a booking type was created from the times of the field. Connect your calendar again and check the type.', 'funnelforms-free' );
			case 'ff4_booking_type_not_created':
				return __( 'The appointment field needs a booking type; choose one in the field before publishing.', 'funnelforms-free' );
			case 'ff4_password_not_imported':
				return __( 'The form was protected by a password; it was not taken over. Protect the page the form is on instead.', 'funnelforms-free' );
			case 'ff4_retention_days':
				/* translators: %s: number of days */
				return sprintf( __( 'Entries are deleted after %s days, as in Funnelforms 4.', 'funnelforms-free' ), $detail );
			case 'ff4_custom_javascript_not_imported':
				return __( 'Own JavaScript of the form was not taken over; add it to the tracking of the steps if you still need it.', 'funnelforms-free' );
			case 'ff4_custom_css_imported':
				return __( 'Own CSS was taken over; class names have changed, so check how the form looks.', 'funnelforms-free' );
			case 'ff4_tracking_code_imported':
				return __( 'Tracking codes were taken over; check them in the preview.', 'funnelforms-free' );
			case 'ff4_external_media':
				return __( 'Images and files still load from Funnelforms 4. Upload them to the media library and replace them before Funnelforms 4 is closed.', 'funnelforms-free' );
			case 'ff4_media_without_address':
				/* translators: %s: label of a field */
				return sprintf( __( 'Image or video "%s" had no address; add it.', 'funnelforms-free' ), $detail );
			case 'ff4_icon_not_found':
				/* translators: %s: name of an icon */
				return sprintf( __( 'Icon "%s" does not exist here; the answer has no icon.', 'funnelforms-free' ), $detail );
			case 'ff4_contact_multiselect_single':
				/* translators: %s: label of a field */
				return sprintf( __( 'The selection "%s" allowed several answers; it allows one now.', 'funnelforms-free' ), $detail );
			case 'ff4_background_image_not_imported':
				return __( 'The background image was not taken over; choose it again in the design.', 'funnelforms-free' );
			case 'ff4_custom_font_not_imported':
			case 'ff4_font':
				/* translators: %s: name of a font */
				return sprintf( __( 'The form uses the font "%s"; it shows only when the website loads it.', 'funnelforms-free' ), $detail );
		}
		return Importer::describe( $note );
	}
}
