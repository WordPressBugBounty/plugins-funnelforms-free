<?php
/**
 * Step events of forms on the new renderer (table ffx_events).
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Infrastructure\Repository;

use Funnelforms\Infrastructure\Database\Schema;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- custom table of this plugin; counts are fresh on purpose.

/**
 * One row per event of a page view: view, start, step (with the node id; variant: the node
 * before, '' for the first), answer, invalid (step: field), variant, source (step: source,
 * variant: medium), campaign (step: name), complete (step and variant: the source of the page
 * view, for the counts per source) and finish (step: end node, variant: contact step). The
 * extended level adds field (step: field), device (step: mobile, tablet or desktop) and visitor
 * (step: keyed hash of the visitor id, variant: new or return). The session is a hash of a random
 * id of the page view; no IP, no user agent, no cookie.
 */
final class EventRepository {

	/**
	 * Stores events of one page view.
	 *
	 * @param int                                                             $form_id Form ID.
	 * @param string                                                          $session Session hash.
	 * @param array<int,array{event: string, step: string, variant?: string}> $events  Events.
	 * @param string                                                          $now     Time (UTC, Y-m-d H:i:s).
	 */
	public function add( int $form_id, string $session, array $events, string $now ): void {
		global $wpdb;
		if ( array() === $events ) {
			return;
		}
		// One row per insert: a page view sends a few events, and the query stays a fixed text.
		$table = Schema::table( 'events' );
		foreach ( $events as $event ) {
			$wpdb->insert(
				$table,
				array(
					'form_id'      => $form_id,
					'session_hash' => $session,
					'step'         => $event['step'],
					'event'        => $event['event'],
					'variant'      => $event['variant'] ?? '',
					'created_at'   => $now,
				),
				array( '%d', '%s', '%s', '%s', '%s', '%s' )
			);
		}
	}

	/**
	 * Distinct sessions per day and event.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $from    Start (UTC, inclusive).
	 * @param string $to      End (UTC, exclusive).
	 * @param int    $offset  Seconds to add for the site's days.
	 * @return array<int,array{day: string, event: string, n: string}>
	 */
	public function daily( int $form_id, string $from, string $to, int $offset ): array {
		global $wpdb;
		return (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT DATE(DATE_ADD(created_at, INTERVAL %d SECOND)) AS day, event, COUNT(DISTINCT session_hash) AS n FROM %i WHERE form_id = %d AND event IN ('view', 'start', 'complete') AND created_at >= %s AND created_at < %s GROUP BY day, event",
				$offset,
				Schema::table( 'events' ),
				$form_id,
				$from,
				$to
			),
			ARRAY_A
		);
	}

	/**
	 * Distinct sessions per form, day and event (view, start) of every form.
	 *
	 * @param string $from   Start (UTC, inclusive).
	 * @param string $to     End (UTC, exclusive).
	 * @param int    $offset Seconds to add for the site's days.
	 * @return array<int,array{form_id: string, day: string, event: string, n: string}>
	 */
	public function daily_all( string $from, string $to, int $offset ): array {
		global $wpdb;
		return (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT form_id, DATE(DATE_ADD(created_at, INTERVAL %d SECOND)) AS day, event, COUNT(DISTINCT session_hash) AS n FROM %i WHERE event IN ('view', 'start') AND created_at >= %s AND created_at < %s GROUP BY form_id, day, event",
				$offset,
				Schema::table( 'events' ),
				$from,
				$to
			),
			ARRAY_A
		);
	}

	/**
	 * Page views per source and medium, and how many of them sent the form; of one form or of all.
	 * Page views without a source event came directly (or their browser reported none); they are
	 * the row with empty source and medium as far as the sent forms go, their views are the rest.
	 *
	 * @param int|null $form_id Form ID, null for every form.
	 * @param string   $from    Start (UTC, inclusive).
	 * @param string   $to      End (UTC, exclusive).
	 * @return array<string,array{source: string, medium: string, views: int, completions: int}> By "source|medium".
	 */
	public function sources( ?int $form_id, string $from, string $to ): array {
		$out = array();
		foreach ( array(
			'source'   => 'views',
			'complete' => 'completions',
		) as $event => $key ) {
			foreach ( $this->grouped( $form_id, $event, $from, $to ) as $row ) {
				$id         = $row['step'] . '|' . $row['variant'];
				$out[ $id ] = $out[ $id ] ?? array(
					'source'      => (string) $row['step'],
					'medium'      => (string) $row['variant'],
					'views'       => 0,
					'completions' => 0,
				);

				$out[ $id ][ $key ] = (int) $row['n'];
			}
		}
		return $out;
	}

	/**
	 * Distinct sessions per step and variant of one event, the most first (at most 500 rows).
	 *
	 * @param int|null $form_id Form ID, null for every form.
	 * @param string   $event   Event.
	 * @param string   $from    Start (UTC, inclusive).
	 * @param string   $to      End (UTC, exclusive).
	 * @return array<int,array{step: string, variant: string, n: string}>
	 */
	private function grouped( ?int $form_id, string $event, string $from, string $to ): array {
		global $wpdb;
		if ( null === $form_id ) {
			$sql = $wpdb->prepare( 'SELECT step, variant, COUNT(DISTINCT session_hash) AS n FROM %i WHERE event = %s AND created_at >= %s AND created_at < %s GROUP BY step, variant ORDER BY n DESC LIMIT 500', Schema::table( 'events' ), $event, $from, $to );
		} else {
			$sql = $wpdb->prepare( 'SELECT step, variant, COUNT(DISTINCT session_hash) AS n FROM %i WHERE form_id = %d AND event = %s AND created_at >= %s AND created_at < %s GROUP BY step, variant ORDER BY n DESC LIMIT 500', Schema::table( 'events' ), $form_id, $event, $from, $to );
		}
		return (array) $wpdb->get_results( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- prepared above.
	}

	/**
	 * Per campaign of a form (utm_campaign of the page): page views, and how many of them sent it.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $from    Start (UTC, inclusive).
	 * @param string $to      End (UTC, exclusive).
	 * @return array<int,array{campaign: string, views: int, completions: int}> The most viewed first, at most 100.
	 */
	public function campaigns( int $form_id, string $from, string $to ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT c.step, COUNT(DISTINCT c.session_hash) AS views, COUNT(DISTINCT d.session_hash) AS completions FROM %i c LEFT JOIN %i d ON d.form_id = c.form_id AND d.session_hash = c.session_hash AND d.event = 'complete' WHERE c.form_id = %d AND c.event = 'campaign' AND c.created_at >= %s AND c.created_at < %s GROUP BY c.step ORDER BY views DESC LIMIT 100",
				$table,
				$table,
				$form_id,
				$from,
				$to
			),
			ARRAY_A
		);
		return array_map(
			static fn( array $row ): array => array(
				'campaign'    => (string) $row['step'],
				'views'       => (int) $row['views'],
				'completions' => (int) $row['completions'],
			),
			$rows
		);
	}

	/**
	 * The source a session reported with its view, if any.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $session Session hash.
	 * @return array{source: string, medium: string}|null
	 */
	public function source_of( int $form_id, string $session ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT step, variant FROM %i WHERE form_id = %d AND session_hash = %s AND event = 'source' LIMIT 1", Schema::table( 'events' ), $form_id, $session ), ARRAY_A );
		return is_array( $row ) ? array(
			'source' => (string) $row['step'],
			'medium' => (string) $row['variant'],
		) : null;
	}

	/**
	 * Per step: sessions that reached it, and sessions that ended there without sending the form.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $from    Start (UTC, inclusive).
	 * @param string $to      End (UTC, exclusive).
	 * @return array<string,array{reached: int, left: int}>
	 */
	public function steps( int $form_id, string $from, string $to ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$out   = array();
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT step, COUNT(DISTINCT session_hash) AS n FROM %i WHERE form_id = %d AND event = 'step' AND created_at >= %s AND created_at < %s GROUP BY step",
				$table,
				$form_id,
				$from,
				$to
			),
			ARRAY_A
		);
		foreach ( $rows as $row ) {
			$out[ (string) $row['step'] ] = array(
				'reached' => (int) $row['n'],
				'left'    => 0,
			);
		}
		// The last step of every session that did not send the form.
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT e.step, COUNT(*) AS n FROM %i e JOIN (SELECT session_hash, MAX(id) AS id FROM %i WHERE form_id = %d AND event = 'step' AND created_at >= %s AND created_at < %s GROUP BY session_hash) last ON last.id = e.id LEFT JOIN (SELECT DISTINCT session_hash FROM %i WHERE form_id = %d AND event = 'complete' AND created_at >= %s AND created_at < %s) done ON done.session_hash = e.session_hash WHERE done.session_hash IS NULL GROUP BY e.step",
				$table,
				$table,
				$form_id,
				$from,
				$to,
				$table,
				$form_id,
				$from,
				$to
			),
			ARRAY_A
		);
		foreach ( $rows as $row ) {
			if ( isset( $out[ (string) $row['step'] ] ) ) {
				$out[ (string) $row['step'] ]['left'] = (int) $row['n'];
			}
		}
		return $out;
	}

	/**
	 * Per field and option: sessions that gave the answer, and how many of them sent the form.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $from    Start (UTC, inclusive).
	 * @param string $to      End (UTC, exclusive).
	 * @return array<string,array<string,array{chosen: int, completed: int}>>
	 */
	public function answers( int $form_id, string $from, string $to ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT a.step, a.variant, COUNT(DISTINCT a.session_hash) AS chosen, COUNT(DISTINCT done.session_hash) AS completed FROM %i a LEFT JOIN (SELECT DISTINCT session_hash FROM %i WHERE form_id = %d AND event = 'complete' AND created_at >= %s) done ON done.session_hash = a.session_hash WHERE a.form_id = %d AND a.event = 'answer' AND a.created_at >= %s AND a.created_at < %s GROUP BY a.step, a.variant",
				$table,
				$table,
				$form_id,
				$from,
				$form_id,
				$from,
				$to
			),
			ARRAY_A
		);
		$out   = array();
		foreach ( $rows as $row ) {
			$out[ (string) $row['step'] ][ (string) $row['variant'] ] = array(
				'chosen'    => (int) $row['chosen'],
				'completed' => (int) $row['completed'],
			);
		}
		return $out;
	}

	/**
	 * Ways between nodes: per node before (from, '' for the first step) and node shown (to), the
	 * sessions that took it and how many of them sent the form; and per contact step and end
	 * (finish), the sent forms.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $from    Start (UTC, inclusive).
	 * @param string $to      End (UTC, exclusive).
	 * @return array<int,array{from: string, to: string, sessions: int, completed: int}>
	 */
	public function paths( int $form_id, string $from, string $to ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT s.variant AS before_node, s.step AS node, COUNT(DISTINCT s.session_hash) AS sessions, COUNT(DISTINCT done.session_hash) AS completed FROM %i s LEFT JOIN (SELECT DISTINCT session_hash FROM %i WHERE form_id = %d AND event = 'complete' AND created_at >= %s) done ON done.session_hash = s.session_hash WHERE s.form_id = %d AND s.event = 'step' AND s.created_at >= %s AND s.created_at < %s GROUP BY s.variant, s.step",
				$table,
				$table,
				$form_id,
				$from,
				$form_id,
				$from,
				$to
			),
			ARRAY_A
		);
		$out   = array();
		foreach ( $rows as $row ) {
			$out[] = array(
				'from'      => (string) $row['before_node'],
				'to'        => (string) $row['node'],
				'sessions'  => (int) $row['sessions'],
				'completed' => (int) $row['completed'],
			);
		}
		foreach ( $this->grouped( $form_id, 'finish', $from, $to ) as $row ) {
			$out[] = array(
				'from'      => (string) $row['variant'],
				'to'        => (string) $row['step'],
				'sessions'  => (int) $row['n'],
				'completed' => (int) $row['n'],
			);
		}
		return $out;
	}

	/**
	 * Per field: sessions whose check it failed (invalid), sessions that put something in
	 * (touched, extended level) and sessions that did not send the form and touched it last
	 * (lastTouched).
	 *
	 * @param int    $form_id Form ID.
	 * @param string $from    Start (UTC, inclusive).
	 * @param string $to      End (UTC, exclusive).
	 * @return array<string,array{invalid: int, touched: int, lastTouched: int}>
	 */
	public function fields( int $form_id, string $from, string $to ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$out   = array();
		$add   = static function ( string $field, string $key, int $n ) use ( &$out ): void {
			$out[ $field ] = $out[ $field ] ?? array(
				'invalid'     => 0,
				'touched'     => 0,
				'lastTouched' => 0,
			);

			$out[ $field ][ $key ] = $n;
		};
		foreach ( array(
			'invalid' => 'invalid',
			'field'   => 'touched',
		) as $event => $key ) {
			foreach ( $this->grouped( $form_id, $event, $from, $to ) as $row ) {
				$add( (string) $row['step'], $key, (int) $row['n'] );
			}
		}
		// The last field each session that did not send the form put something in.
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT e.step, COUNT(*) AS n FROM %i e JOIN (SELECT session_hash, MAX(id) AS id FROM %i WHERE form_id = %d AND event = 'field' AND created_at >= %s AND created_at < %s GROUP BY session_hash) last ON last.id = e.id LEFT JOIN (SELECT DISTINCT session_hash FROM %i WHERE form_id = %d AND event = 'complete' AND created_at >= %s) done ON done.session_hash = e.session_hash WHERE done.session_hash IS NULL GROUP BY e.step",
				$table,
				$table,
				$form_id,
				$from,
				$to,
				$table,
				$form_id,
				$from
			),
			ARRAY_A
		);
		foreach ( $rows as $row ) {
			$add( (string) $row['step'], 'lastTouched', (int) $row['n'] );
		}
		return $out;
	}

	/**
	 * Visitors of the extended level: distinct visitors, those back for another visit, their
	 * page views, and the sent forms of all and of return visits.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $from    Start (UTC, inclusive).
	 * @param string $to      End (UTC, exclusive).
	 * @return array{unique: int, returning: int, views: int, returnViews: int, completions: int, returnCompletions: int}
	 */
	public function visitors( int $form_id, string $from, string $to ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$row   = (array) $wpdb->get_row(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT v.step) AS uniq, COUNT(DISTINCT CASE WHEN v.variant = 'return' THEN v.step END) AS back, COUNT(DISTINCT v.session_hash) AS views, COUNT(DISTINCT CASE WHEN v.variant = 'return' THEN v.session_hash END) AS return_views, COUNT(DISTINCT done.session_hash) AS completions, COUNT(DISTINCT CASE WHEN v.variant = 'return' THEN done.session_hash END) AS return_completions FROM %i v LEFT JOIN (SELECT DISTINCT session_hash FROM %i WHERE form_id = %d AND event = 'complete' AND created_at >= %s) done ON done.session_hash = v.session_hash WHERE v.form_id = %d AND v.event = 'visitor' AND v.created_at >= %s AND v.created_at < %s",
				$table,
				$table,
				$form_id,
				$from,
				$form_id,
				$from,
				$to
			),
			ARRAY_A
		);
		return array(
			'unique'            => (int) ( $row['uniq'] ?? 0 ),
			'returning'         => (int) ( $row['back'] ?? 0 ),
			'views'             => (int) ( $row['views'] ?? 0 ),
			'returnViews'       => (int) ( $row['return_views'] ?? 0 ),
			'completions'       => (int) ( $row['completions'] ?? 0 ),
			'returnCompletions' => (int) ( $row['return_completions'] ?? 0 ),
		);
	}

	/**
	 * Page views of the extended level per device class, and how many of them sent the form.
	 *
	 * @param int    $form_id Form ID.
	 * @param string $from    Start (UTC, inclusive).
	 * @param string $to      End (UTC, exclusive).
	 * @return array<string,array{views: int, completions: int}> By mobile, tablet or desktop.
	 */
	public function device_views( int $form_id, string $from, string $to ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT d.step, COUNT(DISTINCT d.session_hash) AS views, COUNT(DISTINCT done.session_hash) AS completions FROM %i d LEFT JOIN (SELECT DISTINCT session_hash FROM %i WHERE form_id = %d AND event = 'complete' AND created_at >= %s) done ON done.session_hash = d.session_hash WHERE d.form_id = %d AND d.event = 'device' AND d.created_at >= %s AND d.created_at < %s GROUP BY d.step",
				$table,
				$table,
				$form_id,
				$from,
				$form_id,
				$from,
				$to
			),
			ARRAY_A
		);
		$out   = array();
		foreach ( $rows as $row ) {
			$out[ (string) $row['step'] ] = array(
				'views'       => (int) $row['views'],
				'completions' => (int) $row['completions'],
			);
		}
		return $out;
	}

	/**
	 * Per variant of an A/B test: sessions shown it that viewed, started and sent the form. A
	 * session's variant is its "variant" event (step: experiment id, variant: variant id).
	 *
	 * @param int    $form_id    Form ID.
	 * @param string $experiment Experiment id.
	 * @param string $from       Start (UTC, inclusive).
	 * @param string $to         End (UTC, exclusive).
	 * @return array<string,array{view: int, start: int, complete: int}>
	 */
	public function variants( int $form_id, string $experiment, string $from, string $to ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT v.variant, e.event, COUNT(DISTINCT e.session_hash) AS n FROM %i v JOIN %i e ON e.form_id = v.form_id AND e.session_hash = v.session_hash WHERE v.form_id = %d AND v.event = 'variant' AND v.step = %s AND v.created_at >= %s AND v.created_at < %s AND e.event IN ('view', 'start', 'complete') GROUP BY v.variant, e.event",
				$table,
				$table,
				$form_id,
				$experiment,
				$from,
				$to
			),
			ARRAY_A
		);
		$out   = array();
		foreach ( $rows as $row ) {
			$out[ (string) $row['variant'] ]                  = $out[ (string) $row['variant'] ] ?? array(
				'view'     => 0,
				'start'    => 0,
				'complete' => 0,
			);
			$out[ (string) $row['variant'] ][ $row['event'] ] = (int) $row['n'];
		}
		return $out;
	}

	/**
	 * Per day (of the site) and variant of an A/B test: sessions shown it that viewed and sent the
	 * form, by the day the variant was drawn.
	 *
	 * @param int    $form_id    Form ID.
	 * @param string $experiment Experiment id.
	 * @param string $from       Start (UTC, inclusive).
	 * @param string $to         End (UTC, exclusive).
	 * @param int    $offset     Seconds to add for the site's days.
	 * @return list<array{day: string, variant: string, event: string, n: int}>
	 */
	public function variant_daily( int $form_id, string $experiment, string $from, string $to, int $offset ): array {
		global $wpdb;
		$table = Schema::table( 'events' );
		$rows  = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT DATE(DATE_ADD(v.created_at, INTERVAL %d SECOND)) AS day, v.variant, e.event, COUNT(DISTINCT e.session_hash) AS n FROM %i v JOIN %i e ON e.form_id = v.form_id AND e.session_hash = v.session_hash WHERE v.form_id = %d AND v.event = 'variant' AND v.step = %s AND v.created_at >= %s AND v.created_at < %s AND e.event IN ('view', 'complete') GROUP BY day, v.variant, e.event ORDER BY day ASC",
				$offset,
				$table,
				$table,
				$form_id,
				$experiment,
				$from,
				$to
			),
			ARRAY_A
		);
		return array_map(
			static fn( array $row ): array => array(
				'day'     => (string) $row['day'],
				'variant' => (string) $row['variant'],
				'event'   => (string) $row['event'],
				'n'       => (int) $row['n'],
			),
			$rows
		);
	}

	/**
	 * Deletes events created before a time.
	 *
	 * @param string $before Time (UTC).
	 * @param int    $limit  Rows per call.
	 * @return int Deleted rows.
	 */
	public function delete_before( string $before, int $limit ): int {
		global $wpdb;
		return (int) $wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE created_at < %s LIMIT %d', Schema::table( 'events' ), $before, $limit ) );
	}
}
