<?php
/**
 * Turns a form of another plugin into a Funnelforms form document.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import;

defined( 'ABSPATH' ) || exit;

/**
 * Builds a schema v1 document (packages/form-schema) from an ImportedForm.
 *
 * Layout: other plugins show a form as one page or as pages split by page breaks. Every page but
 * the last becomes a step with all its fields. The last page becomes the contact step that sends
 * the entry; its fields that a contact step cannot hold (choices with several answers, numbers,
 * dates, files, …) go into a step right before it. Consent boxes always go into the contact step.
 * Then an end node shows the confirmation text or redirects.
 *
 * Fields get readable keys (from their label) for mail templates and integrations; ids are
 * derived from the source ids, so importing the same form again gives the same ids.
 *
 * Pure PHP without WordPress, so the readers' samples are tested as unit tests.
 */
final class DocumentBuilder {

	/**
	 * Contact field type for an imported type, where a contact step can hold it.
	 */
	private const CONTACT_TYPES = array(
		'name'       => 'name',
		'first_name' => 'text',
		'last_name'  => 'text',
		'email'      => 'email',
		'phone'      => 'phone',
		'text'       => 'text',
		'textarea'   => 'textarea',
		'select'     => 'select',
		'radio'      => 'select',
		'consent'    => 'consent',
		'html'       => 'html',
	);

	/**
	 * Default texts in the form's language: contact, send, thanks, next.
	 *
	 * @var array<string,string>
	 */
	private array $texts;

	/**
	 * Locale of the texts.
	 *
	 * @var string
	 */
	private string $locale;

	/**
	 * Keys given so far.
	 *
	 * @var array<string,true>
	 */
	private array $keys = array();

	/**
	 * Ids given so far.
	 *
	 * @var array<string,true>
	 */
	private array $ids = array();

	/**
	 * Key of each source field id, for {{src:...}} tokens.
	 *
	 * @var array<string,string>
	 */
	private array $source_keys = array();

	/**
	 * Notes about what was changed or left out.
	 *
	 * @var string[]
	 */
	private array $notes = array();

	/**
	 * Builder.
	 *
	 * @param string               $locale Locale of the form, e.g. de_DE.
	 * @param array<string,string> $texts  Default texts: contact, send, thanks, next; and the site's
	 *                                     admin_email, site_title and site_url for
	 *                                     {{admin_email}}, {{site_title}} and {{site_url}} in templates.
	 */
	public function __construct( string $locale, array $texts = array() ) {
		$this->locale = $locale;
		$this->texts  = $texts + array(
			'contact'     => 'Your contact details',
			'send'        => 'Send',
			'thanks'      => 'Thank you! We will get back to you soon.',
			'next'        => 'Next',
			'admin_email' => '',
			'site_title'  => '',
			'site_url'    => '',
		);
	}

	/**
	 * The document and the notes of the import.
	 *
	 * @param ImportedForm $form Form.
	 * @return array{document:array<string,mixed>,notes:string[]}
	 */
	public function build( ImportedForm $form ): array {
		$this->keys        = array();
		$this->ids         = array();
		$this->source_keys = array();
		$this->notes       = $form->notes;

		$pages = array( array() );
		foreach ( $form->fields as $field ) {
			$type = (string) ( $field['type'] ?? '' );
			if ( 'page_break' === $type ) {
				if ( array() !== end( $pages ) ) {
					$pages[] = array();
				}
				continue;
			}
			if ( ! in_array( $type, ImportedForm::FIELD_TYPES, true ) ) {
				$this->notes[] = 'field_type_not_imported:' . $type . ':' . self::plain( (string) ( $field['label'] ?? '' ) );
				continue;
			}
			if ( 'hidden' === $type ) {
				$this->notes[] = 'hidden_field_not_imported:' . self::plain( (string) ( $field['label'] ?? $field['id'] ?? '' ) );
				continue;
			}
			if ( 'captcha' === $type ) {
				$this->notes[] = 'captcha_not_imported';
				continue;
			}
			if ( ! empty( $field['conditional'] ) ) {
				$this->notes[] = 'conditional_logic_not_imported:' . self::plain( (string) ( $field['label'] ?? '' ) );
			}
			$pages[ count( $pages ) - 1 ][] = $field;
		}
		if ( array() === end( $pages ) && count( $pages ) > 1 ) {
			array_pop( $pages );
		}

		$last    = array_pop( $pages );
		$consent = array();
		$steps   = array();
		foreach ( $pages as $page ) {
			$step_fields = array();
			foreach ( $page as $field ) {
				if ( 'consent' === $field['type'] ) {
					$consent[] = $field;
					continue;
				}
				$step_fields[] = $this->step_field( $field );
			}
			if ( array() !== $step_fields ) {
				$steps[] = $step_fields;
			}
		}
		$before  = array();
		$contact = array();
		foreach ( $last as $field ) {
			if ( isset( self::CONTACT_TYPES[ $field['type'] ] ) && ! ( 'select' === $field['type'] && ! empty( $field['multiple'] ) ) ) {
				$contact[] = $field;
			} else {
				$before[] = $field;
			}
		}
		if ( array() !== $before ) {
			if ( array() !== $contact ) {
				$this->notes[] = 'fields_moved_before_contact_step:' . count( $before );
			}
			$steps[] = array_map( array( $this, 'step_field' ), $before );
		}
		$contact_fields = array_map( array( $this, 'contact_field' ), array_merge( $contact, $consent ) );

		$nodes  = array();
		$edges  = array();
		$layout = array();
		$x      = 0;
		foreach ( $steps as $i => $fields ) {
			$id            = 'step_' . ( $i + 1 );
			$nodes[]       = array(
				'id'     => $id,
				'type'   => 'step',
				'fields' => $fields,
			);
			$layout[ $id ] = array(
				'x' => $x,
				'y' => 0,
			);
			$x            += 320;
		}
		$nodes[]           = array(
			'id'            => 'contact',
			'type'          => 'contact',
			'title'         => $this->t( $this->texts['contact'] ),
			'description'   => $this->t( '' ),
			'submitLabel'   => $this->t( '' !== trim( $form->submit_label ) ? self::plain( $form->submit_label ) : $this->texts['send'] ),
			'fields'        => $contact_fields,
			'showBottomBar' => true,
		);
		$layout['contact'] = array(
			'x' => $x,
			'y' => 0,
		);
		$nodes[]           = $this->end( $form->confirmation );
		$layout['end']     = array(
			'x' => $x + 320,
			'y' => 0,
		);
		$order             = array_column( $nodes, 'id' );
		$counter           = count( $order );
		for ( $i = 0; $i < $counter - 1; $i++ ) {
			$edges[] = array(
				'id'      => 'e_' . $order[ $i ] . '_' . $order[ $i + 1 ],
				'from'    => $order[ $i ],
				'to'      => $order[ $i + 1 ],
				'default' => true,
			);
		}
		if ( array() === $contact_fields ) {
			$this->notes[] = 'no_contact_fields';
		}

		$actions = array();
		foreach ( $form->notifications as $i => $mail ) {
			$actions[] = $this->mail_action( $i + 1, $mail );
		}
		$actions = self::confirmation( $actions );

		$document = array(
			'schemaVersion' => 1,
			'id'            => 'frm_import',
			'title'         => '' !== trim( $form->title ) ? self::plain( $form->title ) : $form->source . ' ' . $form->source_id,
			'locales'       => array(
				'default'   => $this->locale,
				'available' => array( $this->locale ),
			),
			'start'         => $order[0],
			'nodes'         => $nodes,
			'edges'         => $edges,
			'calculations'  => array(),
			'actions'       => $actions,
			'style'         => array(
				'preset' => 'default',
				'tokens' => new \stdClass(),
			),
			'settings'      => array(
				'uiLocale'           => '',
				'progressBar'        => array( 'show' => count( $steps ) > 0 ),
				'loadingAnimation'   => false,
				'scrollToTop'        => array(
					'desktop' => false,
					'mobile'  => true,
				),
				'rtl'                => false,
				'autoHeight'         => true,
				'iconFont'           => false,
				'savePartialEntries' => false,
			),
			'layout'        => array( 'nodes' => $layout ),
			'meta'          => array(
				'import' => array(
					'source'   => $form->source,
					'sourceId' => $form->source_id,
					'notes'    => array_values( array_unique( $this->notes ) ),
				),
			),
		);
		return array(
			'document' => $document,
			'notes'    => array_values( array_unique( $this->notes ) ),
		);
	}

	/**
	 * A step field.
	 *
	 * @param array<string,mixed> $f Imported field.
	 * @return array<string,mixed>
	 */
	private function step_field( array $f ): array {
		$base        = array(
			'id'          => $this->id( 'q', (string) ( $f['id'] ?? '' ) ),
			'key'         => $this->key( $f ),
			'label'       => $this->t( self::plain( (string) ( $f['label'] ?? '' ) ) ),
			'description' => $this->t( self::plain( (string) ( $f['description'] ?? '' ) ) ),
			'required'    => ! empty( $f['required'] ),
		);
		$placeholder = array( 'placeholder' => $this->t( self::plain( (string) ( $f['placeholder'] ?? '' ) ) ) );
		switch ( $f['type'] ) {
			case 'name':
			case 'first_name':
			case 'last_name':
				$auto = array(
					'name'       => 'name',
					'first_name' => 'given-name',
					'last_name'  => 'family-name',
				);
				return $base + array(
					'type'  => 'text',
					'props' => $placeholder + array( 'autocomplete' => $auto[ $f['type'] ] ),
				);
			case 'text':
			case 'textarea':
			case 'email':
			case 'phone':
			case 'url':
				return $base + array(
					'type'  => $f['type'],
					'props' => $placeholder,
				);
			case 'number':
				$props = $placeholder;
				foreach ( array( 'min', 'max', 'step' ) as $limit ) {
					if ( isset( $f[ $limit ] ) && is_numeric( $f[ $limit ] ) ) {
						$props[ $limit ] = 0 + $f[ $limit ];
					}
				}
				return $base + array(
					'type'  => 'number',
					'props' => $props,
				);
			case 'date':
				return $base + array(
					'type'  => 'date',
					'props' => $placeholder + array( 'format' => 'dd.mm.yy' ),
				);
			case 'time':
				return $base + array(
					'type'  => 'time',
					'props' => new \stdClass(),
				);
			case 'select':
				$field = $base + array(
					'type'    => 'dropdown',
					'options' => $this->options( $f, $base['id'] ),
					'props'   => array(),
				);
				if ( ! empty( $f['multiple'] ) ) {
					$field['props']['multiple'] = true;
				}
				if ( '' !== trim( (string) ( $f['placeholder'] ?? '' ) ) ) {
					$field['props']['placeholder'] = $placeholder['placeholder'];
				}
				if ( array() === $field['props'] ) {
					$field['props'] = new \stdClass();
				}
				return $field;
			case 'radio':
			case 'checkbox':
			case 'consent':
				return $base + array(
					'type'    => 'choice',
					'options' => $this->options( $f, $base['id'] ),
					'props'   => array(
						'multiple'  => 'radio' !== $f['type'],
						'layout'    => array(
							'desktop' => 'list',
							'mobile'  => 'list',
						),
						'hideIcons' => true,
					),
				);
			case 'html':
				return array_merge(
					$base,
					array(
						'required' => false,
						'type'     => 'content',
						'props'    => array(
							'html'   => $this->t( (string) ( $f['html'] ?? $f['label'] ?? '' ) ),
							'button' => array(
								'show'  => false,
								'label' => $this->t( $this->texts['next'] ),
							),
						),
					)
				);
			case 'file':
				return $base + array(
					'type'  => 'file',
					'props' => array(
						'dropzoneText'    => $this->t( '' ),
						'maxSizeMb'       => 10,
						'maxFiles'        => 1,
						'deniedMimeTypes' => array(),
						'visibility'      => 'private',
					),
				);
			case 'address':
				return $base + array(
					'type'  => 'address',
					'props' => array(
						'zoom'               => 12,
						'start'              => array(
							'name' => '',
							'lat'  => 52.52,
							'lng'  => 13.405,
						),
						'combined'           => false,
						'showCountry'        => true,
						'placesAutocomplete' => false,
					),
				);
			case 'rating':
				return $base + array(
					'type'  => 'rating',
					'props' => array(
						'min'       => 1,
						'max'       => isset( $f['max'] ) && is_numeric( $f['max'] ) ? max( 2, min( 10, (int) $f['max'] ) ) : 5,
						'style'     => 'stars',
						'lowLabel'  => $this->t( '' ),
						'highLabel' => $this->t( '' ),
					),
				);
			case 'slider':
				$min = isset( $f['min'] ) && is_numeric( $f['min'] ) ? 0 + $f['min'] : 0;
				$max = isset( $f['max'] ) && is_numeric( $f['max'] ) ? 0 + $f['max'] : 100;
				if ( $max <= $min ) {
					$max = $min + 100;
				}
				return $base + array(
					'type'  => 'slider',
					'props' => array(
						'min'                => $min,
						'max'                => $max,
						'step'               => isset( $f['step'] ) && is_numeric( $f['step'] ) && $f['step'] > 0 ? 0 + $f['step'] : 1,
						'start'              => isset( $f['default'] ) && is_numeric( $f['default'] ) ? max( $min, min( $max, 0 + $f['default'] ) ) : $min,
						'unit'               => array(
							'text'     => $this->t( '' ),
							'position' => 'after',
						),
						'thousandsSeparator' => true,
						'manualInput'        => array(
							'enabled' => false,
							'label'   => $this->t( '' ),
						),
					),
				);
		}
		// Unreachable: every type is handled above.
		return $base + array(
			'type'  => 'text',
			'props' => $placeholder,
		);
	}

	/**
	 * A contact field.
	 *
	 * @param array<string,mixed> $f Imported field.
	 * @return array<string,mixed>
	 */
	private function contact_field( array $f ): array {
		$type  = self::CONTACT_TYPES[ $f['type'] ];
		$label = self::plain( (string) ( $f['label'] ?? '' ) );
		$field = array(
			'id'       => $this->id( 'c', (string) ( $f['id'] ?? '' ) ),
			'type'     => $type,
			'key'      => $this->key( $f ),
			'label'    => $this->t( $label ),
			'required' => ! empty( $f['required'] ),
			'props'    => array(),
		);
		switch ( $type ) {
			case 'consent':
				// The text of the box is the label; links in it stay.
				$html           = trim( (string) ( $f['html'] ?? '' ) );
				$field['label'] = $this->t( '' );
				$field['props'] = array( 'html' => $this->t( '' !== $html ? $html : $label ) );
				break;
			case 'html':
				$field['required'] = false;
				$field['props']    = array( 'html' => $this->t( (string) ( $f['html'] ?? $label ) ) );
				break;
			case 'select':
				$options = array();
				foreach ( $this->options( $f, $field['id'] ) as $option ) {
					$options[] = array(
						'id'    => $option['id'],
						'label' => $option['label'],
					);
				}
				$field['props'] = array(
					'placeholder' => $this->t( self::plain( (string) ( $f['placeholder'] ?? '' ) ) ),
					'options'     => $options,
				);
				break;
			case 'email':
				$field['props'] = array(
					'placeholder' => $this->t( self::plain( (string) ( $f['placeholder'] ?? '' ) ) ),
					'b2bOnly'     => false,
				);
				break;
			default:
				$field['props'] = array( 'placeholder' => $this->t( self::plain( (string) ( $f['placeholder'] ?? '' ) ) ) );
		}
		return $field;
	}

	/**
	 * The end node: the confirmation text, or a redirect.
	 *
	 * @param array<string,string>|null $confirmation Confirmation.
	 * @return array<string,mixed>
	 */
	private function end( ?array $confirmation ): array {
		$url = trim( (string) ( $confirmation['url'] ?? '' ) );
		if ( 'redirect' === ( $confirmation['type'] ?? '' ) && 1 === preg_match( '#^https?://#i', $url ) ) {
			return array(
				'id'       => 'end',
				'type'     => 'end',
				'success'  => null,
				'redirect' => array(
					'url'     => $this->t( $this->template( $url ) ),
					'newTab'  => false,
					'delayMs' => 0,
					'params'  => array(),
				),
			);
		}
		if ( 'redirect' === ( $confirmation['type'] ?? '' ) ) {
			$this->notes[] = 'redirect_without_address';
		}
		$message = trim( $this->template( (string) ( $confirmation['message'] ?? '' ) ) );
		return array(
			'id'       => 'end',
			'type'     => 'end',
			'success'  => array(
				'show' => true,
				'text' => $this->t( '' !== $message ? $message : $this->texts['thanks'] ),
			),
			'redirect' => null,
		);
	}

	/**
	 * An e-mail action after the contact step.
	 *
	 * @param int                  $n    Number of the mail.
	 * @param array<string,string> $mail Mail.
	 * @return array<string,mixed>
	 */
	private function mail_action( int $n, array $mail ): array {
		$value = fn( string $key ): array => $this->t( $this->template( trim( (string) ( $mail[ $key ] ?? '' ) ) ) );
		$body  = trim( (string) ( $mail['body'] ?? '' ) );
		return array(
			'id'     => 'a_import_mail_' . $n,
			'on'     => 'submit',
			'node'   => 'contact',
			'kind'   => 'email',
			'config' => array(
				'to'        => $value( 'to' ),
				'cc'        => $value( 'cc' ),
				'bcc'       => $value( 'bcc' ),
				'from'      => $value( 'from' ),
				'fromName'  => $value( 'from_name' ),
				'replyTo'   => $value( 'reply_to' ),
				'subject'   => $value( 'subject' ),
				'body'      => $this->t( '' !== $body ? $this->template( $body ) : '{{answers}}' ),
				// HTML bodies keep their markup; plain text ones get line breaks.
				'nl2br'     => strip_tags( $body ) === $body, // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- runs without WordPress in unit tests.
				'transport' => array( 'type' => 'wp_mail' ),
			),
		);
	}

	/**
	 * The first mail after the first one that goes to an address the visitor entered becomes the
	 * confirmation to the visitor (autoresponder), as the mails of Funnelforms are set up. Free has
	 * one notification and one confirmation; two notifications would be a Pro feature.
	 *
	 * @param array<int,array<string,mixed>> $actions Mail actions.
	 * @return array<int,array<string,mixed>>
	 */
	private static function confirmation( array $actions ): array {
		foreach ( $actions as $i => $action ) {
			$to = array_values( $action['config']['to'] )[0] ?? '';
			if ( $i > 0 && 1 === preg_match( '/^\{\{field:([^}]+)\}\}$/', trim( (string) $to ), $m ) ) {
				$actions[ $i ]['kind']                     = 'autoresponder';
				$actions[ $i ]['config']['recipientField'] = $m[1];
				break;
			}
		}
		return $actions;
	}

	/**
	 * A template with {{src:<id>}} turned into the field token of the new form, and the site's
	 * address and name filled in. A token of a field
	 * that was not imported becomes empty, and is noted.
	 *
	 * @param string $text Text.
	 */
	private function template( string $text ): string {
		$text = str_replace( array( '{{admin_email}}', '{{site_title}}', '{{site_url}}' ), array( $this->texts['admin_email'], $this->texts['site_title'], $this->texts['site_url'] ), $text );
		return (string) preg_replace_callback(
			'/\{\{src:([^}]+)\}\}/',
			function ( array $m ): string {
				// A part of a field (WPForms and Gravity name parts, Fluent sub-fields) names the field.
				$parent = (string) preg_replace( '/[.\[].*$/', '', $m[1] );
				foreach ( array( $m[1], $parent ) as $id ) {
					if ( isset( $this->source_keys[ $id ] ) ) {
						return '{{field:' . $this->source_keys[ $id ] . '}}';
					}
				}
				$this->notes[] = 'template_field_not_imported:' . $m[1];
				return '';
			},
			$text
		);
	}

	/**
	 * Options with ids.
	 *
	 * @param array<string,mixed> $f     Field.
	 * @param string              $field Id of the new field.
	 * @return array<int,array<string,mixed>>
	 */
	private function options( array $f, string $field ): array {
		$out  = array();
		$seen = array();
		foreach ( is_array( $f['options'] ?? null ) ? $f['options'] : array() as $i => $option ) {
			$label = self::plain( (string) ( $option['label'] ?? '' ) );
			$value = (string) ( $option['value'] ?? $label );
			if ( '' === $label && '' === $value ) {
				continue;
			}
			$id = $field . '_o' . $i;
			if ( isset( $seen[ $id ] ) ) {
				continue;
			}
			$seen[ $id ] = true;
			$out[]       = array(
				'id'    => $id,
				'label' => $this->t( '' !== $label ? $label : $value ),
				'value' => '' !== $value ? $value : $label,
			);
		}
		if ( array() === $out ) {
			$this->notes[] = 'choice_without_options:' . self::plain( (string) ( $f['label'] ?? '' ) );
			$out[]         = array(
				'id'    => $field . '_o0',
				'label' => $this->t( '1' ),
				'value' => '1',
			);
		}
		return $out;
	}

	/**
	 * A unique id from the source id.
	 *
	 * @param string $prefix Prefix (q for step fields, c for contact fields).
	 * @param string $source Source id.
	 */
	private function id( string $prefix, string $source ): string {
		$base = $prefix . '_' . substr( (string) preg_replace( '/[^A-Za-z0-9_-]+/', '_', $source ), 0, 60 );
		$id   = $base;
		for ( $n = 2; isset( $this->ids[ $id ] ); $n++ ) {
			$id = $base . '_' . $n;
		}
		$this->ids[ $id ] = true;
		return $id;
	}

	/**
	 * A unique key from the label (or the source id), and the record for {{src:...}} tokens.
	 *
	 * @param array<string,mixed> $f Field.
	 */
	private function key( array $f ): string {
		$wanted = array(
			'email'      => 'email',
			'name'       => 'name',
			'first_name' => 'first_name',
			'last_name'  => 'last_name',
			'phone'      => 'phone',
		);
		$base   = $wanted[ $f['type'] ] ?? self::slug( (string) ( $f['label'] ?? '' ) );
		if ( '' === $base ) {
			$base = self::slug( (string) ( $f['id'] ?? '' ) );
		}
		if ( '' === $base || ctype_digit( $base[0] ) ) {
			$base = 'field_' . $base;
		}
		$key = $base;
		for ( $n = 2; isset( $this->keys[ $key ] ); $n++ ) {
			$key = $base . '_' . $n;
		}
		$this->keys[ $key ]                                 = true;
		$this->source_keys[ (string) ( $f['id'] ?? $key ) ] = $key;
		return $key;
	}

	/**
	 * Lower case letters, digits and underscores, at most 40 characters.
	 *
	 * @param string $text Text.
	 */
	public static function slug( string $text ): string {
		$text = strtolower(
			strtr(
				self::plain( $text ),
				array(
					'ä' => 'ae',
					'ö' => 'oe',
					'ü' => 'ue',
					'Ä' => 'ae',
					'Ö' => 'oe',
					'Ü' => 'ue',
					'ß' => 'ss',
				)
			)
		);
		$text = trim( (string) preg_replace( '/[^a-z0-9]+/', '_', $text ), '_' );
		return substr( $text, 0, 40 );
	}

	/**
	 * Text without markup.
	 *
	 * @param string $text Text.
	 */
	public static function plain( string $text ): string {
		return trim( html_entity_decode( strip_tags( $text ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- runs without WordPress in unit tests.
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
}
