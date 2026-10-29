<?php
/**
 * The document of a new form.
 *
 * @package Funnelforms
 */

declare(strict_types=1);

namespace Funnelforms\Domain\Form;

defined( 'ABSPATH' ) || exit;

/**
 * A new form starts with a contact step (name and e-mail address), an end with a thank-you text
 * and the mail to the site owner ({{lead}} and {{answers}}, to the site's address): the smallest
 * form that can be published, stores entries and tells the owner of each. The texts come in the
 * language of the site.
 */
final class BlankDocument {

	/**
	 * The document.
	 *
	 * @param string               $id     Document ID (frm_<form ID>).
	 * @param string               $title  Title.
	 * @param string               $locale Language of the texts, e.g. de_DE.
	 * @param array<string,string> $texts  contact, name, email, send, thanks; subject and intro of
	 *                                     the owner's mail.
	 * @param string               $owner  Address of the owner's mail; without one there is no mail.
	 * @return array<string,mixed>
	 */
	public static function create( string $id, string $title, string $locale, array $texts, string $owner = '' ): array {
		$t    = static fn( string $key ): array => array( $locale => (string) ( $texts[ $key ] ?? '' ) );
		$none = array( $locale => '' );
		$mail = array(
			'id'     => 'a_owner',
			'on'     => 'submit',
			'kind'   => 'email',
			'config' => array(
				'to'        => array( $locale => $owner ),
				'cc'        => $none,
				'bcc'       => $none,
				'from'      => $none,
				'fromName'  => $none,
				'replyTo'   => array( $locale => '{{field:email}}' ),
				'subject'   => $t( 'subject' ),
				'body'      => array( $locale => trim( ( $texts['intro'] ?? '' ) . "\n\n{{lead}}\n\n{{answers}}" ) ),
				'nl2br'     => true,
				'transport' => array( 'type' => 'wp_mail' ),
				'layout'    => 'branded',
			),
		);
		return array(
			'schemaVersion' => 1,
			'id'            => $id,
			'title'         => $title,
			'locales'       => array(
				'default'   => $locale,
				'available' => array( $locale ),
			),
			'start'         => 'contact',
			'nodes'         => array(
				array(
					'id'            => 'contact',
					'type'          => 'contact',
					'title'         => $t( 'contact' ),
					'description'   => array( $locale => '' ),
					'submitLabel'   => $t( 'send' ),
					'fields'        => array(
						array(
							'id'       => 'c_name',
							'type'     => 'name',
							'key'      => 'name',
							'label'    => $t( 'name' ),
							'required' => true,
							'props'    => array( 'placeholder' => array( $locale => '' ) ),
						),
						array(
							'id'       => 'c_email',
							'type'     => 'email',
							'key'      => 'email',
							'label'    => $t( 'email' ),
							'required' => true,
							'props'    => array(
								'b2bOnly'     => false,
								'placeholder' => array( $locale => '' ),
							),
						),
					),
					'showBottomBar' => true,
				),
				array(
					'id'       => 'end',
					'type'     => 'end',
					'success'  => array(
						'show' => true,
						'text' => $t( 'thanks' ),
					),
					'redirect' => null,
				),
			),
			'edges'         => array(
				array(
					'id'      => 'e_contact_end',
					'from'    => 'contact',
					'to'      => 'end',
					'default' => true,
				),
			),
			'calculations'  => array(),
			'actions'       => '' === $owner ? array() : array( $mail ),
			'style'         => array(
				'preset' => 'default',
				'tokens' => new \stdClass(),
			),
			'settings'      => array(
				'uiLocale'           => '',
				'progressBar'        => array( 'show' => true ),
				'loadingAnimation'   => false,
				'scrollToTop'        => array(
					'desktop' => false,
					'mobile'  => true,
				),
				'rtl'                => false,
				'autoHeight'         => true,
				'iconFont'           => false,
				'savePartialEntries' => false,
			),
			'layout'        => array(
				'nodes' => array(
					'contact' => array(
						'x' => 0,
						'y' => 0,
					),
					'end'     => array(
						'x' => 320,
						'y' => 0,
					),
				),
			),
		);
	}
}
