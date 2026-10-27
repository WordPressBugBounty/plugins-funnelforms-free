/**
 * "Insert an earlier answer": puts {{field:<key>}} into a question, which the form fills in with
 * the visitor's answer ("Hello {{field:name}}").
 */
import React from 'react';
import { text } from '../document';
import { useBuilder, useEnv } from './context';
import { __ } from './i18n';
import { Select } from './ui';

export function AnswerInsert( { fieldId, onInsert }: { fieldId: string; onInsert: ( token: string ) => void } ) {
	const doc = useBuilder( ( s ) => s.doc );
	const { ctx, readOnly } = useEnv();
	if ( ! doc || readOnly ) {
		return null;
	}
	const seen = new Set<string>();
	const options: Array<{ value: string; label: string }> = [];
	for ( const node of doc.nodes ) {
		for ( const field of 'fields' in node ? node.fields : [] ) {
			if ( field.id === fieldId || seen.has( field.key ) || [ 'content', 'result', 'html', 'consent', 'captcha', 'file', 'signature' ].includes( field.type ) ) {
				continue;
			}
			seen.add( field.key );
			const label = text( field.label, ctx.locale ).replace( /<[^>]*>/g, '' ).trim();
			options.push( { value: field.key, label: label ? `${ label } (${ field.key })` : field.key } );
		}
	}
	if ( ! options.length ) {
		return null;
	}
	return (
		<Select
			label={ __( 'Insert an earlier answer', 'funnelforms-pro' ) }
			value=""
			options={ [ { value: '', label: __( 'Choose a field', 'funnelforms-pro' ) }, ...options ] }
			onChange={ ( key ) => key && onInsert( `{{field:${ key }}}` ) }
		/>
	);
}
