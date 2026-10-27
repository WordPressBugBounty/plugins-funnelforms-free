<?php
/**
 * Read access to the 3.x data in wp_posts, wp_postmeta and wp_options.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Legacy;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- reads plugin data in batches; caching would only waste memory.

/**
 * Read only. Queries go straight to $wpdb with keyset pagination: WP_Query would load and cache
 * every post object, and 3.x sites can hold 10^5 leads.
 */
class LegacyRepository {

	public const FORM         = 'af2_formular';
	public const QUESTION     = 'af2_frage';
	public const CONTACT_FORM = 'af2_kontaktformular';
	public const CALCULATION  = 'af2_calculations';
	public const LEAD         = 'af2_request';
	public const BOOKING      = 'af2_terminbuchung';
	public const BOOKING_TYPE = 'af2_terminevent';
	public const ALL_TYPES    = array( self::FORM, self::QUESTION, self::CONTACT_FORM, self::CALCULATION, self::LEAD, self::BOOKING, self::BOOKING_TYPE );

	/**
	 * Decoded posts of this request.
	 *
	 * @var array<int,array{type:string,content:?array}|null>
	 */
	private array $cache = array();

	/**
	 * Posts of one type after a given ID, in ID order. Auto-drafts and revisions are not 3.x data.
	 *
	 * @param string $type     Post type.
	 * @param int    $after_id Cursor.
	 * @param int    $limit    Batch size.
	 * @return array<int,array<string,mixed>>
	 */
	public function posts_after( string $type, int $after_id, int $limit ): array {
		global $wpdb;
		return (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT ID, post_type, post_status, post_date, post_date_gmt, post_modified_gmt, post_content FROM {$wpdb->posts} WHERE post_type = %s AND ID > %d AND post_status NOT IN ('auto-draft', 'inherit') ORDER BY ID ASC LIMIT %d",
				$type,
				$after_id,
				$limit
			),
			ARRAY_A
		);
	}

	/**
	 * IDs of posts of one type changed at or after a GMT time.
	 *
	 * @param string $type  Post type.
	 * @param string $since GMT datetime.
	 * @return int[]
	 */
	public function ids_modified_since( string $type, string $since ): array {
		global $wpdb;
		return array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_modified_gmt >= %s AND post_status NOT IN ('auto-draft', 'inherit')",
					$type,
					$since
				)
			)
		);
	}

	/**
	 * All IDs of one type (for detecting posts deleted in 3.x).
	 *
	 * @param string $type Post type.
	 * @return array<int,true>
	 */
	public function all_ids( string $type ): array {
		global $wpdb;
		$ids = (array) $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s", $type ) );
		return array_fill_keys( array_map( 'intval', $ids ), true );
	}

	/**
	 * One raw post row.
	 *
	 * @param int $id Post ID.
	 * @return array<string,mixed>|null
	 */
	public function row( int $id ): ?array {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT ID, post_type, post_status, post_date, post_date_gmt, post_modified_gmt, post_content FROM {$wpdb->posts} WHERE ID = %d", $id ), ARRAY_A );
		return is_array( $row ) ? $row : null;
	}

	/**
	 * Loader for FormConverter and FormVerifier: type and decoded content of a 3.x post.
	 *
	 * @param int $id Post ID.
	 * @return array{type:string,content:?array,raw:string}|null
	 */
	public function load( int $id ): ?array {
		if ( ! array_key_exists( $id, $this->cache ) ) {
			$row                = $this->row( $id );
			$this->cache[ $id ] = null === $row || ! in_array( $row['post_type'], self::ALL_TYPES, true ) ? null : array(
				'type'    => (string) $row['post_type'],
				'content' => ( new LegacyCodec() )->decode( (string) $row['post_content'] ),
				'raw'     => (string) $row['post_content'],
			);
		}
		return $this->cache[ $id ];
	}

	/**
	 * Forgets decoded posts (between batches).
	 */
	public function flush(): void {
		$this->cache = array();
	}

	/**
	 * Number of posts per type and status.
	 *
	 * @return array<string,array<string,int>>
	 */
	public function counts(): array {
		global $wpdb;
		$rows = (array) $wpdb->get_results(
			$wpdb->prepare(
				"SELECT post_type, post_status, COUNT(*) AS n FROM {$wpdb->posts} WHERE post_type IN (" . implode( ', ', array_fill( 0, count( self::ALL_TYPES ), '%s' ) ) . ") AND post_status NOT IN ('auto-draft', 'inherit') GROUP BY post_type, post_status",
				self::ALL_TYPES
			),
			ARRAY_A
		);
		$out  = array();
		foreach ( $rows as $row ) {
			$out[ $row['post_type'] ][ $row['post_status'] ] = (int) $row['n'];
		}
		return $out;
	}

	/**
	 * Whether the site has any 3.x data worth migrating.
	 */
	public function has_data(): bool {
		global $wpdb;
		return null !== $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type IN (%s, %s) LIMIT 1", self::FORM, self::LEAD ) );
	}
}
