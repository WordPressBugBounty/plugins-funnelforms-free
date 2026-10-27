/**
 * Deleting steps, fields and answers that rules ask for: the rules go with them, and a message
 * says what changed in the logic, with a way to undo it.
 */
import React, { useEffect } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import { findNode, lossOf, type LogicLoss } from '../document';
import type { Leaf } from '../conditions';
import type { BuilderStore, Recipe } from '../store';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';

/** What deleting did to the logic, in words; null when nothing changed. */
export function lossText( loss: LogicLoss ): string | null {
	const parts: string[] = [];
	if ( loss.removedPaths ) {
		parts.push( sprintf( __( 'paths removed: %d', 'funnelforms-pro' ), loss.removedPaths ) );
	}
	if ( loss.changedPaths ) {
		parts.push( sprintf( __( 'paths with fewer rules: %d', 'funnelforms-pro' ), loss.changedPaths ) );
	}
	if ( loss.shownFields ) {
		parts.push( sprintf( __( 'fields now always shown: %d', 'funnelforms-pro' ), loss.shownFields ) );
	}
	return parts.length ? sprintf( __( 'Deleted. Rules asked for it, so the logic changed: %s.', 'funnelforms-pro' ), parts.join( ', ' ) ) : null;
}

/** Rules on any field of a node, which go when the node is deleted. */
export function fieldsOf( doc: FormDocument | null, nodeId: string ): ( leaf: Leaf ) => boolean {
	const node = doc ? findNode( doc, nodeId ) : undefined;
	const ids = new Set<string>( node && 'fields' in node ? node.fields.map( ( f ) => f.id ) : [] );
	return ( leaf ) => 'field' in leaf && ids.has( leaf.field );
}

/** Makes a change that removes what the rules matching `gone` ask for, and tells what it did to the logic. */
export function removeWithNotice( store: BuilderStore, recipe: Recipe, gone: ( leaf: Leaf ) => boolean ): void {
	const doc = store.getState().doc;
	const loss = doc ? lossOf( doc, gone ) : null;
	store.getState().change( recipe );
	store.getState().notify( loss ? lossText( loss ) : null );
}

/** The message about the last change, with undo; it goes away by itself after a while. */
export function ChangeNotice() {
	const { store } = useEnv();
	const notice = useBuilder( ( s ) => s.notice );
	useEffect( () => {
		if ( ! notice ) {
			return undefined;
		}
		const timer = setTimeout( () => store.getState().notify( null ), 12000 );
		return () => clearTimeout( timer );
	}, [ notice, store ] );
	if ( ! notice ) {
		return null;
	}
	return (
		<div className="ffxb-toast" role="status">
			<span className="ffxb-toast__text">{ notice.text }</span>
			{ notice.undo ? (
				<button
					type="button"
					className="ffxb-toast__action"
					onClick={ () => {
						store.getState().undo();
						store.getState().notify( null );
					} }
				>
					{ __( 'Undo', 'funnelforms-pro' ) }
				</button>
			) : null }
			<button type="button" className="ffxb-toast__close" aria-label={ __( 'Close', 'funnelforms-pro' ) } onClick={ () => store.getState().notify( null ) }>
				×
			</button>
		</div>
	);
}
