<?php
/**
 * Converts 3.x placeholder tags into template tokens of schema v1.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

defined( 'ABSPATH' ) || exit;

/**
 * 3.x replaced tags with str_ireplace in a fixed order; the conversion follows the same order so a
 * contact field called "url" keeps behaving like the page URL tag, as it did in 3.x.
 *
 * Mail and autoresponder:   answers tag (every language), [queryString], [url], [ID], [post_title],
 *                           calculations, appointment tags, then [<contact field id>].
 * Subject and reply-to:     [<contact field id>] and appointment tags.
 * HTML content step:        the answers tag of the form's language, [CALCULATION-n] and bare [n]
 *                           (both calculation n).
 * Redirect after a question: the answers tag of the form's language becomes base64 JSON.
 */
final class TemplateConverter {

	public const ANSWER_TAGS = array( '[ANTWORTEN]', '[ANSWERS]' );

	public const BOOKING_TAGS = array(
		'date'     => array( '[TERMINDATUM]', '[APPOINTMENTDATE]' ),
		'duration' => array( '[TERMINDAUER]', '[APPOINTMENTDURATION]' ),
		'name'     => array( '[TERMINNAME]', '[APPOINTMENTNAME]' ),
		'time'     => array( '[TERMINZEIT]', '[APPOINTMENTTIME]' ),
	);

	/**
	 * Calculation post IDs found while converting.
	 *
	 * @var int[]
	 */
	private array $calculations = array();

	/**
	 * Calculation post IDs referenced by the last conversions.
	 *
	 * @return int[]
	 */
	public function calculations(): array {
		return array_values( array_unique( $this->calculations ) );
	}

	/**
	 * Admin mail body.
	 *
	 * @param string               $text       3.x mail text.
	 * @param array<string,string> $field_keys 3.x contact field id => token key.
	 * @param bool                 $with_hidden Whether the answers list includes hidden values (admin mail).
	 */
	public function mail( string $text, array $field_keys, bool $with_hidden ): string {
		$text = str_ireplace( self::ANSWER_TAGS, $with_hidden ? '{{answers_with_hidden}}' : '{{answers}}', $text );
		$text = str_ireplace( '[queryString]', '{{page:query}}', $text );
		$text = str_ireplace( '[url]', '{{page:url}}', $text );
		$text = str_ireplace( '[ID]', '{{entry:id}}', $text );
		$text = str_ireplace( '[post_title]', '{{page:title}}', $text );
		$text = $this->mail_calculations( $text );
		$text = $this->booking( $text );
		return $this->fields( $text, $field_keys );
	}

	/**
	 * Subject, reply-to, sender name: only contact fields and appointment tags.
	 *
	 * @param string               $text       3.x text.
	 * @param array<string,string> $field_keys 3.x contact field id => token key.
	 */
	public function header( string $text, array $field_keys ): string {
		return $this->fields( $this->booking( $text ), $field_keys );
	}

	/**
	 * HTML of a content step.
	 *
	 * @param string $html        3.x HTML.
	 * @param string $answers_tag Answers tag in the form's language.
	 */
	public function content( string $html, string $answers_tag ): string {
		$pos = stripos( $html, $answers_tag );
		if ( false !== $pos ) {
			$html = substr_replace( $html, '{{answers}}', $pos, strlen( $answers_tag ) );
		}
		return (string) preg_replace_callback(
			'/\[(?:CALCULATION-)?(\d+)\]/i',
			function ( array $m ): string {
				$this->calculations[] = (int) $m[1];
				return '{{calc:calc' . $m[1] . '}}';
			},
			$html
		);
	}

	/**
	 * Redirect URL reached from a question.
	 *
	 * @param string $url         3.x URL.
	 * @param string $answers_tag Answers tag in the form's language.
	 */
	public function question_redirect( string $url, string $answers_tag ): string {
		$pos = strpos( $url, $answers_tag );
		if ( false === $pos ) {
			return $url;
		}
		return substr_replace( $url, '{{answers:base64json}}', $pos, strlen( $answers_tag ) );
	}

	/**
	 * Value of a redirect parameter after a contact form.
	 *
	 * @param string               $value      3.x value.
	 * @param array<string,string> $field_keys 3.x contact field id => token key.
	 */
	public function redirect_param( string $value, array $field_keys ): string {
		if ( '[antworten]' === $value ) {
			return '{{legacy:answers_serialized_base64url}}';
		}
		return $this->fields( $value, $field_keys );
	}

	/**
	 * Calculation tags in mails.
	 *
	 * @param string $text Text.
	 */
	private function mail_calculations( string $text ): string {
		return (string) preg_replace_callback(
			'/\[CALCULATION(?: ID="(\d+)"|-(\d+))\]/i',
			function ( array $m ): string {
				$id                   = '' !== $m[1] ? $m[1] : $m[2];
				$this->calculations[] = (int) $id;
				return '{{calc:calc' . $id . '}}';
			},
			$text
		);
	}

	/**
	 * Appointment tags (German and English spelling).
	 *
	 * @param string $text Text.
	 */
	private function booking( string $text ): string {
		foreach ( self::BOOKING_TAGS as $token => $tags ) {
			$text = str_ireplace( $tags, '{{booking:' . $token . '}}', $text );
		}
		return $text;
	}

	/**
	 * Contact field tags, case-insensitive like 3.x.
	 *
	 * @param string               $text       Text.
	 * @param array<string,string> $field_keys 3.x contact field id => token key.
	 */
	private function fields( string $text, array $field_keys ): string {
		foreach ( $field_keys as $legacy_id => $key ) {
			if ( '' === (string) $legacy_id ) {
				continue;
			}
			$text = str_ireplace( '[' . $legacy_id . ']', '{{field:' . $key . '}}', $text );
		}
		return $text;
	}
}
