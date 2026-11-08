<?php
/**
 * Form submissions for Independent Analytics.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Integrations;

defined( 'ABSPATH' ) || exit;

/**
 * Reports every entry a visitor sends to Independent Analytics Pro (form tracking), through the hook
 * its developer guide names for custom forms: do_action( 'iawp_custom_form_submissions', $form_id,
 * $form_title ). Independent Analytics adds the submission to the visit of the person whose request
 * fires the hook, so it runs in the visitor's submit request, only for entries outside the spam
 * folder, and never for previews or entries the admin takes out of the spam folder later.
 *
 * Nothing is sent anywhere: Independent Analytics stores the submission in the site's own
 * database. Without Independent Analytics Pro nobody listens to the hook and nothing happens.
 * Independent Analytics counts visits without cookies; whether it records a visitor at all is its
 * own setting, so the privacy mode of Funnelforms does not apply here. The filter
 * funnelforms_independent_analytics switches it off for a site or a form.
 */
final class IndependentAnalytics {

	/** Hook of Independent Analytics Pro for submissions of custom forms. */
	public const HOOK = 'iawp_custom_form_submissions';

	/**
	 * Reports a submitted entry.
	 *
	 * @param array<string,mixed> $form Form row (id, title).
	 * @return bool Whether the submission was reported.
	 */
	public static function submitted( array $form ): bool {
		if ( ! has_action( self::HOOK ) ) {
			return false;
		}
		/**
		 * Whether Funnelforms reports a submitted entry of this form to Independent Analytics.
		 *
		 * @param bool                $report Default true.
		 * @param array<string,mixed> $form   Form row.
		 */
		if ( ! apply_filters( 'funnelforms_independent_analytics', true, $form ) ) {
			return false;
		}
		$title = trim( (string) ( $form['title'] ?? '' ) );
		// The form ID must be an integer and the name a string (developer guide of Independent Analytics).
		do_action( 'iawp_custom_form_submissions', (int) $form['id'], '' !== $title ? $title : 'Funnelforms #' . (int) $form['id'] ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Independent Analytics' API.
		return true;
	}
}
