<?php
/**
 * Gravity Forms.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

use Funnelforms\Compat\Import\ImportedForm;
use Funnelforms\Compat\Import\Reader;

defined( 'ABSPATH' ) || exit;

/**
 * Forms are in {prefix}gf_form and {prefix}gf_form_meta (display_meta, confirmations and
 * notifications as JSON, older sites PHP-serialized). The export is an object
 * {"0": form, …, "version": "x"}. Merge tags: {Label:3}, {Label:1.3}, {all_fields},
 * {admin_email}, {form_title}, {entry_id}, {date_mdy}, {embed_url}.
 */
final class GravityForms implements Reader {

	private const TYPES = array(
		'text'         => 'text',
		'textarea'     => 'textarea',
		'select'       => 'select',
		'multiselect'  => 'select',
		'number'       => 'number',
		'checkbox'     => 'checkbox',
		'radio'        => 'radio',
		'hidden'       => 'hidden',
		'html'         => 'html',
		'section'      => 'html',
		'page'         => 'page_break',
		'name'         => 'name',
		'date'         => 'date',
		'time'         => 'time',
		'phone'        => 'phone',
		'address'      => 'address',
		'website'      => 'url',
		'email'        => 'email',
		'fileupload'   => 'file',
		'captcha'      => 'captcha',
		'consent'      => 'consent',
		'post_title'   => 'text',
		'post_content' => 'textarea',
	);

	/**
	 * Key.
	 */
	public function key(): string {
		return 'gravityforms';
	}

	/**
	 * Name.
	 */
	public function label(): string {
		return 'Gravity Forms';
	}

	/**
	 * Whether a file is a Gravity Forms export.
	 *
	 * @param string $contents File contents.
	 */
	public function recognizes( string $contents ): bool {
		$data = Values::json( $contents );
		return is_array( $data ) && isset( $data['version'] ) && is_array( $data['0']['fields'] ?? null );
	}

	/**
	 * Forms of an export.
	 *
	 * @param string $contents File contents.
	 * @return ImportedForm[]
	 */
	public function parse_file( string $contents ): array {
		$data = Values::json( $contents );
		$out  = array();
		foreach ( is_array( $data ) ? $data : array() as $key => $form ) {
			if ( 'version' !== $key && is_array( $form ) && isset( $form['fields'] ) ) {
				$out[] = self::form( $form );
			}
		}
		return $out;
	}

	/**
	 * Forms on this site.
	 *
	 * @return array<int,array{id:string,title:string}>
	 */
	public function list_site(): array {
		global $wpdb;
		$table = $wpdb->prefix . 'gf_form';
		if ( ! Values::table_exists( $table ) ) {
			return array();
		}
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT id, title FROM %i WHERE is_trash = 0 ORDER BY id', $table ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return array_map(
			static fn( array $r ): array => array(
				'id'    => (string) $r['id'],
				'title' => (string) $r['title'],
			),
			is_array( $rows ) ? $rows : array()
		);
	}

	/**
	 * A form on this site.
	 *
	 * @param string $id Form id.
	 */
	public function read_site( string $id ): ?ImportedForm {
		global $wpdb;
		if ( ! Values::table_exists( $wpdb->prefix . 'gf_form_meta' ) ) {
			return null;
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT display_meta, confirmations, notifications FROM %i WHERE form_id = %d', $wpdb->prefix . 'gf_form_meta', (int) $id ), ARRAY_A ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( ! is_array( $row ) ) {
			return null;
		}
		$form = self::decode( $row['display_meta'] );
		if ( ! is_array( $form ) ) {
			return null;
		}
		$form['id']            = $id;
		$form['confirmations'] = self::decode( $row['confirmations'] );
		$form['notifications'] = self::decode( $row['notifications'] );
		return self::form( $form );
	}

	/**
	 * Stored meta: JSON, or PHP-serialized on old sites.
	 *
	 * @param mixed $value Value.
	 * @return mixed
	 */
	private static function decode( $value ) {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$json = json_decode( $value, true );
		return null !== $json ? $json : Values::unserialized( $value );
	}

	/**
	 * One form object.
	 *
	 * @param array<string,mixed> $form Form.
	 */
	public static function form( array $form ): ImportedForm {
		$notes  = array();
		$fields = array();
		foreach ( Values::items( $form['fields'] ?? array() ) as $field ) {
			if ( ! is_array( $field ) ) {
				continue;
			}
			$gf   = Values::str( $field['type'] ?? '' );
			$type = self::TYPES[ $gf ] ?? null;
			if ( null === $type ) {
				if ( ! in_array( $gf, array( 'submit', 'honeypot' ), true ) ) {
					$notes[] = 'field_type_not_imported:' . $gf . ':' . Values::str( $field['label'] ?? '' );
				}
				continue;
			}
			if ( 'administrative' === Values::str( $field['visibility'] ?? '' ) ) {
				$notes[] = 'admin_only_field_not_imported:' . Values::str( $field['label'] ?? '' );
				continue;
			}
			$options = array();
			foreach ( Values::items( $field['choices'] ?? array() ) as $choice ) {
				if ( is_array( $choice ) ) {
					$text      = Values::str( $choice['text'] ?? '' );
					$options[] = array(
						'label' => $text,
						'value' => Values::flag( $field['enableChoiceValue'] ?? false ) && '' !== Values::str( $choice['value'] ?? '' ) ? Values::str( $choice['value'] ) : $text,
					);
				}
			}
			$placeholder = Values::str( $field['placeholder'] ?? '' );
			if ( 'name' === $gf ) {
				$parts = array();
				foreach ( Values::items( $field['inputs'] ?? array() ) as $input ) {
					if ( is_array( $input ) && ! Values::flag( $input['isHidden'] ?? false ) && '' !== Values::str( $input['placeholder'] ?? '' ) ) {
						$parts[] = Values::str( $input['placeholder'] );
					}
				}
				$placeholder = implode( ' ', $parts );
			}
			$item = array(
				'id'          => Values::str( $field['id'] ?? '' ),
				'type'        => $type,
				'label'       => 'consent' === $gf ? self::consent_text( $field ) : Values::str( $field['label'] ?? '' ),
				'required'    => Values::flag( $field['isRequired'] ?? false ),
				'placeholder' => $placeholder,
				'description' => Values::str( $field['description'] ?? '' ),
				'default'     => Values::str( $field['defaultValue'] ?? '' ),
				'options'     => $options,
				'multiple'    => 'multiselect' === $gf,
				'conditional' => is_array( $field['conditionalLogic'] ?? null ) && array() !== $field['conditionalLogic'],
			);
			if ( 'html' === $gf ) {
				$item['html'] = Values::str( $field['content'] ?? '' );
			} elseif ( 'section' === $gf ) {
				$item['html'] = '<h3>' . Values::str( $field['label'] ?? '' ) . '</h3>' . ( '' !== Values::str( $field['description'] ?? '' ) ? '<p>' . Values::str( $field['description'] ) . '</p>' : '' );
			}
			foreach ( array(
				'rangeMin' => 'min',
				'rangeMax' => 'max',
			) as $from => $to ) {
				if ( isset( $field[ $from ] ) && is_numeric( $field[ $from ] ) ) {
					$item[ $to ] = $field[ $from ];
				}
			}
			$fields[] = $item;
		}

		$unknown       = array();
		$notifications = array();
		foreach ( Values::items( $form['notifications'] ?? array() ) as $mail ) {
			if ( ! is_array( $mail ) || ( isset( $mail['isActive'] ) && ! Values::flag( $mail['isActive'] ) ) || 'form_submission' !== Values::str( $mail['event'] ?? 'form_submission' ) ) {
				continue;
			}
			$to_type = Values::str( $mail['toType'] ?? 'email' );
			if ( 'routing' === $to_type ) {
				$notes[] = 'notification_routing_not_imported';
			}
			$to              = 'field' === $to_type ? '{{src:' . Values::str( $mail['toField'] ?? $mail['to'] ?? '' ) . '}}' : self::tags( Values::str( $mail['to'] ?? '' ), $unknown );
			$notifications[] = array(
				'to'        => $to,
				'cc'        => self::tags( Values::str( $mail['cc'] ?? '' ), $unknown ),
				'bcc'       => self::tags( Values::str( $mail['bcc'] ?? '' ), $unknown ),
				'subject'   => self::tags( Values::str( $mail['subject'] ?? '' ), $unknown ),
				'from_name' => self::tags( Values::str( $mail['fromName'] ?? '' ), $unknown ),
				'from'      => self::tags( Values::str( $mail['from'] ?? '' ), $unknown ),
				'reply_to'  => self::tags( Values::str( $mail['replyTo'] ?? '' ), $unknown ),
				'body'      => self::tags( Values::str( $mail['message'] ?? '' ), $unknown ),
			);
			if ( is_array( $mail['conditionalLogic'] ?? null ) && array() !== $mail['conditionalLogic'] ) {
				$notes[] = 'notification_conditions_not_imported';
			}
		}

		$confirmations = Values::items( $form['confirmations'] ?? array() );
		$chosen        = null;
		foreach ( $confirmations as $c ) {
			if ( is_array( $c ) && ( null === $chosen || Values::flag( $c['isDefault'] ?? false ) ) ) {
				$chosen = $c;
			}
		}
		if ( count( $confirmations ) > 1 ) {
			$notes[] = 'only_default_confirmation_imported';
		}
		$confirmation = null;
		if ( null !== $chosen ) {
			switch ( Values::str( $chosen['type'] ?? 'message' ) ) {
				case 'redirect':
					$query        = Values::str( $chosen['queryString'] ?? '' );
					$url          = Values::str( $chosen['url'] ?? '' );
					$confirmation = array(
						'type' => 'redirect',
						'url'  => self::tags( $url . ( '' !== $query ? ( str_contains( $url, '?' ) ? '&' : '?' ) . $query : '' ), $unknown ),
					);
					break;
				case 'page':
					$confirmation = Site::page_confirmation( $chosen['pageId'] ?? 0, $notes );
					break;
				default:
					$confirmation = array(
						'type'    => 'message',
						'message' => self::tags( Values::str( $chosen['message'] ?? '' ), $unknown ),
					);
			}
		}
		foreach ( array_unique( $unknown ) as $tag ) {
			$notes[] = 'template_tag_not_imported:' . $tag;
		}

		return new ImportedForm(
			'gravityforms',
			Values::str( $form['id'] ?? '' ),
			Values::str( $form['title'] ?? '' ),
			$fields,
			$notifications,
			$confirmation,
			Values::str( $form['button']['text'] ?? '' ),
			$notes
		);
	}

	/**
	 * The text of a consent box.
	 *
	 * @param array<string,mixed> $field Field.
	 */
	private static function consent_text( array $field ): string {
		$text = Values::str( $field['checkboxLabel'] ?? '' );
		return '' !== $text ? $text : Values::str( $field['label'] ?? '' );
	}

	/**
	 * Merge tags to builder tokens.
	 *
	 * @param string   $text    Text.
	 * @param string[] $unknown Unknown tags.
	 */
	private static function tags( string $text, array &$unknown ): string {
		return Values::tokens(
			$text,
			'/\{([^{}\s"][^{}"]*)\}/',
			static function ( array $m ): ?string {
				if ( preg_match( '/:(\d+(?:\.\d+)?)(?::[a-z_]+)?$/i', $m[1], $field ) ) {
					return '{{src:' . $field[1] . '}}';
				}
				switch ( strtolower( $m[1] ) ) {
					case 'all_fields':
						return '{{answers}}';
					case 'admin_email':
						return '{{admin_email}}';
					case 'form_title':
						return '{{form:title}}';
					case 'entry_id':
						return '{{entry:id}}';
					case 'date_mdy':
					case 'date_dmy':
						return '{{entry:date}}';
					case 'embed_url':
						return '{{page:url}}';
					case 'embed_post:post_title':
						return '{{page:title}}';
				}
				return null;
			},
			$unknown
		);
	}
}
