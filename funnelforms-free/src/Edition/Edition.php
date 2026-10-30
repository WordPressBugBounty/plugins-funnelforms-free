<?php
/**
 * What Funnelforms Free contains and what only Funnelforms Pro has.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Funnelforms Free and Funnelforms Pro are built from this one code base (tools/build-free.sh).
 * The Free plugin defines FUNNELFORMS_EDITION as 'free' before it loads the core; everything else
 * is Pro. Free draws the line at features, never at quantities: forms, steps, fields and entries
 * are unlimited in both editions.
 *
 * This class is the one list of that line. The Free build leaves out the files of the Pro modules,
 * the server refuses Pro features in Free documents (pro_features()), and the builder gets the
 * same lists through catalog().
 */
final class Edition {

	public const FREE = 'free';
	public const PRO  = 'pro';

	/** Step field types of Free. */
	public const FREE_STEP_FIELDS = array( 'choice', 'dropdown', 'text', 'textarea', 'email', 'phone', 'url', 'number', 'date', 'time', 'rating', 'content' );

	/** Step field types only Pro has. */
	public const PRO_STEP_FIELDS = array( 'slider', 'file', 'address', 'signature', 'repeat', 'booking', 'result' );

	/** Contact field types of Free. */
	public const FREE_CONTACT_FIELDS = array( 'salutation', 'name', 'email', 'phone', 'text', 'textarea', 'select', 'checkbox', 'consent', 'captcha' );

	/** Contact field types only Pro has. */
	public const PRO_CONTACT_FIELDS = array( 'phone_verification', 'html' );

	/** Actions of Free: one notification to the site and one confirmation to the lead. */
	public const FREE_ACTIONS = array( 'email', 'autoresponder' );

	/** Actions only Pro has. */
	public const PRO_ACTIONS = array( 'webhook', 'crm', 'chat', 'sms', 'whatsapp', 'conversion', 'googleAds' );

	/**
	 * Conditions of Free: branching by the chosen answer. Paths without a condition and the
	 * default path are Free as well. Everything else (AND/OR, numbers, text, dates, calculations,
	 * A/B variants) is Pro.
	 */
	public const FREE_CONDITION_OPS = array( 'selected' );

	/**
	 * Modules (classes with register()) that Free does not load. Their files are left out of the
	 * Free build (editions/free/exclude.txt lists the files that can go already).
	 */
	public const PRO_MODULES = array(
		'Funnelforms\\Compat\\Legacy\\LegacyLicense',
		'Funnelforms\\Integrations\\Crm\\CrmController',
		'Funnelforms\\Application\\Payments',
		'Funnelforms\\Admin\\AppointmentsPage',
		'Funnelforms\\Admin\\CronofyNotice',
		'Funnelforms\\Admin\\PredictionPage',
		'Funnelforms\\Admin\\IntegrationsPage',
		'Funnelforms\\Http\\AppController',
		'Funnelforms\\Application\\AppPush',
		'Funnelforms\\Admin\\AppPage',
		'Funnelforms\\Http\\AppointmentsController',
		'Funnelforms\\Http\\AutomationController',
		'Funnelforms\\Http\\McpServer',
		'Funnelforms\\Http\\ConnectionsController',
		'Funnelforms\\Http\\IntegrationsController',
		'Funnelforms\\Http\\CalendarOAuthController',
		'Funnelforms\\Http\\CalendarsController',
		'Funnelforms\\Http\\PaymentsController',
		'Funnelforms\\Admin\\EntryPdfDownload',
		'Funnelforms\\Application\\FileCleanup',
		'Funnelforms\\Application\\SaveProgress',
		'Funnelforms\\Application\\Abandonment',
		'Funnelforms\\Application\\ExperimentSchedule',
		'Funnelforms\\Frontend\\AbandonPage',
		'Funnelforms\\Application\\SupportAccess',
		'Funnelforms\\Application\\License\\License',
		'Funnelforms\\Application\\License\\LicenseLock',
		'Funnelforms\\Frontend\\EntriesShortcode',
		'Funnelforms\\Compat\\Multilingual',
		'Funnelforms\\Frontend\\ExternalEmbed',
		'Funnelforms\\Frontend\\OptInPage',
		'Funnelforms\\Frontend\\BookingPage',
		'Funnelforms\\Frontend\\PaymentReturn',
		'Funnelforms\\Admin\\AccountPage',
		'Funnelforms\\Admin\\ReferPage',
		'Funnelforms\\Admin\\SupportPage',
		'Funnelforms\\Application\\Notices\\Notices',
		'Funnelforms\\Admin\\NoticesView',
	);

	/**
	 * Feature keys only Pro has; pro_features() reports them. Field types are reported as
	 * field:<type>, contact fields as contact_field:<type> and actions as action:<kind>.
	 */
	public const PRO_FEATURES = array(
		'conditions',
		'calculations',
		'hidden_fields',
		'multiple_mails',
		'conditional_actions',
		'pdf',
		'experiments',
		'custom_css',
		'partial_entries',
		'save_progress',
		'lead_scoring',
		'lead_value',
		'quiz',
		'double_opt_in',
		'abandonment',
		'public_entries',
		'payment',
		'access',
		'time_limit',
		'multilingual',
		'variables',
	);

	/**
	 * Pro features that change what visitors go through. A Free site does not show a form that
	 * uses one of them, because it would be incomplete; the other Pro features are left unused.
	 */
	public const BLOCKING_FEATURES = array( 'payment', 'access', 'time_limit', 'save_progress', 'double_opt_in', 'calculations', 'quiz', 'conditions', 'experiments', 'multilingual', 'variables' );

	/**
	 * The edition of this site.
	 */
	public static function current(): string {
		return defined( 'FUNNELFORMS_EDITION' ) && self::FREE === constant( 'FUNNELFORMS_EDITION' ) ? self::FREE : self::PRO;
	}

	/**
	 * Whether this is Funnelforms Free.
	 */
	public static function is_free(): bool {
		return self::FREE === self::current();
	}

	/**
	 * Whether this is Funnelforms Pro.
	 */
	public static function is_pro(): bool {
		return self::PRO === self::current();
	}

	/**
	 * Whether Funnelforms Pro runs without an active license (License::allows( 'pro' ) is false):
	 * not connected, a token of another address, the plan ended or the token ran out more than
	 * License::GRACE_DAYS ago. License\LicenseLock then locks everything but the account page;
	 * forms on the website keep running. A Brain that cannot be reached does not lock: the stored
	 * token counts until it runs out, and the grace period after that. Neither does a website that
	 * comes from Funnelforms 3 while it still connects itself with the old license key
	 * (LegacyKey::connecting(), at most about a week); it locks when that stops without success.
	 */
	public static function locked(): bool {
		$license = self::pro( \Funnelforms\Application\License\License::class );
		$legacy  = self::pro( \Funnelforms\Application\License\LegacyKey::class );
		$locked  = null !== $license && ! $license::allows( 'pro' ) && ! ( null !== $legacy && $legacy::connecting() );
		/**
		 * Filters whether Funnelforms Pro is locked for want of a license.
		 *
		 * @param bool $locked Whether no active license includes Pro.
		 */
		return (bool) apply_filters( 'funnelforms_pro_locked', $locked );
	}

	/**
	 * Whether a module is loaded in this edition.
	 *
	 * @param string $module Class name.
	 */
	public static function has_module( string $module ): bool {
		return self::is_pro() || ! in_array( ltrim( $module, '\\' ), self::PRO_MODULES, true );
	}

	/**
	 * The class of a Pro module, or null in Funnelforms Free, whose build leaves its file out.
	 * Shared code reaches Pro code only through this, so Free never loads a class it does not have.
	 *
	 * @param string $class_name Class name.
	 * @return class-string|null
	 */
	public static function pro( string $class_name ): ?string {
		return self::is_pro() && class_exists( $class_name ) ? $class_name : null;
	}

	/**
	 * Whether a step field type is part of this edition.
	 *
	 * @param string $type Field type.
	 */
	public static function has_field( string $type ): bool {
		return self::is_pro() || in_array( $type, self::FREE_STEP_FIELDS, true );
	}

	/**
	 * Whether a contact field type is part of this edition.
	 *
	 * @param string $type Contact field type.
	 */
	public static function has_contact_field( string $type ): bool {
		return self::is_pro() || in_array( $type, self::FREE_CONTACT_FIELDS, true );
	}

	/**
	 * Whether an action kind is part of this edition.
	 *
	 * @param string $kind Action kind.
	 */
	public static function has_action( string $kind ): bool {
		return self::is_pro() || in_array( $kind, self::FREE_ACTIONS, true );
	}

	/**
	 * Pro features a form document uses, whatever the edition of this site. Empty for a document
	 * Free can show and edit in full.
	 *
	 * @param array<string,mixed> $document Form document (decoded as arrays).
	 * @return string[] Feature keys, sorted, each once.
	 */
	public static function pro_features( array $document ): array {
		$found = array();
		foreach ( (array) ( $document['nodes'] ?? array() ) as $node ) {
			if ( ! is_array( $node ) ) {
				continue;
			}
			$type = (string) ( $node['type'] ?? '' );
			if ( self::uses_answers( $node ) ) {
				$found[] = 'variables';
			}
			foreach ( (array) ( $node['fields'] ?? array() ) as $field ) {
				if ( ! is_array( $field ) ) {
					continue;
				}
				$found = array_merge( $found, 'contact' === $type ? self::contact_field_features( $field ) : self::step_field_features( $field ) );
				// A field shown on an answer follows the rules of paths.
				if ( isset( $field['showWhen'] ) && ! self::free_condition( $field['showWhen'] ) ) {
					$found[] = 'conditions';
				}
			}
		}
		foreach ( (array) ( $document['edges'] ?? array() ) as $edge ) {
			if ( is_array( $edge ) && isset( $edge['when'] ) && ! self::free_condition( $edge['when'] ) ) {
				$found[] = 'conditions';
			}
		}
		if ( array() !== (array) ( $document['calculations'] ?? array() ) ) {
			$found[] = 'calculations';
		}
		if ( array() !== (array) ( $document['experiments'] ?? array() ) ) {
			$found[] = 'experiments';
		}
		$found = array_merge( $found, self::action_features( (array) ( $document['actions'] ?? array() ) ) );
		if ( '' !== trim( (string) ( $document['style']['css'] ?? '' ) ) ) {
			$found[] = 'custom_css';
		}
		$found = array_merge( $found, self::settings_features( (array) ( $document['settings'] ?? array() ) ) );
		if ( count( (array) ( $document['locales']['available'] ?? array() ) ) > 1 ) {
			$found[] = 'multilingual';
		}
		$found = array_values( array_unique( $found ) );
		sort( $found );
		return $found;
	}

	/**
	 * Pro features that keep a Free site from showing the form.
	 *
	 * @param string[] $features Result of pro_features().
	 * @return string[]
	 */
	public static function blocking( array $features ): array {
		return array_values(
			array_filter(
				$features,
				static fn( string $feature ): bool => in_array( $feature, self::BLOCKING_FEATURES, true ) || str_starts_with( $feature, 'field:' ) || 'contact_field:phone_verification' === $feature
			)
		);
	}

	/**
	 * Problems in the words of the document checker, for Free: one per Pro feature.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return string[] Empty in Pro.
	 */
	public static function problems( array $document ): array {
		if ( self::is_pro() ) {
			return array();
		}
		return array_map( static fn( string $feature ): string => 'pro feature ' . $feature, self::pro_features( $document ) );
	}

	/**
	 * The lists for the builder and the Free build; in Free also the names of the Pro features and
	 * the address of the page about Pro.
	 *
	 * @return array<string,mixed>
	 */
	public static function catalog(): array {
		return array(
			'edition'           => self::current(),
			'freeStepFields'    => self::FREE_STEP_FIELDS,
			'proStepFields'     => self::PRO_STEP_FIELDS,
			'freeContactFields' => self::FREE_CONTACT_FIELDS,
			'proContactFields'  => self::PRO_CONTACT_FIELDS,
			'freeActions'       => self::FREE_ACTIONS,
			'proActions'        => self::PRO_ACTIONS,
			'freeConditionOps'  => self::FREE_CONDITION_OPS,
			'proFeatures'       => self::PRO_FEATURES,
		) + ( self::is_free() ? array(
			'labels' => self::labels(),
			'proUrl' => FreeSite::url(),
		) : array() );
	}

	/**
	 * Names of the Pro features, for people.
	 *
	 * @return array<string,string> Feature key => name.
	 */
	public static function labels(): array {
		return array(
			'field:slider'                     => __( 'Slider', 'funnelforms-free' ),
			'field:file'                       => __( 'File upload', 'funnelforms-free' ),
			'field:address'                    => __( 'Address with suggestions', 'funnelforms-free' ),
			'field:signature'                  => __( 'Signature', 'funnelforms-free' ),
			'field:repeat'                     => __( 'Repeat group', 'funnelforms-free' ),
			'field:booking'                    => __( 'Appointment booking', 'funnelforms-free' ),
			'field:result'                     => __( 'Live result and price box', 'funnelforms-free' ),
			'contact_field:phone_verification' => __( 'Phone verification', 'funnelforms-free' ),
			'contact_field:html'               => __( 'HTML in the contact step', 'funnelforms-free' ),
			'conditions'                       => __( 'Conditions with AND/OR, numbers, text and dates', 'funnelforms-free' ),
			'calculations'                     => __( 'Calculations and price calculators', 'funnelforms-free' ),
			'hidden_fields'                    => __( 'Hidden values of answers', 'funnelforms-free' ),
			'multiple_mails'                   => __( 'More than one notification or confirmation mail', 'funnelforms-free' ),
			'conditional_actions'              => __( 'Mails and actions only for some entries (lead routing)', 'funnelforms-free' ),
			'pdf'                              => __( 'PDF of the entry', 'funnelforms-free' ),
			'experiments'                      => __( 'A/B tests', 'funnelforms-free' ),
			'custom_css'                       => __( 'Custom CSS', 'funnelforms-free' ),
			'partial_entries'                  => __( 'Incomplete entries', 'funnelforms-free' ),
			'save_progress'                    => __( 'Save and continue later', 'funnelforms-free' ),
			'lead_scoring'                     => __( 'Lead scoring', 'funnelforms-free' ),
			'lead_value'                       => __( 'Lead value (estimated order value)', 'funnelforms-free' ),
			'quiz'                             => __( 'Quizzes', 'funnelforms-free' ),
			'double_opt_in'                    => __( 'Double opt-in', 'funnelforms-free' ),
			'abandonment'                      => __( 'Reminder mails to visitors who leave', 'funnelforms-free' ),
			'public_entries'                   => __( 'Entries on the website', 'funnelforms-free' ),
			'payment'                          => __( 'Payments', 'funnelforms-free' ),
			'access'                           => __( 'Password, entry limit and opening times', 'funnelforms-free' ),
			'time_limit'                       => __( 'Time limit', 'funnelforms-free' ),
			'multilingual'                     => __( 'Forms in several languages', 'funnelforms-free' ),
			'variables'                        => __( 'Earlier answers in questions and in the address of a redirect', 'funnelforms-free' ),
			'action:webhook'                   => __( 'Webhooks', 'funnelforms-free' ),
			'action:crm'                       => __( 'CRM and newsletter tools', 'funnelforms-free' ),
			'action:chat'                      => __( 'Slack and Microsoft Teams', 'funnelforms-free' ),
			'action:sms'                       => __( 'Text messages', 'funnelforms-free' ),
			'action:whatsapp'                  => __( 'WhatsApp', 'funnelforms-free' ),
			'action:conversion'                => __( 'Conversion tracking', 'funnelforms-free' ),
			'action:googleAds'                 => __( 'Google Ads conversions', 'funnelforms-free' ),
		);
	}

	/**
	 * Whether a step shows earlier answers ({{field:…}}) in its texts, or an end sends them on in
	 * the address it redirects to. Mails and the thank-you text may use them in Free.
	 *
	 * @param array<string,mixed> $node Node.
	 */
	private static function uses_answers( array $node ): bool {
		$type = (string) ( $node['type'] ?? '' );
		if ( 'step' === $type ) {
			unset( $node['tracking'], $node['legacy'] );
			foreach ( array_keys( (array) ( $node['fields'] ?? array() ) ) as $i ) {
				unset( $node['fields'][ $i ]['tracking'], $node['fields'][ $i ]['legacy'] );
			}
			$text = (string) json_encode( $node ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- also used without WordPress (unit tests).
		} else {
			// The address of a redirect and the values of its parameters.
			$text = 'end' === $type && is_array( $node['redirect'] ?? null ) ? (string) json_encode( array( $node['redirect']['url'] ?? '', $node['redirect']['params'] ?? array() ) ) : ''; // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- also used without WordPress (unit tests).
		}
		return 1 === preg_match( '/\{\{\s*field:/', $text );
	}

	/**
	 * Pro features of a step field.
	 *
	 * @param array<string,mixed> $field Field.
	 * @return string[]
	 */
	private static function step_field_features( array $field ): array {
		$type  = (string) ( $field['type'] ?? '' );
		$found = in_array( $type, self::FREE_STEP_FIELDS, true ) ? array() : array( 'field:' . $type );
		foreach ( (array) ( $field['options'] ?? array() ) as $option ) {
			if ( is_array( $option ) && '' !== (string) ( $option['hiddenValue'] ?? '' ) ) {
				$found[] = 'hidden_fields';
			}
		}
		return $found;
	}

	/**
	 * Pro features of a contact field.
	 *
	 * @param array<string,mixed> $field Contact field.
	 * @return string[]
	 */
	private static function contact_field_features( array $field ): array {
		$type = (string) ( $field['type'] ?? '' );
		// A phone field confirmed by text message is the Pro feature of the 3.x type phone_verification.
		if ( 'phone' === $type && is_array( ( (array) ( $field['props'] ?? array() ) )['sms'] ?? null ) ) {
			return array( 'contact_field:phone_verification' );
		}
		return in_array( $type, self::FREE_CONTACT_FIELDS, true ) ? array() : array( 'contact_field:' . $type );
	}

	/**
	 * Whether a path condition is branching by the chosen answer.
	 *
	 * @param mixed $when Condition.
	 */
	private static function free_condition( $when ): bool {
		return is_array( $when ) && isset( $when['field'], $when['op'] ) && in_array( $when['op'], self::FREE_CONDITION_OPS, true );
	}

	/**
	 * Pro features of the actions.
	 *
	 * @param array<int,mixed> $actions Actions.
	 * @return string[]
	 */
	private static function action_features( array $actions ): array {
		$found = array();
		$count = array();
		foreach ( $actions as $action ) {
			if ( ! is_array( $action ) ) {
				continue;
			}
			$kind = (string) ( $action['kind'] ?? '' );
			if ( isset( $action['when'] ) ) {
				$found[] = 'conditional_actions';
			}
			if ( ! in_array( $kind, self::FREE_ACTIONS, true ) ) {
				$found[] = 'action:' . $kind;
				continue;
			}
			// One notification and one confirmation per contact step.
			$key           = $kind . '@' . (string) ( $action['node'] ?? '' );
			$count[ $key ] = ( $count[ $key ] ?? 0 ) + 1;
			if ( $count[ $key ] > 1 ) {
				$found[] = 'multiple_mails';
			}
			if ( ! empty( $action['config']['attachPdf'] ) ) {
				$found[] = 'pdf';
			}
			if ( 'paid' === ( $action['on'] ?? 'submit' ) ) {
				$found[] = 'payment';
			}
		}
		return $found;
	}

	/**
	 * Pro features of the settings.
	 *
	 * @param array<string,mixed> $settings Settings.
	 * @return string[]
	 */
	private static function settings_features( array $settings ): array {
		$found = array();
		$flags = array(
			'savePartialEntries' => 'partial_entries',
			'saveProgress'       => 'save_progress',
			'languageSwitch'     => 'multilingual',
		);
		foreach ( $flags as $key => $feature ) {
			if ( ! empty( $settings[ $key ] ) ) {
				$found[] = $feature;
			}
		}
		$present = array(
			'scoreCalculation' => 'lead_scoring',
			'valueCalculation' => 'lead_value',
			'quiz'             => 'quiz',
			'doubleOptIn'      => 'double_opt_in',
			'abandonment'      => 'abandonment',
			'publicEntries'    => 'public_entries',
			'payment'          => 'payment',
			'access'           => 'access',
			'timeLimit'        => 'time_limit',
		);
		foreach ( $present as $key => $feature ) {
			if ( isset( $settings[ $key ] ) && null !== $settings[ $key ] && '' !== $settings[ $key ] && array() !== $settings[ $key ] ) {
				$found[] = $feature;
			}
		}
		return $found;
	}
}
