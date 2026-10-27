/**
 * What can be added: steps by field type, contact steps and ends. A click adds after the
 * selected node (or on the default path); dragging places it on the canvas or drops a field
 * type into a node.
 */
import React, { useState } from 'react';
import { addContact, addEnd, addField, addStep, defaultPlacement, findNode, CONTACT_FIELD_TYPES, STEP_FIELD_TYPES, type Placement, type StepFieldType } from '../document';
import { isPro } from '../edition';
import type { Selection } from '../store';
import { DRAG_TYPE, type PaletteItem } from './Canvas';
import { contactFieldName, stepFieldName } from './catalog';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';
import { QuestionList } from './Questions';
import { TypeIcon } from './typeIcons';
import { ProBadge } from './ui';

/** The step types by what visitors do: pick, type in, or the rest. */
const GROUPS: Array<{ id: 'pick' | 'input' | 'more'; title: () => string; types: StepFieldType[] }> = [
	{ id: 'pick', title: () => __( 'Pick answers', 'funnelforms-pro' ), types: [ 'choice', 'dropdown', 'rating', 'slider' ] },
	{ id: 'input', title: () => __( 'Type in', 'funnelforms-pro' ), types: [ 'text', 'textarea', 'email', 'phone', 'url', 'number', 'date', 'time', 'address' ] },
	{ id: 'more', title: () => __( 'Content and more', 'funnelforms-pro' ), types: [ 'content', 'result', 'file', 'signature', 'repeat', 'booking' ] },
];

function Tile( { item, label, icon, tone, onAdd, disabled }: { item: PaletteItem; label: string; icon: string; tone: string; onAdd: () => void; disabled: boolean } ) {
	return (
		<button
			type="button"
			className={ `ffxb-tile ffxb-tile--${ item.kind } ffxb-tile--${ tone }` }
			draggable={ ! disabled }
			disabled={ disabled }
			title={ label }
			onDragStart={ ( e ) => {
				e.dataTransfer.setData( DRAG_TYPE, JSON.stringify( item ) );
				e.dataTransfer.effectAllowed = 'copy';
			} }
			onClick={ onAdd }
		>
			<span className="ffxb-tile__icon" aria-hidden="true">
				<TypeIcon type={ icon } />
			</span>
			<span className="ffxb-tile__label">{ label }</span>
		</button>
	);
}

/** A field type of Funnelforms Pro in the palette. */
export function ProTile( { label, icon, tone }: { label: string; icon: string; tone: string } ) {
	return (
		<span className={ `ffxb-tile ffxb-tile--${ tone } ffxb-tile--pro` } aria-disabled="true" title={ sprintf( /* translators: %s: name of a field type */ __( '%s: in Funnelforms Pro', 'funnelforms-pro' ), label ) }>
			<span className="ffxb-tile__icon" aria-hidden="true">
				<TypeIcon type={ icon } />
			</span>
			<span className="ffxb-tile__label">{ label }</span>
			<ProBadge />
		</span>
	);
}

export function Palette() {
	const { store, ctx, readOnly } = useEnv();
	const selection = useBuilder( ( s ) => s.selection );
	const selectedNode = useBuilder( ( s ) => ( s.doc && s.selection.node ? findNode( s.doc, s.selection.node ) : undefined ) );
	const { change, select } = store.getState();
	const [ query, setQuery ] = useState( '' );
	const [ tab, setTab ] = useState<'add' | 'questions'>( 'add' );

	const placement = ( doc: Parameters<typeof defaultPlacement>[ 0 ] ): Placement => {
		const node = selection.node ? findNode( doc, selection.node ) : undefined;
		return node && 'end' !== node.type ? { after: node.id } : defaultPlacement( doc );
	};

	const add = ( item: PaletteItem ): void => {
		let created: Selection = {};
		change( ( doc ) => {
			if ( 'step' === item.kind ) {
				created = { node: addStep( doc, item.type, ctx, placement( doc ) ) };
			} else if ( 'contact' === item.kind ) {
				created = { node: addContact( doc, ctx, placement( doc ) ) };
			} else if ( 'end' === item.kind ) {
				const node = selection.node ? findNode( doc, selection.node ) : undefined;
				created = { node: addEnd( doc, ctx, node && 'end' !== node.type ? { after: node.id } : {} ) };
			} else if ( selection.node ) {
				const field = addField( doc, selection.node, item.type, ctx );
				created = field ? { node: selection.node, field } : selection;
			}
		} );
		select( created );
	};

	const fieldTarget = selectedNode && 'end' !== selectedNode.type ? selectedNode : undefined;
	const needle = query.trim().toLowerCase();
	const matches = ( label: string ): boolean => '' === needle || label.toLowerCase().includes( needle );
	const tabs = (
		<div className="ffxb-palette__tabs" role="tablist" aria-label={ __( 'Side panel', 'funnelforms-pro' ) }>
			<button type="button" role="tab" id="ffxb-tab-add" aria-selected={ 'add' === tab } aria-controls="ffxb-panel-left" className={ 'add' === tab ? 'is-active' : '' } onClick={ () => setTab( 'add' ) }>
				{ __( 'Add', 'funnelforms-pro' ) }
			</button>
			<button type="button" role="tab" id="ffxb-tab-questions" aria-selected={ 'questions' === tab } aria-controls="ffxb-panel-left" className={ 'questions' === tab ? 'is-active' : '' } onClick={ () => setTab( 'questions' ) }>
				{ __( 'Questions', 'funnelforms-pro' ) }
			</button>
		</div>
	);
	if ( 'questions' === tab ) {
		return (
			<aside className="ffxb-palette" aria-label={ __( 'Questions', 'funnelforms-pro' ) }>
				{ tabs }
				<div id="ffxb-panel-left" role="tabpanel" aria-labelledby="ffxb-tab-questions">
					<QuestionList />
				</div>
			</aside>
		);
	}

	const fieldTypes = fieldTarget ? ( 'contact' === fieldTarget.type ? CONTACT_FIELD_TYPES : STEP_FIELD_TYPES ).map( ( type ) => ( { type: type as string, label: 'contact' === fieldTarget.type ? contactFieldName( type ) : stepFieldName( type ) } ) ).filter( ( t ) => matches( t.label ) ) : [];
	const groups = GROUPS.map( ( g ) => ( { ...g, types: g.types.filter( ( type ) => matches( stepFieldName( type ) ) ) } ) ).filter( ( g ) => g.types.length > 0 );
	const finish = [
		{ item: { kind: 'contact' } as PaletteItem, label: __( 'Contact step', 'funnelforms-pro' ), icon: 'contact' },
		{ item: { kind: 'end' } as PaletteItem, label: __( 'End', 'funnelforms-pro' ), icon: 'end' },
	].filter( ( f ) => matches( f.label ) );

	return (
		<aside className="ffxb-palette" aria-label={ __( 'Add', 'funnelforms-pro' ) }>
			{ tabs }
			<div className="ffxb-palette__search">
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
					<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
				</svg>
				<input type="search" value={ query } placeholder={ __( 'Find a field type', 'funnelforms-pro' ) } aria-label={ __( 'Find a field type', 'funnelforms-pro' ) } onChange={ ( e ) => setQuery( e.target.value ) } />
			</div>
			<p className="ffxb-palette__hint">{ __( 'Click to add after the selected step, or drag onto the canvas.', 'funnelforms-pro' ) }</p>
			{ fieldTypes.length ? (
				<section className="ffxb-palette__group ffxb-palette__group--field">
					<h2 className="ffxb-palette__title">{ __( 'Field in this step', 'funnelforms-pro' ) }</h2>
					<div className="ffxb-palette__tiles">
						{ fieldTypes.map( ( { type, label } ) =>
							'free' === process.env.FUNNELFORMS_EDITION && isPro( ( 'contact' === fieldTarget?.type ? 'contact_field:' : 'field:' ) + type ) ? (
								<ProTile key={ type } label={ label } icon={ type } tone="field" />
							) : (
								<Tile key={ type } item={ { kind: 'field', type } } label={ label } icon={ type } tone="field" onAdd={ () => add( { kind: 'field', type } ) } disabled={ readOnly } />
							)
						) }
					</div>
				</section>
			) : null }
			{ groups.map( ( g, index ) => (
				<section key={ g.id } className="ffxb-palette__group">
					<h2 className="ffxb-palette__title">
						{ 0 === index ? <span className="ffxb-palette__lead">{ __( 'New step', 'funnelforms-pro' ) }</span> : null }
						{ g.title() }
					</h2>
					<div className="ffxb-palette__tiles">
						{ g.types.map( ( type ) =>
							'free' === process.env.FUNNELFORMS_EDITION && isPro( 'field:' + type ) ? (
								<ProTile key={ type } label={ stepFieldName( type ) } icon={ type } tone={ g.id } />
							) : (
								<Tile key={ type } item={ { kind: 'step', type } } label={ stepFieldName( type ) } icon={ type } tone={ g.id } onAdd={ () => add( { kind: 'step', type } ) } disabled={ readOnly } />
							)
						) }
					</div>
				</section>
			) ) }
			{ finish.length ? (
				<section className="ffxb-palette__group">
					<h2 className="ffxb-palette__title">{ __( 'Finish', 'funnelforms-pro' ) }</h2>
					<div className="ffxb-palette__tiles">
						{ finish.map( ( f ) => (
							<Tile key={ f.icon } item={ f.item } label={ f.label } icon={ f.icon } tone="finish" onAdd={ () => add( f.item ) } disabled={ readOnly } />
						) ) }
					</div>
				</section>
			) : null }
			{ ! fieldTypes.length && ! groups.length && ! finish.length ? <p className="ffxb-palette__empty">{ __( 'No field type matches.', 'funnelforms-pro' ) }</p> : null }
		</aside>
	);
}
