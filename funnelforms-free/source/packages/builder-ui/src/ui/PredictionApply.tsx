/**
 * Applying suggestions of the Predictive AI to the form with one click (tab of the Predictive AI):
 * the step as it is and as it will be (See the change), the bar to apply all open ones, the note
 * once all are applied, and taking one out again. The AI form builder makes the change with the suggestion's
 * instruction, like the AI bar; it lands in the draft and goes live with the next publishing.
 */
import React from 'react';
import type { FormDocument, FormNode } from '@funnelforms/form-schema';
import { text } from '../document';
import type { PredictionSuggestion } from '../predict';
import { contactFieldName, stepFieldName } from './catalog';
import { __, sprintf } from './i18n';
import { stepName } from './PredictionStage';

/** Fields shown in the small picture of a step at most. */
const PREVIEW_FIELDS = 5;
/** Answers shown of a choice at most. */
const PREVIEW_TILES = 4;

interface PreviewField {
	id: string;
	label: string;
	required: boolean;
	/** The answers of a choice; an input box without. */
	tiles?: string[];
	placeholder: string;
	tone?: 'bad' | 'good';
	hint?: string;
}

interface PreviewSide {
	title: string;
	fields: PreviewField[];
	/** The text of the send button of a contact step. */
	button?: string;
	/** Fields not shown. */
	more: number;
}

function plain( html: string ): string {
	return html
		.replace( /<[^>]*>/g, ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
}

/** The fields of a step as the small picture shows them: what a visitor fills in. */
function fieldsOf( node: FormNode, locale: string ): PreviewField[] {
	if ( 'end' === node.type ) {
		return [];
	}
	if ( 'contact' === node.type ) {
		return node.fields
			.filter( ( f ) => ! [ 'captcha', 'html', 'consent', 'phone_verification' ].includes( f.type ) )
			.map( ( f ) => {
				const placeholder = ( f.props as { placeholder?: Record<string, string> } ).placeholder;
				return { id: f.id, label: plain( text( f.label, locale ) ) || contactFieldName( f.type ), required: f.required, placeholder: placeholder ? text( placeholder, locale ) : '' };
			} );
	}
	return node.fields
		.filter( ( f ) => ! [ 'content', 'html', 'result', 'captcha' ].includes( f.type ) )
		.map( ( f ) => {
			const props = f.props as { placeholder?: Record<string, string> };
			const options = 'choice' === f.type || 'dropdown' === f.type ? f.options.map( ( o ) => plain( text( o.label, locale ) ) || o.value ) : undefined;
			return {
				id: f.id,
				label: plain( text( f.label, locale ) ) || stepFieldName( f.type ),
				required: f.required,
				tiles: options ? [ ...options.slice( 0, PREVIEW_TILES ), ...( options.length > PREVIEW_TILES ? [ '…' ] : [] ) ] : undefined,
				placeholder: props.placeholder ? text( props.placeholder, locale ) : stepFieldName( f.type ),
			};
		} );
}

/** The picture of a step: the first fields, the field a suggestion is about among them. */
function sideOf( doc: FormDocument, node: FormNode, fields: PreviewField[], locale: string, first?: string ): PreviewSide {
	const hit = first ? fields.find( ( f ) => f.id === first ) : undefined;
	const shown = hit && fields.indexOf( hit ) >= PREVIEW_FIELDS ? [ hit, ...fields.filter( ( f ) => f !== hit ).slice( 0, PREVIEW_FIELDS - 1 ) ] : fields.slice( 0, PREVIEW_FIELDS );
	return {
		title: stepName( doc, node ),
		fields: shown,
		button: 'contact' === node.type ? plain( text( node.submitLabel, locale ) ) || __( 'Send', 'funnelforms-pro' ) : undefined,
		more: Math.max( 0, fields.length - shown.length ),
	};
}

/**
 * The step as it is and as it will be. Making a field optional and removing one are drawn as they
 * will be; for other changes the AI decides the details, so the instruction stands there instead.
 */
export function sidesOf( doc: FormDocument, suggestion: Pick<PredictionSuggestion, 'kind' | 'node' | 'field' | 'instruction'>, locale: string ): { before: PreviewSide; after: PreviewSide | null } | null {
	const node = doc.nodes.find( ( n ) => n.id === suggestion.node );
	if ( ! node ) {
		return null;
	}
	const fields = fieldsOf( node, locale );
	const field = suggestion.field ? fields.find( ( f ) => f.id === suggestion.field ) : undefined;
	const id = field?.id;
	const marked = fields.map( ( f ) => ( f.id === id ? { ...f, tone: 'bad' as const, hint: 'remove_field' === suggestion.kind ? __( 'Is removed', 'funnelforms-pro' ) : f.required ? __( 'Required', 'funnelforms-pro' ) : undefined } : f ) );
	const before = sideOf( doc, node, marked, locale, id );
	if ( id && 'optional_field' === suggestion.kind ) {
		return { before, after: sideOf( doc, node, fields.map( ( f ) => ( f.id === id ? { ...f, required: false, tone: 'good' as const, hint: __( 'Optional', 'funnelforms-pro' ) } : f ) ), locale, id ) };
	}
	if ( id && 'remove_field' === suggestion.kind ) {
		return { before, after: sideOf( doc, node, fields.filter( ( f ) => f.id !== id ), locale ) };
	}
	return { before, after: null };
}

function Side( { label, side, after }: { label: string; side: PreviewSide; after?: boolean } ) {
	return (
		<div className="ffxb-pai-side">
			<span className={ 'ffxb-pai-side__label' + ( after ? ' is-after' : '' ) }>{ label }</span>
			<div className={ 'ffxb-pai-side__frame' + ( after ? ' is-after' : '' ) }>
				{ side.title ? <strong className="ffxb-pai-side__title">{ side.title }</strong> : null }
				{ side.fields.map( ( f ) => (
					<div key={ f.id } className={ 'ffxb-pai-side__field' + ( f.tone ? ` is-${ f.tone }` : '' ) }>
						<span className="ffxb-pai-side__name">
							{ f.label }
							{ f.required ? <span className="ffxb-pai-side__req"> *</span> : null }
						</span>
						{ f.tiles ? (
							<span className="ffxb-pai-side__tiles">
								{ f.tiles.map( ( t, i ) => (
									<span key={ i }>{ t }</span>
								) ) }
							</span>
						) : (
							<span className="ffxb-pai-side__input">{ f.placeholder }</span>
						) }
						{ f.hint ? <span className="ffxb-pai-side__hint">{ f.hint }</span> : null }
					</div>
				) ) }
				{ side.more ? <span className="ffxb-pai-muted is-small">{ sprintf( __( '+%d more fields', 'funnelforms-pro' ), side.more ) }</span> : null }
				{ side.button ? <span className="ffxb-pai-side__button">{ side.button }</span> : null }
			</div>
		</div>
	);
}

/** See the change: the step now and after applying, and what applying changes. */
export function ChangePeek( { doc, suggestion, locale, rate }: { doc: FormDocument; suggestion: PredictionSuggestion; locale: string; rate: string } ) {
	const sides = sidesOf( doc, suggestion, locale );
	return (
		<div className="ffxb-pai-peek ffxb-pai-in">
			{ sides ? (
				<div className="ffxb-pai-peek__sides">
					<Side label={ __( 'Now', 'funnelforms-pro' ) } side={ sides.before } />
					{ sides.after ? (
						<Side label={ __( 'After applying', 'funnelforms-pro' ) } side={ sides.after } after />
					) : (
						<div className="ffxb-pai-side">
							<span className="ffxb-pai-side__label is-after">{ __( 'After applying', 'funnelforms-pro' ) }</span>
							<div className="ffxb-pai-side__frame is-after is-text">
								<p>{ suggestion.instruction }</p>
								<span className="ffxb-pai-muted is-small">{ __( 'The AI works out the details when it puts the change into your form.', 'funnelforms-pro' ) }</span>
							</div>
						</div>
					) }
				</div>
			) : null }
			<div className="ffxb-pai-peek__changes">
				<span className="ffxb-pai-peek__label">{ __( 'What "Apply change" does to your form', 'funnelforms-pro' ) }</span>
				<span className="ffxb-pai-peek__change">
					<Arrow />
					{ suggestion.instruction }
				</span>
				<span className="ffxb-pai-muted is-small">{ rate }</span>
				<span className="ffxb-pai-muted is-small">{ __( 'Lands in the draft and can be undone at any time. Live only once you publish.', 'funnelforms-pro' ) }</span>
			</div>
		</div>
	);
}

/** The bar under the suggestions: all open ones into the form at once. */
export function ApplyBar( { count, points, busy, disabled, onApply }: { count: number; points: string; busy: boolean; disabled: boolean; onApply: () => void } ) {
	return (
		<div className="ffxb-pai-applybar" role="region" aria-label={ __( 'Apply all suggestions', 'funnelforms-pro' ) }>
			<div>
				<span>{ busy ? sprintf( __( 'The AI applies %d suggestions to your form. This can take up to a minute.', 'funnelforms-pro' ), count ) : sprintf( __( '%1$d suggestions open · together about +%2$s points conversion rate', 'funnelforms-pro' ), count, points ) }</span>
				<button type="button" className="ffxb-pai-btn ffxb-pai-btn--primary" disabled={ disabled || busy } aria-busy={ busy } onClick={ onApply }>
					{ busy ? <span className="ffxb-spinner" aria-hidden="true" /> : <Sparkle /> }
					{ sprintf( __( 'Apply all %d', 'funnelforms-pro' ), count ) }
				</button>
			</div>
		</div>
	);
}

/** Once every suggestion is in the form: what it brings and how it goes live. */
export function AllDone( { more, count, onPublish, onRun, canRun }: { more: number; count: number; onPublish?: () => void; onRun: () => void; canRun: boolean } ) {
	return (
		<section className="ffxb-pai-alldone ffxb-pai-in">
			<span className="ffxb-pai-alldone__icon" aria-hidden="true">
				<Tick size={ 20 } />
			</span>
			<div>
				<strong>{ more > 0 ? sprintf( __( 'All suggestions applied: probably %s more leads.', 'funnelforms-pro' ), `${ more }\u00a0%` ) : __( 'All suggestions applied.', 'funnelforms-pro' ) }</strong>
				<span>{ sprintf( __( 'The %d changes are in the draft. Visitors see them once you publish.', 'funnelforms-pro' ), count ) }</span>
			</div>
			{ onPublish ? (
				<button type="button" className="ffxb-pai-btn ffxb-pai-btn--good" onClick={ onPublish }>
					{ __( 'Publish now', 'funnelforms-pro' ) }
				</button>
			) : null }
			<button type="button" className="ffxb-pai-btn ffxb-pai-btn--secondary" disabled={ ! canRun } onClick={ onRun }>
				{ __( 'Confirm with a new simulation', 'funnelforms-pro' ) }
			</button>
		</section>
	);
}

/**
 * Undo when the change is not simply the last one: since then the form changed (the state
 * before it comes back, and with it what came after), or it was made on an earlier visit.
 */
export function RevertChoice( { how, onBefore, onOpen, onCancel }: { how: 'before' | null; onBefore: () => void; onOpen: () => void; onCancel: () => void } ) {
	return (
		<div className="ffxb-pai-revert ffxb-pai-in" role="group" aria-label={ __( 'Undo', 'funnelforms-pro' ) }>
			<p>
				{ 'before' === how
					? __( 'You changed the form since. Undo brings back the form as it was before this suggestion, without your changes after it (Ctrl+Z brings them back).', 'funnelforms-pro' )
					: __( 'This change is already saved in the draft. Change the step back on the canvas, or only count the suggestion as open again.', 'funnelforms-pro' ) }
			</p>
			<span>
				{ 'before' === how ? (
					<button type="button" className="ffxb-pai-btn ffxb-pai-btn--primary" onClick={ onBefore }>
						{ __( 'Undo anyway', 'funnelforms-pro' ) }
					</button>
				) : null }
				<button type="button" className="ffxb-pai-btn ffxb-pai-btn--secondary" onClick={ onOpen }>
					{ __( 'Only count as open', 'funnelforms-pro' ) }
				</button>
				<button type="button" className="ffxb-pai-btn ffxb-pai-btn--secondary" onClick={ onCancel }>
					{ __( 'Cancel', 'funnelforms-pro' ) }
				</button>
			</span>
		</div>
	);
}

export function Tick( { size = 14 }: { size?: number } ) {
	return (
		<svg width={ size } height={ size } viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M5 12l5 5 9-10" />
		</svg>
	);
}

function Arrow() {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M5 12h14M13 6l6 6-6 6" />
		</svg>
	);
}

export function Sparkle() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
			<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
		</svg>
	);
}
