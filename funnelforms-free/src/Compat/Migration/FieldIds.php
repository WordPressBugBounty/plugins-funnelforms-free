<?php
/**
 * Deterministic IDs for migrated objects.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Migration;

defined( 'ABSPATH' ) || exit;

/**
 * IDs in migrated documents are derived from the 3.x IDs, so a second migration run produces the
 * same document and migrated leads can be linked to fields without a lookup table.
 */
final class FieldIds {

	/**
	 * Field id of a 3.x question (af2_frage post ID).
	 *
	 * @param int $question_post_id Post ID.
	 */
	public static function question( int $question_post_id ): string {
		return 'q' . $question_post_id;
	}

	/**
	 * Field id of a contact form field; 3.x uses free text IDs such as "name" or "email".
	 *
	 * @param string $legacy_id 3.x field id.
	 */
	public static function contact( string $legacy_id ): string {
		$clean = strtolower( (string) preg_replace( '/[^A-Za-z0-9_-]+/', '_', $legacy_id ) );
		$clean = trim( $clean, '_' );
		return 'c_' . ( '' !== $clean ? $clean : substr( md5( $legacy_id ), 0, 8 ) );
	}

	/**
	 * Option id of a 3.x answer (answers are addressed by their position in 3.x).
	 *
	 * @param string $field_id Field id.
	 * @param int    $index    Answer index.
	 */
	public static function option( string $field_id, int $index ): string {
		return $field_id . '_o' . $index;
	}

	/**
	 * Node id of a 3.x graph element (section/content position).
	 *
	 * @param int $section Section index.
	 * @param int $content Content index.
	 */
	public static function node( int $section, int $content ): string {
		return 'n' . $section . '_' . $content;
	}
}
