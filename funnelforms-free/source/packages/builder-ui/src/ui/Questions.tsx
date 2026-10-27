/**
 * All questions of the form in one list, with a search, a filter by type and "required only".
 * A click selects the question and brings its step into view on the canvas.
 */
import React, { useState } from 'react';
import type { ContactField, Field } from '@funnelforms/form-schema';
import { reachable } from '../document';
import { contactFieldName, stepFieldName } from './catalog';
import { useBuilder, useEnv } from './context';
import { fieldTitle } from './describe';
import { __, sprintf } from './i18n';
import { Select, Toggle } from './ui';

/** Event the canvas listens to, with the id of the node to show. */
export const REVEAL_EVENT = 'ffxb:reveal';

interface Row {
	node: string;
	field: string;
	title: string;
	type: string;
	typeName: string;
	key: string;
	required: boolean;
	reachable: boolean;
}

export function QuestionList() {
	const doc = useBuilder( ( s ) => s.doc );
	const selection = useBuilder( ( s ) => s.selection );
	const { store, ctx } = useEnv();
	const [ query, setQuery ] = useState( '' );
	const [ type, setType ] = useState( '' );
	const [ required, setRequired ] = useState( false );
	if ( ! doc ) {
		return null;
	}
	const reached = reachable( doc );
	const rows: Row[] = [];
	for ( const node of doc.nodes ) {
		if ( 'end' === node.type ) {
			continue;
		}
		for ( const field of node.fields as Array<Field | ContactField> ) {
			const contact = 'contact' === node.type;
			rows.push( {
				node: node.id,
				field: field.id,
				title: fieldTitle( field as Field, ctx.locale ),
				type: ( contact ? 'contact:' : '' ) + field.type,
				typeName: contact ? contactFieldName( field.type ) : stepFieldName( field.type ),
				key: field.key,
				required: field.required,
				reachable: reached.has( node.id ),
			} );
		}
	}
	const types = [ ...new Map( rows.map( ( r ) => [ r.type, r.typeName ] ) ) ].sort( ( a, b ) => a[ 1 ].localeCompare( b[ 1 ] ) );
	const needle = query.trim().toLowerCase();
	const shown = rows.filter( ( r ) => ( ! needle || `${ r.title } ${ r.key }`.toLowerCase().includes( needle ) ) && ( ! type || r.type === type ) && ( ! required || r.required ) );

	return (
		<div className="ffxb-questions">
			<div className="ffxb-field">
				<label className="ffxb-field__label" htmlFor="ffxb-questions-search">
					{ __( 'Search questions', 'funnelforms-pro' ) }
				</label>
				<input id="ffxb-questions-search" className="ffxb-input" type="search" value={ query } onChange={ ( e ) => setQuery( e.target.value ) } />
			</div>
			<Select label={ __( 'Type', 'funnelforms-pro' ) } value={ type } options={ [ { value: '', label: __( 'All types', 'funnelforms-pro' ) }, ...types.map( ( [ value, label ] ) => ( { value, label } ) ) ] } onChange={ setType } />
			<Toggle label={ __( 'Required only', 'funnelforms-pro' ) } checked={ required } onChange={ setRequired } />
			<p className="ffxb-palette__hint" aria-live="polite">
				{ sprintf( __( '%1$d of %2$d questions', 'funnelforms-pro' ), shown.length, rows.length ) }
			</p>
			<ul className="ffxb-questions__list">
				{ shown.map( ( r ) => (
					<li key={ r.field }>
						<button
							type="button"
							className={ `ffxb-questions__item${ selection.field === r.field ? ' is-selected' : '' }` }
							aria-current={ selection.field === r.field ? 'true' : undefined }
							onClick={ () => {
								store.getState().select( { node: r.node, field: r.field } );
								window.dispatchEvent( new CustomEvent( REVEAL_EVENT, { detail: r.node } ) );
							} }
						>
							<span className="ffxb-questions__title">
								{ r.title }
								{ r.required ? <span className="ffxb-questions__required" title={ __( 'Required', 'funnelforms-pro' ) }> *</span> : null }
							</span>
							<span className="ffxb-questions__meta">
								{ r.typeName } · { r.key }
								{ r.reachable ? null : <span className="ffxb-questions__unreachable"> · { __( 'Not reachable', 'funnelforms-pro' ) }</span> }
							</span>
						</button>
					</li>
				) ) }
			</ul>
		</div>
	);
}
