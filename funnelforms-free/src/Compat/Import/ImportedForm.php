<?php
/**
 * A form read from another form plugin, before it becomes a Funnelforms document.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Compat\Import;

defined( 'ABSPATH' ) || exit;

/**
 * The common shape every reader produces. DocumentBuilder turns it into a form document.
 *
 * Fields: arrays with
 * - id: the field's id in the other plugin (string, unique in the form);
 * - type: one of FIELD_TYPES;
 * - label, placeholder, description, default: text;
 * - required: bool;
 * - options: list of {label, value} for select, radio and checkboxes;
 * - multiple: bool, for select;
 * - min, max, step: numbers, for number, slider and rating;
 * - html: text, for html;
 * - conditional: true when the other plugin showed or hid the field by conditions.
 *
 * Templates (notification and confirmation texts) mark field values as {{src:<id>}}, all answers as
 * {{answers}}, the site's admin address, name and address as {{admin_email}}, {{site_title}} and
 * {{site_url}}; other builder tokens ({{page:url}}, {{entry:id}}, …) pass through. The builder
 * replaces {{src:...}} by the field token of the new form and fills in the site's values.
 */
final class ImportedForm {

	/**
	 * Field types readers may use.
	 */
	public const FIELD_TYPES = array(
		'name',
		'first_name',
		'last_name',
		'email',
		'phone',
		'text',
		'textarea',
		'number',
		'url',
		'date',
		'time',
		'select',
		'radio',
		'checkbox',
		'consent',
		'html',
		'file',
		'address',
		'rating',
		'slider',
		'hidden',
		'captcha',
		'page_break',
	);

	/**
	 * Form.
	 *
	 * @param string                          $source        Reader key, e.g. wpforms.
	 * @param string                          $source_id     Id of the form in the other plugin.
	 * @param string                          $title         Title.
	 * @param array<int,array<string,mixed>>  $fields        Fields in order (see class doc).
	 * @param array<int,array<string,string>> $notifications E-mails: to, subject, body, from, from_name, reply_to, cc, bcc.
	 * @param array<string,string>|null       $confirmation  What follows the submit: type (message or redirect), message, url.
	 * @param string                          $submit_label  Text of the submit button.
	 * @param string[]                        $notes         What could not be taken over, as codes with details.
	 */
	public function __construct(
		public string $source,
		public string $source_id,
		public string $title,
		public array $fields,
		public array $notifications = array(),
		public ?array $confirmation = null,
		public string $submit_label = '',
		public array $notes = array()
	) {}
}
