<?php
/**
 * CSV export of entries.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Admin;

use Funnelforms\Application\Capabilities;
use Funnelforms\Application\LeadStages;
use Funnelforms\Compat\Migration\MigrationStore;
use Funnelforms\Infrastructure\Crypto\SecretBox;
use Funnelforms\Infrastructure\Repository\EntryRepository;
use Funnelforms\Infrastructure\Repository\FormRepository;
use Funnelforms\Domain\Entry\Money;
use Funnelforms\Domain\Entry\VisitAnalytics;
use Funnelforms\Edition\Edition;

defined( 'ABSPATH' ) || exit;

/**
 * Download by admin-post.php?action=funnelforms_export_entries&_wpnonce=…[&form=…][&status=…][&format=excel]
 * downloads the entries as CSV: one row per entry, one column per answer and contact label, the
 * UTM values and the page. format=excel writes a byte order mark and semicolons, which Excel opens
 * directly in German settings. Cells that start like a formula are prefixed with an apostrophe.
 *
 * Needs the export capability (filter funnelforms_export_capability, default the entries
 * capability). Every export is written to the audit log, without its content.
 */
final class EntriesExport {

	public const ACTION = 'funnelforms_export_entries';
	private const BATCH = 200;

	/**
	 * Registers the handler.
	 */
	public static function register(): void {
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'handle' ) );
	}

	/**
	 * Capability needed to export entries.
	 */
	public static function capability(): string {
		/**
		 * Capability needed to export entries.
		 *
		 * @param string $capability Capability; funnelforms_export_entries by default.
		 */
		return (string) apply_filters( 'funnelforms_export_capability', Capabilities::EXPORT_ENTRIES );
	}

	/**
	 * Download link for the admin app: a plain URL, not escaped for HTML like wp_nonce_url(), whose
	 * "&amp;" turned the nonce into a parameter "amp;_wpnonce" and the download into an error.
	 *
	 * @param array<string,string|int> $args Filters form, status, leadStatus, tag, assignedTo, minScore, archived (1 or 0; both when left out) and format.
	 */
	public static function url( array $args = array() ): string {
		return add_query_arg( array( 'action' => self::ACTION ) + $args + array( '_wpnonce' => wp_create_nonce( self::ACTION ) ), admin_url( 'admin-post.php' ) );
	}

	/**
	 * Handles the download.
	 */
	public static function handle(): void {
		if ( ! current_user_can( self::capability() ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'funnelforms-free' ), 403 );
		}
		check_admin_referer( self::ACTION );
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- checked above.
		$filter = array();
		if ( isset( $_GET['form'] ) ) {
			$filter['form_id'] = absint( $_GET['form'] );
		}
		$status = isset( $_GET['status'] ) ? sanitize_key( $_GET['status'] ) : '';
		if ( in_array( $status, array( 'complete', 'partial', 'abandoned' ), true ) ) {
			// Without it, as in the list: no spam and no visitors who left after giving their address.
			$filter['status'] = $status;
		}
		$lead = isset( $_GET['leadStatus'] ) ? sanitize_key( $_GET['leadStatus'] ) : '';
		if ( LeadStages::exists( $lead ) ) {
			$filter['lead_status'] = $lead;
		}
		if ( isset( $_GET['tag'] ) ) {
			$filter['tag'] = sanitize_text_field( wp_unslash( $_GET['tag'] ) );
		}
		if ( isset( $_GET['archived'] ) ) {
			$filter['archived'] = '1' === $_GET['archived'];
		}
		if ( isset( $_GET['assignedTo'] ) ) {
			$filter['assigned_to'] = absint( $_GET['assignedTo'] );
		}
		$device = isset( $_GET['device'] ) ? sanitize_key( wp_unslash( $_GET['device'] ) ) : '';
		if ( in_array( $device, VisitAnalytics::DEVICES, true ) ) {
			$filter['device'] = $device;
		}
		$payment = isset( $_GET['payment'] ) ? sanitize_key( wp_unslash( $_GET['payment'] ) ) : '';
		if ( in_array( $payment, EntryRepository::PAYMENT_STATUSES, true ) ) {
			$filter['payment'] = $payment;
		}
		if ( isset( $_GET['minScore'] ) && is_numeric( $_GET['minScore'] ) ) {
			$filter['min_score'] = (float) $_GET['minScore'];
		}
		// The Excel variant is Funnelforms Pro; Free writes the plain CSV.
		$excel = isset( $_GET['format'] ) && 'excel' === $_GET['format'] && ! Edition::is_free();
		// phpcs:enable

		$table = self::table( $filter );
		( new MigrationStore( SecretBox::for_site() ) )->audit(
			'entries_exported',
			'form',
			(string) ( $filter['form_id'] ?? '' ),
			array(
				'user'  => get_current_user_id(),
				'count' => count( $table ) - 1,
			)
		);
		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="funnelforms-entries-' . gmdate( 'Y-m-d' ) . '.csv"' );
		echo self::csv( $table, $excel ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- CSV download.
		exit;
	}

	/**
	 * Header row and one row per entry, newest first.
	 *
	 * @param array<string,mixed> $filter Filters of EntryRepository::search().
	 * @return array<int,array<int,string>>
	 */
	public static function table( array $filter ): array {
		$entries = new EntryRepository();
		$forms   = new FormRepository();
		$fixed   = array(
			__( 'ID', 'funnelforms-free' ),
			__( 'Form', 'funnelforms-free' ),
			__( 'Date', 'funnelforms-free' ),
			__( 'Status', 'funnelforms-free' ),
		);
		// Lead status, tags and assignment are the lead CRM of Funnelforms Pro.
		$crm = ! Edition::is_free();
		if ( $crm ) {
			array_push( $fixed, __( 'Lead status', 'funnelforms-free' ), __( 'Tags', 'funnelforms-free' ), __( 'Assigned to', 'funnelforms-free' ) );
		}
		$records = array();
		$labels  = array();
		$scores  = false;
		$worth   = false;
		$consent = self::consent_words();
		$page    = 1;
		do {
			$result = $entries->search( $filter, $page, self::BATCH );
			foreach ( $result['rows'] as $entry ) {
				$form = null === $entry['form_id'] ? null : $forms->by_id( (int) $entry['form_id'] );
				// Consent of 5.0 forms as yes or no; migrated 3.x forms keep "true" and "false".
				$words  = null !== $form && null === $form['legacy_post_id'] ? $consent : array();
				$values = array();
				foreach ( array( 'contact', 'answers' ) as $part ) {
					foreach ( (array) ( $entry['data'][ $part ] ?? array() ) as $item ) {
						$label = is_array( $item ) ? trim( (string) ( $item['label'] ?? '' ) ) : '';
						if ( '' === $label ) {
							continue;
						}
						$value            = $item['display'] ?? $item['value'] ?? '';
						$labels[ $label ] = true;
						$values[ $label ] = 'consent' === ( $item['type'] ?? '' ) && is_string( $value ) && isset( $words[ $value ] ) ? $words[ $value ] : self::cell( $value );
					}
				}
				foreach ( (array) ( $entry['utm'] ?? array() ) as $key => $value ) {
					$labels[ (string) $key ] = true;
					$values[ (string) $key ] = self::cell( $value );
				}
				// The variants of A/B tests the visitor was shown, one column per test.
				foreach ( (array) ( $entry['meta']['v5']['variants'] ?? array() ) as $experiment => $variant ) {
					/* translators: %s: id of an A/B test */
					$label            = sprintf( __( 'A/B test %s', 'funnelforms-free' ), $experiment );
					$labels[ $label ] = true;
					$values[ $label ] = self::cell( $variant );
				}
				// Entries of forms that take a payment: its status and the amount.
				if ( is_array( $entry['meta']['payment'] ?? null ) ) {
					$payment = $entry['meta']['payment'];
					// Labels and values apart: the Free build renames the text domain, which would undo any alignment.
					$columns = array_combine(
						array( __( 'Payment', 'funnelforms-free' ), __( 'Amount', 'funnelforms-free' ) ),
						array( Money::status_label( (string) $payment['status'] ), Money::format( (float) $payment['amount'], (string) $payment['currency'] ) )
					);
					foreach ( $columns as $label => $value ) {
						$labels[ $label ] = true;
						$values[ $label ] = self::cell( $value );
					}
				}
				// How the visitor filled in the form (entries of 5.0).
				if ( is_array( $entry['meta']['visit'] ?? null ) ) {
					$visit   = $entry['meta']['visit'];
					$columns = array_combine(
						array( __( 'Device', 'funnelforms-free' ), __( 'Browser', 'funnelforms-free' ), __( 'Time to fill in (s)', 'funnelforms-free' ), __( 'Came from', 'funnelforms-free' ) ),
						array(
							VisitAnalytics::device_label( (string) ( $visit['device'] ?? '' ) ),
							trim( ( $visit['browser'] ?? '' ) . ' / ' . ( $visit['os'] ?? '' ), ' /' ),
							isset( $visit['seconds'] ) ? (string) (int) $visit['seconds'] : '',
							(string) ( $visit['referrer'] ?? '' ),
						)
					);
					foreach ( $columns as $label => $value ) {
						$labels[ $label ] = true;
						$values[ $label ] = self::cell( $value );
					}
				}
				$scores = $scores || isset( $entry['score'] );
				$worth  = $worth || isset( $entry['lead_value'] );
				$row    = array(
					(string) $entry['id'],
					null === $form ? '' : (string) $form['title'],
					get_date_from_gmt( (string) $entry['created_at'], 'Y-m-d H:i' ),
					(string) $entry['status'],
				);
				if ( $crm ) {
					array_push( $row, LeadStages::name( (string) $entry['lead_status'] ), implode( ', ', EntryRepository::entry_tags( $entry ) ), self::user_name( $entry['assigned_to'] ?? null ) );
				}
				$records[] = array(
					$row,
					$values,
					(string) ( $entry['source_url'] ?? '' ),
					isset( $entry['score'] ) ? (string) (float) $entry['score'] : '',
					isset( $entry['lead_value'] ) ? (string) (float) $entry['lead_value'] : '',
				);
			}
			++$page;
			$more = count( $result['rows'] ) === self::BATCH;
		} while ( $more );

		$labels = array_keys( $labels );
		// Forms with a score calculation (lead scoring, quizzes) add the score after the fixed columns,
		// forms with a lead value calculation the lead value.
		$table = array( array_merge( $fixed, $scores ? array( __( 'Score', 'funnelforms-free' ) ) : array(), $worth ? array( __( 'Lead value', 'funnelforms-free' ) ) : array(), $labels, array( __( 'Page', 'funnelforms-free' ) ) ) );
		foreach ( $records as list( $columns, $values, $url, $score, $value ) ) {
			$row = array_merge( $columns, $scores ? array( $score ) : array(), $worth ? array( $value ) : array() );
			foreach ( $labels as $label ) {
				$row[] = $values[ $label ] ?? '';
			}
			$row[]   = $url;
			$table[] = $row;
		}
		return $table;
	}

	/**
	 * Consent as yes or no in the language of the site, like boxes to tick, whose answer is saved
	 * in it when the visitor sends the form.
	 *
	 * @return array<string,string> Text by stored value ("true", "false").
	 */
	private static function consent_words(): array {
		$switched = switch_to_locale( get_locale() );
		$words    = array(
			'true'  => __( 'Yes', 'funnelforms-free' ),
			'false' => __( 'No', 'funnelforms-free' ),
		);
		if ( $switched ) {
			restore_previous_locale();
		}
		return $words;
	}

	/**
	 * Display name of a user, '' for none.
	 *
	 * @param mixed $id User ID or null.
	 */
	private static function user_name( $id ): string {
		$user = (int) $id > 0 ? get_userdata( (int) $id ) : false;
		return false === $user ? '' : (string) $user->display_name;
	}

	/**
	 * The table as CSV.
	 *
	 * @param array<int,array<int,string>> $table Rows.
	 * @param bool                         $excel Byte order mark and semicolons for Excel.
	 */
	public static function csv( array $table, bool $excel ): string {
		$out = fopen( 'php://temp', 'r+' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen -- in-memory buffer.
		foreach ( $table as $row ) {
			fputcsv( $out, array_map( array( self::class, 'safe' ), $row ), $excel ? ';' : ',', '"', '' );
		}
		rewind( $out );
		$csv = (string) stream_get_contents( $out );
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- in-memory buffer.
		return ( $excel ? "\xEF\xBB\xBF" : '' ) . $csv;
	}

	/**
	 * A value as text: lists joined with commas.
	 *
	 * @param mixed $value Value.
	 */
	private static function cell( $value ): string {
		if ( is_array( $value ) ) {
			return implode( ', ', array_map( array( self::class, 'cell' ), $value ) );
		}
		if ( is_bool( $value ) ) {
			return $value ? '1' : '0';
		}
		return is_scalar( $value ) ? (string) $value : '';
	}

	/**
	 * Keeps spreadsheets from running a cell as a formula.
	 *
	 * @param string $cell Cell.
	 */
	private static function safe( string $cell ): string {
		return '' !== $cell && in_array( $cell[0], array( '=', '+', '-', '@', "\t", "\r" ), true ) ? "'" . $cell : $cell;
	}
}
