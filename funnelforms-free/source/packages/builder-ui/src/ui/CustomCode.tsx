/**
 * Custom JavaScript of a contact step (node.tracking): when the step appears, and after sending,
 * as the thank-you page appears or before the redirect, the place for a conversion pixel. In Free
 * and Pro. The plugin sends the code to visitors only when the site allows it (TrackingCode), the
 * runtime runs it once per visit and only with consent to marketing, and saving changed code
 * needs the right to use unfiltered HTML (SensitiveChanges).
 */
import React from 'react';
import type { FormDocument, FormNode } from '@funnelforms/form-schema';
import { findNode } from '../document';
import { codeSetting } from '../code';
import { euPrivacy } from '../privacy';
import { rightName } from './catalog';
import { useEnv } from './context';
import { __ } from './i18n';
import { Field, Notice, Section } from './ui';

type ContactNode = Extract<FormNode, { type: 'contact' }>;
type Moment = 'onShow' | 'afterSubmit';

export function ContactCode( { node }: { node: ContactNode } ) {
	const { store, rights, readOnly } = useEnv();
	const change = store.getState().change;
	const setting = codeSetting();
	const edit = ( moment: Moment ) => ( value: string ) =>
		change( ( d ) => {
			const n = findNode( d, node.id );
			if ( ! n || 'contact' !== n.type ) {
				return;
			}
			const tracking = Object.fromEntries( Object.entries( { ...n.tracking, [ moment ]: value } ).filter( ( [ , v ] ) => Boolean( v ) ) );
			if ( Object.keys( tracking ).length ) {
				n.tracking = tracking;
			} else {
				delete n.tracking;
			}
		}, `${ node.id }:tracking.${ moment }` );
	const code = ( moment: Moment, label: string, hint: string ) => (
		<Field label={ label } hint={ hint }>
			{ ( id ) => (
				<textarea
					id={ id }
					className="ffxb-input ffxb-input--code"
					rows={ 4 }
					spellCheck={ false }
					placeholder={ "gtag('event', 'conversion');" }
					value={ node.tracking?.[ moment ] ?? '' }
					disabled={ readOnly || ! rights.code }
					onChange={ ( e ) => edit( moment )( e.target.value ) }
				/>
			) }
		</Field>
	);
	return (
		<Section title={ __( 'Custom code', 'funnelforms-pro' ) }>
			<p className="ffxb-hint">
				{ __( 'JavaScript or HTML such as a conversion pixel. It runs once per visit in the visitor\'s browser.', 'funnelforms-pro' ) }{ ' ' }
				{ euPrivacy()
					? __( 'In the EU privacy mode only after the visitor allowed marketing in your cookie banner.', 'funnelforms-pro' )
					: __( 'Not when the visitor refused marketing.', 'funnelforms-pro' ) }
			</p>
			{ setting.allowed ? null : (
				<Notice
					tone="warning"
					action={
						setting.settingsUrl ? (
							<a className="ffxb-button ffxb-button--secondary ffxb-button--sm" href={ setting.settingsUrl }>
								{ __( 'Allow in the settings', 'funnelforms-pro' ) }
							</a>
						) : null
					}
				>
					{ setting.settingsUrl
						? __( 'This site does not run custom code yet.', 'funnelforms-pro' )
						: __( 'This site does not run custom code yet. An administrator can allow it under Funnelforms → Settings.', 'funnelforms-pro' ) }
				</Notice>
			) }
			{ rights.code ? null : <Notice>{ rightName( 'unfiltered_html' ) }</Notice> }
			{ code( 'onShow', __( 'When the step appears', 'funnelforms-pro' ), __( 'For example to count visitors who reached the contact step.', 'funnelforms-pro' ) ) }
			{ code( 'afterSubmit', __( 'After sending (thank-you page)', 'funnelforms-pro' ), __( 'Runs as the thank-you page appears, or before the redirect. The place for a conversion.', 'funnelforms-pro' ) ) }
		</Section>
	);
}

/** On a thank-you page: where its code goes, with a way to the contact steps that lead here. */
export function EndCode( { doc, node }: { doc: FormDocument; node: Extract<FormNode, { type: 'end' }> } ) {
	const select = useEnv().store.getState().select;
	const from = doc.edges.filter( ( e ) => e.to === node.id ).map( ( e ) => findNode( doc, e.from ) );
	const contact = from.find( ( n ): n is ContactNode => 'contact' === n?.type );
	if ( ! contact ) {
		return null;
	}
	const has = Boolean( contact.tracking?.afterSubmit?.trim() );
	return (
		<p className="ffxb-hint">
			{ has ? __( 'Custom code runs on this thank-you page; it is set on the contact step.', 'funnelforms-pro' ) : __( 'Code for this thank-you page, such as a conversion pixel, is set on the contact step.', 'funnelforms-pro' ) }{ ' ' }
			<button type="button" className="ffxb-link" onClick={ () => select( { node: contact.id }, 'content' ) }>
				{ __( 'Custom code', 'funnelforms-pro' ) }
			</button>
		</p>
	);
}
