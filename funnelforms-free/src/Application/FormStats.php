<?php
/**
 * Views, starts, sent forms and where visitors leave, for forms on the new renderer.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Application;

use Funnelforms\Domain\Form\Document;
use Funnelforms\Domain\Form\Experiments;
use Funnelforms\Edition\Edition;
use Funnelforms\Infrastructure\Repository\EntryFigures;
use Funnelforms\Infrastructure\Repository\EventRepository;

defined( 'ABSPATH' ) || exit;

/**
 * The runtime reports per page view: the form was seen (view), the visitor began (start), each
 * node shown with the node before it (step; an end only when reached from a question), the
 * answers of choice fields (answer), fields whose check stopped the visitor (invalid), the
 * variants of A/B tests (variant), and where the visitor came from (source: a search engine, site
 * or utm_source with the medium; campaign: utm_campaign; never a full address). The plugin adds
 * "complete" when the entry is stored, with the source of the page view so sent forms count per
 * source, and "finish" with the contact step and the end it led to. A page view is known only by
 * a random id the runtime makes; the plugin stores a keyed hash of it, no IP address, no user
 * agent, and nothing is stored in the browser.
 *
 * Extended level (Pro): where the visitor allowed statistics, the runtime sends the batch with
 * consent: 'statistics' and adds the device class (device), a visitor id it keeps in
 * localStorage for 180 days (visitor: new or return; stored only as a keyed hash per form) and the
 * first input into each field (field). Events are deleted after KEEP_DAYS.
 *
 * Views also count in the 3.x dashboard (options af2_impressions and af2_impressions_data), which
 * counted every display of a 3.x form.
 */
final class FormStats {

	public const EVENTS    = array( 'view', 'start', 'step', 'answer', 'invalid' );
	public const KEEP_DAYS = 400;

	/** Events of the extended level: only with consent: 'statistics', and only in Pro. */
	public const EXTENDED = array( 'field', 'device', 'visitor' );

	/** Device classes of the device event (from the width of the window). */
	public const DEVICES = array( 'mobile', 'tablet', 'desktop' );

	/** Field types without input, which no check stops and nobody fills in. */
	private const NO_INPUT = array( 'content', 'html', 'result' );

	/**
	 * Most events of one page view a request may carry.
	 */
	public const MAX_BATCH = 30;

	/**
	 * Sent forms the average time to fill in is taken from, the latest of the period.
	 */
	public const FILL_TIMES = 5000;

	/** Fewer values than this show no average: it could point at one visitor. */
	public const MIN_VALUES = 3;

	/**
	 * Stores events the runtime reported.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Shown document.
	 * @param string              $sid      Random id of the page view.
	 * @param mixed               $events   Events: list of {event, step}; for "variant" the step is the
	 *                                      experiment id and variant the variant shown.
	 * @param int                 $now      Time.
	 * @param bool                $extended The batch came with consent: 'statistics' (extended level).
	 * @return int Stored events; -1 when the request is not valid.
	 */
	public static function record( array $form, array $document, string $sid, $events, int $now, bool $extended = false ): int {
		if ( ! self::valid_sid( $sid ) || ! is_array( $events ) || count( $events ) > self::MAX_BATCH ) {
			return -1;
		}
		$doc  = new Document( $document );
		$rows = array();
		foreach ( $events as $event ) {
			// Values that are no text (arrays from a broken client) count as empty.
			$event = is_array( $event ) ? array_map( static fn( $v ) => is_scalar( $v ) ? (string) $v : '', $event ) : array();
			$name  = $event['event'] ?? '';
			$step  = $event['step'] ?? '';
			if ( in_array( $name, self::EXTENDED, true ) ) {
				// The browser decides, since only it knows the answer of the consent tool.
				if ( ! $extended ) {
					return -1;
				}
				$row = self::extended_row( $doc, (int) $form['id'], $name, $step, $event['variant'] ?? '' );
				if ( null === $row ) {
					return -1;
				}
				// Free has no extended level; a cached Pro runtime may still send it.
				if ( Edition::is_pro() ) {
					$rows[ $name . '|' . ( 'field' === $name ? $step : '' ) ] = $row;
				}
				continue;
			}
			if ( 'invalid' === $name ) {
				if ( ! self::input_field( $doc, $step ) ) {
					return -1;
				}
				$rows[ $name . '|' . $step ] = array(
					'event' => $name,
					'step'  => $step,
				);
				continue;
			}
			if ( 'answer' === $name ) {
				// The answer of a choice or dropdown field: step is the field, variant the option.
				$option = $event['variant'] ?? '';
				if ( ! in_array( $option, self::option_ids( $doc, $step ), true ) ) {
					return -1;
				}
				$rows[ $name . '|' . $step . '|' . $option ] = array(
					'event'   => $name,
					'step'    => $step,
					'variant' => $option,
				);
				continue;
			}
			if ( 'source' === $name ) {
				// Where the visitor came from (step: referrer, variant: query of the page). Only the
				// source, medium and campaign are kept; input that does not fit is left out, the view
				// still counts.
				$from = TrafficSources::detect( $event['step'] ?? '', $event['variant'] ?? '', self::own_hosts() );
				if ( null !== $from && '' !== $from['source'] . $from['medium'] ) {
					$rows['source'] = array(
						'event'   => 'source',
						'step'    => $from['source'],
						'variant' => $from['medium'],
					);
				}
				if ( null !== $from && '' !== $from['campaign'] ) {
					$rows['campaign'] = array(
						'event' => 'campaign',
						'step'  => $from['campaign'],
					);
				}
				continue;
			}
			if ( 'variant' === $name ) {
				// Only running tests are measured; a stopped one shows everybody the same variant.
				$variant    = $event['variant'] ?? '';
				$ab         = Edition::pro( Experiments::class );
				$experiment = null === $ab ? null : $ab::find( $document, $step );
				if ( null === $experiment || 'running' !== $experiment['status'] || ! in_array( $variant, array_column( $experiment['variants'], 'id' ), true ) ) {
					return -1;
				}
				$rows[ $name . '|' . $step ] = array(
					'event'   => $name,
					'step'    => $step,
					'variant' => $variant,
				);
				continue;
			}
			if ( ! in_array( $name, self::EVENTS, true ) ) {
				return -1;
			}
			if ( 'step' === $name ) {
				// The node shown, and the step before it ('' for the first; missing from runtimes
				// before paths were counted, which then count as first steps of the start only).
				$node   = $doc->node( $step );
				$before = $event['variant'] ?? '';
				$prev   = '' === $before ? null : $doc->node( $before );
				if ( null === $node || ! in_array( $node['type'] ?? '', array( 'step', 'contact', 'end' ), true ) || ( '' !== $before && ( null === $prev || ! in_array( $prev['type'] ?? '', array( 'step', 'contact' ), true ) ) ) ) {
					return -1;
				}
				$rows[ $name . '|' . $step . '|' . $before ] = array(
					'event'   => $name,
					'step'    => $step,
					'variant' => $before,
				);
				continue;
			}
			$rows[ $name ] = array(
				'event' => $name,
				'step'  => '',
			);
		}
		$rows = array_values( $rows );
		( new EventRepository() )->add( (int) $form['id'], self::session( (int) $form['id'], $sid ), $rows, gmdate( 'Y-m-d H:i:s', $now ) );
		if ( in_array( 'view', array_column( $rows, 'event' ), true ) ) {
			self::count_legacy_impression( $now );
		}
		return count( $rows );
	}

	/**
	 * A row of the extended level, or null when the event does not fit the document.
	 *
	 * @param Document $doc     Document.
	 * @param int      $form_id Form ID.
	 * @param string   $name    field, device or visitor.
	 * @param string   $step    Field id, device class or visitor id.
	 * @param string   $variant new or return for visitor.
	 * @return array{event: string, step: string, variant?: string}|null
	 */
	private static function extended_row( Document $doc, int $form_id, string $name, string $step, string $variant ): ?array {
		if ( 'field' === $name ) {
			return self::input_field( $doc, $step ) ? array(
				'event' => $name,
				'step'  => $step,
			) : null;
		}
		if ( 'device' === $name ) {
			return in_array( $step, self::DEVICES, true ) ? array(
				'event' => $name,
				'step'  => $step,
			) : null;
		}
		if ( 1 !== preg_match( '/^[0-9a-f]{32}$/', $step ) || ! in_array( $variant, array( 'new', 'return' ), true ) ) {
			return null;
		}
		// Like the page view, the visitor is kept only as a keyed hash, one of its own per form.
		return array(
			'event'   => $name,
			'step'    => self::visitor( $form_id, $step ),
			'variant' => $variant,
		);
	}

	/**
	 * Whether a field of a step or contact step takes input (not a text or HTML block).
	 *
	 * @param Document $doc Document.
	 * @param string   $id  Field id.
	 */
	private static function input_field( Document $doc, string $id ): bool {
		$field = '' === $id ? null : $doc->field( $id );
		return null !== $field && ! in_array( $field['type'] ?? '', self::NO_INPUT, true );
	}

	/**
	 * Notes that the page view sent the form.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $sid     Random id of the page view; nothing is noted without one.
	 * @param int    $now     Time.
	 * @param string $contact Contact step that sent the form ('' when unknown).
	 * @param string $end     End node it led to ('' when it has none).
	 * @return array{source:string,medium:string}|null The source of the page view, for the entry (LeadSources).
	 */
	public static function completed( int $form_id, string $sid, int $now, string $contact = '', string $end = '' ): ?array {
		if ( ! self::valid_sid( $sid ) ) {
			return null;
		}
		$events  = new EventRepository();
		$session = self::session( $form_id, $sid );
		// The sent form carries the source of its page view, so it counts per source without a join.
		$source = $events->source_of( $form_id, $session );
		$rows   = array(
			array(
				'event'   => 'complete',
				'step'    => $source['source'] ?? '',
				'variant' => $source['medium'] ?? '',
			),
		);
		if ( '' !== $contact ) {
			// The way from the contact step to its end, for the paths.
			$rows[] = array(
				'event'   => 'finish',
				'step'    => $end,
				'variant' => $contact,
			);
		}
		$events->add( $form_id, $session, $rows, gmdate( 'Y-m-d H:i:s', $now ) );
		return $source;
	}

	/**
	 * Hosts of this site: of the home address and of the page that sent the events (a form can
	 * show on a page of another address of the same site).
	 *
	 * @return string[]
	 */
	private static function own_hosts(): array {
		$hosts = array( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
		$page  = wp_get_raw_referer();
		if ( is_string( $page ) && '' !== $page ) {
			$hosts[] = (string) wp_parse_url( $page, PHP_URL_HOST );
		}
		return array_values( array_filter( $hosts ) );
	}

	/**
	 * A source, medium or campaign as stored: plain text of at most 80 characters, lower case for
	 * source and medium; empty when it looks like an e-mail address (no personal data).
	 *
	 * @param mixed $value Value from the runtime.
	 * @param bool  $lower Lower case.
	 */
	public static function tag( $value, bool $lower ): string {
		if ( ! is_string( $value ) ) {
			return '';
		}
		$value = trim( (string) preg_replace( '/\s+/u', ' ', sanitize_text_field( $value ) ) );
		if ( str_contains( $value, '@' ) ) {
			return '';
		}
		$value = mb_substr( $value, 0, 80 );
		return $lower ? mb_strtolower( $value ) : $value;
	}

	/**
	 * Figures of a form for a period of the site's days.
	 *
	 * @param array<string,mixed> $form     Form row.
	 * @param array<string,mixed> $document Current document.
	 * @param string              $from     First day (Y-m-d, site time).
	 * @param string              $to       Last day (Y-m-d, site time).
	 * @param int[]|null          $seconds  Times to fill in of the period when they are known already.
	 * @return array<string,mixed>
	 */
	public static function report( array $form, array $document, string $from, string $to, ?array $seconds = null ): array {
		$form_id = (int) $form['id'];
		$start   = get_gmt_from_date( $from . ' 00:00:00' );
		$end     = get_gmt_from_date( gmdate( 'Y-m-d', (int) strtotime( $to . ' +1 day' ) ) . ' 00:00:00' );
		$offset  = (int) wp_timezone()->getOffset( new \DateTimeImmutable( $to ) );
		$events  = new EventRepository();
		$entries = new EntryFigures();

		$days = array();
		for ( $day = $from; $day <= $to; $day = gmdate( 'Y-m-d', (int) strtotime( $day . ' +1 day' ) ) ) {
			$days[ $day ] = array(
				'date'        => $day,
				'views'       => 0,
				'starts'      => 0,
				'completions' => 0,
			);
		}
		foreach ( $events->daily( $form_id, $start, $end, $offset ) as $row ) {
			$key = array(
				'view'  => 'views',
				'start' => 'starts',
			)[ $row['event'] ] ?? null;
			if ( null !== $key && isset( $days[ $row['day'] ] ) ) {
				$days[ $row['day'] ][ $key ] = (int) $row['n'];
			}
		}
		// Sent forms are the entries stored by the new renderer, also those of visitors whose browser
		// sent no events. Leads imported from 3.x have no views here and are left out.
		foreach ( $entries->daily( $form_id, $start, $end, $offset, true ) as $row ) {
			if ( isset( $days[ $row['day'] ] ) ) {
				$days[ $row['day'] ]['completions'] = (int) $row['n'];
			}
		}

		$views       = array_sum( array_column( $days, 'views' ) );
		$completions = array_sum( array_column( $days, 'completions' ) );
		$seconds     = $seconds ?? self::fill_times( $form_id, $start, $end );
		return array(
			'form'    => $form_id,
			'from'    => $from,
			'to'      => $to,
			'totals'  => array(
				'views'          => $views,
				'starts'         => array_sum( array_column( $days, 'starts' ) ),
				'completions'    => $completions,
				'conversionRate' => $views > 0 ? round( $completions / $views, 4 ) : null,
				'averageSeconds' => array() === $seconds ? null : (int) round( array_sum( $seconds ) / count( $seconds ) ),
				'medianSeconds'  => array() === $seconds ? null : self::median( $seconds ),
			),
			'devices' => $entries->devices( $form_id, $start, $end, true ),
			'daily'   => array_values( $days ),
			'steps'   => self::steps( new Document( $document ), $events->steps( $form_id, $start, $end ) ),
			'answers' => self::answers( new Document( $document ), $events->answers( $form_id, $start, $end ) ),
		) + self::experiments( $form_id, $document, $events, $start, $end );
	}

	/**
	 * Seconds from the first answer to sending, of the latest FILL_TIMES sent forms of the period.
	 * The time is kept in the entry's visit details, so it is read from there.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $start   Start (UTC, inclusive).
	 * @param string $end     End (UTC, exclusive).
	 * @return int[]
	 */
	private static function fill_times( int $form_id, string $start, string $end ): array {
		$out = array();
		( new EntryFigures() )->each(
			$form_id,
			$start,
			$end,
			self::FILL_TIMES,
			static function ( array $meta ) use ( &$out ): void {
				$seconds = $meta['visit']['seconds'] ?? null;
				if ( is_int( $seconds ) && $seconds > 0 ) {
					$out[] = $seconds;
				}
			},
			false
		);
		return $out;
	}

	/**
	 * Middle value; for an even count the mean of the two middle ones.
	 *
	 * @param int[] $values Values, at least one.
	 */
	public static function median( array $values ): int {
		sort( $values );
		$middle = intdiv( count( $values ), 2 );
		return count( $values ) % 2 ? $values[ $middle ] : (int) round( ( $values[ $middle - 1 ] + $values[ $middle ] ) / 2 );
	}

	/**
	 * Option ids of a choice or dropdown field of a step; none for other fields.
	 *
	 * @param Document $doc      Document.
	 * @param string   $field_id Field id.
	 * @return string[]
	 */
	private static function option_ids( Document $doc, string $field_id ): array {
		foreach ( $doc->nodes() as $node ) {
			foreach ( ( 'step' === ( $node['type'] ?? '' ) ? $node['fields'] ?? array() : array() ) as $field ) {
				if ( ( $field['id'] ?? null ) === $field_id && in_array( $field['type'] ?? '', array( 'choice', 'dropdown' ), true ) ) {
					return array_map( 'strval', array_column( (array) ( $field['options'] ?? array() ), 'id' ) );
				}
			}
		}
		return array();
	}

	/**
	 * Per choice and dropdown field of the current version, in document order: page views that
	 * gave each answer, and how many of them sent the form.
	 *
	 * @param Document                                                    $doc    Document.
	 * @param array<string,array<string,array{chosen:int,completed:int}>> $counts Counts per field and option.
	 * @return array<int,array<string,mixed>>
	 */
	private static function answers( Document $doc, array $counts ): array {
		$out = array();
		foreach ( $doc->nodes() as $id => $node ) {
			foreach ( ( 'step' === ( $node['type'] ?? '' ) ? $node['fields'] ?? array() : array() ) as $field ) {
				if ( ! in_array( $field['type'] ?? '', array( 'choice', 'dropdown' ), true ) ) {
					continue;
				}
				$options = array();
				foreach ( (array) ( $field['options'] ?? array() ) as $option ) {
					$n         = $counts[ $field['id'] ][ $option['id'] ] ?? array(
						'chosen'    => 0,
						'completed' => 0,
					);
					$options[] = array(
						'id'        => (string) $option['id'],
						'label'     => self::plain( $doc->text( $option['label'] ?? array() ) ),
						'chosen'    => $n['chosen'],
						'completed' => $n['completed'],
					);
				}
				$out[] = array(
					'field'   => (string) $field['id'],
					'step'    => (string) $id,
					'title'   => self::plain( $doc->text( $field['label'] ?? array() ) ),
					'options' => $options,
				);
			}
		}
		return $out;
	}

	/**
	 * Figures of the A/B tests of the current version, per variant. The first variant is the
	 * control: the others carry their uplift in conversion rate and the chance that they convert
	 * better (Beta posteriors with a uniform prior, normal approximation).
	 *
	 * @param int                 $form_id  Form ID.
	 * @param array<string,mixed> $document Current document.
	 * @param EventRepository     $events   Events.
	 * @param string              $start    Start (UTC, inclusive).
	 * @param string              $end      End (UTC, exclusive).
	 * @return array<string,mixed> Empty, or experiments => list.
	 */
	private static function experiments( int $form_id, array $document, EventRepository $events, string $start, string $end ): array {
		$out = array();
		foreach ( $document['experiments'] ?? array() as $experiment ) {
			$out[] = array(
				'id'       => (string) $experiment['id'],
				'name'     => (string) ( $experiment['name'] ?? $experiment['id'] ),
				'status'   => (string) $experiment['status'],
				'winner'   => $experiment['winner'] ?? null,
				'variants' => self::variant_rows( $experiment, $events->variants( $form_id, (string) $experiment['id'], $start, $end ) ),
			);
		}
		return array() === $out ? array() : array( 'experiments' => $out );
	}

	/**
	 * Figures of each variant of a test, compared with the first; variants planned or retired in
	 * a test plan are left out.
	 *
	 * @param array<string,mixed>                                       $experiment Test.
	 * @param array<string,array{view: int, start: int, complete: int}> $counts     Sessions per variant (EventRepository::variants()).
	 * @return list<array<string,mixed>> id, label, weight, views, starts, completions, conversionRate, uplift, chanceToBeatControl.
	 */
	public static function variant_rows( array $experiment, array $counts ): array {
		$rows    = array();
		$control = null;
		foreach ( $experiment['variants'] as $variant ) {
			if ( ! empty( $variant['planned'] ) || ! empty( $variant['retired'] ) ) {
				// Waits in the test plan or lost an earlier round: no part of this round.
				continue;
			}
			$views       = $counts[ $variant['id'] ]['view'] ?? 0;
			$completions = min( $views, $counts[ $variant['id'] ]['complete'] ?? 0 );
			$rate        = $views > 0 ? $completions / $views : null;
			$row         = array(
				'id'                  => (string) $variant['id'],
				'label'               => (string) ( $variant['label'] ?? $variant['id'] ),
				'weight'              => (int) $variant['weight'],
				'views'               => $views,
				'starts'              => $counts[ $variant['id'] ]['start'] ?? 0,
				'completions'         => $completions,
				'conversionRate'      => null === $rate ? null : round( $rate, 4 ),
				'uplift'              => null,
				'chanceToBeatControl' => null,
			);
			if ( null === $control ) {
				$control = array( $views, $completions, $rate );
			} elseif ( $views > 0 && $control[0] > 0 ) {
				$row['uplift']              = $control[2] > 0 ? round( $rate / $control[2] - 1, 4 ) : null;
				$row['chanceToBeatControl'] = round( self::chance_to_beat( $control[0], $control[1], $views, $completions ), 4 );
			}
			$rows[] = $row;
		}
		return $rows;
	}

	/**
	 * Chance that B converts better than A, from views and completions of both.
	 *
	 * @param int $views_a       Views of A.
	 * @param int $completions_a Completions of A.
	 * @param int $views_b       Views of B.
	 * @param int $completions_b Completions of B.
	 */
	public static function chance_to_beat( int $views_a, int $completions_a, int $views_b, int $completions_b ): float {
		$mean = static fn( int $v, int $c ): float => ( $c + 1 ) / ( $v + 2 );
		$var  = static fn( int $v, int $c ): float => $mean( $v, $c ) * ( 1 - $mean( $v, $c ) ) / ( $v + 3 );
		$z    = ( $mean( $views_b, $completions_b ) - $mean( $views_a, $completions_a ) ) / sqrt( $var( $views_a, $completions_a ) + $var( $views_b, $completions_b ) );
		return 0.5 * ( 1 + self::erf( $z / M_SQRT2 ) );
	}

	/**
	 * Error function (Abramowitz and Stegun 7.1.26, error below 1.5e-7); PHP has none.
	 *
	 * @param float $x Value.
	 */
	public static function erf( float $x ): float {
		$sign = $x < 0 ? -1 : 1;
		$x    = abs( $x );
		$t    = 1 / ( 1 + 0.3275911 * $x );
		$y    = 1 - ( ( ( ( 1.061405429 * $t - 1.453152027 ) * $t + 1.421413741 ) * $t - 0.284496736 ) * $t + 0.254829592 ) * $t * exp( -$x * $x );
		return $sign * $y;
	}

	/**
	 * Steps in the order of the document, with a readable name.
	 *
	 * @param Document                                     $doc    Document.
	 * @param array<string,array{reached: int, left: int}> $counts Counts per node id.
	 * @return array<int,array<string,mixed>>
	 */
	public static function steps( Document $doc, array $counts ): array {
		$out = array();
		foreach ( $doc->nodes() as $id => $node ) {
			if ( ! in_array( $node['type'] ?? '', array( 'step', 'contact' ), true ) ) {
				continue;
			}
			$label = 'contact' === $node['type'] ? ( $node['title'] ?? array() ) : ( $node['fields'][0]['label'] ?? array() );
			$out[] = array(
				'id'      => (string) $id,
				'type'    => (string) $node['type'],
				'title'   => self::plain( $doc->text( $label ) ),
				'reached' => $counts[ $id ]['reached'] ?? 0,
				'left'    => $counts[ $id ]['left'] ?? 0,
			);
		}
		return $out;
	}

	/**
	 * Text of the document as plain text: without tags, entities turned into characters.
	 *
	 * @param string $html Text, maybe with HTML.
	 */
	public static function plain( string $html ): string {
		return trim( html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
	}

	/**
	 * Deletes events older than KEEP_DAYS.
	 *
	 * @param int $now Time.
	 */
	public static function purge( int $now ): int {
		$events  = new EventRepository();
		$before  = gmdate( 'Y-m-d H:i:s', $now - self::KEEP_DAYS * DAY_IN_SECONDS );
		$deleted = 0;
		do {
			$n        = $events->delete_before( $before, 5000 );
			$deleted += $n;
		} while ( 5000 === $n );
		return $deleted;
	}

	/**
	 * Whether the runtime's page view id looks right.
	 *
	 * @param string $sid Id.
	 */
	private static function valid_sid( string $sid ): bool {
		return 1 === preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $sid );
	}

	/**
	 * Stored session: a keyed hash, so the id the browser made is not kept.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $sid     Page view id.
	 */
	private static function session( int $form_id, string $sid ): string {
		return hash_hmac( 'sha256', $form_id . '|' . $sid, wp_salt( 'nonce' ) );
	}

	/**
	 * Stored visitor: a keyed hash per form, so the id kept in the browser is not stored and the
	 * same visitor cannot be followed from one form to another.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $id      Visitor id of the runtime.
	 */
	private static function visitor( int $form_id, string $id ): string {
		return hash_hmac( 'sha256', $form_id . '|visitor|' . $id, wp_salt( 'nonce' ) );
	}

	/**
	 * Counts a view in the 3.x dashboard, as 3.x did for each display of a form.
	 *
	 * @param int $now Time.
	 */
	private static function count_legacy_impression( int $now ): void {
		/**
		 * Whether views of forms on the new renderer count in the 3.x dashboard.
		 *
		 * @param bool $count Default true.
		 */
		if ( ! apply_filters( 'funnelforms_count_legacy_impressions', true ) ) {
			return;
		}
		update_option( 'af2_impressions', (int) get_option( 'af2_impressions' ) + 1 );
		$data                    = maybe_unserialize( (string) get_option( 'af2_impressions_data', '' ) );
		$data                    = is_array( $data ) ? $data : array();
		$year                    = (int) gmdate( 'Y', $now );
		$month                   = (int) gmdate( 'm', $now );
		$data[ $year ][ $month ] = (int) ( $data[ $year ][ $month ] ?? 0 ) + 1;
		// 3.x reads the option with unserialize() and stores it serialized itself.
		update_option( 'af2_impressions_data', serialize( $data ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize -- 3.x format.
	}
}
