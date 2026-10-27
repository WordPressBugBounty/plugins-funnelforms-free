<?php
/**
 * Suggested text for the privacy policy of the site (Settings → Privacy → Policy guide).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\PrivacyMode;
use Funnelforms\Application\Retention;
use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * The section describes what the plugin processes on the site. Paragraphs with the class
 * privacy-policy-tutorial are notes for the operator; WordPress shows them but leaves them out
 * when the text is copied. Places in square brackets are for the operator to choose or fill in.
 * Until a professional has reviewed the text it is marked as a draft.
 */
final class PrivacyPolicyText {

	/**
	 * Registers the text.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'add' ) );
	}

	/**
	 * Adds the text to the policy guide.
	 */
	public static function add(): void {
		if ( function_exists( 'wp_add_privacy_policy_content' ) ) {
			wp_add_privacy_policy_content( self::plugin(), self::html() );
		}
	}

	/**
	 * Name of the plugin on this site.
	 */
	private static function plugin(): string {
		return Edition::is_free() ? 'Funnelforms Free' : 'Funnelforms Pro';
	}

	/**
	 * The section as HTML.
	 */
	public static function html(): string {
		$days      = Retention::site_days();
		$free      = Edition::is_free();
		$retention = $days > 0
			/* translators: %d: number of days after which form entries are deleted. */
			? sprintf( _n( 'We delete form entries after %d day.', 'We delete form entries after %d days.', $days, 'funnelforms-free' ), $days )
			: __( 'We delete form entries after [fill in the period; the plugin does not delete entries automatically until you set one under Funnelforms → Settings].', 'funnelforms-free' );

		$eu   = PrivacyMode::eu();
		$note = static fn ( string $text ): string => '<p class="privacy-policy-tutorial">' . esc_html( $text ) . '</p>';
		$p    = static fn ( string $text ): string => '<p>' . esc_html( $text ) . '</p>';
		$h    = static fn ( string $text ): string => '<h2>' . esc_html( $text ) . '</h2>';
		$list = static fn ( array $items ): string => '<ul><li>' . implode( '</li><li>', array_map( 'esc_html', $items ) ) . '</li></ul>';

		return implode(
			'',
			array(
				$note( __( 'DRAFT, not legally binding: a professional (lawyer or data protection officer) must review this text before you use it.', 'funnelforms-free' ) ),
				/* translators: %s: name of the plugin (Funnelforms Pro or Funnelforms Free). */
				$note( sprintf( __( 'This section describes what %s processes on your website. You are the controller. Keep only the paragraphs for features you use, and fill in the places in square brackets.', 'funnelforms-free' ), self::plugin() ) ),
				$h( __( 'Forms on this website', 'funnelforms-free' ) ),
				/* translators: %s: name of the plugin (Funnelforms Pro or Funnelforms Free). */
				$p( sprintf( __( 'We use the WordPress plugin %s by Funnelforms LLC for enquiry and contact forms. The information you enter in a form is stored in the database of our website. It is not sent to the maker of the plugin.', 'funnelforms-free' ), self::plugin() ) ),
				$p( __( 'We process:', 'funnelforms-free' ) ),
				$list(
					array(
						__( 'the information you enter in the form fields,', 'funnelforms-free' ),
						__( 'your consents, if the form asks for them,', 'funnelforms-free' ),
						__( 'the page on which you submitted the form and campaign parameters (UTM) from the address,', 'funnelforms-free' ),
						__( 'uploaded files, if the form has an upload field.', 'funnelforms-free' ),
					)
				),
				$p( __( 'The purpose is to handle your enquiry. The legal basis is Art. 6(1)(b) GDPR where your enquiry relates to a contract, otherwise Art. 6(1)(f) GDPR (our interest in answering enquiries).', 'funnelforms-free' ) ),
				$note( __( 'Check the legal basis for each form.', 'funnelforms-free' ) ),
				$p( $retention . ' ' . __( 'We are notified of new entries by email.', 'funnelforms-free' ) ),
				// Partial entries, saving progress, popups, the optional features and support are Pro.
				$free ? '' : $p( __( 'The plugin only stores partially completed forms if we have enabled this. If you use "continue later", your progress is kept for no more than 30 days.', 'funnelforms-free' ) ),
				$free ? '' : $note( __( 'Only if a form reminds visitors who leave:', 'funnelforms-free' ) ),
				$free ? '' : $p( __( 'If you enter your email address in a form and leave without sending it, we keep the address, your name and your answers so far and send you one reminder with a link back to your answers [after one hour]. We do this only [if you tick the box for it / after the notice under the email field]. The legal basis is [your consent (Art. 6(1)(a) GDPR) / our legitimate interest in completing your enquiry (Art. 6(1)(f) GDPR)]. You can stop it with "Don\'t remind me" under the field or in the email; we then delete your address. We delete this data after 30 days at the latest.', 'funnelforms-free' ) ),
				$h( __( 'Form statistics', 'funnelforms-free' ) ),
				$p( __( 'The plugin counts how often a form is shown and submitted, which steps visitors go through in which order, and which fields stopped them because an entry was missing or not valid. It uses a random identifier per page view and stores only its hash, without IP address or browser details, for 400 days. These basic statistics store nothing in your browser and do not read anything from it.', 'funnelforms-free' ) ),
				Edition::is_pro() ? $p( self::extended( $eu ) ) : '',
				$free ? '' : $h( __( 'Browser storage', 'funnelforms-free' ) ),
				$free ? '' : $p( __( 'For forms shown as a popup, your browser stores in local storage that the popup has already been shown (the entry starts with "ffx-popup-"). The entry remains until you clear it in your browser.', 'funnelforms-free' ) ),
				$h( __( 'Abuse protection', 'funnelforms-free' ) ),
				$p( __( 'To prevent spam, the plugin limits the number of submissions. For this it stores a hash of your IP address for a short time. The legal basis is Art. 6(1)(f) GDPR.', 'funnelforms-free' ) ),
				$note( __( 'Only if a captcha is active:', 'funnelforms-free' ) ),
				$p( __( 'We also use [Google reCAPTCHA, Cloudflare Turnstile or hCaptcha]. The provider receives your IP address and details about your browser.', 'funnelforms-free' ) ),
				$note( __( 'Only if entries are checked with Akismet:', 'funnelforms-free' ) ),
				$p( __( 'To detect spam, we send your name, email address, the text you entered, your IP address and browser details to Akismet, a service of Automattic Inc., USA. Entries that look like spam are deleted automatically after [30] days. The legal basis is Art. 6(1)(f) GDPR.', 'funnelforms-free' ) ),
				$free ? '' : $h( __( 'Optional features', 'funnelforms-free' ) ),
				$free || $eu || PrivacyMode::open() ? '' : $note( __( 'The privacy mode "Global (opt-out)" is on: tracking code and services of other providers run without consent unless the visitor refuses. Do not use it for visitors from the EU.', 'funnelforms-free' ) ),
				$free || ! PrivacyMode::open() ? '' : $note( __( 'The privacy mode "Unrestricted" is on: tracking code, conversions and services of other providers run for every visitor, and refusals are ignored. The texts below about consent and objection do not match this mode; have the section rewritten by a lawyer.', 'funnelforms-free' ) ),
				$free ? '' : $note( __( 'Keep only what is active in your forms. You connect these services with your own account; the maker of the plugin does not receive any data. For providers outside the EU, state the safeguard for the transfer (adequacy decision or standard contractual clauses).', 'funnelforms-free' ) ),
				$free ? '' : $list(
					array(
						__( 'Address input with suggestions: Google Maps receives your input, your IP address and browser details.', 'funnelforms-free' ),
						__( 'Payments: [Stripe, PayPal or Mollie] receives the amount, currency, description and your email address.', 'funnelforms-free' ),
						__( 'Appointment booking: the appointment and attendee details go to our calendar at [Google, Microsoft or CalDAV server].', 'funnelforms-free' ),
						__( 'Forwarding to CRM, newsletter or messenger: the form data goes to [service, for example HubSpot, KlickTipp, Slack].', 'funnelforms-free' ),
						// Conversions to Meta, TikTok and GA4 need a yes in both privacy modes (ProActions::conversion()).
						__( 'Conversion tracking: with your consent we send [Meta, TikTok or Google] your hashed email address and phone number, IP address, browser details and cookie identifiers. The legal basis is your consent (Art. 6(1)(a) GDPR), which you can withdraw at any time.', 'funnelforms-free' ),
					)
				),
				// In the global mode a Google Ads conversion without "Only with the visitor's consent" goes out unless the visitor refuses (runtime ads.ts).
				$free || $eu ? '' : $note( __( 'Only if a Google Ads conversion in your forms is not set to "Only with the visitor\'s consent":', 'funnelforms-free' ) ),
				$free || $eu ? '' : $p( __( 'Google Ads conversions: unless you object, our Google tag reports to Google Ads that you submitted a form, with the value of your enquiry and, if enhanced conversions are on, your email address and phone number, which the tag hashes before sending. The legal basis is our legitimate interest in measuring our advertising (Art. 6(1)(f) GDPR). You can object in our cookie settings; we also respect the Global Privacy Control signal of your browser.', 'funnelforms-free' ) ),
				$free ? '' : $h( __( 'Support by the maker of the plugin', 'funnelforms-free' ) ),
				$free ? '' : $note( __( 'Only include this if you have a data processing agreement with Funnelforms LLC.', 'funnelforms-free' ) ),
				$free ? '' : $p( __( 'If we use the support of the maker, they may view form entries through time-limited access. We have concluded a data processing agreement with Funnelforms LLC for this.', 'funnelforms-free' ) ),
			)
		);
	}

	/**
	 * The paragraph on the extended statistics (visitor id in local storage), by privacy mode.
	 *
	 * @param bool $eu EU mode: only with consent; otherwise unless the visitor objects.
	 */
	private static function extended( bool $eu ): string {
		$what = __( 'the fields you filled in and the last one before you left the form, the kind of device (mobile, tablet or desktop, taken from the width of the window), and whether you used the form before. For this, your browser keeps a random identifier in local storage (key "ffx_vid") for 180 days from when it was created. We store only a hash of the identifier on our server, for 400 days. The purpose is to improve our forms. The data is not passed on to others.', 'funnelforms-free' );
		return $eu
			/* translators: %s: what the extended statistics record, a sentence fragment that starts in lower case. */
			? sprintf( __( 'Extended form statistics: only if you consent to statistics in our cookie settings, the plugin also records %s The legal basis is your consent (Art. 6(1)(a) GDPR; for the storage in your browser § 25(1) TDDDG), which you can withdraw at any time; the identifier is then deleted from your browser the next time a page with one of our forms loads.', 'funnelforms-free' ), $what )
			/* translators: %s: what the extended statistics record, a sentence fragment that starts in lower case. */
			: sprintf( __( 'Extended form statistics: unless you object, the plugin also records %s The legal basis is our legitimate interest in improving our forms (Art. 6(1)(f) GDPR). You can object in our cookie settings; we also respect the Global Privacy Control signal of your browser. After an objection the identifier is deleted from your browser the next time a page with one of our forms loads.', 'funnelforms-free' ), $what );
	}
}
