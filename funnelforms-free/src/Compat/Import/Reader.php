<?php
/**
 * Reads the forms of another form plugin.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import;

defined( 'ABSPATH' ) || exit;

/**
 * One reader per plugin: from its export file, and from its data on this site (also when the
 * plugin is no longer active, as long as its data is there).
 */
interface Reader {

	/**
	 * Key, e.g. wpforms.
	 */
	public function key(): string;

	/**
	 * Name of the plugin.
	 */
	public function label(): string;

	/**
	 * Whether a file is an export of this plugin.
	 *
	 * @param string $contents File contents.
	 */
	public function recognizes( string $contents ): bool;

	/**
	 * Forms in an export file.
	 *
	 * @param string $contents File contents.
	 * @return ImportedForm[]
	 */
	public function parse_file( string $contents ): array;

	/**
	 * Forms of the plugin on this site: id, title.
	 *
	 * @return array<int,array{id:string,title:string}>
	 */
	public function list_site(): array;

	/**
	 * One form of the plugin on this site.
	 *
	 * @param string $id Id from list_site().
	 */
	public function read_site( string $id ): ?ImportedForm;
}
