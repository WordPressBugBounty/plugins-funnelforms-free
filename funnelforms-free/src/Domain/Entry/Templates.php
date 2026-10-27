<?php
/**
 * Fills the template tokens of mails and redirects on the server.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Entry;

use Funnelforms\Compat\Migration\EntryConverter;
use Funnelforms\Domain\Form\Calculator;
use Funnelforms\Domain\Form\Document;
use Funnelforms\Domain\Form\Quiz;
use Funnelforms\Edition\Edition;
use Funnelforms\Frontend\UiLocale;

defined( 'ABSPATH' ) || exit;

/**
 * Tokens are listed in packages/form-schema/src/types.ts (TEMPLATE_TOKENS) plus {{field:<key>}},
 * {{calc:<id>}} and {{url:<name>}}. Visitor input is escaped for the target: HTML in mail bodies, plain text without
 * line breaks in headers, URL encoding in redirects. 3.x inserted visitor input into mails unescaped.
 */
final class Templates {

	public const HTML = 'html';
	public const TEXT = 'text';
	public const URL  = 'url';
	/** HTML of a designed mail (MailLayout): like HTML, the answers as a table. */
	public const CARD = 'card';

	private const LINE = '_________________________';

	/**
	 * Replaces the tokens of a template.
	 *
	 * @param string     $template Template text.
	 * @param Submission $s        Submission.
	 * @param string     $mode     self::HTML, self::CARD, self::TEXT or self::URL.
	 */
	public static function render( string $template, Submission $s, string $mode ): string {
		return (string) preg_replace_callback(
			'/\{\{\s*([a-z_]+(?::[a-z0-9_]+)?|field:[^}]+|calc:[^}]+)\s*\}\}/i',
			static function ( array $m ) use ( $s, $mode ): string {
				$value = self::token( $m[1], $s, $mode );
				return null === $value ? $m[0] : $value;
			},
			$template
		);
	}

	/**
	 * Text of the range the result of a calculation lies in ({{calc:<id>:text}}), in the language
	 * of the entry, as plain text; empty without one.
	 *
	 * @param Submission $s  Submission.
	 * @param string     $id Calculation id.
	 */
	private static function range_text( Submission $s, string $id ): string {
		$calculator = Edition::pro( Calculator::class );
		$calc       = $s->document->calculation( $id );
		$result     = $s->calculations[ $id ] ?? null;
		if ( null === $calculator || null === $calc || null === $result || ! $result['ok'] ) {
			return '';
		}
		$text = $calculator::range_text( $calc, (float) $result['value'] );
		return null === $text ? '' : trim( wp_strip_all_tags( $s->document->text( $text, $s->locale ) ) );
	}

	/**
	 * Value of one token, or null to leave unknown tokens as they are.
	 *
	 * @param string     $token Token without braces.
	 * @param Submission $s     Submission.
	 * @param string     $mode  Output mode.
	 */
	private static function token( string $token, Submission $s, string $mode ): ?string {
		if ( str_starts_with( $token, 'field:' ) ) {
			$value = $s->value_by_key( substr( $token, 6 ) );
			return self::escape( $value ?? '', $mode );
		}
		if ( str_starts_with( $token, 'url:' ) ) {
			// Any parameter of the page address, e.g. {{url:gclid}} or {{url:partner}}.
			parse_str( ltrim( (string) ( $s->page['query'] ?? '' ), '?' ), $params );
			$param = $params[ substr( $token, 4 ) ] ?? '';
			return self::escape( is_string( $param ) ? $param : '', $mode );
		}
		if ( str_starts_with( $token, 'calc:' ) && str_ends_with( $token, ':text' ) ) {
			return self::escape( self::range_text( $s, substr( $token, 5, -5 ) ), $mode );
		}
		if ( str_starts_with( $token, 'calc:' ) ) {
			$result = $s->calculations[ substr( $token, 5 ) ] ?? null;
			if ( null === $result ) {
				return self::escape( '', $mode );
			}
			return self::escape( $result['ok'] ? $result['formatted'] : __( 'An error occurred in the calculation!', 'funnelforms-free' ), $mode );
		}
		switch ( $token ) {
			case 'answers':
			case 'answers_with_hidden':
				if ( self::CARD === $mode ) {
					return self::answers_card( $s, 'answers_with_hidden' === $token );
				}
				return self::HTML === $mode ? self::answers_html( $s, 'answers_with_hidden' === $token ) : self::escape( self::answers_text( $s ), $mode );
			case 'contact':
				return self::list( self::contact_rows( $s ), $mode );
			case 'calculations':
				return self::in_form_language( $s, static fn(): string => self::list( self::calculation_rows( $s ), $mode ) );
			case 'lead':
				// "Page", "Lead score": in the language of the form, like the rest of its mails.
				return self::in_form_language( $s, static fn(): string => self::lead( $s, $mode ) );
			case 'answers:base64json':
				return self::escape( base64_encode( (string) wp_json_encode( self::summary( $s ) ) ), $mode ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- format of the 3.x redirect tag.
			case 'legacy:answers_serialized_base64url':
				// 3.x appended base64url(serialize(zapier_json)) to redirects; receivers unserialize it.
				return self::escape( rtrim( strtr( base64_encode( serialize( LegacyLead::zapier_json( $s ) ) ), '+/', '-_' ), '=' ), $mode ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode,WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize -- format of the 3.x redirect parameter.
			case 'entry:id':
				return self::escape( (string) $s->entry_id, $mode );
			case 'page:url':
				return self::escape( (string) ( $s->page['url'] ?? '' ), $mode );
			case 'page:query':
				return self::escape( (string) ( $s->page['query'] ?? '' ), $mode );
			case 'page:title':
				return self::escape( (string) ( $s->page['title'] ?? '' ), $mode );
			case 'payment:status':
				return self::escape( null === $s->payment ? '' : Money::status_label( (string) $s->payment['status'] ), $mode );
			case 'payment:amount':
				return self::escape( null === $s->payment ? '' : Money::format( (float) $s->payment['amount'], (string) $s->payment['currency'] ), $mode );
			case 'payment:reference':
				return self::escape( (string) ( $s->payment['reference'] ?? '' ), $mode );
			case 'quiz:max':
				$quiz       = Edition::pro( Quiz::class );
				$calculator = Edition::pro( Calculator::class );
				$max        = null === $quiz ? null : $quiz::max( $s->document );
				$calc       = $s->document->calculation( (string) ( $s->document->raw()['settings']['quiz']['calculation'] ?? '' ) );
				return self::escape( null === $max || null === $calculator ? '' : $calculator::format( $max, $calc['format'] ?? array() ), $mode );
			case 'booking:time':
				$booking = $s->booking();
				return self::escape( null === $booking ? __( 'No appointment has been booked!', 'funnelforms-free' ) : (string) $booking['time'], $mode );
			case 'booking:date':
				return self::escape( (string) ( $s->booking()['date'] ?? '' ), $mode );
			case 'booking:name':
				return self::escape( (string) ( $s->booking()['title'] ?? '' ), $mode );
			case 'booking:duration':
				return self::escape( (string) ( $s->booking()['durationText'] ?? '' ), $mode );
			case 'code':
				return '';
			case 'entry:date':
				return self::escape( self::local_time( $s, (string) get_option( 'date_format', 'Y-m-d' ) ), $mode );
			case 'entry:time':
				return self::escape( self::local_time( $s, (string) get_option( 'time_format', 'H:i' ) ), $mode );
			case 'form:title':
				return self::escape( (string) ( $s->document->raw()['title'] ?? '' ), $mode );
			case 'visit:device':
				return self::escape( VisitAnalytics::device_label( (string) ( $s->visit['device'] ?? '' ) ), $mode );
			case 'visit:browser':
				return self::escape( trim( (string) ( $s->visit['browser'] ?? '' ) . ( '' !== (string) ( $s->visit['os'] ?? '' ) ? ' / ' . $s->visit['os'] : '' ), ' /' ), $mode );
			case 'visit:duration':
				return self::escape( isset( $s->visit['seconds'] ) ? VisitAnalytics::duration( (int) $s->visit['seconds'] ) : '', $mode );
			case 'visit:referrer':
				return self::escape( (string) ( $s->visit['referrer'] ?? '' ), $mode );
			case 'utm':
				$utm = EntryConverter::utm( (string) ( $s->page['query'] ?? '' ) );
				return self::escape( implode( ', ', array_map( static fn( $key, $value ) => $key . ': ' . $value, array_keys( $utm ), $utm ) ), $mode );
		}
		if ( preg_match( '/^utm:(source|medium|campaign|term|content)$/', $token, $m ) ) {
			$utm = EntryConverter::utm( (string) ( $s->page['query'] ?? '' ) );
			return self::escape( (string) ( $utm[ 'utm_' . $m[1] ] ?? '' ), $mode );
		}
		return null;
	}

	/**
	 * Time the entry was sent, in the site's time zone and the given format; now before it is stored.
	 *
	 * @param Submission $s      Submission.
	 * @param string     $format Date format.
	 */
	private static function local_time( Submission $s, string $format ): string {
		$time = '' === $s->created_at ? time() : strtotime( $s->created_at . ' UTC' );
		return wp_date( $format, false === $time ? time() : $time );
	}

	/**
	 * Answer list of the mail, as 3.x built it (af2_create_answers_with_hidden_fields), escaped.
	 *
	 * @param Submission $s           Submission.
	 * @param bool       $with_hidden Append the hidden values (admin mail).
	 */
	private static function answers_html( Submission $s, bool $with_hidden ): string {
		$text   = '';
		$hidden = '';
		foreach ( $s->answered_step_fields() as $field ) {
			$label = esc_html( $s->label( $field ) );
			$text .= '<b>' . $label . "</b>\n" . ( Document::holds_files( $field ) ? self::file_links_html( $s, $field ) : esc_html( $s->display_with_unit( $field ) ) ) . "\n" . self::LINE . "\n\n";
			$extra = $s->hidden_values( $field );
			if ( array() !== $extra ) {
				$hidden .= '<b>' . $label . "</b>\n" . esc_html( implode( "\n", $extra ) ) . "\n" . self::LINE . "\n\n";
			}
		}
		if ( $with_hidden && '' !== $hidden ) {
			$text .= "\n\n\n<b>" . esc_html__( 'Hidden fields', 'funnelforms-free' ) . ":</b>\n\n" . $hidden;
		}
		return $text;
	}

	/**
	 * Answer list of a designed mail: a table without line breaks between its tags; hidden values
	 * of answers in rows of their own below.
	 *
	 * @param Submission $s           Submission.
	 * @param bool       $with_hidden With the hidden values of the answers.
	 */
	private static function answers_card( Submission $s, bool $with_hidden ): string {
		$rows   = array();
		$hidden = array();
		foreach ( $s->answered_step_fields() as $field ) {
			$label  = esc_html( $s->label( $field ) );
			$value  = Document::holds_files( $field ) ? self::file_links_html( $s, $field ) : esc_html( $s->display_with_unit( $field ) );
			$rows[] = array(
				'label' => $label,
				'value' => str_replace( array( "\r\n", "\n" ), '<br>', $value ),
			);
			$extra  = $s->hidden_values( $field );
			if ( $with_hidden && array() !== $extra ) {
				$hidden[] = array(
					/* translators: %s: question. */
					'label' => sprintf( esc_html__( '%s (hidden value)', 'funnelforms-free' ), $label ),
					'value' => esc_html( implode( ', ', $extra ) ),
				);
			}
		}
		return \Funnelforms\Application\Actions\MailLayout::answers( array_merge( $rows, $hidden ) );
	}

	/**
	 * Answer list as plain text.
	 *
	 * @param Submission $s Submission.
	 */
	private static function answers_text( Submission $s ): string {
		$lines = array();
		foreach ( $s->answered_step_fields() as $field ) {
			$lines[] = $s->label( $field ) . ': ' . ( Document::holds_files( $field ) ? implode( ', ', $s->file_links( $field ) ) : $s->display_with_unit( $field, ', ' ) );
		}
		return implode( "\n", $lines );
	}

	/**
	 * The contact details of the entry: label, value and a link for e-mail addresses and phone
	 * numbers; consents and empty fields are left out.
	 *
	 * @param Submission $s Submission.
	 * @return array<int,array{label:string,value:string,href?:string}>
	 */
	private static function contact_rows( Submission $s ): array {
		$rows = array();
		foreach ( $s->contact_fields() as $field ) {
			$value = 'consent' === $field['type'] ? '' : $s->contact_display( $field );
			if ( '' === trim( $value ) ) {
				continue;
			}
			$raw = (string) ( is_scalar( $s->contact_values[ $field['id'] ] ?? null ) ? $s->contact_values[ $field['id'] ] : '' );
			$row = array(
				'label' => $s->label( $field ),
				'value' => $value,
			);
			if ( 'email' === $field['type'] && is_email( $raw ) ) {
				$row['href'] = 'mailto:' . $raw;
			} elseif ( in_array( $field['type'], array( 'phone', 'phone_verification' ), true ) && 1 === preg_match( '/^\+?[\d\s()\/.-]{4,}$/', $raw ) ) {
				$row['href'] = 'tel:' . preg_replace( '/[^\d+]/', '', $raw );
			}
			$rows[] = $row;
		}
		return $rows;
	}

	/**
	 * The results of the calculations the form shows or uses, in their order: those in texts, mails,
	 * live results, paths, the payment, the lead score and the quiz, and those used nowhere at all.
	 * Helpers that only other calculations use are left out. The two ends of a range in a live
	 * result are one line with the line's label ("1.200 – 1.500 €").
	 *
	 * @param Submission $s             Submission.
	 * @param bool       $without_score Leave out the lead score ({{lead}} shows it on its own).
	 * @return array<int,array{label:string,value:string}>
	 */
	private static function calculation_rows( Submission $s, bool $without_score = false ): array {
		$calculator = Edition::pro( Calculator::class );
		$raw        = $s->document->raw();
		if ( null === $calculator || array() === $s->calculations ) {
			return array();
		}
		$calcs = $s->document->calculations();
		$rest  = $raw;
		unset( $rest['calculations'] );
		$json = (string) wp_json_encode( $rest );
		// Lines of live results: the pairs of a range, and text around the numbers.
		$lines = array();
		$ends  = array();
		foreach ( $raw['nodes'] ?? array() as $node ) {
			foreach ( 'step' === ( $node['type'] ?? '' ) ? (array) ( $node['fields'] ?? array() ) : array() as $field ) {
				foreach ( 'result' === ( $field['type'] ?? '' ) ? (array) ( $field['props']['lines'] ?? array() ) : array() as $line ) {
					$id = (string) ( $line['calculation'] ?? '' );
					// The first line of a calculation, or the first that makes it a range.
					if ( ! isset( $lines[ $id ] ) || ( ! isset( $lines[ $id ]['to'] ) && isset( $line['to'] ) ) ) {
						$lines[ $id ] = $line;
					}
				}
			}
		}
		foreach ( $lines as $id => $line ) {
			if ( isset( $line['to'], $calcs[ (string) $line['to'] ] ) && (string) $line['to'] !== (string) $id ) {
				$ends[ (string) $line['to'] ] = true;
			}
		}
		// Used outside the calculations: {{calc:…}} in texts and mails, paths, payment, lead score, quiz.
		$used = static fn( string $id ): bool => isset( $lines[ $id ] ) || isset( $ends[ $id ] ) || str_contains( $json, '{{calc:' . $id . '}}' ) || str_contains( $json, '"calc":"' . $id . '"' ) || str_contains( $json, 'alculation":"' . $id . '"' );
		$refs = array();
		foreach ( $calcs as $calc ) {
			foreach ( $calculator::refs( (array) ( $calc['expression'] ?? array() ) ) as $ref ) {
				$refs[ $ref ] = true;
			}
		}
		$score = (string) ( $raw['settings']['scoreCalculation'] ?? '' );
		$worth = (string) ( $raw['settings']['valueCalculation'] ?? '' );
		$error = __( 'An error occurred in the calculation!', 'funnelforms-free' );
		$rows  = array();
		foreach ( $calcs as $id => $calc ) {
			$id     = (string) $id;
			$result = $s->calculations[ $id ] ?? null;
			if ( null === $result || isset( $ends[ $id ] ) || ( isset( $refs[ $id ] ) && ! $used( $id ) ) || ( $without_score && $id === $score ) ) {
				continue;
			}
			$line  = $lines[ $id ] ?? array();
			$to    = (string) ( $line['to'] ?? '' );
			$upper = '' === $to ? null : ( $s->calculations[ $to ] ?? null );
			if ( null !== $upper && $result['ok'] && $upper['ok'] ) {
				$a      = (array) ( $calc['format'] ?? array() );
				$b      = (array) ( $calcs[ $to ]['format'] ?? array() );
				$shared = ( $a['prefix'] ?? '' ) === ( $b['prefix'] ?? '' ) && ( $a['suffix'] ?? '' ) === ( $b['suffix'] ?? '' );
				$value  = $shared
					? $calculator::format( (float) $result['value'], array( 'suffix' => '' ) + $a ) . ' – ' . $calculator::format( (float) $upper['value'], array( 'prefix' => '' ) + $b )
					: $result['formatted'] . ' – ' . $upper['formatted'];
			} else {
				$value = $result['ok'] && ( null === $upper || $upper['ok'] ) ? $result['formatted'] : $error;
			}
			if ( $result['ok'] ) {
				$value = (string) ( $line['prefix'] ?? '' ) . $value . (string) ( $line['suffix'] ?? '' );
			}
			// A calculation the form only shows as its text ({{calc:id:text}}): "Protected", not "1".
			$text = array() === $line && ! str_contains( $json, '{{calc:' . $id . '}}' ) ? self::range_text( $s, $id ) : '';
			if ( '' !== $text ) {
				$value = $text;
			}
			$label = '' === $to ? '' : trim( html_entity_decode( wp_strip_all_tags( $s->document->text( (array) ( $line['label'] ?? array() ), $s->locale ) ), ENT_QUOTES, 'UTF-8' ) );
			$label = '' !== $label ? $label : ( '' !== (string) ( $calc['label'] ?? '' ) ? (string) $calc['label'] : $id );
			if ( $without_score && $id === $worth && '' === $to ) {
				// The lead value often shares its name with a range in the live result ("Investment").
				/* translators: %s: name of the calculation that gives the value of a lead, e.g. "Investment" */
				$label = sprintf( __( '%s (lead value)', 'funnelforms-free' ), $label );
			}
			$rows[] = array(
				'label' => $label,
				'value' => $value,
			);
		}
		return $rows;
	}

	/**
	 * Runs $callback with the plugin's texts in the language of the form (its interface language
	 * when that is a variant of the form's, such as de_DE_formal), not in the site's.
	 *
	 * @param Submission         $s        Submission.
	 * @param callable(): string $callback Code that translates.
	 */
	private static function in_form_language( Submission $s, callable $callback ): string {
		$ui     = (string) ( $s->document->raw()['settings']['uiLocale'] ?? '' );
		$locale = '' !== $ui && strtok( $ui, '_' ) === strtok( $s->locale, '_' ) ? $ui : $s->locale;
		return UiLocale::run( $locale, $callback );
	}

	/**
	 * The block for the site owner ({{lead}}): contact details, results, lead score, the page and
	 * where the visitor came from.
	 *
	 * @param Submission $s    Submission.
	 * @param string     $mode Output mode.
	 */
	private static function lead( Submission $s, string $mode ): string {
		$rows  = array_merge( self::contact_rows( $s ), self::calculation_rows( $s, true ) );
		$score = (string) ( $s->document->raw()['settings']['scoreCalculation'] ?? '' );
		if ( '' !== $score && ! empty( $s->calculations[ $score ]['ok'] ) ) {
			$rows[] = array(
				'label' => __( 'Lead score', 'funnelforms-free' ),
				'value' => (string) $s->calculations[ $score ]['formatted'],
			);
		}
		$url = (string) ( $s->page['url'] ?? '' );
		if ( '' !== $url ) {
			$rows[] = array(
				'label' => __( 'Page', 'funnelforms-free' ),
				'value' => $url,
				'href'  => $url,
			);
		}
		$utm = EntryConverter::utm( (string) ( $s->page['query'] ?? '' ) );
		if ( array() !== $utm ) {
			$rows[] = array(
				'label' => __( 'Campaign', 'funnelforms-free' ),
				'value' => implode( ', ', array_map( static fn( $key, $value ) => $key . ': ' . $value, array_keys( $utm ), $utm ) ),
			);
		}
		$referrer = (string) ( $s->visit['referrer'] ?? '' );
		if ( '' !== $referrer ) {
			$rows[] = array(
				'label' => __( 'Came from', 'funnelforms-free' ),
				'value' => $referrer,
			);
		}
		if ( self::HTML !== $mode ) {
			return self::list( $rows, $mode );
		}
		// Like the answers of a mail: label, value, a line.
		$out = '';
		foreach ( $rows as $row ) {
			$out .= '<b>' . esc_html( $row['label'] ) . "</b>\n" . self::value_html( $row ) . "\n" . self::LINE . "\n\n";
		}
		return $out;
	}

	/**
	 * Rows of label and value for the output mode: a table in designed mails, "label: value" lines
	 * otherwise.
	 *
	 * @param array<int,array{label:string,value:string,href?:string}> $rows Rows.
	 * @param string                                                   $mode Output mode.
	 */
	private static function list( array $rows, string $mode ): string {
		if ( self::CARD === $mode ) {
			return \Funnelforms\Application\Actions\MailLayout::answers(
				array_map(
					static fn( array $row ): array => array(
						'label' => esc_html( $row['label'] ),
						'value' => self::value_html( $row ),
					),
					$rows
				)
			);
		}
		if ( self::HTML === $mode ) {
			return implode( "\n", array_map( static fn( array $row ): string => '<b>' . esc_html( $row['label'] ) . ':</b> ' . self::value_html( $row ), $rows ) );
		}
		// One line in headers and texts without line breaks.
		return self::escape( implode( self::TEXT === $mode ? '; ' : "\n", array_map( static fn( array $row ): string => $row['label'] . ': ' . $row['value'], $rows ) ), $mode );
	}

	/**
	 * The value of a row as HTML, a link where it has one.
	 *
	 * @param array{label:string,value:string,href?:string} $row Row.
	 */
	private static function value_html( array $row ): string {
		$value = str_replace( array( "\r\n", "\n" ), '<br>', esc_html( $row['value'] ) );
		return isset( $row['href'] ) ? '<a href="' . esc_url( $row['href'], array( 'http', 'https', 'mailto', 'tel' ) ) . '">' . $value . '</a>' : $value;
	}

	/**
	 * Answer summary of the browser (3.x answerObject): title and answer of each visited step.
	 * Questions left empty (an optional period, a text typed and deleted) are not listed, as in
	 * summary() of the runtime.
	 *
	 * @param Submission $s     Submission.
	 * @param bool       $units Numbers with their unit, for people (the end page); the 3.x tag has none.
	 * @return array<int,array{id:string,title:string,answer:string}>
	 */
	public static function summary( Submission $s, bool $units = false ): array {
		$out = array();
		foreach ( $s->answered_step_fields() as $field ) {
			if ( ! self::answered( $s->answers[ $field['id'] ] ?? null ) ) {
				continue;
			}
			$out[] = array(
				'id'     => (string) ( $field['legacy']['questionId'] ?? $field['id'] ),
				'title'  => $s->document->text( $field['label'], $s->locale ),
				'answer' => self::summary_answer( $s, $field, $units ),
			);
		}
		return $out;
	}

	/**
	 * Whether an answer holds anything: text that is not blank, or a list or object with such text.
	 *
	 * @param mixed $value Answer.
	 */
	private static function answered( $value ): bool {
		if ( is_array( $value ) ) {
			foreach ( $value as $part ) {
				if ( self::answered( $part ) ) {
					return true;
				}
			}
			return false;
		}
		return is_scalar( $value ) && '' !== trim( (string) $value );
	}

	/**
	 * Answer of one field in the summary.
	 *
	 * @param Submission          $s     Submission.
	 * @param array<string,mixed> $field Field.
	 * @param bool                $units With the unit of numbers.
	 */
	private static function summary_answer( Submission $s, array $field, bool $units = false ): string {
		switch ( $field['type'] ) {
			case 'dropdown':
				return implode( ', ', array_map( array( $s, 'option_label' ), $s->chosen_options( $field ) ) );
			case 'signature':
				return __( 'Signed', 'funnelforms-free' );
			case 'file':
				// 3.x wrote a sentence with the number of files.
				$count = count( $s->files( $field ) );
				/* translators: %d: number of uploaded files. */
				return sprintf( _n( '%d file was uploaded.', '%d files were uploaded.', $count, 'funnelforms-free' ), $count );
		}
		return $units ? $s->display_with_unit( $field, ', ' ) : $s->display( $field, ', ' );
	}

	/**
	 * Uploaded files as links, one per line.
	 *
	 * @param Submission          $s     Submission.
	 * @param array<string,mixed> $field File field.
	 */
	private static function file_links_html( Submission $s, array $field ): string {
		$links = array();
		foreach ( $s->files( $field ) as $file ) {
			$links[] = '<a href="' . esc_url( \Funnelforms\Http\FileDownload::url( $file['id'] ) ) . '">' . esc_html( $file['name'] ) . '</a>';
		}
		return implode( "\n", $links );
	}

	/**
	 * Escapes a value for the output mode.
	 *
	 * @param string $value Value.
	 * @param string $mode  Output mode.
	 */
	private static function escape( string $value, string $mode ): string {
		switch ( $mode ) {
			case self::HTML:
			case self::CARD:
				return esc_html( $value );
			case self::URL:
				return rawurlencode( $value );
		}
		return trim( str_replace( array( "\r", "\n" ), ' ', $value ) );
	}
}
