<?php
/**
 * Decides whether the new renderer can show a form.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * The new renderer starts with the field types and actions most forms use. A form that needs
 * anything else stays on the 3.x renderer, and the admin sees why.
 */
final class RendererSupport {

	public const FIELD_TYPES   = array( 'choice', 'dropdown', 'text', 'textarea', 'date', 'slider', 'content', 'file', 'address', 'email', 'phone', 'url', 'number', 'time', 'rating', 'signature', 'repeat', 'booking', 'result' );
	public const CONTACT_TYPES = array( 'salutation', 'name', 'email', 'phone', 'text', 'consent', 'html', 'captcha', 'select', 'textarea', 'checkbox', 'phone_verification' );
	public const ACTION_KINDS  = array( 'email', 'autoresponder', 'webhook', 'chat', 'sms', 'whatsapp', 'conversion', 'googleAds', 'aiCall', 'customCode' );
	/**
	 * CRM providers with an adapter (Integrations\Crm\CrmAdapters).
	 */
	public const CRM_PROVIDERS = array( 'activecampaign', 'brevo', 'cleverreach', 'dealsnprojects', 'fincrm', 'getresponse', 'googlesheets', 'hellohq', 'hubspot', 'klicktipp', 'mailchimp', 'pipedrive' );

	/**
	 * Whether content steps or contact HTML blocks carry code (runs_code()). 3.x ran it; the new
	 * renderer only when the site allows the code of its forms (Frontend\TrackingCode).
	 *
	 * @param array<string,mixed> $document Form document.
	 */
	public static function has_scripts( array $document ): bool {
		foreach ( $document['nodes'] ?? array() as $node ) {
			foreach ( $node['fields'] ?? array() as $field ) {
				if ( ! in_array( $field['type'], array( 'content', 'html' ), true ) ) {
					continue;
				}
				foreach ( (array) ( $field['props']['html'] ?? array() ) as $text ) {
					if ( is_string( $text ) && self::runs_code( $text ) ) {
						return true;
					}
				}
			}
		}
		return false;
	}

	/**
	 * Whether HTML can run code or act for the page in a visitor's browser: scripts, event handlers
	 * (also after a slash or quote, as in <svg/onload=…>), script addresses (also written with
	 * entities or tabs, as in java&#x09;script:, or as the whole value of an address), frames with their own document (srcdoc), and the
	 * elements wp_kses never lets through that load, send or restyle the page (object, embed, base,
	 * meta, link, style, form, svg, math). Only users with unfiltered_html may add such HTML
	 * (SensitiveChanges); everyone else's is cleaned with wp_kses before it reaches a browser.
	 *
	 * @param string $html HTML.
	 */
	public static function runs_code( string $html ): bool {
		if ( 1 === preg_match( '#<\s*/?\s*(script|object|embed|applet|base|meta|link|style|form|frame|frameset|svg|math)\b|[\s/"\'](on[a-z]+|srcdoc|formaction)\s*=#i', $html ) ) {
			return true;
		}
		// Browsers ignore tabs and line breaks in addresses and decode entities in attributes.
		$decoded = (string) preg_replace( '/[\x00-\x20]+/', '', html_entity_decode( $html, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
		return 1 === preg_match( '#^(javascript|vbscript|livescript):|=["\']?(javascript|vbscript|livescript|data(?!:image/)):#i', $decoded );
	}

	/**
	 * Reasons why the new renderer cannot show the document yet; empty when it can.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return string[]
	 */
	public static function problems( array $document ): array {
		// Funnelforms Free does not show a form that needs a Pro feature to work (Edition).
		$out = Edition::is_free() ? array_map( static fn( string $feature ): string => 'pro feature ' . $feature, Edition::blocking( Edition::pro_features( $document ) ) ) : array();
		foreach ( $document['nodes'] ?? array() as $node ) {
			foreach ( $node['fields'] ?? array() as $field ) {
				$allowed = 'contact' === $node['type'] ? self::CONTACT_TYPES : self::FIELD_TYPES;
				if ( ! in_array( $field['type'], $allowed, true ) ) {
					$out[] = 'field_type:' . $field['type'];
				}
				if ( isset( $field['props']['mask'] ) && '' !== $field['props']['mask'] && ! InputMask::supported( (string) $field['props']['mask'] ) ) {
					// 3.x used the full Inputmask library; the runtime knows its common part only.
					$out[] = 'input_mask';
				}
			}
		}
		foreach ( $document['actions'] ?? array() as $action ) {
			if ( 'crm' === $action['kind'] && in_array( $action['config']['provider'] ?? '', self::CRM_PROVIDERS, true ) ) {
				continue;
			}
			if ( ! in_array( $action['kind'], self::ACTION_KINDS, true ) ) {
				$out[] = 'action:' . $action['kind'] . ( isset( $action['config']['provider'] ) ? ':' . $action['config']['provider'] : '' );
			}
		}
		return array_values( array_unique( $out ) );
	}
}
