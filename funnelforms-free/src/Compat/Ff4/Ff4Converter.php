<?php
/**
 * Turns a form of Funnelforms 4 (the online version) into a form document.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Ff4;

use Funnelforms\Compat\Import\DocumentBuilder;

defined( 'ABSPATH' ) || exit;

/**
 * Builds a schema v1 document (packages/form-schema) from a snapshot of Funnelforms 4
 * (Ff4Export). Funnelforms 4 is a funnel like this plugin: logic nodes point to fields, edges
 * between them hold conditions, the contact form is one field of type "submit" with its own
 * fields, and the thank-you page belongs to it. So the shape carries over:
 *
 * - every node of a question becomes a step with that one field; a field used by several nodes
 *   becomes one field per step with the same key;
 * - every node of a contact form becomes a contact step, followed by an end node with its
 *   thank-you page or redirect;
 * - edges keep their order: conditional ones first, then the first edge without a condition as
 *   the default, as the SaaS runtime picks them (getNextNodeId.ts);
 * - redirect actions on a path become end nodes that redirect; webhook and other action nodes
 *   on a path are passed through to the node after them;
 * - notifications become mails, the webhook of the contact form and webhook actions become
 *   webhooks in the payload of Funnelforms 4 (format "ff4"), so Zaps and scenarios keep working.
 *
 * Keys: a step field keeps the webhook field id of Funnelforms 4, else its field id; contact
 * fields keep their id ("field-1712345678"). Ff4Payload keys answers by them, as the SaaS did.
 *
 * Every change or loss is a note (codes, Ff4Messages puts them into words). Pure PHP without
 * WordPress.
 */
final class Ff4Converter {

	/** Version of the conversion, kept in meta.import. */
	public const VERSION = 1;

	/** Field types of Funnelforms 4 that become a contact step. */
	private const CONTACT = 'submit';

	/** Contact form of Funnelforms 4 before its fields were saved (SubmitFieldPreview.tsx). */
	private const DEFAULT_CONTACT_FIELDS = array(
		array(
			'id'           => 'salutation',
			'type'         => 'select',
			'label'        => 'salutation',
			'required'     => true,
			'options'      => array(),
			'variableName' => 'contact_salutation',
		),
		array(
			'id'           => 'name',
			'type'         => 'text',
			'label'        => 'name',
			'required'     => true,
			'autocomplete' => 'name',
			'variableName' => 'contact_name',
		),
		array(
			'id'           => 'email',
			'type'         => 'email',
			'label'        => 'email',
			'required'     => true,
			'variableName' => 'contact_email',
		),
	);

	/** Lucide icons renamed since the version Funnelforms 4 uses. */
	private const ICON_ALIASES = array(
		'home'        => 'house',
		'building-2'  => 'building',
		'train'       => 'train-front',
		'user-circle' => 'circle-user',
		'smile'       => 'face-slightly-smiling',
		'frown'       => 'face-slightly-frowning',
		'edit'        => 'square-pen',
		'music'       => 'eighth-note',
	);

	/** File types an upload field may name; scripts and markup stay out. */
	private const UNSAFE_EXTENSIONS = array( 'php', 'phtml', 'phar', 'js', 'mjs', 'html', 'htm', 'svg', 'svgz', 'exe', 'sh', 'bat', 'cmd' );

	/** Placeholders of the SaaS mails and their tokens. */
	private const TOKENS = array(
		'all_responses'   => '{{answers}}',
		'form_name'       => '{{form:title}}',
		'submission_date' => '{{entry:date}}',
		'submission_time' => '{{entry:time}}',
		'entry_url'       => '{{page:url}}',
		'device_type'     => '{{visit:device}}',
		'completion_time' => '{{visit:duration}}',
		'utm_source'      => '{{utm:source}}',
		'utm_medium'      => '{{utm:medium}}',
		'utm_campaign'    => '{{utm:campaign}}',
		'utm_term'        => '{{utm:term}}',
		'utm_content'     => '{{utm:content}}',
		'utm_parameters'  => '{{utm}}',
		'user_ip'         => '',
		'form_id'         => '',
	);

	/** Texts for visitors the converter writes itself, in English. */
	private const TEXTS = array(
		'contact'    => 'Your contact details',
		'send'       => 'Send',
		'thanks'     => 'Thank you! We will get back to you soon.',
		'next'       => 'Next',
		'salutation' => 'Salutation',
		'name'       => 'Name',
		'email'      => 'E-mail address',
		'subject'    => 'New entry: {{form:title}}',
		'clear'      => 'Clear',
		'type'       => 'Type your name instead',
	);

	/**
	 * Options: locale (of the site), icons (known Lucide names; null takes every name) and texts
	 * (of the form being converted).
	 *
	 * @var array{locale:string,icons:array<string,true>|null,texts:array<string,string>}
	 */
	private array $options;

	/**
	 * Texts for visitors by locale (see the constructor).
	 *
	 * @var callable|array<string,string>
	 */
	private $texts;

	/**
	 * Locale of the document.
	 *
	 * @var string
	 */
	private string $locale = '';

	/**
	 * Notes of the form being converted.
	 *
	 * @var string[]
	 */
	private array $notes = array();

	/**
	 * Fields of Funnelforms 4 by id.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private array $fields = array();

	/**
	 * Placeholder name (field id, variable name, node id, contact field id) => key.
	 *
	 * @var array<string,string>
	 */
	private array $vars = array();

	/**
	 * Ids given so far.
	 *
	 * @var array<string,true>
	 */
	private array $ids = array();

	/**
	 * Converter.
	 *
	 * @param array<string,mixed> $options locale: the site's locale (de_DE); icons: list of the
	 *                                     Lucide names the plugin ships, or null; texts: texts for
	 *                                     visitors (keys of TEXTS), or a callable that returns them
	 *                                     for a locale (forms keep their own language).
	 */
	public function __construct( array $options = array() ) {
		$icons         = $options['icons'] ?? null;
		$texts         = $options['texts'] ?? array();
		$this->texts   = is_callable( $texts ) || is_array( $texts ) ? $texts : array();
		$this->options = array(
			'locale' => (string) ( $options['locale'] ?? 'en_US' ),
			'icons'  => is_array( $icons ) ? array_fill_keys( array_map( 'strval', $icons ), true ) : null,
			'texts'  => self::TEXTS,
		);
	}

	/**
	 * The document of one form.
	 *
	 * @param array<string,mixed> $snapshot Snapshot of the form (Ff4Export::forms()).
	 * @return array{ok:bool,document:array<string,mixed>|null,notes:string[],bookings:array<int,array<string,mixed>>,errors:string[],sourceId:string,title:string}
	 */
	public function convert( array $snapshot ): array {
		$this->notes  = array();
		$this->fields = array();
		$this->vars   = array();
		$this->ids    = array();

		$form     = is_array( $snapshot['form'] ?? null ) ? $snapshot['form'] : array();
		$settings = is_array( $snapshot['settings'] ?? null ) ? $snapshot['settings'] : array();
		$title    = DocumentBuilder::plain( (string) ( $form['title'] ?? '' ) );
		$source   = (string) ( $form['id'] ?? '' );
		$fail     = fn( string $error ): array => array(
			'ok'       => false,
			'document' => null,
			'notes'    => array(),
			'bookings' => array(),
			'errors'   => array( $error ),
			'sourceId' => $source,
			'title'    => $title,
		);

		$this->locale           = $this->locale( (string) ( $settings['form_language'] ?? '' ) );
		$texts                  = is_callable( $this->texts ) ? ( $this->texts )( $this->locale ) : $this->texts;
		$this->options['texts'] = array_map( 'strval', array_intersect_key( is_array( $texts ) ? $texts : array(), self::TEXTS ) ) + self::TEXTS;

		foreach ( self::rows( $snapshot['fields'] ?? null ) as $field ) {
			if ( isset( $field['id'] ) && is_scalar( $field['id'] ) ) {
				$this->fields[ (string) $field['id'] ] = $field;
			}
		}
		$logic_nodes = array();
		$start_id    = null;
		foreach ( self::rows( $snapshot['logic_nodes'] ?? null ) as $node ) {
			$id = (string) ( $node['node_id'] ?? '' );
			if ( '' === $id ) {
				continue;
			}
			$logic_nodes[ $id ] = $node;
			if ( null === $start_id && ! empty( $node['is_start_node'] ) ) {
				$start_id = $id;
			}
		}
		$edges_from = array();
		foreach ( self::rows( $snapshot['logic_edges'] ?? null ) as $edge ) {
			$edges_from[ (string) ( $edge['source_node_id'] ?? '' ) ][] = $edge;
		}
		$actions = array();
		foreach ( self::rows( $snapshot['logic_actions'] ?? null ) as $action ) {
			$actions[ (string) ( $action['node_id'] ?? '' ) ] = $action;
		}
		if ( array() === $this->fields ) {
			return $fail( 'no_fields' );
		}
		if ( array() === $logic_nodes ) {
			// Forms that were never opened in the logic editor: the fields in their order.
			[ $logic_nodes, $edges_from, $start_id ] = self::linear( $this->fields );
			$this->notes[]                           = 'ff4_no_logic_linear_order';
		}

		$this->collect_vars( $logic_nodes );

		// Nodes of the document, by node id of Funnelforms 4.
		$converted = array();
		$nodes     = array();
		$ends      = array();
		$layout    = array();
		$bookings  = array();
		$tracking  = false;
		$used      = array();
		foreach ( $logic_nodes as $node_id => $node ) {
			$field_id = (string) ( $node['field_id'] ?? '' );
			$position = array(
				'x' => (int) round( (float) ( $node['position_x'] ?? 0 ) ),
				'y' => (int) round( (float) ( $node['position_y'] ?? 0 ) ),
			);
			if ( $node_id === $start_id ) {
				continue;
			}
			if ( '' !== $field_id && isset( $this->fields[ $field_id ] ) ) {
				$ff4 = $this->fields[ $field_id ];
				if ( self::CONTACT === ( $ff4['type'] ?? '' ) ) {
					$id                    = $this->id( 'c_' . $node_id );
					$contact               = $this->contact( $id, $ff4, isset( $used[ $field_id ] ) ? '_' . count( $nodes ) : '' );
					$used[ $field_id ]     = true;
					$nodes[]               = $contact;
					$converted[ $node_id ] = $id;
					$layout[ $id ]         = $position;
					$ends[ $id ]           = $field_id;
					continue;
				}
				$field = $this->field( $ff4, isset( $used[ $field_id ] ) );
				if ( null === $field ) {
					continue;
				}
				$used[ $field_id ] = true;
				if ( 'booking' === $field['type'] ) {
					$bookings[] = $this->booking( $field['id'], $ff4 );
				}
				$id   = $this->id( 's_' . $node_id );
				$step = array(
					'id'     => $id,
					'type'   => 'step',
					'fields' => array( $field ),
				);
				$code = self::script( $ff4['settings']['trackingCode'] ?? '' );
				if ( '' !== $code ) {
					$step['tracking'] = array( 'onShow' => $code );
					$tracking         = true;
				}
				$nodes[]               = $step;
				$converted[ $node_id ] = $id;
				$layout[ $id ]         = $position;
				continue;
			}
			$action = $actions[ $node_id ] ?? null;
			$kind   = (string) ( $action['action_type'] ?? '' );
			if ( 'redirect' === $kind ) {
				$url = trim( (string) ( $action['settings']['url'] ?? '' ) );
				if ( 1 === preg_match( '#^https?://#i', $url ) ) {
					$id                    = $this->id( 'r_' . $node_id );
					$nodes[]               = array(
						'id'       => $id,
						'type'     => 'end',
						'success'  => null,
						'redirect' => array(
							'url'     => $this->t( $this->template( $url ) ),
							'newTab'  => ! empty( $action['settings']['openInNewTab'] ),
							'delayMs' => 0,
							'params'  => array(),
						),
					);
					$converted[ $node_id ] = $id;
					$layout[ $id ]         = $position;
				} else {
					$this->notes[] = 'redirect_without_address';
				}
			} elseif ( 'thankyou' === $kind ) {
				$id                    = $this->id( 't_' . $node_id );
				$nodes[]               = $this->end( $id, is_array( $action['settings'] ?? null ) ? $action['settings'] : array() );
				$converted[ $node_id ] = $id;
				$layout[ $id ]         = $position;
			} elseif ( '' === $kind && '' !== $field_id ) {
				$this->notes[] = 'ff4_node_without_field';
			}
			// Webhook, AI caller and nodes without field: passed through (resolve()).
		}

		// An end node after every contact step: the thank-you page of its contact form.
		foreach ( $ends as $contact_id => $field_id ) {
			$id      = $this->id( 'e_' . substr( $contact_id, 2 ) );
			$thanks  = $this->fields[ $field_id ]['thankyou_settings'] ?? array();
			$nodes[] = $this->end( $id, is_array( $thanks ) ? $thanks : array() );
			$after   = self::script( is_array( $thanks ) ? ( $thanks['trackingCode'] ?? '' ) : '' );
			if ( '' !== $after ) {
				foreach ( $nodes as $i => $n ) {
					if ( $n['id'] === $contact_id ) {
						$nodes[ $i ]['tracking'] = array( 'afterSubmit' => $after );
						$tracking                = true;
					}
				}
			}
			$layout[ $id ]       = array(
				'x' => $layout[ $contact_id ]['x'] + 360,
				'y' => $layout[ $contact_id ]['y'],
			);
			$ends[ $contact_id ] = $id;
		}
		if ( array() === $nodes ) {
			return $fail( 'no_steps' );
		}
		if ( array() === $ends ) {
			$this->notes[] = 'ff4_no_contact_step';
		}

		$seen    = array();
		$resolve = function ( string $node_id ) use ( &$resolve, &$seen, $converted, $edges_from, $actions ): ?string {
			if ( isset( $converted[ $node_id ] ) ) {
				return $converted[ $node_id ];
			}
			if ( isset( $seen[ $node_id ] ) ) {
				return null;
			}
			$seen[ $node_id ] = true;
			foreach ( $edges_from[ $node_id ] ?? array() as $edge ) {
				if ( empty( $edge['condition'] ) ) {
					$to = $resolve( (string) ( $edge['target_node_id'] ?? '' ) );
					unset( $seen[ $node_id ] );
					if ( isset( $actions[ $node_id ] ) ) {
						$this->notes[] = 'ff4_action_on_path_passed:' . (string) ( $actions[ $node_id ]['action_type'] ?? '' );
					}
					return $to;
				}
			}
			unset( $seen[ $node_id ] );
			return null;
		};

		// Edges, in the order the SaaS runtime tries them.
		$edges = array();
		$by_id = array();
		foreach ( $nodes as $node ) {
			$by_id[ $node['id'] ] = $node;
		}
		$edge_ids = array();
		$add_edge = function ( string $from, string $to, ?array $when ) use ( &$edges, &$edge_ids ): void {
			$id = 'e_' . substr( md5( $from . '>' . $to . '>' . count( $edges ) ), 0, 12 );
			while ( isset( $edge_ids[ $id ] ) ) {
				$id .= 'x';
			}
			$edge_ids[ $id ] = true;
			$edge            = array(
				'id'   => $id,
				'from' => $from,
				'to'   => $to,
			);
			if ( null === $when ) {
				$edge['default'] = true;
			} else {
				$edge['when'] = $when;
			}
			$edges[] = $edge;
		};
		foreach ( $converted as $node_id => $id ) {
			$node = $by_id[ $id ];
			if ( 'contact' === $node['type'] ) {
				$add_edge( $id, $ends[ $id ], null );
				continue;
			}
			if ( 'step' !== $node['type'] ) {
				continue;
			}
			$field    = $node['fields'][0];
			$ff4_type = (string) ( $this->fields[ (string) ( $logic_nodes[ $node_id ]['field_id'] ?? '' ) ]['type'] ?? '' );
			$default  = null;
			foreach ( $edges_from[ $node_id ] ?? array() as $edge ) {
				$condition = $edge['condition'] ?? null;
				if ( is_string( $condition ) ) {
					$condition = json_decode( $condition, true );
				}
				if ( empty( $condition ) ) {
					$default = $default ?? $edge;
					continue;
				}
				$to = $resolve( (string) ( $edge['target_node_id'] ?? '' ) );
				if ( null === $to ) {
					continue;
				}
				$when = is_array( $condition ) ? Ff4Conditions::map( $condition, $field, $ff4_type ) : null;
				if ( null === $when ) {
					$this->notes[] = 'ff4_condition_not_imported:' . DocumentBuilder::plain( $this->label( $field ) );
					continue;
				}
				if ( Ff4Conditions::never_matched_in_ff4( $condition ) ) {
					$this->notes[] = 'ff4_condition_now_works:' . DocumentBuilder::plain( $this->label( $field ) );
				}
				$add_edge( $id, $to, $when );
			}
			if ( null !== $default ) {
				$to = $resolve( (string) ( $default['target_node_id'] ?? '' ) );
				if ( null !== $to ) {
					$add_edge( $id, $to, null );
				}
			}
		}

		// The first node: the one the start node leads to.
		$start = null;
		if ( null !== $start_id ) {
			foreach ( $edges_from[ $start_id ] ?? array() as $edge ) {
				$start = $resolve( (string) ( $edge['target_node_id'] ?? '' ) );
				if ( null !== $start ) {
					break;
				}
			}
		}
		if ( null === $start ) {
			$this->notes[] = 'ff4_start_not_connected';
			$start         = $nodes[0]['id'];
		}

		$general  = is_array( $settings['general'] ?? null ) ? $settings['general'] : array();
		$advanced = is_array( $settings['advanced'] ?? null ) ? $settings['advanced'] : array();
		$gdpr     = is_array( $settings['gdpr'] ?? null ) ? $settings['gdpr'] : array();
		$styles   = is_array( $snapshot['styles']['style_data'] ?? null ) ? $snapshot['styles']['style_data'] : array();
		$design   = Ff4Style::convert( $styles, is_string( $advanced['customCss'] ?? null ) ? $advanced['customCss'] : '' );
		array_push( $this->notes, ...$design['notes'] );

		$doc_settings = array(
			'uiLocale'           => '',
			'progressBar'        => $design['progress'],
			'loadingAnimation'   => false,
			'scrollToTop'        => array(
				'desktop' => false,
				'mobile'  => true,
			),
			'rtl'                => false,
			'autoHeight'         => true,
			'iconFont'           => false,
			'savePartialEntries' => false,
		);
		if ( '' !== $design['heading'] ) {
			$doc_settings['heading'] = $this->t( $design['heading'] );
		}
		if ( ! empty( $general['saveProgress'] ) ) {
			$doc_settings['saveProgress'] = true;
		}
		if ( is_numeric( $general['timeLimit'] ?? null ) && (int) $general['timeLimit'] >= 1 ) {
			$doc_settings['timeLimit'] = array( 'minutes' => min( 1440, (int) $general['timeLimit'] ) );
		}
		if ( ! empty( $general['responseLimitEnabled'] ) && is_numeric( $general['responseLimit'] ?? null ) && (int) $general['responseLimit'] >= 1 ) {
			$doc_settings['access'] = array( 'maxEntries' => (int) $general['responseLimit'] );
		}
		if ( ! empty( $general['passwordProtectionEnabled'] ) ) {
			$this->notes[] = 'ff4_password_not_imported';
		}
		if ( ! empty( $gdpr['retentionEnabled'] ) && is_numeric( $gdpr['retentionPeriod'] ?? null ) && (int) $gdpr['retentionPeriod'] >= 1 ) {
			$doc_settings['retentionDays'] = min( 36500, (int) $gdpr['retentionPeriod'] );
			$this->notes[]                 = 'ff4_retention_days:' . $doc_settings['retentionDays'];
		}
		if ( '' !== trim( (string) ( $advanced['customJavaScript'] ?? '' ) ) ) {
			$this->notes[] = 'ff4_custom_javascript_not_imported';
		}
		if ( '' !== trim( (string) ( $advanced['customCss'] ?? '' ) ) ) {
			$this->notes[] = 'ff4_custom_css_imported';
		}
		if ( $tracking ) {
			$this->notes[] = 'ff4_tracking_code_imported';
		}

		$document = array(
			'schemaVersion' => 1,
			'id'            => 'frm_import',
			'title'         => '' !== $title ? $title : 'Funnelforms 4',
			'locales'       => array(
				'default'   => $this->locale,
				'available' => array( $this->locale ),
			),
			'start'         => $start,
			'nodes'         => $nodes,
			'edges'         => $edges,
			'calculations'  => array(),
			'actions'       => $this->actions( $snapshot, $nodes, $actions ),
			'style'         => $design['style'],
			'settings'      => $doc_settings,
			'layout'        => array( 'nodes' => $layout ),
			'meta'          => array(
				'import' => array(
					'source'   => 'ff4',
					'sourceId' => $source,
					'version'  => self::VERSION,
					'notes'    => array_values( array_unique( $this->notes ) ),
				),
			),
		);
		if ( array() === $document['style']['tokens'] ) {
			$document['style']['tokens'] = new \stdClass();
		}
		return array(
			'ok'       => true,
			'document' => $document,
			'notes'    => array_values( array_unique( $this->notes ) ),
			'bookings' => $bookings,
			'errors'   => array(),
			'sourceId' => $source,
			'title'    => $document['title'],
		);
	}

	/**
	 * Locale of the form: its language in the site's variant when the site speaks it.
	 *
	 * @param string $language Language of the form in Funnelforms 4 (de, en).
	 */
	private function locale( string $language ): string {
		$site = $this->options['locale'];
		if ( '' === $language || 0 === strpos( $site, $language ) ) {
			return $site;
		}
		return 'de' === $language ? 'de_DE' : ( 'en' === $language ? 'en_US' : $site );
	}

	/**
	 * Keys of every field and the names templates of Funnelforms 4 use for them.
	 *
	 * @param array<string,array<string,mixed>> $logic_nodes Logic nodes.
	 */
	private function collect_vars( array $logic_nodes ): void {
		foreach ( $this->fields as $id => $field ) {
			if ( self::CONTACT === ( $field['type'] ?? '' ) ) {
				foreach ( $this->contact_fields( $field ) as $sub ) {
					$key = (string) $sub['id'];
					foreach ( array( $sub['id'], $sub['variableName'] ?? '' ) as $name ) {
						if ( '' !== (string) $name && ! isset( $this->vars[ (string) $name ] ) ) {
							$this->vars[ (string) $name ] = $key;
						}
					}
				}
				continue;
			}
			$key = $this->key( $field );
			foreach ( array( $id, (string) ( $field['variable_name'] ?? '' ) ) as $name ) {
				if ( '' !== $name && ! isset( $this->vars[ $name ] ) ) {
					$this->vars[ $name ] = $key;
				}
			}
		}
		foreach ( $logic_nodes as $node_id => $node ) {
			$field_id = (string) ( $node['field_id'] ?? '' );
			if ( isset( $this->vars[ $field_id ] ) && ! isset( $this->vars[ $node_id ] ) ) {
				$this->vars[ $node_id ] = $this->vars[ $field_id ];
			}
		}
	}

	/**
	 * Key of a step field: its webhook field id, else its id.
	 *
	 * @param array<string,mixed> $field Field of Funnelforms 4.
	 */
	private function key( array $field ): string {
		$webhook = $field['settings']['webhookFieldId'] ?? null;
		return is_string( $webhook ) && '' !== trim( $webhook ) ? trim( $webhook ) : (string) $field['id'];
	}

	/**
	 * A step field, or null when the type has no counterpart.
	 *
	 * @param array<string,mixed> $f     Field of Funnelforms 4.
	 * @param bool                $again Whether another step already asks this field.
	 * @return array<string,mixed>|null
	 */
	private function field( array $f, bool $again ): ?array {
		$type     = (string) ( $f['type'] ?? '' );
		$settings = is_array( $f['settings'] ?? null ) ? $f['settings'] : array();
		$label    = DocumentBuilder::plain( (string) ( $f['label'] ?? '' ) );
		$base     = array(
			'id'          => $this->id( (string) $f['id'], $again ),
			'key'         => $this->key( $f ),
			'label'       => $this->t( $label ),
			'description' => $this->t( DocumentBuilder::plain( (string) ( $f['placeholder'] ?? '' ) ) ),
			'required'    => ! empty( $f['required'] ),
		);
		$text     = fn( $value ): array => $this->t( is_scalar( $value ) ? DocumentBuilder::plain( (string) $value ) : '' );
		$number   = fn( $value, $fallback ) => is_numeric( $value ) ? 0 + $value : $fallback;

		switch ( $type ) {
			case 'single_selection':
			case 'multiple_selection':
			case 'checkbox':
				return $base + $this->choice( $f, $base['id'], 'multiple_selection' === $type || 'checkbox' === $type || ! empty( $settings['allowMultiSelect'] ) );
			case 'dropdown':
			case 'radio':
				$props = array();
				if ( ! empty( $settings['enableSearch'] ) ) {
					$props['search'] = true;
				}
				if ( 'dropdown' === $type && ! empty( $settings['allowMultiSelect'] ) ) {
					$props['multiple'] = true;
					$props            += $this->choice_limits( $settings );
				}
				if ( is_string( $settings['placeholderText'] ?? null ) && '' !== trim( $settings['placeholderText'] ) ) {
					$props['placeholder'] = $text( $settings['placeholderText'] );
				}
				return $base + array(
					'type'    => 'dropdown',
					'options' => $this->options( $f, $base['id'] ),
					'props'   => array() === $props ? new \stdClass() : $props,
				);
			case 'text':
			case 'email':
			case 'number':
			case 'textarea':
				return $base + $this->input( $type, $settings );
			case 'date':
				$props = array(
					'placeholder' => $this->t( '' ),
					'format'      => self::date_format( (string) ( $settings['dateFormat'] ?? '' ) ),
				);
				if ( ! empty( $settings['allowDateRange'] ) ) {
					$props['range'] = true;
				}
				if ( ! empty( $settings['allowOnlyFutureDates'] ) ) {
					$props['allow'] = 'future';
				} elseif ( ! empty( $settings['allowOnlyPastDates'] ) ) {
					$props['allow'] = 'past';
				}
				return $base + array(
					'type'  => 'date',
					'props' => $props,
				);
			case 'slider':
				$min = $number( $settings['minValue'] ?? null, 0 );
				$max = $number( $settings['maxValue'] ?? null, 100 );
				if ( $max <= $min ) {
					$max = $min + 100;
				}
				$step       = $number( $settings['stepSize'] ?? null, 1 );
				$separators = array(
					'dot'        => '.',
					'comma'      => ',',
					'space'      => ' ',
					'apostrophe' => "'",
				);
				$props      = array(
					'min'                => $min,
					'max'                => $max,
					'step'               => $step > 0 ? $step : 1,
					'start'              => max( $min, min( $max, $number( $settings['startValue'] ?? null, $min ) ) ),
					'unit'               => array(
						'text'     => $text( $settings['unit'] ?? '' ),
						'position' => ! empty( $settings['unitBeforeNumber'] ) ? 'before' : 'after',
					),
					'thousandsSeparator' => ! empty( $settings['showSeparator'] ),
					'manualInput'        => array(
						'enabled' => ! empty( $settings['showManualInput'] ),
						'label'   => $text( $settings['manualInputPlaceholder'] ?? '' ),
					),
				);
				if ( ! empty( $settings['showSeparator'] ) && isset( $separators[ $settings['separatorType'] ?? '' ] ) ) {
					$props['separator'] = $separators[ $settings['separatorType'] ];
				}
				if ( ! empty( $settings['allowRange'] ) ) {
					$props['range']    = true;
					$props['startEnd'] = max( $min, min( $max, $number( $settings['endValue'] ?? null, $max ) ) );
				}
				return $base + array(
					'type'  => 'slider',
					'props' => $props,
				);
			case 'scale':
				$max    = max( 2, min( 10, (int) $number( $settings['scaleSize'] ?? null, 5 ) ) );
				$labels = ( $settings['showExtremityLabels'] ?? true ) !== false;
				$props  = array(
					'min'       => 1,
					'max'       => $max,
					'style'     => 'stars' === ( $settings['scaleVisualization'] ?? 'stars' ) ? 'stars' : 'numbers',
					'lowLabel'  => $labels ? $text( $settings['leftExtremityLabel'] ?? '' ) : $this->t( '' ),
					'highLabel' => $labels ? $text( $settings['rightExtremityLabel'] ?? '' ) : $this->t( '' ),
				);
				$show   = (string) ( $settings['scaleDisplay'] ?? '' );
				if ( 'emojis' === $show ) {
					$props['show'] = 'emojis';
				} elseif ( 'labels' === $show && is_array( $settings['customLabels'] ?? null ) ) {
					$props['show']   = 'labels';
					$props['labels'] = array();
					for ( $i = 0; $i < $max; $i++ ) {
						$props['labels'][] = $text( $settings['customLabels'][ $i ] ?? (string) ( $i + 1 ) );
					}
				}
				return $base + array(
					'type'  => 'rating',
					'props' => $props,
				);
			case 'address':
				$lat = $settings['startingPositionCoordinates']['lat'] ?? null;
				$lng = $settings['startingPositionCoordinates']['lng'] ?? null;
				return $base + array(
					'type'  => 'address',
					'props' => array(
						'zoom'               => max( 1, min( 20, (int) $number( $settings['initialZoom'] ?? null, 12 ) ) ),
						'start'              => array(
							'name' => is_string( $settings['startingPosition'] ?? null ) ? DocumentBuilder::plain( $settings['startingPosition'] ) : '',
							'lat'  => is_numeric( $lat ) ? (float) $lat : 52.52,
							'lng'  => is_numeric( $lng ) ? (float) $lng : 13.405,
						),
						'combined'           => empty( $settings['separateComponents'] ),
						'showCountry'        => true,
						'placesAutocomplete' => ! empty( $settings['enableGoogleServices'] ),
					),
				);
			case 'file':
			case 'upload':
				$props      = array(
					'dropzoneText'    => $this->t( '' ),
					'maxSizeMb'       => max( 1, min( 100, (int) $number( $settings['maxFileSize'] ?? null, 10 ) ) ),
					'maxFiles'        => ! empty( $settings['allowMultiple'] ) ? max( 1, min( 20, (int) $number( $settings['maxFiles'] ?? null, 5 ) ) ) : 1,
					'deniedMimeTypes' => array(),
					'visibility'      => 'private',
				);
				$extensions = array();
				foreach ( is_array( $settings['acceptedFileTypes'] ?? null ) ? $settings['acceptedFileTypes'] : array() as $ext ) {
					$ext = strtolower( ltrim( trim( (string) $ext ), '.' ) );
					if ( 1 === preg_match( '/^[a-z0-9]{1,10}$/', $ext ) && ! in_array( $ext, self::UNSAFE_EXTENSIONS, true ) ) {
						$extensions[ $ext ] = true;
					}
				}
				if ( array() !== $extensions ) {
					$props['allowedExtensions'] = array_keys( $extensions );
				}
				if ( is_string( $settings['customInstructions'] ?? null ) && '' !== trim( $settings['customInstructions'] ) ) {
					$props['hint'] = $text( $settings['customInstructions'] );
				}
				if ( ! empty( $settings['showFilePreview'] ) ) {
					$props['preview'] = true;
				}
				return $base + array(
					'type'  => 'file',
					'props' => $props,
				);
			case 'signature':
				$props = array(
					'clearLabel' => $this->t( $this->options['texts']['clear'] ),
					'typeLabel'  => $this->t( $this->options['texts']['type'] ),
				);
				if ( is_string( $settings['signatureColor'] ?? null ) && 1 === preg_match( '/^#[0-9a-fA-F]{6}$/', $settings['signatureColor'] ) ) {
					$props['penColor'] = strtolower( $settings['signatureColor'] );
				}
				if ( ! empty( $settings['allowUpload'] ) ) {
					$props['upload'] = true;
				}
				return $base + array(
					'type'  => 'signature',
					'props' => $props,
				);
			case 'booking':
				return $base + array(
					'type'  => 'booking',
					'props' => array( 'bookingTypeRef' => '' ),
				);
			case 'html':
				return array_merge(
					$base,
					array(
						'required' => false,
						'type'     => 'content',
						'props'    => array(
							'html'   => $this->t( (string) ( $settings['htmlContent'] ?? '' ) ),
							'button' => array(
								'show'  => true,
								'label' => $this->t( $this->options['texts']['next'] ),
							),
						),
					)
				);
			case 'media':
				$props = array(
					'html'   => $this->t( '' ),
					'button' => array(
						'show'  => true,
						'label' => $this->t( $this->options['texts']['next'] ),
					),
				);
				$url   = trim( (string) ( $settings['mediaUrl'] ?? '' ) );
				$media = array(
					'kind' => 'video' === ( $settings['mediaType'] ?? 'image' ) ? 'video' : 'image',
					'url'  => 1 === preg_match( '#^https?://#i', $url ) ? $url : '',
				);
				if ( is_string( $settings['altText'] ?? null ) && '' !== trim( $settings['altText'] ) ) {
					$media['alt'] = $text( $settings['altText'] );
				}
				if ( is_string( $settings['caption'] ?? null ) && '' !== trim( $settings['caption'] ) ) {
					$media['caption'] = $text( $settings['caption'] );
				}
				if ( '' === $media['url'] ) {
					$this->notes[] = 'ff4_media_without_address:' . $label;
				} else {
					$this->notes[] = 'ff4_external_media';
				}
				$props['media'] = $media;
				return array_merge(
					$base,
					array(
						'required' => false,
						'type'     => 'content',
						'props'    => $props,
					)
				);
			case 'loading':
				$styles  = array(
					'progress' => 'bar',
					'circle'   => 'circle',
					'dots'     => 'dots',
					'spinner'  => 'spinner',
				);
				$seconds = $number( $settings['duration'] ?? null, 3 );
				$message = $settings['displayText'] ?? $label;
				return array_merge(
					$base,
					array(
						'required' => false,
						'type'     => 'content',
						'props'    => array(
							'html'          => $this->t( '' ),
							'autoAdvanceMs' => (int) max( 500, min( 60000, round( $seconds * 1000 ) ) ),
							'button'        => array(
								'show'  => false,
								'label' => $this->t( $this->options['texts']['next'] ),
							),
							'loader'        => array(
								'style'    => $styles[ (string) ( $settings['animationType'] ?? 'progress' ) ] ?? 'spinner',
								'messages' => array( $text( $message ) ),
							),
						),
					)
				);
		}
		$this->notes[] = 'field_type_not_imported:' . $type . ':' . $label;
		return null;
	}

	/**
	 * Props of a text input by its type in Funnelforms 4.
	 *
	 * @param string              $type     Type.
	 * @param array<string,mixed> $settings Settings.
	 * @return array<string,mixed>
	 */
	private function input( string $type, array $settings ): array {
		$input       = (string) ( $settings['inputType'] ?? '' );
		$placeholder = array( 'placeholder' => $this->t( is_scalar( $settings['inputPlaceholder'] ?? null ) ? DocumentBuilder::plain( (string) $settings['inputPlaceholder'] ) : '' ) );
		$lengths     = array();
		foreach ( array(
			'minChars' => 'minLength',
			'maxChars' => 'maxLength',
		) as $from => $to ) {
			if ( is_numeric( $settings[ $from ] ?? null ) && (int) $settings[ $from ] > 0 ) {
				$lengths[ $to ] = (int) $settings[ $from ];
			}
		}
		if ( 'textarea' === $type || ! empty( $settings['multiline'] ) || 'textarea' === $input ) {
			return array(
				'type'  => 'textarea',
				'props' => $placeholder + $lengths,
			);
		}
		if ( 'email' === $type || 'email' === $input ) {
			return array(
				'type'  => 'email',
				'props' => $placeholder,
			);
		}
		if ( 'number' === $type || 'number' === $input ) {
			return array(
				'type'  => 'number',
				'props' => $placeholder,
			);
		}
		if ( in_array( $input, array( 'tel', 'phone' ), true ) ) {
			return array(
				'type'  => 'phone',
				'props' => $placeholder,
			);
		}
		if ( 'url' === $input ) {
			return array(
				'type'  => 'url',
				'props' => $placeholder,
			);
		}
		$props = $placeholder + $lengths;
		if ( ! empty( $settings['numbersOnly'] ) ) {
			$props['restrict'] = 'digits';
		} elseif ( ! empty( $settings['textOnly'] ) ) {
			$props['restrict'] = 'letters';
		}
		$auto = $settings['autocomplete'] ?? null;
		if ( is_string( $auto ) && in_array( $auto, array( 'off', 'name', 'given-name', 'family-name', 'organization', 'organization-title', 'street-address', 'address-line1', 'address-line2', 'postal-code', 'address-level2', 'country-name', 'email', 'tel', 'bday', 'url', 'username' ), true ) ) {
			$props['autocomplete'] = $auto;
		}
		return array(
			'type'  => 'text',
			'props' => $props,
		);
	}

	/**
	 * A choice of answers (tiles or a list).
	 *
	 * @param array<string,mixed> $f        Field of Funnelforms 4.
	 * @param string              $id       Id of the new field.
	 * @param bool                $multiple Several answers.
	 * @return array<string,mixed>
	 */
	private function choice( array $f, string $id, bool $multiple ): array {
		$settings = is_array( $f['settings'] ?? null ) ? $f['settings'] : array();
		$options  = $this->options( $f, $id );
		$desktop  = (int) ( $settings['cardsPerRow'] ?? 0 );
		$mobile   = (int) ( $settings['mobileCardsPerRow'] ?? 0 );
		$visuals  = false;
		foreach ( $options as $option ) {
			$visuals = $visuals || isset( $option['media'] );
		}
		$props   = array(
			'multiple'  => $multiple,
			'layout'    => array(
				'desktop' => 1 === $desktop ? 'list' : 'grid',
				'mobile'  => 1 === $mobile ? 'list' : 'grid',
			),
			'hideIcons' => ! $visuals || false === ( $settings['showIcons'] ?? true ),
		);
		$columns = array();
		if ( $desktop >= 2 && $desktop <= 4 ) {
			$columns['desktop'] = $desktop;
		}
		if ( 2 === $mobile ) {
			$columns['mobile'] = 2;
		}
		if ( array() !== $columns ) {
			$props['columns'] = $columns;
		}
		$positions = array(
			'above' => 'top',
			'below' => 'bottom',
			'left'  => 'left',
			'right' => 'right',
		);
		if ( isset( $positions[ $settings['iconPosition'] ?? '' ] ) && 'above' !== $settings['iconPosition'] ) {
			$props['iconPosition'] = $positions[ $settings['iconPosition'] ];
		}
		$sizes = array(
			'small' => 's',
			'large' => 'l',
		);
		if ( isset( $sizes[ $settings['cardSize'] ?? '' ] ) ) {
			$props['size'] = $sizes[ $settings['cardSize'] ];
		}
		if ( ! empty( $settings['fullWidthImage'] ) ) {
			$props['imageFull'] = true;
		}
		if ( $multiple ) {
			$props += $this->choice_limits( $settings );
		}
		return array(
			'type'    => 'choice',
			'options' => $options,
			'props'   => $props,
		);
	}

	/**
	 * Least and most answers of a multiple choice.
	 *
	 * @param array<string,mixed> $settings Settings.
	 * @return array<string,int>
	 */
	private function choice_limits( array $settings ): array {
		$out = array();
		$min = $settings['minSelections'] ?? null;
		$max = $settings['maxSelections'] ?? null;
		if ( is_numeric( $min ) && (int) $min > 1 ) {
			$out['minChoices'] = (int) $min;
		}
		if ( is_numeric( $max ) && (int) $max >= 1 && (int) $max >= ( $out['minChoices'] ?? 1 ) ) {
			$out['maxChoices'] = (int) $max;
		}
		return $out;
	}

	/**
	 * Options of a choice or dropdown, with icons, images, hidden values and calculation values.
	 * The value of an option is its text, as Funnelforms 4 sent it.
	 *
	 * @param array<string,mixed> $f  Field of Funnelforms 4.
	 * @param string              $id Id of the new field.
	 * @return array<int,array<string,mixed>>
	 */
	private function options( array $f, string $id ): array {
		$visuals = array();
		foreach ( is_array( $f['settings']['optionVisuals'] ?? null ) ? $f['settings']['optionVisuals'] : array() as $i => $visual ) {
			if ( is_array( $visual ) ) {
				$visuals[ is_numeric( $visual['index'] ?? null ) ? (int) $visual['index'] : (int) $i ] = $visual;
			}
		}
		$out = array();
		foreach ( is_array( $f['options'] ?? null ) ? array_values( $f['options'] ) : array() as $i => $option ) {
			$text   = is_array( $option ) ? (string) ( $option['label'] ?? $option['value'] ?? '' ) : ( is_scalar( $option ) ? (string) $option : '' );
			$item   = array(
				'id'    => $id . '_o' . $i,
				'label' => $this->t( DocumentBuilder::plain( $text ) ),
				'value' => '' !== $text ? $text : (string) ( $i + 1 ),
			);
			$visual = $visuals[ $i ] ?? array();
			$image  = trim( (string) ( $visual['customImage'] ?? '' ) );
			$icon   = is_string( $visual['iconName'] ?? null ) ? $this->icon( $visual['iconName'] ) : null;
			if ( 1 === preg_match( '#^https?://#i', $image ) ) {
				$item['media'] = array(
					'kind'  => 'image',
					'value' => $image,
				);
				$this->notes[] = 'ff4_external_media';
			} elseif ( null !== $icon ) {
				$item['media'] = array(
					'kind'  => 'lucide',
					'value' => $icon,
				);
			} elseif ( is_string( $visual['iconName'] ?? null ) && '' !== $visual['iconName'] ) {
				$this->notes[] = 'ff4_icon_not_found:' . $visual['iconName'];
			}
			if ( is_scalar( $visual['hiddenValue'] ?? null ) && '' !== trim( (string) $visual['hiddenValue'] ) ) {
				$item['hiddenValue'] = (string) $visual['hiddenValue'];
			}
			if ( is_numeric( $visual['calculationValue'] ?? null ) ) {
				$item['calcValue'] = 0 + $visual['calculationValue'];
			}
			$out[] = $item;
		}
		if ( array() === $out ) {
			$this->notes[] = 'choice_without_options:' . DocumentBuilder::plain( (string) ( $f['label'] ?? '' ) );
			$out[]         = array(
				'id'    => $id . '_o0',
				'label' => $this->t( '1' ),
				'value' => '1',
			);
		}
		return $out;
	}

	/**
	 * Name of a Lucide icon from the name Funnelforms 4 stores (PascalCase), or null.
	 *
	 * @param string $name Name, e.g. Building2.
	 */
	private function icon( string $name ): ?string {
		$kebab = strtolower( (string) preg_replace( '/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])/', '-', trim( $name ) ) );
		if ( 1 !== preg_match( '/^[a-z0-9-]{1,60}$/', $kebab ) ) {
			return null;
		}
		$icons = $this->options['icons'];
		if ( null === $icons ) {
			return self::ICON_ALIASES[ $kebab ] ?? $kebab;
		}
		$candidates = array( $kebab, self::ICON_ALIASES[ $kebab ] ?? '' );
		// Lucide moved shapes to the front: alert-circle is circle-alert now.
		if ( 1 === preg_match( '/^(.+)-(circle|square)$/', $kebab, $m ) ) {
			$candidates[] = $m[2] . '-' . $m[1];
		}
		foreach ( $candidates as $candidate ) {
			if ( '' !== $candidate && isset( $icons[ $candidate ] ) ) {
				return $candidate;
			}
		}
		return null;
	}

	/**
	 * Fields of a contact form: as saved, or the three it starts with.
	 *
	 * @param array<string,mixed> $f Field of type submit.
	 * @return array<int,array<string,mixed>>
	 */
	private function contact_fields( array $f ): array {
		$saved = $f['settings']['submitFields'] ?? null;
		if ( ! is_array( $saved ) ) {
			$texts    = $this->options['texts'];
			$defaults = self::DEFAULT_CONTACT_FIELDS;
			foreach ( $defaults as $i => $field ) {
				$defaults[ $i ]['label'] = $texts[ $field['label'] ];
			}
			return $defaults;
		}
		$out = array();
		foreach ( $saved as $i => $field ) {
			if ( is_array( $field ) && isset( $field['id'] ) && is_scalar( $field['id'] ) && '' !== (string) $field['id'] ) {
				$field['order'] = is_numeric( $field['order'] ?? null ) ? (float) $field['order'] : (float) $i;
				$out[]          = $field;
			}
		}
		usort( $out, static fn( array $a, array $b ): int => $a['order'] <=> $b['order'] );
		return $out;
	}

	/**
	 * A contact step.
	 *
	 * @param string              $id     Id of the node.
	 * @param array<string,mixed> $f      Field of type submit.
	 * @param string              $suffix Suffix of field ids when the contact form is used twice.
	 * @return array<string,mixed>
	 */
	private function contact( string $id, array $f, string $suffix ): array {
		$settings = is_array( $f['settings'] ?? null ) ? $f['settings'] : array();
		$fields   = array();
		foreach ( $this->contact_fields( $f ) as $sub ) {
			$field = $this->contact_field( $sub, $suffix );
			if ( null !== $field ) {
				$fields[] = $field;
			}
		}
		if ( ! empty( $settings['showPrivacyCheckbox'] ) ) {
			$fields[] = array(
				'id'       => $this->id( 'privacy' . $suffix ),
				'type'     => 'consent',
				'key'      => 'privacy',
				'label'    => $this->t( '' ),
				'required' => ( $settings['privacyCheckboxRequired'] ?? true ) !== false,
				'props'    => array( 'html' => $this->t( self::esc( (string) ( $settings['privacyCheckboxText'] ?? '' ) ) ) ),
			);
		}
		$node   = array(
			'id'            => $id,
			'type'          => 'contact',
			'title'         => $this->t( self::either( DocumentBuilder::plain( (string) ( $f['label'] ?? '' ) ), $this->options['texts']['contact'] ) ),
			'description'   => $this->t( DocumentBuilder::plain( (string) ( $f['placeholder'] ?? '' ) ) ),
			'submitLabel'   => $this->t( self::either( DocumentBuilder::plain( (string) ( $settings['buttonText'] ?? '' ) ), $this->options['texts']['send'] ) ),
			'fields'        => $fields,
			'showBottomBar' => true,
		);
		$layout = array();
		$cols   = array();
		foreach ( array(
			'desktopColumns' => 'desktop',
			'mobileColumns'  => 'mobile',
		) as $from => $to ) {
			if ( in_array( (int) ( $settings[ $from ] ?? 0 ), array( 1, 2 ), true ) ) {
				$cols[ $to ] = (int) $settings[ $from ];
			}
		}
		if ( array() !== $cols ) {
			$layout['columns'] = $cols;
		}
		if ( ! empty( $settings['hideLabels'] ) ) {
			$layout['hideLabels'] = true;
		}
		if ( is_numeric( $settings['inputHeight'] ?? null ) ) {
			$layout['inputHeight'] = max( 30, min( 120, (int) $settings['inputHeight'] ) );
		}
		$button = array();
		if ( in_array( $settings['buttonSize'] ?? '', array( 'sm', 'lg' ), true ) ) {
			$button['size'] = 'sm' === $settings['buttonSize'] ? 's' : 'l';
		}
		if ( in_array( $settings['buttonAlignment'] ?? '', array( 'left', 'center', 'right', 'full' ), true ) ) {
			$button['align'] = (string) $settings['buttonAlignment'];
		}
		if ( array() !== $button ) {
			$layout['button'] = $button;
		}
		if ( array() !== $layout ) {
			$node['layout'] = $layout;
		}
		if ( '' !== trim( (string) ( $settings['webhookUrl'] ?? '' ) ) && array() === $fields ) {
			$this->notes[] = 'no_contact_fields';
		}
		return $node;
	}

	/**
	 * A field of the contact step.
	 *
	 * @param array<string,mixed> $sub    Field of the contact form.
	 * @param string              $suffix Suffix of the id.
	 * @return array<string,mixed>|null
	 */
	private function contact_field( array $sub, string $suffix ): ?array {
		$type  = (string) ( $sub['type'] ?? 'text' );
		$label = DocumentBuilder::plain( (string) ( $sub['label'] ?? '' ) );
		$field = array(
			'id'       => $this->id( (string) $sub['id'] . $suffix ),
			'type'     => 'text',
			'key'      => (string) $sub['id'],
			'label'    => $this->t( $label ),
			'required' => ! empty( $sub['required'] ),
			'props'    => array( 'placeholder' => $this->t( DocumentBuilder::plain( (string) ( $sub['placeholder'] ?? '' ) ) ) ),
		);
		switch ( $type ) {
			case 'email':
				$field['type']             = 'email';
				$field['props']['b2bOnly'] = false;
				break;
			case 'tel':
				$field['type'] = 'phone';
				break;
			case 'textarea':
				$field['type'] = 'textarea';
				break;
			case 'select':
				if ( ! empty( $sub['settings']['allowMultiSelect'] ) ) {
					$this->notes[] = 'ff4_contact_multiselect_single:' . $label;
				}
				$options = array();
				foreach ( is_array( $sub['options'] ?? null ) ? array_values( $sub['options'] ) : array() as $i => $option ) {
					if ( is_scalar( $option ) && '' !== trim( (string) $option ) ) {
						$options[] = array(
							'id'    => $field['id'] . '_o' . $i,
							'label' => $this->t( DocumentBuilder::plain( (string) $option ) ),
						);
					}
				}
				if ( array() === $options && 'salutation' === $sub['id'] ) {
					// The salutation of Funnelforms 4 before it was saved: the salutation field of 5.0.
					$field['type']  = 'salutation';
					$field['props'] = array(
						'allow' => array(
							'male'    => true,
							'female'  => true,
							'diverse' => true,
							'company' => false,
						),
					);
					break;
				}
				$field['type']             = 'select';
				$field['props']['options'] = $options;
				break;
			case 'checkbox':
				$html           = $this->checkbox_html( $label, is_array( $sub['labelLinks'] ?? null ) ? $sub['labelLinks'] : array() );
				$consent        = ! empty( $sub['labelLinks'] ) || 1 === preg_match( '/datenschutz|privacy|einwillig|consent|agb|terms|dsgvo|gdpr/i', $label );
				$field['type']  = $consent ? 'consent' : 'checkbox';
				$field['label'] = $this->t( $consent ? '' : $label );
				$field['props'] = array( 'html' => $this->t( $html ) );
				break;
			default:
				if ( 'name' === ( $sub['autocomplete'] ?? '' ) ) {
					$field['type'] = 'name';
				}
		}
		$icon = is_string( $sub['iconName'] ?? null ) ? $this->icon( $sub['iconName'] ) : null;
		if ( null !== $icon && ! in_array( $field['type'], array( 'consent', 'checkbox', 'salutation' ), true ) ) {
			$field['props']['icon'] = 'lucide:' . $icon;
		}
		return $field;
	}

	/**
	 * Text of a box to tick, with its links as anchors.
	 *
	 * @param string                         $label Text.
	 * @param array<int,array<string,mixed>> $links Links: text, url.
	 */
	private function checkbox_html( string $label, array $links ): string {
		$html = self::esc( $label );
		foreach ( $links as $link ) {
			$text = self::esc( (string) ( $link['text'] ?? '' ) );
			$url  = (string) ( $link['url'] ?? '' );
			if ( '' === $text || 1 !== preg_match( '#^(https?://|mailto:)#i', $url ) ) {
				continue;
			}
			$pos = strpos( $html, $text );
			if ( false !== $pos ) {
				$html = substr_replace( $html, '<a href="' . self::esc( $url ) . '" target="_blank" rel="noopener">' . $text . '</a>', $pos, strlen( $text ) );
			}
		}
		return $html;
	}

	/**
	 * An end node from the thank-you settings of Funnelforms 4.
	 *
	 * @param string              $id Id.
	 * @param array<string,mixed> $s  thankyou_settings.
	 * @return array<string,mixed>
	 */
	private function end( string $id, array $s ): array {
		$url      = trim( (string) ( $s['redirectUrl'] ?? '' ) );
		$redirect = null;
		if ( 1 === preg_match( '#^https?://#i', $url ) && ( $s['redirectEnabled'] ?? true ) !== false ) {
			$params = array();
			if ( ! empty( $s['redirectParams']['enabled'] ) && is_array( $s['redirectParams']['params'] ?? null ) ) {
				foreach ( $s['redirectParams']['params'] as $param ) {
					$name = trim( (string) ( $param['paramName'] ?? '' ) );
					$var  = (string) ( $param['fieldVariable'] ?? '' );
					if ( '' === $name || '' === $var ) {
						continue;
					}
					if ( ! isset( $this->vars[ $var ] ) ) {
						$this->notes[] = 'template_field_not_imported:' . $var;
						continue;
					}
					$params[] = array(
						'name'  => $name,
						'value' => $this->t( '{{field:' . $this->vars[ $var ] . '}}' ),
					);
				}
			}
			$skip     = ! empty( $s['skipThankYouPage'] );
			$timer    = is_numeric( $s['redirectTimer'] ?? null ) ? (int) $s['redirectTimer'] : 5;
			$redirect = array(
				'url'     => $this->t( $this->template( $url ) ),
				'newTab'  => ! empty( $s['openInNewTab'] ),
				'delayMs' => $skip ? 0 : max( 0, min( 60, $timer ) ) * 1000,
				'params'  => $params,
			);
			if ( ! $skip && $timer > 0 ) {
				$redirect['countdown'] = true;
			}
			if ( $skip ) {
				return array(
					'id'       => $id,
					'type'     => 'end',
					'success'  => null,
					'redirect' => $redirect,
				);
			}
		}
		$heading = trim( $this->template( DocumentBuilder::plain( (string) ( $s['headline'] ?? '' ) ) ) );
		$text    = trim( $this->template( (string) ( $s['customText'] ?? '' ) ) );
		$success = array(
			'show' => true,
			'text' => $this->t( '' !== $text ? $text : ( '' === $heading ? $this->options['texts']['thanks'] : '' ) ),
		);
		if ( '' !== $heading ) {
			$success['heading'] = $this->t( $heading );
		}
		if ( ! empty( $s['enableAnimation'] ) && in_array( $s['animationType'] ?? '', array( 'confetti', 'checkmark' ), true ) ) {
			$success['animation'] = 'confetti' === $s['animationType'] ? 'confetti' : 'check';
		}
		$cta = is_array( $s['ctaButton'] ?? null ) ? $s['ctaButton'] : array();
		if ( '' !== trim( (string) ( $cta['text'] ?? '' ) ) && 1 === preg_match( '#^https?://#i', trim( (string) ( $cta['url'] ?? '' ) ) ) ) {
			$success['button'] = array(
				'label'  => $this->t( DocumentBuilder::plain( (string) $cta['text'] ) ),
				'url'    => $this->t( trim( (string) $cta['url'] ) ),
				'newTab' => ! empty( $cta['openInNewTab'] ),
			);
		}
		$downloads = array();
		foreach ( is_array( $s['fileDownloads'] ?? null ) ? $s['fileDownloads'] : array() as $file ) {
			$file_url = trim( (string) ( $file['url'] ?? '' ) );
			if ( 1 === preg_match( '#^https?://#i', $file_url ) && count( $downloads ) < 10 ) {
				$downloads[] = array(
					'label' => $this->t( self::either( DocumentBuilder::plain( (string) ( $file['name'] ?? '' ) ), basename( self::path( $file_url ) ) ) ),
					'url'   => $file_url,
				);
			}
		}
		if ( array() !== $downloads ) {
			$success['downloads'] = $downloads;
			$this->notes[]        = 'ff4_external_media';
		}
		if ( ! empty( $s['showAnswerSummary'] ) ) {
			$success['showAnswers'] = true;
		}
		return array(
			'id'       => $id,
			'type'     => 'end',
			'success'  => $success,
			'redirect' => $redirect,
		);
	}

	/**
	 * A booking type made from the settings of an appointment field.
	 *
	 * @param string              $field_id Id of the new field.
	 * @param array<string,mixed> $f        Field of Funnelforms 4.
	 * @return array<string,mixed> field, title, config (settings of Domain\Booking\BookingType).
	 */
	private function booking( string $field_id, array $f ): array {
		$s      = is_array( $f['settings'] ?? null ) ? $f['settings'] : array();
		$config = array();
		$days   = array(
			'daily'   => array( 1, 2, 3, 4, 5, 6, 7 ),
			'mo - fr' => array( 1, 2, 3, 4, 5 ),
			'sa - so' => array( 6, 7 ),
		);
		$names  = array( 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday' );
		$hours  = array();
		foreach ( is_array( $s['availableTimeSlots'] ?? null ) ? $s['availableTimeSlots'] : array() as $slot ) {
			$from = (string) ( $slot['start'] ?? '' );
			$to   = (string) ( $slot['end'] ?? '' );
			$key  = strtolower( trim( (string) ( $slot['days'] ?? '' ) ) );
			$on   = $days[ $key ] ?? ( false !== array_search( $key, $names, true ) ? array( (int) array_search( $key, $names, true ) + 1 ) : null );
			if ( null !== $on && 1 === preg_match( '/^\d{2}:\d{2}$/', $from ) && 1 === preg_match( '/^\d{2}:\d{2}$/', $to ) && $from < $to ) {
				$hours[] = array(
					'days' => $on,
					'from' => $from,
					'to'   => $to,
				);
			}
		}
		if ( array() !== $hours ) {
			$config['hours'] = $hours;
		}
		$durations = array();
		foreach ( is_array( $s['durations'] ?? null ) ? $s['durations'] : array() as $d ) {
			$minutes = self::minutes( $d['value'] ?? null, (string) ( $d['unit'] ?? 'minutes' ) );
			if ( null !== $minutes ) {
				$durations[] = $minutes;
			}
		}
		if ( array() === $durations && is_numeric( $s['appointmentDuration'] ?? null ) ) {
			$durations[] = (int) $s['appointmentDuration'];
		}
		if ( array() !== $durations ) {
			$config['durations'] = array_values( array_unique( $durations ) );
			$config['interval']  = min( $config['durations'] );
		}
		if ( is_numeric( $s['bufferTime'] ?? null ) ) {
			$config['bufferAfter'] = max( 0, (int) $s['bufferTime'] );
		}
		$notice = self::minutes( $s['minAdvanceTime'] ?? null, (string) ( $s['minAdvanceTimeUnit'] ?? 'hours' ) );
		if ( null !== $notice ) {
			$config['notice'] = $notice;
		}
		if ( 'dateRange' === ( $s['planningPeriodType'] ?? '' ) && is_string( $s['planningDateRangeStart'] ?? null ) && is_string( $s['planningDateRangeEnd'] ?? null ) ) {
			$config['horizon'] = array(
				'mode' => 'range',
				'from' => substr( $s['planningDateRangeStart'], 0, 10 ),
				'to'   => substr( $s['planningDateRangeEnd'], 0, 10 ),
			);
		} elseif ( is_numeric( $s['planningFutureDays'] ?? null ) && (int) $s['planningFutureDays'] > 0 ) {
			$config['horizon'] = array(
				'mode'   => 'rolling',
				'amount' => (int) $s['planningFutureDays'],
				'unit'   => 'day',
			);
		}
		if ( is_string( $s['timeZone'] ?? null ) && 1 === preg_match( '#^([A-Za-z]+/[A-Za-z_/+-]+)#', $s['timeZone'], $m ) ) {
			$config['timezone'] = $m[1];
		}
		$this->notes[] = 'ff4_booking_calendar_not_imported';
		return array(
			'field'  => $field_id,
			'title'  => DocumentBuilder::plain( (string) ( $f['label'] ?? '' ) ),
			'config' => $config,
		);
	}

	/**
	 * Minutes of a value in minutes, hours or days.
	 *
	 * @param mixed  $value Value.
	 * @param string $unit  Unit.
	 */
	private static function minutes( $value, string $unit ): ?int {
		if ( ! is_numeric( $value ) || $value < 0 ) {
			return null;
		}
		$factor = array(
			'minutes' => 1,
			'hours'   => 60,
			'days'    => 1440,
		);
		return (int) round( (float) $value * ( $factor[ $unit ] ?? 1 ) );
	}

	/**
	 * Mails, webhooks and the notes on what stays behind.
	 *
	 * @param array<string,mixed>               $snapshot Snapshot.
	 * @param array<int,array<string,mixed>>    $nodes    Nodes of the document.
	 * @param array<string,array<string,mixed>> $actions  Logic actions by node id.
	 * @return array<int,array<string,mixed>>
	 */
	private function actions( array $snapshot, array $nodes, array $actions ): array {
		$out      = array();
		$n        = is_array( $snapshot['notifications'] ?? null ) ? $snapshot['notifications'] : array();
		$email    = null;
		$contacts = array();
		foreach ( $nodes as $node ) {
			if ( 'contact' !== $node['type'] ) {
				continue;
			}
			$contacts[] = $node['id'];
			foreach ( $node['fields'] as $field ) {
				if ( null === $email && 'email' === $field['type'] ) {
					$email = $field;
				}
			}
		}
		$field_token = function ( $name ) use ( $email ): ?array {
			if ( is_string( $name ) && '' !== $name && 'none' !== $name && isset( $this->vars[ $name ] ) ) {
				return array(
					'token' => '{{field:' . $this->vars[ $name ] . '}}',
					'key'   => $this->vars[ $name ],
				);
			}
			return null === $email ? null : array(
				'token' => '{{field:' . $email['key'] . '}}',
				'key'   => $email['key'],
			);
		};
		$mail        = function ( string $id, string $kind, string $to, string $cc, string $bcc, string $reply, $subject, $html, $plain ): array {
			$html  = trim( (string) $html );
			$plain = trim( (string) $plain );
			$body  = '' !== $html ? $html : $plain;
			return array(
				'id'     => $id,
				'on'     => 'submit',
				'kind'   => $kind,
				'config' => array(
					'to'        => $this->t( $to ),
					'cc'        => $this->t( $cc ),
					'bcc'       => $this->t( $bcc ),
					'from'      => $this->t( '' ),
					'fromName'  => $this->t( '' ),
					'replyTo'   => $this->t( $reply ),
					'subject'   => $this->t( '' !== trim( (string) $subject ) ? $this->template( (string) $subject ) : $this->options['texts']['subject'] ),
					'body'      => $this->t( '' !== $body ? $this->template( $body ) : '{{lead}}' ),
					'nl2br'     => '' === $html,
					'transport' => array( 'type' => 'wp_mail' ),
					'layout'    => '' !== $body ? 'plain' : 'branded',
				),
			);
		};

		if ( ! empty( $n['admin_notifications_enabled'] ) ) {
			$to  = array();
			$cc  = array();
			$bcc = array();
			foreach ( is_array( $n['admin_email_recipients'] ?? null ) ? $n['admin_email_recipients'] : array() as $r ) {
				$address = trim( (string) ( $r['email'] ?? '' ) );
				if ( false === strpos( $address, '@' ) ) {
					continue;
				}
				if ( 'cc' === ( $r['type'] ?? '' ) ) {
					$cc[] = $address;
				} elseif ( 'bcc' === ( $r['type'] ?? '' ) ) {
					$bcc[] = $address;
				} else {
					$to[] = $address;
				}
			}
			if ( array() === $to && array() === $cc && array() === $bcc ) {
				foreach ( is_array( $n['admin_email_addresses'] ?? null ) ? $n['admin_email_addresses'] : array() as $address ) {
					if ( false !== strpos( (string) $address, '@' ) ) {
						$to[] = trim( (string) $address );
					}
				}
			}
			if ( array() === $to && array() === $cc && array() === $bcc ) {
				$this->notes[] = 'ff4_admin_mail_without_recipient';
			} else {
				$reply = $field_token( $n['admin_email_reply_to_field'] ?? null );
				$out[] = $mail( 'a_ff4_admin', 'email', implode( ', ', $to ), implode( ', ', $cc ), implode( ', ', $bcc ), null === $reply ? '' : $reply['token'], $n['admin_email_subject'] ?? '', $n['admin_email_html'] ?? '', $n['admin_email_plain'] ?? '' );
			}
		}
		if ( ! empty( $n['user_notifications_enabled'] ) ) {
			$to = $field_token( $n['user_email_field'] ?? null );
			if ( null === $to ) {
				$this->notes[] = 'ff4_confirmation_without_email_field';
			} else {
				$action                             = $mail( 'a_ff4_confirmation', 'autoresponder', $to['token'], '', '', '', $n['user_email_subject'] ?? '', $n['user_email_html'] ?? '', $n['user_email_plain'] ?? '' );
				$action['config']['recipientField'] = $this->field_id_of_key( $nodes, $to['key'] );
				if ( '' === $action['config']['recipientField'] ) {
					unset( $action['config']['recipientField'] );
				}
				$out[] = $action;
			}
		}
		if ( ! empty( $n['sms_admin_notifications_enabled'] ) || ! empty( $n['sms_user_notifications_enabled'] ) ) {
			$this->notes[] = 'ff4_sms_not_imported';
		}
		if ( ! empty( $n['whatsapp_admin_notifications_enabled'] ) || ! empty( $n['whatsapp_user_notifications_enabled'] ) ) {
			$this->notes[] = 'ff4_whatsapp_not_imported';
		}

		// Webhooks: of the contact forms, and the webhook actions of the logic (the SaaS sends both on every entry).
		$urls = array();
		foreach ( $this->fields as $field ) {
			if ( self::CONTACT === ( $field['type'] ?? '' ) ) {
				$urls[] = array( (string) ( $field['settings']['webhookUrl'] ?? '' ), 'POST' );
			}
		}
		foreach ( $actions as $action ) {
			$kind = (string) ( $action['action_type'] ?? '' );
			if ( 'webhook' === $kind ) {
				$urls[] = array( (string) ( $action['settings']['url'] ?? '' ), strtoupper( (string) ( $action['settings']['httpMethod'] ?? 'POST' ) ) );
			} elseif ( 'ai_leadcaller' === $kind ) {
				$this->notes[] = 'ff4_ai_leadcaller_not_imported';
			}
		}
		$seen = array();
		foreach ( $urls as [ $url, $method ] ) {
			$url = trim( $url );
			if ( 1 !== preg_match( '#^https?://#i', $url ) || isset( $seen[ $url ] ) ) {
				continue;
			}
			$seen[ $url ] = true;
			if ( 'POST' !== $method ) {
				$this->notes[] = 'ff4_webhook_method_post:' . $method;
			}
			$out[] = array(
				'id'     => 'a_ff4_webhook_' . count( $seen ),
				'on'     => 'submit',
				'kind'   => 'webhook',
				'config' => array(
					'url'    => $url,
					'format' => 'ff4',
				),
			);
		}
		if ( array() !== $seen ) {
			$this->notes[] = 'ff4_webhooks_imported';
		}
		if ( array() === $contacts && array() !== $out ) {
			$this->notes[] = 'ff4_actions_without_contact_step';
		}
		return $out;
	}

	/**
	 * Id of the first field with a key.
	 *
	 * @param array<int,array<string,mixed>> $nodes Nodes.
	 * @param string                         $key   Key.
	 */
	private function field_id_of_key( array $nodes, string $key ): string {
		foreach ( $nodes as $node ) {
			foreach ( $node['fields'] ?? array() as $field ) {
				if ( $key === $field['key'] ) {
					return (string) $field['id'];
				}
			}
		}
		return '';
	}

	/**
	 * A text of Funnelforms 4 with its placeholders as tokens of this plugin.
	 *
	 * @param string $text Text.
	 */
	private function template( string $text ): string {
		$text = (string) preg_replace_callback(
			'/\{\{\s*([^{}]+?)\s*\}\}/',
			function ( array $m ): string {
				$name = $m[1];
				if ( array_key_exists( $name, self::TOKENS ) ) {
					if ( '' === self::TOKENS[ $name ] ) {
						$this->notes[] = 'template_tag_not_imported:{{' . $name . '}}';
					}
					return self::TOKENS[ $name ];
				}
				if ( 0 === strpos( $name, 'booking_' ) ) {
					return '{{booking:date}} {{booking:time}}';
				}
				if ( 0 === strpos( $name, 'question_' ) && isset( $this->vars[ substr( $name, 9 ) ] ) ) {
					return '{{field:' . $this->vars[ substr( $name, 9 ) ] . '}}';
				}
				if ( isset( $this->vars[ $name ] ) ) {
					return '{{field:' . $this->vars[ $name ] . '}}';
				}
				$this->notes[] = 'template_field_not_imported:{{' . $name . '}}';
				return '';
			},
			$text
		);
		// The SaaS also replaced {name} when the name was known; CSS braces stay.
		return (string) preg_replace_callback(
			'/(?<!\{)\{([A-Za-z0-9_-]{1,80})\}(?!\})/',
			fn( array $m ): string => isset( $this->vars[ $m[1] ] ) ? '{{field:' . $this->vars[ $m[1] ] . '}}' : $m[0],
			$text
		);
	}

	/**
	 * Label of a field of the document.
	 *
	 * @param array<string,mixed> $field Field.
	 */
	private function label( array $field ): string {
		return (string) ( $field['label'][ $this->locale ] ?? $field['key'] ?? '' );
	}

	/**
	 * A unique id from a source id.
	 *
	 * @param string $source Source id.
	 * @param bool   $again  Whether the source id was used before (then a suffix follows).
	 */
	private function id( string $source, bool $again = false ): string {
		$base = substr( (string) preg_replace( '/[^A-Za-z0-9_-]+/', '_', $source ), 0, 72 );
		if ( '' === $base ) {
			$base = 'n';
		}
		$id = $base;
		for ( $n = 2; isset( $this->ids[ $id ] ) || ( $again && $id === $base ); $n++ ) {
			$id = $base . '_' . $n;
		}
		$this->ids[ $id ] = true;
		return $id;
	}

	/**
	 * A text in the form's language.
	 *
	 * @param string $value Value.
	 * @return array<string,string>
	 */
	private function t( string $value ): array {
		return array( $this->locale => $value );
	}

	/**
	 * JavaScript of a tracking code, without the script tags the SaaS wraps it in.
	 *
	 * @param mixed $code Code.
	 */
	private static function script( $code ): string {
		if ( ! is_string( $code ) ) {
			return '';
		}
		return trim( (string) preg_replace( '#</?script[^>]*>#i', '', $code ) );
	}

	/**
	 * Date format of the SaaS (DD/MM/YYYY) in the tokens of the date field (dd/mm/yy).
	 *
	 * @param string $format Format.
	 */
	private static function date_format( string $format ): string {
		$out = strtr(
			strtoupper( $format ),
			array(
				'YYYY' => 'yy',
				'DD'   => 'dd',
				'MM'   => 'mm',
			)
		);
		return 1 === preg_match( '/^(dd|mm|yy)([.\/-])(dd|mm|yy)\2(dd|mm|yy)$/', $out, $m ) && 3 === count( array_unique( array( $m[1], $m[3], $m[4] ) ) ) ? $out : 'dd.mm.yy';
	}

	/**
	 * Rows of a table as arrays.
	 *
	 * @param mixed $rows Rows.
	 * @return array<int,array<string,mixed>>
	 */
	private static function rows( $rows ): array {
		return is_array( $rows ) ? array_values( array_filter( $rows, 'is_array' ) ) : array();
	}

	/**
	 * Nodes and edges of a form without logic: its fields in their order.
	 *
	 * @param array<string,array<string,mixed>> $fields Fields by id.
	 * @return array{0:array<string,array<string,mixed>>,1:array<string,array<int,array<string,mixed>>>,2:string}
	 */
	private static function linear( array $fields ): array {
		uasort( $fields, static fn( array $a, array $b ): int => (int) ( $a['order_index'] ?? 0 ) <=> (int) ( $b['order_index'] ?? 0 ) );
		$nodes = array(
			'start' => array(
				'node_id'       => 'start',
				'field_id'      => null,
				'is_start_node' => true,
			),
		);
		$edges = array();
		$prev  = 'start';
		$x     = 0;
		foreach ( $fields as $id => $field ) {
			$node_id           = 'node-' . $id;
			$nodes[ $node_id ] = array(
				'node_id'    => $node_id,
				'field_id'   => $id,
				'position_x' => $x += 360,
				'position_y' => 0,
			);
			$edges[ $prev ][] = array(
				'source_node_id' => $prev,
				'target_node_id' => $node_id,
				'condition'      => null,
			);
			$prev             = $node_id;
		}
		return array( $nodes, $edges, 'start' );
	}

	/**
	 * A text, or the fallback when it is empty.
	 *
	 * @param string $text     Text.
	 * @param string $fallback Fallback.
	 */
	private static function either( string $text, string $fallback ): string {
		return '' !== $text ? $text : $fallback;
	}

	/**
	 * Text escaped for HTML (runs without WordPress in unit tests).
	 *
	 * @param string $text Text.
	 */
	private static function esc( string $text ): string {
		return htmlspecialchars( $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	}

	/**
	 * Path of an address.
	 *
	 * @param string $url Address.
	 */
	private static function path( string $url ): string {
		return (string) parse_url( $url, PHP_URL_PATH ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- runs without WordPress in unit tests.
	}
}
