<?php
/**
 * The part of a form document that is sent to the browser.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\StyleTokens;

defined( 'ABSPATH' ) || exit;

/**
 * Like 3.x, calculation values, hidden values, formulas, actions and credentials never reach the
 * browser, nor the right answers of a quiz unless it tells visitors after each question; calculations
 * shown in content steps and live results are computed through the REST API (live results get the
 * number format of their calculations). HTML written by the site owner passes wp_kses with the post
 * rules plus iframes (video embeds).
 */
final class PublicDocument {

	/**
	 * Builds the public document.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @param bool                $scripts  Keep the HTML of content steps and contact HTML blocks as
	 *                                      written, scripts included (the site allows them).
	 * @return array<string,mixed>
	 */
	public static function from( array $document, bool $scripts = false ): array {
		$quiz     = $document['settings']['quiz'] ?? null;
		$feedback = is_array( $quiz ) && 'knowledge' === ( $quiz['kind'] ?? '' ) && ! empty( $quiz['feedback'] );
		$nodes    = array();
		foreach ( $document['nodes'] as $node ) {
			unset( $node['legacy'], $node['tracking'] );
			if ( 'end' === $node['type'] ) {
				if ( is_array( $node['success'] ?? null ) ) {
					$node['success']['text'] = self::html( $node['success']['text'] );
				}
				$nodes[] = $node;
				continue;
			}
			if ( 'contact' === $node['type'] ) {
				$node['title']       = self::html( $node['title'] );
				$node['description'] = self::html( $node['description'] );
			}
			$fields = array();
			foreach ( $node['fields'] as $field ) {
				$fields[] = self::field( $field, $scripts, $feedback );
			}
			$node['fields'] = $fields;
			$nodes[]        = $node;
		}

		// Live results format their numbers in the browser and wait for the questions they use; the
		// formulas stay here.
		$shown        = self::live_calculations( $document );
		$calculations = array();
		foreach ( $document['calculations'] ?? array() as $calc ) {
			$calculations[] = isset( $shown[ $calc['id'] ] ) && isset( $calc['format'] ) ? array(
				'id'     => $calc['id'],
				'format' => $calc['format'],
				'uses'   => self::uses( (array) ( $document['calculations'] ?? array() ), (string) $calc['id'] ),
			) : array( 'id' => $calc['id'] );
		}

		// Names and labels of A/B tests are for the admin only.
		$experiments = array();
		foreach ( $document['experiments'] ?? array() as $experiment ) {
			$variants = array();
			foreach ( $experiment['variants'] as $variant ) {
				unset( $variant['label'] );
				if ( isset( $variant['style'] ) ) {
					// A test of designs: the browser gets the CSS variables (fonts and images need more than that).
					$style = (array) $variant['style'];
					unset( $style['font.family'], $style['font.heading'], $style['font.field'], $style['background.image'] );
					$css = StyleTokens::css( $style );
					unset( $variant['style'] );
					if ( '' !== $css ) {
						$variant['css'] = $css;
					}
				}
				$variants[] = $variant;
			}
			$experiments[] = array_intersect_key( $experiment, array_flip( array( 'id', 'status', 'winner' ) ) ) + array( 'variants' => $variants );
		}

		// Of the quiz the browser needs only to know that it shows right and wrong answers.
		$settings = array_diff_key( $document['settings'], array_flip( array( 'access', 'retentionDays', 'doubleOptIn', 'publicEntries', 'payment', 'quiz', 'abandonment' ) ) );
		if ( $feedback ) {
			$settings['quiz'] = array( 'feedback' => true );
		}
		// Of the reminders the browser needs the field, the basis, the box to tick and the notice;
		// the mail and its delay stay on the server. Funnelforms Free sends no reminders.
		$abandon = $document['settings']['abandonment'] ?? null;
		if ( is_array( $abandon ) && Edition::is_pro() ) {
			$settings['abandonment'] = array_intersect_key( $abandon, array_flip( array( 'field', 'basis', 'consentField' ) ) );
			if ( is_array( $abandon['notice'] ?? null ) ) {
				$settings['abandonment']['notice'] = self::html( $abandon['notice'] );
			}
		}

		return ( array() === $experiments ? array() : array( 'experiments' => $experiments ) ) + array(
			'schemaVersion' => $document['schemaVersion'],
			'id'            => $document['id'],
			'locales'       => $document['locales'],
			'start'         => $document['start'],
			'nodes'         => $nodes,
			'edges'         => $document['edges'],
			'calculations'  => $calculations,
			'style'         => array( 'tokens' => (object) ( $document['style']['tokens'] ?? array() ) ),
			// Password hash, limits, retention, what the website shows, the quiz and mails stay on the server.
			'settings'      => $settings,
		);
	}

	/**
	 * Public part of a field.
	 *
	 * @param array<string,mixed> $field    Field.
	 * @param bool                $scripts  Keep content HTML as written.
	 * @param bool                $feedback Keep the right answers (quiz with feedback).
	 * @return array<string,mixed>
	 */
	private static function field( array $field, bool $scripts, bool $feedback = false ): array {
		$question = $field['legacy']['questionId'] ?? null;
		unset( $field['legacy'], $field['tracking'] );
		if ( null !== $question ) {
			// The id in {{answers:base64json}} of redirects that leave from a question, as in 3.x.
			$field['legacy'] = array( 'questionId' => $question );
		}
		$field['label'] = self::html( $field['label'] );
		if ( isset( $field['description'] ) ) {
			$field['description'] = self::html( $field['description'] );
		}
		if ( isset( $field['options'] ) ) {
			foreach ( $field['options'] as $i => $option ) {
				unset( $option['calcValue'], $option['hiddenValue'], $option['scores'] );
				if ( ! $feedback ) {
					unset( $option['correct'] );
				}
				$option['label']        = self::html( $option['label'] );
				$field['options'][ $i ] = $option;
			}
		}
		if ( isset( $field['props']['html'] ) && is_array( $field['props']['html'] ) && ! ( $scripts && in_array( $field['type'], array( 'content', 'html' ), true ) ) ) {
			$field['props']['html'] = self::html( $field['props']['html'] );
		}
		if ( isset( $field['props']['media'] ) ) {
			$field['props']['media'] = self::media( (array) $field['props']['media'] );
			if ( null === $field['props']['media'] ) {
				unset( $field['props']['media'] );
			}
		}
		// The SMS settings (connection, sender, text) stay on the server; the runtime only learns
		// that the number is confirmed by text message.
		$verify = PhoneNumbers::confirms( $field );
		unset( $field['props']['connectionRef'], $field['props']['sms'] );
		if ( $verify ) {
			$field['props']['verify'] = 'sms';
		}
		if ( 'result' === $field['type'] ) {
			foreach ( (array) ( $field['props']['lines'] ?? array() ) as $i => $line ) {
				$field['props']['lines'][ $i ]['label'] = self::html( $line['label'] ?? array() );
			}
			if ( isset( $field['props']['disclaimer'] ) ) {
				$field['props']['disclaimer'] = self::html( $field['props']['disclaimer'] );
			}
			if ( isset( $field['props']['teaser'] ) ) {
				$field['props']['teaser'] = self::html( $field['props']['teaser'] );
			}
		}
		return $field;
	}

	/**
	 * Ids of the calculations that live results show (ResultField), as keys.
	 *
	 * @param array<string,mixed> $document Form document.
	 * @return array<string,bool>
	 */
	public static function live_calculations( array $document ): array {
		$ids = array();
		foreach ( $document['nodes'] ?? array() as $node ) {
			foreach ( 'step' === ( $node['type'] ?? '' ) ? (array) ( $node['fields'] ?? array() ) : array() as $field ) {
				foreach ( 'result' === ( $field['type'] ?? '' ) ? (array) ( $field['props']['lines'] ?? array() ) : array() as $line ) {
					foreach ( array( 'calculation', 'to' ) as $end ) {
						if ( isset( $line[ $end ] ) && is_string( $line[ $end ] ) ) {
							$ids[ $line[ $end ] ] = true;
						}
					}
				}
			}
		}
		return $ids;
	}

	/**
	 * Keys of the fields a calculation uses: as variables, with count() or points, also through the
	 * calculations it uses. Every part of the expression is looked at, so new kinds of nodes are too.
	 *
	 * @param array<int,array<string,mixed>> $calculations Calculations of the document.
	 * @param string                         $id           Calculation id.
	 * @return string[]
	 */
	public static function uses( array $calculations, string $id ): array {
		$by    = array_column( $calculations, null, 'id' );
		$keys  = array();
		$todo  = array( $id );
		$seen  = array();
		$visit = static function ( $node ) use ( &$visit, &$keys, &$todo ): void {
			if ( ! is_array( $node ) ) {
				return;
			}
			foreach ( array( 'var', 'count', 'score' ) as $kind ) {
				if ( isset( $node[ $kind ] ) && is_string( $node[ $kind ] ) ) {
					$keys[ $node[ $kind ] ] = true;
				}
			}
			if ( isset( $node['ref'] ) && is_string( $node['ref'] ) ) {
				$todo[] = $node['ref'];
			}
			foreach ( $node as $child ) {
				$visit( $child );
			}
		};
		while ( array() !== $todo ) {
			$next = (string) array_pop( $todo );
			if ( isset( $seen[ $next ] ) || ! isset( $by[ $next ] ) ) {
				continue;
			}
			$seen[ $next ] = true;
			$visit( $by[ $next ]['expression'] ?? null );
		}
		return array_map( 'strval', array_keys( $keys ) );
	}

	/**
	 * Image or video of a content step: only http(s) addresses, texts without HTML.
	 *
	 * @param array<string,mixed> $media Media.
	 * @return array<string,mixed>|null
	 */
	private static function media( array $media ): ?array {
		$url = esc_url_raw( (string) ( $media['url'] ?? '' ), array( 'http', 'https' ) );
		if ( '' === $url || ! in_array( $media['kind'] ?? '', array( 'image', 'video' ), true ) ) {
			return null;
		}
		$media['url'] = $url;
		foreach ( array( 'alt', 'caption' ) as $key ) {
			if ( isset( $media[ $key ] ) ) {
				$media[ $key ] = array_map( static fn( $value ): string => wp_strip_all_tags( (string) $value ), (array) $media[ $key ] );
			}
		}
		return $media;
	}

	/**
	 * Sanitizes the HTML of every locale.
	 *
	 * @param mixed $text Text per locale.
	 * @return array<string,string>|\stdClass
	 */
	private static function html( $text ) {
		$out = array();
		foreach ( (array) $text as $locale => $value ) {
			// wp_kses() removes the tags but keeps the code between them as text.
			$out[ $locale ] = wp_kses( (string) preg_replace( '#<(script|style)\b[^>]*>.*?</\1\s*>#is', '', (string) $value ), self::allowed_html() );
		}
		return array() === $out ? new \stdClass() : $out;
	}

	/**
	 * Allowed tags: those of posts plus iframes.
	 *
	 * @return array<string,array<string,bool>>
	 */
	private static function allowed_html(): array {
		static $allowed = null;
		if ( null === $allowed ) {
			$allowed           = wp_kses_allowed_html( 'post' );
			$allowed['iframe'] = array(
				'src'             => true,
				'width'           => true,
				'height'          => true,
				'title'           => true,
				'allow'           => true,
				'allowfullscreen' => true,
				'frameborder'     => true,
				'loading'         => true,
				'style'           => true,
			);
		}
		return $allowed;
	}
}
