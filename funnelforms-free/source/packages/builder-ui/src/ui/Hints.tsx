/**
 * Hints about the logic of the form (logic.ts) in words, with a way to the place they are about.
 */
import React, { useMemo } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import type { Coverage } from '../coverage';
import { coverage, spanText } from '../coverage';
import { findNode, nodeName, text } from '../document';
import { logicHints, type LogicHint } from '../logic';
import { useBuilder, useEnv } from './context';
import { fieldIndex, fieldTitle } from './describe';
import { __, sprintf } from './i18n';

/** The hints of the open document, worked out again when it changes. */
export function useHints(): LogicHint[] {
	const doc = useBuilder( ( s ) => s.doc );
	return useMemo( () => ( doc ? logicHints( doc ) : [] ), [ doc ] );
}

/**
 * The answers of a step no path with a condition takes, in words: "Other, Don't know", "20 – 30",
 * "no answer". Empty when every answer has a path or the answers cannot be listed.
 */
export function restText( rest: Coverage[ 'rest' ] | undefined, locale: string ): string {
	if ( ! rest ) {
		return '';
	}
	const number = new Intl.NumberFormat( ( 'undefined' !== typeof document && document.documentElement.lang ) || undefined, { maximumFractionDigits: 4 } );
	const names = rest.options.map( ( o ) => text( o.label, locale ).replace( /<[^>]*>/g, ' ' ).replace( /\s+/g, ' ' ).trim() || o.value );
	const parts = [ ...names.slice( 0, 4 ), ...( names.length > 4 ? [ '+' + ( names.length - 4 ) ] : [] ), ...rest.spans.slice( 0, 4 ).map( ( s ) => spanText( s, ( n ) => number.format( n ) ) ) ];
	if ( rest.combinations && ! names.length ) {
		parts.push( __( 'some combinations of answers', 'funnelforms-pro' ) );
	}
	if ( rest.none ) {
		parts.push( __( 'no answer', 'funnelforms-pro' ) );
	}
	return parts.join( ', ' );
}

/** The hint in words. */
export function hintText( hint: LogicHint, doc: FormDocument, locale: string ): string {
	const field = hint.other ? fieldIndex( doc ).get( hint.other ) : undefined;
	const other = hint.other ? findNode( doc, hint.other ) : undefined;
	switch ( hint.code ) {
		case 'deadEnd':
			return __( 'No path leads on from this step: visitors get stuck here.', 'funnelforms-pro' );
		case 'noOtherwise': {
			const node = findNode( doc, hint.node );
			const rest = restText( node ? coverage( doc, node )?.rest : undefined, locale );
			return rest
				? sprintf( /* translators: %s: the answers without a path, e.g. "Other, 20 – 30" */ __( 'No path takes these answers, so visitors get stuck: %s. Choose where they go under “Otherwise”.', 'funnelforms-pro' ), rest )
				: __( 'Visitors for whom no rule applies get stuck. Choose where they go otherwise.', 'funnelforms-pro' );
		}
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
		case 'shadowed':
			return __( 'Paths checked before this one take every answer it asks for, so it is never taken. Move it up or change it.', 'funnelforms-pro' );
		case 'noAnswer':
			return __( 'No answer this question can give fulfils this rule, so the path is never taken.', 'funnelforms-pro' );
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
