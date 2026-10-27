<?php
/**
 * Contact Form 7.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import\Readers;

use Funnelforms\Compat\Import\ImportedForm;
use Funnelforms\Compat\Import\Reader;

defined( 'ABSPATH' ) || exit;

/**
 * Forms are posts of type wpcf7_contact_form with the form as tag template in meta _form
 * ("<label> Your name [text* your-name] </label>"), the mails in _mail and _mail_2 and the texts in
 * _messages. Contact Form 7 has no export of its own: files are WordPress exports (WXR) of those
 * posts, or the JSON of its REST API (contact-form-7/v1/contact-forms/<id>). Labels are free text
 * before a tag; mail tags are the field names in brackets ([your-email]).
 */
final class ContactForm7 implements Reader {

	private const POST_TYPE = 'wpcf7_contact_form';

	private const TYPES = array(
		'text'       => 'text',
		'email'      => 'email',
		'url'        => 'url',
		'tel'        => 'phone',
		'textarea'   => 'textarea',
		'number'     => 'number',
		'range'      => 'slider',
		'date'       => 'date',
		'select'     => 'select',
		'checkbox'   => 'checkbox',
		'radio'      => 'radio',
		'acceptance' => 'consent',
		'file'       => 'file',
		'hidden'     => 'hidden',
		'quiz'       => 'captcha',
		'captchac'   => 'captcha',
		'recaptcha'  => 'captcha',
		'turnstile'  => 'captcha',
	);

	/**
	 * Tags that show something without a value.
	 */
	private const SKIPPED = array( 'submit', 'count', 'response', 'reflection', 'output', 'captchar', 'stripe' );

	/**
	 * A form tag (form-tags-manager.php): [type name options "values"]content[/type].
	 */
	private const TAG = '/(\[?)\[([a-zA-Z0-9_]+\*?)(?:[\r\n\t ](.*?))?(?:[\r\n\t ](\/))?\](?:([^[]*?)\[\/\2\])?(\]?)/s';

	/**
	 * Autocomplete values that say a text field holds a name.
	 */
	private const NAMES = array(
		'name'        => 'name',
		'given-name'  => 'first_name',
		'family-name' => 'last_name',
	);

	/**
	 * Key.
	 */
	public function key(): string {
		return 'contact-form-7';
	}

	/**
	 * Name.
	 */
	public function label(): string {
		return 'Contact Form 7';
	}

	/**
	 * Whether a file holds Contact Form 7 forms.
	 *
	 * @param string $contents File contents.
	 */
	public function recognizes( string $contents ): bool {
		if ( false !== strpos( $contents, '<wp:post_type>' ) ) {
			return (bool) preg_match( '/<wp:post_type>(?:<!\[CDATA\[)?' . self::POST_TYPE . '/', $contents );
		}
		$data = Values::json( $contents );
		$form = is_array( $data ) && array_is_list( $data ) ? ( $data[0] ?? null ) : $data;
		return is_array( $form ) && isset( $form['properties']['form'] );
	}

	/**
	 * Forms of a WordPress export or a REST response.
	 *
	 * @param string $contents File contents.
	 * @return ImportedForm[]
	 */
	public function parse_file( string $contents ): array {
		$out = array();
		$doc = Values::xml( $contents );
		if ( null !== $doc ) {
			foreach ( Values::wxr_posts( $doc, self::POST_TYPE ) as $post ) {
				$out[] = self::form( $post['id'], $post['title'], $post['meta']['_form'] ?? '', $post['meta']['_mail'] ?? array(), $post['meta']['_mail_2'] ?? array(), $post['meta']['_messages'] ?? array() );
			}
			return $out;
		}
		$data  = Values::json( $contents );
		$forms = is_array( $data ) && array_is_list( $data ) ? $data : array( $data );
		foreach ( $forms as $form ) {
			if ( ! is_array( $form ) || ! is_array( $form['properties'] ?? null ) ) {
				continue;
			}
			$props = $form['properties'];
			$body  = $props['form'] ?? '';
			$out[] = self::form( Values::str( $form['id'] ?? '' ), Values::str( $form['title'] ?? '' ), is_array( $body ) ? ( $body['content'] ?? '' ) : $body, $props['mail'] ?? array(), $props['mail_2'] ?? array(), $props['messages'] ?? array() );
		}
		return $out;
	}

	/**
	 * Forms on this site.
	 *
	 * @return array<int,array{id:string,title:string}>
	 */
	public function list_site(): array {
		$posts = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => 'any',
				'posts_per_page' => 500, // phpcs:ignore WordPress.WP.PostsPerPage.posts_per_page_posts_per_page -- one admin list of another plugin's forms.
				'orderby'        => 'ID',
				'order'          => 'ASC',
			)
		);
		return array_map(
			static fn( \WP_Post $p ): array => array(
				'id'    => (string) $p->ID,
				'title' => $p->post_title,
			),
			$posts
		);
	}

	/**
	 * A form on this site.
	 *
	 * @param string $id Post id.
	 */
	public function read_site( string $id ): ?ImportedForm {
		$post = get_post( (int) $id );
		if ( ! $post instanceof \WP_Post || self::POST_TYPE !== $post->post_type ) {
			return null;
		}
		$meta = static fn( string $key ) => get_post_meta( $post->ID, $key, true );
		return self::form( (string) $post->ID, $post->post_title, $meta( '_form' ), $meta( '_mail' ), $meta( '_mail_2' ), $meta( '_messages' ) );
	}

	/**
	 * One form.
	 *
	 * @param string $id       Id.
	 * @param string $title    Title.
	 * @param mixed  $template Form tag template.
	 * @param mixed  $mail     Mail.
	 * @param mixed  $mail_2   Second mail.
	 * @param mixed  $messages Messages.
	 */
	public static function form( string $id, string $title, $template, $mail, $mail_2, $messages ): ImportedForm {
		$notes    = array();
		$fields   = array();
		$submit   = '';
		$template = Values::str( $template );
		$names    = array();
		$last     = 0;
		preg_match_all( self::TAG, $template, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE );
		foreach ( $matches as $m ) {
			if ( '[' === $m[1][0] && ']' === ( $m[6][0] ?? '' ) ) {
				continue;
			}
			$before                   = substr( $template, $last, $m[0][1] - $last );
			$last                     = $m[0][1] + strlen( $m[0][0] );
			$type                     = $m[2][0];
			$base                     = rtrim( $type, '*' );
			list( $options, $values ) = self::attributes( (string) ( $m[3][0] ?? '' ) );
			if ( 'submit' === $base ) {
				$submit = $values[0] ?? '';
				continue;
			}
			if ( in_array( $base, self::SKIPPED, true ) ) {
				continue;
			}
			$kind = self::TYPES[ $base ] ?? null;
			if ( null === $kind ) {
				$notes[] = 'field_type_not_imported:' . $base;
				continue;
			}
			$name = (string) array_shift( $options );
			if ( in_array( $base, array( 'recaptcha', 'turnstile' ), true ) ) {
				$name = $base;
			}
			$name           = str_replace( '.', '_', $name );
			$names[ $name ] = true;
			$fields[]       = self::field( $base, $kind, str_ends_with( $type, '*' ), $name, $options, $values, (string) ( $m[5][0] ?? '' ), self::label_before( $before ) );
		}

		$unknown       = array();
		$notifications = array();
		foreach ( array( $mail, $mail_2 ) as $index => $item ) {
			$item = Values::unserialized( $item );
			if ( ! is_array( $item ) || ( 1 === $index && ! Values::flag( $item['active'] ?? false ) ) ) {
				continue;
			}
			$headers = array();
			foreach ( preg_split( '/\r\n|\r|\n/', Values::str( $item['additional_headers'] ?? '' ) ) as $line ) {
				if ( preg_match( '/^\s*([A-Za-z-]+)\s*:\s*(.+)$/', (string) $line, $h ) ) {
					$headers[ strtolower( $h[1] ) ] = trim( $h[2] );
				}
			}
			$sender = Values::str( $item['sender'] ?? '' );
			$from   = $sender;
			$name   = '';
			if ( preg_match( '/^(.*)<([^>]+)>\s*$/', $sender, $s ) ) {
				$name = trim( $s[1] );
				$from = trim( $s[2] );
			}
			$body = self::tags( Values::str( $item['body'] ?? '' ), $names, $unknown );
			if ( ! Values::flag( $item['use_html'] ?? false ) ) {
				$body = str_replace( array( '<', '>' ), array( '&lt;', '&gt;' ), $body );
			}
			$notifications[] = array(
				'to'        => self::tags( Values::str( $item['recipient'] ?? '' ), $names, $unknown ),
				'cc'        => self::tags( $headers['cc'] ?? '', $names, $unknown ),
				'bcc'       => self::tags( $headers['bcc'] ?? '', $names, $unknown ),
				'subject'   => self::tags( Values::str( $item['subject'] ?? '' ), $names, $unknown ),
				'from_name' => self::tags( $name, $names, $unknown ),
				'from'      => self::tags( $from, $names, $unknown ),
				'reply_to'  => self::tags( $headers['reply-to'] ?? '', $names, $unknown ),
				'body'      => $body,
			);
		}
		$messages = Values::unserialized( $messages );
		$sent     = is_array( $messages ) ? Values::str( $messages['mail_sent_ok'] ?? '' ) : '';
		foreach ( array_unique( $unknown ) as $tag ) {
			$notes[] = 'template_tag_not_imported:' . $tag;
		}

		return new ImportedForm(
			'contact-form-7',
			$id,
			$title,
			$fields,
			$notifications,
			'' !== $sent ? array(
				'type'    => 'message',
				'message' => $sent,
			) : null,
			$submit,
			$notes
		);
	}

	/**
	 * Options and quoted values of a tag (form-tags-manager.php parse_atts).
	 *
	 * @param string $text Text after the type.
	 * @return array{0:string[],1:string[]}
	 */
	private static function attributes( string $text ): array {
		if ( ! preg_match( '%^([-+*=0-9a-zA-Z:.!?#$&@_/|\%\r\n\t ]*?)((?:[\r\n\t ]*"[^"]*"|[\r\n\t ]*\'[^\']*\')*)$%', $text, $m ) ) {
			return array( array(), array() );
		}
		$options = '' === trim( $m[1] ) ? array() : (array) preg_split( '/[\r\n\t ]+/', trim( $m[1] ) );
		preg_match_all( '/"[^"]*"|\'[^\']*\'/', $m[2], $quoted );
		$values = array_map( static fn( string $v ): string => substr( $v, 1, -1 ), $quoted[0] );
		return array( array_map( 'strval', $options ), $values );
	}

	/**
	 * The label of a tag: the last line of text before it, without markup.
	 *
	 * @param string $before Template between the previous tag and this one.
	 */
	private static function label_before( string $before ): string {
		$text  = (string) preg_replace( '/<br\s*\/?>|<\/(?:p|div|label|h[1-6]|li|span)>/i', "\n", $before );
		$text  = html_entity_decode( (string) preg_replace( '/<[^>]*>/', '', $text ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$lines = array_values( array_filter( array_map( 'trim', (array) preg_split( '/\r\n|\r|\n/', $text ) ), static fn( string $l ): bool => '' !== $l ) );
		return (string) end( $lines );
	}

	/**
	 * One field in the common shape.
	 *
	 * @param string   $base     Tag type without *.
	 * @param string   $kind     Imported type.
	 * @param bool     $required Whether the type ends with *.
	 * @param string   $name     Tag name.
	 * @param string[] $options  Options.
	 * @param string[] $values   Quoted values.
	 * @param string   $content  Content between the tag and its end tag.
	 * @param string   $label    Text before the tag.
	 * @return array<string,mixed>
	 */
	private static function field( string $base, string $kind, bool $required, string $name, array $options, array $values, string $content, string $label ): array {
		$option = static function ( string $key ) use ( $options ): ?string {
			foreach ( $options as $o ) {
				if ( $o === $key ) {
					return '';
				}
				if ( str_starts_with( $o, $key . ':' ) ) {
					return substr( $o, strlen( $key ) + 1 );
				}
			}
			return null;
		};
		$item   = array(
			'id'          => $name,
			'type'        => $kind,
			'label'       => '' !== $label ? $label : $name,
			'required'    => $required,
			'placeholder' => '',
			'default'     => '',
			'options'     => array(),
			'multiple'    => null !== $option( 'multiple' ),
		);
		if ( 'text' === $kind && ( isset( self::NAMES[ (string) $option( 'autocomplete' ) ] ) || 'your-name' === $name ) ) {
			$item['type'] = self::NAMES[ (string) $option( 'autocomplete' ) ] ?? 'name';
		}
		if ( in_array( $kind, array( 'select', 'checkbox', 'radio' ), true ) ) {
			if ( 'checkbox' === $kind && null !== $option( 'exclusive' ) ) {
				$item['type'] = 'radio';
			}
			if ( null !== $option( 'first_as_label' ) && array() !== $values ) {
				$item['placeholder'] = (string) array_shift( $values );
			}
			$chosen = array_map( 'intval', explode( '_', (string) $option( 'default' ) ) );
			$picked = array();
			foreach ( $values as $i => $value ) {
				$parts             = explode( '|', $value, 2 );
				$item['options'][] = array(
					'label' => $parts[0],
					'value' => $parts[1] ?? $parts[0],
				);
				if ( in_array( $i + 1, $chosen, true ) ) {
					$picked[] = $parts[1] ?? $parts[0];
				}
			}
			$item['default'] = implode( ',', $picked );
		} elseif ( 'consent' === $kind ) {
			$text             = trim( '' !== trim( $content ) ? $content : ( $values[0] ?? '' ) );
			$item['label']    = '' !== $text ? $text : $item['label'];
			$item['html']     = $text;
			$item['required'] = null === $option( 'optional' );
		} elseif ( null !== $option( 'placeholder' ) || null !== $option( 'watermark' ) ) {
			$item['placeholder'] = $values[0] ?? '';
		} else {
			$item['default'] = $values[0] ?? '';
		}
		if ( in_array( $kind, array( 'number', 'slider' ), true ) ) {
			foreach ( array( 'min', 'max', 'step' ) as $limit ) {
				if ( is_numeric( $option( $limit ) ) ) {
					$item[ $limit ] = $option( $limit );
				}
			}
		}
		return $item;
	}

	/**
	 * Mail tags to builder tokens. Text in brackets that names no field stays, as it does in
	 * Contact Form 7.
	 *
	 * @param string             $text    Text.
	 * @param array<string,true> $names   Field names.
	 * @param string[]           $unknown Unknown special tags.
	 */
	private static function tags( string $text, array $names, array &$unknown ): string {
		return Values::tokens(
			$text,
			'/\[(_raw_|_format_)?([a-zA-Z0-9_-]+)(?:\s+"[^"]*")?\]/',
			static function ( array $m ) use ( $names ): ?string {
				if ( '' === $m[1] ) {
					switch ( $m[2] ) {
						case '_site_title':
							return '{{site_title}}';
						case '_site_admin_email':
							return '{{admin_email}}';
						case '_site_url':
							return '{{site_url}}';
						case '_url':
							return '{{page:url}}';
						case '_post_title':
							return '{{page:title}}';
						case '_date':
							return '{{entry:date}}';
						case '_serial_number':
							return '{{entry:id}}';
					}
				}
				if ( isset( $names[ $m[2] ] ) ) {
					return '{{src:' . $m[2] . '}}';
				}
				return '' === $m[1] && ! str_starts_with( $m[2], '_' ) ? $m[0] : null;
			},
			$unknown
		);
	}
}
