/**
 * Hints about the logic of the form (logic.ts) in words, with a way to the place they are about.
 */
import React, { useMemo } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import { findNode, nodeName } from '../document';
import { logicHints, type LogicHint } from '../logic';
import { useBuilder, useEnv } from './context';
import { fieldIndex, fieldTitle } from './describe';
import { __, sprintf } from './i18n';

/** The hints of the open document, worked out again when it changes. */
export function useHints(): LogicHint[] {
	const doc = useBuilder( ( s ) => s.doc );
	return useMemo( () => ( doc ? logicHints( doc ) : [] ), [ doc ] );
}

/** The hint in words. */
export function hintText( hint: LogicHint, doc: FormDocument, locale: string ): string {
	const field = hint.other ? fieldIndex( doc ).get( hint.other ) : undefined;
	const other = hint.other ? findNode( doc, hint.other ) : undefined;
	switch ( hint.code ) {
		case 'deadEnd':
			return __( 'No path leads on from this step: visitors get stuck here.', 'funnelforms-pro' );
		case 'noOtherwise':
			return __( 'Visitors for whom no rule applies get stuck. Choose where they go otherwise.', 'funnelforms-pro' );
		case 'unreachable':
			return __( 'No path leads here, so visitors never see this.', 'funnelforms-pro' );
		case 'contactNoEnd':
			return __( 'After sending, visitors see an empty form. Connect an end with a thank-you message or a redirect.', 'funnelforms-pro' );
		case 'laterAnswer':
			return sprintf( __( 'A rule asks for “%s”, which visitors answer only later. Here it has no answer yet.', 'funnelforms-pro' ), fieldTitle( field, locale ) );
		case 'neverChecked':
			return __( 'A path without a condition is checked before this one, so this one is never taken. Move it up.', 'funnelforms-pro' );
		case 'sameRule':
			return __( 'A path checked earlier asks the same, so this one is never taken.', 'funnelforms-pro' );
		case 'impossible':
			return __( 'The rules of this path contradict each other, so it is never taken.', 'funnelforms-pro' );
		case 'endlessLoop':
			return __( 'This path leads round in a circle that visitors cannot leave. Entries would be refused.', 'funnelforms-pro' );
		case 'showLater':
			return sprintf( __( 'A field is shown on “%s”, which visitors answer only below or after it. Move that question up.', 'funnelforms-pro' ), fieldTitle( field, locale ) );
		case 'allHidden':
			return __( 'Every field of this step can be hidden. When all are hidden, visitors see an empty step.', 'funnelforms-pro' );
		case 'emptyEnd':
			return __( 'This end shows nothing: turn on a message or a redirect.', 'funnelforms-pro' );
		case 'redirectNoUrl':
			return __( 'Enter the page to redirect to.', 'funnelforms-pro' );
		case 'noEntry':
			return sprintf( __( 'Visitors who come here from “%s” leave without sending: no entry is saved and no mail goes out.', 'funnelforms-pro' ), other ? nodeName( other, locale ) || __( 'Without a title', 'funnelforms-pro' ) : '' );
	}
}

/** Hints as a list; each one can bring its place into view. */
export function HintList( { doc, hints, compact = false }: { doc: FormDocument; hints: LogicHint[]; compact?: boolean } ) {
	const { store, ctx } = useEnv();
	if ( ! hints.length ) {
		return null;
	}
	const select = store.getState().select;
	return (
		<ul className={ 'ffxb-hints' + ( compact ? ' ffxb-hints--compact' : '' ) }>
			{ hints.map( ( h, i ) => {
				const node = findNode( doc, h.node );
				return (
					<li key={ `${ h.code }-${ h.node }-${ h.edge ?? h.field ?? i }` } className={ `ffxb-hint-row ffxb-hint-row--${ h.level }` }>
						<span className="ffxb-hint-row__dot" aria-hidden="true" />
						<span className="ffxb-hint-row__text">
							{ compact ? null : <strong>{ node ? nodeName( node, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' ) : '' }</strong> }
							{ hintText( h, doc, ctx.locale ) }
						</span>
						{ compact ? null : (
							<button type="button" className="ffxb-link" onClick={ () => select( h.edge ? { edge: h.edge } : h.field ? { node: h.node, field: h.field } : { node: h.node } ) }>
								{ __( 'Show', 'funnelforms-pro' ) }
							</button>
						) }
					</li>
				);
			} ) }
		</ul>
	);
}
