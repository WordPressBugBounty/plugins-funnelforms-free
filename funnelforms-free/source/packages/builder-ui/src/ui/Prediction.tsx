/**
 * The prediction mode of the canvas (Predictive AI, Funnelforms Pro): before a form goes live,
 * how many of its visitors are expected to reach and leave each step, what they answer, the rate
 * of sent forms with its range, the sticking points and what would help. The owner describes the
 * visitors once (industry, value of a lead, audience); the Funnelforms server answers with a
 * behaviour model, and the builder sends virtual visitors through the form with it (predict.ts).
 * The figures are drawn on the canvas like those of the analytics mode and follow changes to the
 * form at once; a suggestion goes to the AI bar as an instruction, or (in the tab of the Predictive
 * AI) the AI puts it into the form with one click. Nothing is changed by itself.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { FormDocument } from '@funnelforms/form-schema';
import type { FormsApi } from '../api';
import { nodeName } from '../document';
import { AGES, DEFAULT_VISITORS, figuresOf, INDUSTRIES, predict, VISITORS, type AppliedSuggestion, type Prediction, type PredictionParameters, type StoredPrediction } from '../predict';
import { canvasAnalytics, percent, type CanvasAnalytics } from '../stats';
import type { BuilderStore } from '../store';
import { AI_MAX_PROMPT, useAiAsk } from './AiForm';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';
import { Button, Dialog, Field, icons, Notice, NumberInput, Select, Spinner, TextInput } from './ui';

export interface PredictionMode {
	on: boolean;
	setOn: ( on: boolean ) => void;
	/** The license includes the AI; without it the mode explains where to connect it. */
	ready: boolean;
	accountUrl: string;
	/** The last prediction of the form, once loaded; null without one. */
	stored: StoredPrediction | null;
	loading: boolean;
	/** While the server works on a new prediction. */
	busy: boolean;
	error: string | null;
	/** Analyses left after the last request (today for the website, this month for the license). */
	remaining: { today: number; month: number } | null;
	run: ( parameters: PredictionParameters, visitors: number ) => Promise<boolean>;
	/** The simulation of the form as it is now, with the model of the last prediction. */
	result: Prediction | null;
	/** The prediction whose model the result uses; a new one replaces the result at once. */
	resultOf: StoredPrediction | null;
	figures: CanvasAnalytics | null;
	/** Suggestions of the last prediction put into the form, the oldest first. */
	applied: AppliedSuggestion[];
	/** The AI can put suggestions into the form: the AI form builder is there and the form can be edited. */
	canApply: boolean;
	/** The suggestions the AI puts into the form now; null while it does not. */
	applying: string[] | null;
	/** Why putting suggestions in, or taking them out, failed last. */
	applyError: { ids: string[]; message: string } | null;
	/** Has the AI put suggestions into the form, with their instructions; false when it failed. */
	apply: ( ids: string[] ) => Promise<boolean>;
	/**
	 * Takes a suggestion out again. undo: the change is undone (the last change of the form);
	 * before: the form goes back to how it was before the change, with all changes since; open: it
	 * only counts as open again, the form stays. A change that put in several suggestions at once
	 * takes them all out.
	 */
	revert: ( id: string, how: 'undo' | 'before' | 'open' ) => void;
	/** How a suggestion put in can be taken out of the form: null when the change is not known here (an earlier visit). */
	undoable: ( id: string ) => 'undo' | 'before' | null;
}

/** A change the AI made to put suggestions into the form, while the editor is open. */
interface AppliedChange {
	ids: string[];
	before: FormDocument;
	after: FormDocument;
}

function lastChange( list: AppliedChange[], id: string ): AppliedChange | undefined {
	return [ ...list ].reverse().find( ( c ) => c.ids.includes( id ) );
}

/** Instructions of suggestions as prompts of the AI bar: as few as fit, each numbered when there are several. */
export function applyPrompts( instructions: Array<{ id: string; instruction: string }> ): Array<{ ids: string[]; prompt: string }> {
	if ( 1 === instructions.length ) {
		const [ one ] = instructions;
		return one ? [ { ids: [ one.id ], prompt: one.instruction.slice( 0, AI_MAX_PROMPT ) } ] : [];
	}
	const head = __( 'Make these changes to the form:', 'funnelforms-pro' );
	const prompts: Array<{ ids: string[]; prompt: string }> = [];
	let current: { ids: string[]; lines: string[] } = { ids: [], lines: [] };
	const text = ( c: typeof current ): string => [ head, ...c.lines.map( ( l, i ) => `${ i + 1 }. ${ l }` ) ].join( '\n' );
	for ( const { id, instruction } of instructions ) {
		const next = { ids: [ ...current.ids, id ], lines: [ ...current.lines, instruction.trim() ] };
		if ( current.ids.length && text( next ).length > AI_MAX_PROMPT ) {
			prompts.push( { ids: current.ids, prompt: text( current ) } );
			current = { ids: [ id ], lines: [ instruction.trim() ] };
		} else {
			current = next;
		}
	}
	if ( current.ids.length ) {
		prompts.push( { ids: current.ids, prompt: 1 === current.ids.length ? ( current.lines[ 0 ] ?? '' ).slice( 0, AI_MAX_PROMPT ) : text( current ).slice( 0, AI_MAX_PROMPT ) } );
	}
	return prompts;
}

/** What the tab of the Predictive AI shows next to its name. */
export function predictionBadge( mode: PredictionMode | null ): { busy: boolean; open: number } | null {
	if ( ! mode ) {
		return null;
	}
	const done = new Set( mode.applied.map( ( a ) => a.suggestion ) );
	return { busy: mode.busy, open: mode.stored?.model.suggestions.filter( ( s ) => ! done.has( s.id ) ).length ?? 0 };
}

/** The prediction mode; null in Funnelforms Free, outside the editor and where the host has no AI. */
export const PredictionContext = createContext<PredictionMode | null>( null );

export function usePrediction(): PredictionMode | null {
	return useContext( PredictionContext );
}

/** The simulation runs again this long after the last change to the form. */
const SETTLE_MS = 400;

/**
 * State of the prediction of one form, shared by the canvas mode and the tab of the Predictive AI.
 * The last prediction loads once either of them is open (active: the tab is shown).
 */
export function usePredictionState( api: FormsApi, formId: number, store: BuilderStore, ai: { ready: boolean; accountUrl: string } | null | undefined, active = false, readOnly = false ): PredictionMode | null {
	const [ on, setOn ] = useState( false );
	const [ stored, setStored ] = useState<StoredPrediction | null>( null );
	const [ loading, setLoading ] = useState( false );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ remaining, setRemaining ] = useState<{ today: number; month: number } | null>( null );
	const [ computed, setComputed ] = useState<{ result: Prediction; of: StoredPrediction } | null>( null );
	const result = computed?.result ?? null;
	const doc = useStore( store, ( s ) => s.doc );
	const [ applied, setApplied ] = useState<AppliedSuggestion[]>( [] );
	const [ applying, setApplying ] = useState<string[] | null>( null );
	const [ applyError, setApplyError ] = useState<{ ids: string[]; message: string } | null>( null );
	// The changes the AI made here, to take them out again; a new prediction starts over.
	const changes = useRef<AppliedChange[]>( [] );
	useEffect( () => {
		setApplied( stored?.applied ?? [] );
		setApplyError( null );
		changes.current = [];
	}, [ stored ] );
	const loaded = useRef( false );
	const offered = undefined !== api.predict && undefined !== api.lastPrediction && !! ai;

	const wanted = on || active;
	useEffect( () => {
		if ( ! wanted || ! offered || loaded.current || ! api.lastPrediction ) {
			return undefined;
		}
		let live = true;
		loaded.current = true;
		setLoading( true );
		api.lastPrediction( formId )
			.then( ( last ) => live && setStored( last ) )
			.catch( ( e: unknown ) => {
				loaded.current = false;
				if ( live ) {
					setError( e instanceof Error ? e.message : String( e ) );
				}
			} )
			.finally( () => live && setLoading( false ) );
		return () => {
			live = false;
		};
	}, [ api, formId, wanted, offered ] );

	// The figures follow the form: a while after the last change, with the same visitors; at once when there are none yet.
	// A new prediction shows at once.
	const shown = useRef<StoredPrediction | null>( null );
	const appliedKey = applied.map( ( a ) => a.suggestion ).join( ',' );
	useEffect( () => {
		if ( ! wanted || ! stored || ! doc ) {
			shown.current = null;
			setComputed( null );
			return undefined;
		}
		const timer = setTimeout(
			() => {
				shown.current = stored;
				setComputed( { result: predict( doc, stored.model, stored.visitors, undefined, appliedKey ? appliedKey.split( ',' ) : [] ), of: stored } );
			},
			shown.current === stored ? SETTLE_MS : 0
		);
		return () => clearTimeout( timer );
	}, [ wanted, stored, doc, appliedKey ] );

	// The statistics compare the figures with the real ones: they are kept once per prediction and
	// set of applied suggestions, when the form is simulated with them, not on every change.
	const kept = useRef( '' );
	useEffect( () => {
		const of = computed?.of;
		if ( readOnly || ! api.saveFigures || ! computed || ! of || of !== stored ) {
			return;
		}
		const figures = figuresOf( computed.result );
		const key = of.created + '|' + [ ...figures.applied ].sort().join( ',' );
		const before = of.figures ? of.created + '|' + [ ...of.figures.applied ].sort().join( ',' ) : '';
		if ( key === kept.current || key === before ) {
			kept.current = key;
			return;
		}
		kept.current = key;
		api.saveFigures( formId, figures ).catch( () => {
			kept.current = '';
		} );
	}, [ api, formId, computed, stored, readOnly ] );

	const run = useCallback(
		async ( parameters: PredictionParameters, visitors: number ): Promise<boolean> => {
			const current = store.getState().doc;
			if ( ! api.predict || ! current ) {
				return false;
			}
			setBusy( true );
			setError( null );
			try {
				const answer = await api.predict( formId, current, parameters, visitors );
				setStored( answer.prediction );
				setRemaining( { today: answer.remainingToday, month: answer.remainingMonth } );
				return true;
			} catch ( e ) {
				setError( e instanceof Error ? e.message : String( e ) );
				return false;
			} finally {
				setBusy( false );
			}
		},
		[ api, formId, store ]
	);

	/** Notes suggestions as put in or open again on the server; here at once, so a slow answer changes nothing. */
	const mark = useCallback(
		async ( ids: string[], put: boolean, summary = '' ): Promise<void> => {
			const at = new Date().toISOString();
			setApplied( ( list ) => [ ...list.filter( ( a ) => ! ids.includes( a.suggestion ) ), ...( put ? ids.map( ( suggestion ) => ( { suggestion, summary, at } ) ) : [] ) ] );
			if ( ! api.markApplied ) {
				return;
			}
			try {
				const answer = await api.markApplied( formId, ids, put, summary );
				setApplied( answer.applied ?? [] );
			} catch ( e ) {
				setApplyError( { ids, message: e instanceof Error ? e.message : String( e ) } );
			}
		},
		[ api, formId ]
	);

	const apply = useCallback(
		async ( ids: string[] ): Promise<boolean> => {
			const start = store.getState().doc;
			const suggestions = ( stored?.model.suggestions ?? [] ).filter( ( s ) => ids.includes( s.id ) );
			if ( ! api.aiEdit || ! start || ! suggestions.length || null !== applying ) {
				return false;
			}
			setApplying( ids );
			setApplyError( null );
			const summaries: string[] = [];
			let ok = true;
			for ( const part of applyPrompts( suggestions ) ) {
				const before = store.getState().doc;
				if ( ! before ) {
					break;
				}
				try {
					const change = await api.aiEdit( formId, part.prompt, before );
					// One step of the history, like the AI bar.
					store.getState().replace( change.document );
					const after = store.getState().doc;
					if ( after ) {
						changes.current.push( { ids: part.ids, before, after } );
					}
					summaries.push( change.summary );
					await mark( part.ids, true, change.summary );
				} catch ( e ) {
					setApplyError( { ids: part.ids, message: e instanceof Error ? e.message : String( e ) } );
					ok = false;
					break;
				}
			}
			if ( summaries.length ) {
				// Without undo in the message: Undo on the suggestion also counts it as open again.
				store.getState().notify( summaries.filter( Boolean ).join( ' ' ) || __( 'The form was changed.', 'funnelforms-pro' ), false );
			}
			setApplying( null );
			return ok;
		},
		[ api, formId, store, stored, applying, mark ]
	);

	const undoable = useCallback(
		( id: string ): 'undo' | 'before' | null => {
			const change = lastChange( changes.current, id );
			return change ? ( change.after === doc ? 'undo' : 'before' ) : null;
		},
		[ doc ]
	);
	const revert = useCallback(
		( id: string, how: 'undo' | 'before' | 'open' ): void => {
			const change = lastChange( changes.current, id );
			if ( 'open' === how || ! change ) {
				changes.current = changes.current.map( ( c ) => ( { ...c, ids: c.ids.filter( ( x ) => x !== id ) } ) ).filter( ( c ) => c.ids.length );
				void mark( [ id ], false );
				return;
			}
			const at = changes.current.indexOf( change );
			// Back to before the change: what was put in after it goes too.
			const gone = 'undo' === how ? [ change ] : changes.current.slice( at );
			if ( 'undo' === how && store.getState().doc === change.after ) {
				store.getState().undo();
			} else {
				store.getState().replace( change.before );
			}
			changes.current = changes.current.filter( ( c ) => ! gone.includes( c ) );
			const ids = gone.flatMap( ( c ) => c.ids );
			store.getState().notify( 1 === ids.length ? __( 'The suggestion was taken out of the form again.', 'funnelforms-pro' ) : sprintf( __( '%d suggestions were taken out of the form again.', 'funnelforms-pro' ), ids.length ), false );
			void mark( ids, false );
		},
		[ store, mark ]
	);

	const canApply = !! api.aiEdit && !! ai?.ready && ! readOnly;
	const figures = useMemo( () => ( on && result && doc ? canvasAnalytics( doc, result.simulation.report ) : null ), [ on, result, doc ] );
	const mode = useMemo<PredictionMode>(
		() => ( { on, setOn, ready: !! ai?.ready, accountUrl: ai?.accountUrl ?? '', stored, loading, busy, error, remaining, run, result, resultOf: computed?.of ?? null, figures, applied, canApply, applying, applyError, apply, revert, undoable } ),
		[ on, ai, stored, loading, busy, error, remaining, run, result, computed, figures, applied, canApply, applying, applyError, apply, revert, undoable ]
	);
	return offered ? mode : null;
}

export function industryNames(): Record<( typeof INDUSTRIES )[ number ], string> {
	return {
		solar: __( 'Solar systems', 'funnelforms-pro' ),
		heat_pump: __( 'Heat pumps and heating', 'funnelforms-pro' ),
		real_estate_buy: __( 'Real estate: buying and selling', 'funnelforms-pro' ),
		luxury_real_estate: __( 'Luxury real estate', 'funnelforms-pro' ),
		property_valuation: __( 'Property valuation', 'funnelforms-pro' ),
		trades: __( 'Trades and craft services', 'funnelforms-pro' ),
		construction: __( 'Construction and renovation', 'funnelforms-pro' ),
		insurance: __( 'Insurance', 'funnelforms-pro' ),
		financing: __( 'Loans and financing', 'funnelforms-pro' ),
		legal_tax: __( 'Legal and tax advice', 'funnelforms-pro' ),
		coaching: __( 'Coaching and consulting', 'funnelforms-pro' ),
		recruiting: __( 'Recruiting and job applications', 'funnelforms-pro' ),
		health: __( 'Health and medicine', 'funnelforms-pro' ),
		beauty: __( 'Beauty and wellness', 'funnelforms-pro' ),
		fitness: __( 'Fitness and sports', 'funnelforms-pro' ),
		education: __( 'Education and courses', 'funnelforms-pro' ),
		software_b2b: __( 'Software for businesses', 'funnelforms-pro' ),
		agency: __( 'Agencies and marketing', 'funnelforms-pro' ),
		automotive: __( 'Cars and vehicles', 'funnelforms-pro' ),
		travel_events: __( 'Travel and events', 'funnelforms-pro' ),
		product_advice: __( 'Product advice and online shops', 'funnelforms-pro' ),
		gastronomy: __( 'Restaurants and catering', 'funnelforms-pro' ),
		energy_tariffs: __( 'Electricity and gas tariffs', 'funnelforms-pro' ),
		other: __( 'Another industry', 'funnelforms-pro' ),
	};
}

/** What a new prediction starts with, before the owner says more. */
export function defaultParameters( currency = 'EUR' ): PredictionParameters {
	return { industry: 'other', industry_label: '', lead_value: 50, currency, audience: 'b2c', ages: [], intent: 'compare', traffic: 'mixed', mobile_share: null, notes: '' };
}

export function number( n: number ): string {
	try {
		return new Intl.NumberFormat().format( n );
	} catch {
		return String( n );
	}
}

/** Where the data goes; shown before a prediction is asked for. */
export function predictionPrivacyText(): string {
	return __( 'The structure of the form and your description of the visitors are sent to the Funnelforms server and to Anthropic. No entries and no visitor data are sent, and nothing is stored there.', 'funnelforms-pro' );
}

/** The description of the visitors, and the number of virtual visitors, before a prediction. */
export function PredictionDialog( { onClose }: { onClose: () => void } ) {
	const mode = usePrediction();
	const [ p, setP ] = useState<PredictionParameters>( () => mode?.stored?.parameters ?? defaultParameters() );
	const [ visitors, setVisitors ] = useState<number>( mode?.stored?.visitors ?? DEFAULT_VISITORS );
	if ( ! mode ) {
		return null;
	}
	const submit = async (): Promise<void> => {
		if ( await mode.run( p, visitors ) ) {
			onClose();
		}
	};
	return (
		<Dialog
			title={ __( 'Predict the visitors of this form', 'funnelforms-pro' ) }
			open
			wide
			onClose={ () => ( mode.busy ? undefined : onClose() ) }
			actions={
				<>
					<Button onClick={ onClose } disabled={ mode.busy }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" icon={ icons.sparkles } disabled={ mode.busy || ! mode.ready } onClick={ () => void submit() }>
						{ __( 'Predict', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			<div className="ffxb-predict-form">
				{ mode.ready ? null : <NotReady accountUrl={ mode.accountUrl } /> }
				<p className="ffxb-hint">{ __( 'The more you say about your visitors, the closer the prediction. It is an estimate based on experience, not a measurement.', 'funnelforms-pro' ) }</p>
				<PredictionFields value={ p } onChange={ setP } visitors={ visitors } onVisitors={ setVisitors } />
				<p className="ffxb-ai__privacy">{ predictionPrivacyText() }</p>
				{ mode.busy ? (
					<div className="ffxb-ai__progress" role="status">
						<span className="ffxb-spinner" aria-hidden="true" />
						<span>
							<strong>{ __( 'The AI studies the form and its visitors…', 'funnelforms-pro' ) }</strong>
							<span>{ __( 'This can take up to a minute.', 'funnelforms-pro' ) }</span>
						</span>
					</div>
				) : null }
				{ mode.error ? <Notice tone="danger">{ mode.error }</Notice> : null }
			</div>
		</Dialog>
	);
}

/** The description of the visitors and the number of virtual visitors: in the dialog of the canvas and on the page of the Predictive AI. */
export function PredictionFields( { value: p, onChange, visitors, onVisitors, disabled = false }: { value: PredictionParameters; onChange: ( p: PredictionParameters ) => void; visitors: number; onVisitors: ( visitors: number ) => void; disabled?: boolean } ) {
	const set = <K extends keyof PredictionParameters>( key: K, value: PredictionParameters[ K ] ): void => onChange( { ...p, [ key ]: value } );
	const names = industryNames();
	return (
		<fieldset className="ffxb-predict-form__fields" disabled={ disabled }>
			<Select label={ __( 'Industry', 'funnelforms-pro' ) } value={ p.industry as ( typeof INDUSTRIES )[ number ] } options={ INDUSTRIES.map( ( value ) => ( { value, label: names[ value ] } ) ) } onChange={ ( v ) => set( 'industry', v ) } />
			{ 'other' === p.industry ? <TextInput label={ __( 'Your industry', 'funnelforms-pro' ) } value={ p.industry_label } onChange={ ( v ) => set( 'industry_label', v.slice( 0, 100 ) ) } /> : null }
			<div className="ffxb-predict-form__row">
				<NumberInput label={ __( 'Value of one lead', 'funnelforms-pro' ) } value={ p.lead_value } min={ 0 } max={ 1000000 } onChange={ ( v ) => set( 'lead_value', Math.min( 1000000, Math.max( 0, v ?? 0 ) ) ) } hint={ __( 'What a new enquiry is worth to you on average.', 'funnelforms-pro' ) } />
				<TextInput label={ __( 'Currency', 'funnelforms-pro' ) } value={ p.currency } onChange={ ( v ) => set( 'currency', v.toUpperCase().replace( /[^A-Z]/g, '' ).slice( 0, 3 ) ) } />
			</div>
			<Select
				label={ __( 'Customers', 'funnelforms-pro' ) }
				value={ p.audience }
				options={ [
					{ value: 'b2c', label: __( 'Private customers', 'funnelforms-pro' ) },
					{ value: 'b2b', label: __( 'Business customers', 'funnelforms-pro' ) },
					{ value: 'mixed', label: __( 'Both', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => set( 'audience', v ) }
			/>
			<fieldset className="ffxb-predict-form__ages">
				<legend className="ffxb-field__label">{ __( 'Age groups (none: mixed)', 'funnelforms-pro' ) }</legend>
				{ AGES.map( ( age ) => (
					<label key={ age } className="ffxb-check">
						<input type="checkbox" checked={ p.ages.includes( age ) } onChange={ ( e ) => set( 'ages', e.target.checked ? [ ...p.ages, age ] : p.ages.filter( ( a ) => a !== age ) ) } />
						{ age }
					</label>
				) ) }
			</fieldset>
			<Select
				label={ __( 'How ready to buy are they?', 'funnelforms-pro' ) }
				value={ p.intent }
				options={ [
					{ value: 'research', label: __( 'Just looking around', 'funnelforms-pro' ) },
					{ value: 'compare', label: __( 'Comparing offers', 'funnelforms-pro' ) },
					{ value: 'ready', label: __( 'Ready to buy', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => set( 'intent', v ) }
			/>
			<Select
				label={ __( 'Where do they come from?', 'funnelforms-pro' ) }
				value={ p.traffic }
				options={ [
					{ value: 'search_ads', label: __( 'Search ads', 'funnelforms-pro' ) },
					{ value: 'social_ads', label: __( 'Social media ads', 'funnelforms-pro' ) },
					{ value: 'organic', label: __( 'Search results and own website', 'funnelforms-pro' ) },
					{ value: 'email', label: __( 'Newsletter and e-mail', 'funnelforms-pro' ) },
					{ value: 'direct', label: __( 'Direct, recommendations', 'funnelforms-pro' ) },
					{ value: 'mixed', label: __( 'Mixed', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => set( 'traffic', v ) }
			/>
			<NumberInput label={ __( 'Share on phones in percent (empty: usual for the source)', 'funnelforms-pro' ) } value={ p.mobile_share ?? undefined } min={ 0 } max={ 100 } onChange={ ( v ) => set( 'mobile_share', undefined === v ? null : Math.round( Math.min( 100, Math.max( 0, v ) ) ) ) } />
			<Field label={ __( 'Anything else about your visitors?', 'funnelforms-pro' ) } hint={ __( 'For example: mostly home owners in the countryside who want a quick price.', 'funnelforms-pro' ) }>
				{ ( id ) => <textarea id={ id } className="ffxb-input" rows={ 3 } maxLength={ 500 } value={ p.notes } onChange={ ( e ) => set( 'notes', e.target.value ) } /> }
			</Field>
			<Select label={ __( 'Virtual visitors', 'funnelforms-pro' ) } value={ String( visitors ) } options={ VISITORS.map( ( n ) => ( { value: String( n ), label: number( n ) } ) ) } onChange={ ( v ) => onVisitors( Number( v ) ) } />
		</fieldset>
	);
}

export function NotReady( { accountUrl }: { accountUrl: string } ) {
	return (
		<Notice
			tone="warning"
			title={ __( 'Connect your license', 'funnelforms-pro' ) }
			action={
				accountUrl ? (
					<a className="ffxb-button ffxb-button--secondary ffxb-button--md" href={ accountUrl }>
						{ __( 'Connect license', 'funnelforms-pro' ) }
					</a>
				) : undefined
			}
		>
			{ __( 'The Predictive AI needs a connected Funnelforms Pro license that includes AI.', 'funnelforms-pro' ) }
		</Notice>
	);
}

/** Switch and state of the mode, beside the analytics at the top right of the canvas. */
export function PredictionPanel() {
	const mode = usePrediction();
	const [ asking, setAsking ] = useState( false );
	const toggle = useCallback( () => mode?.setOn( ! mode.on ), [ mode ] );
	if ( ! mode ) {
		return null;
	}
	const { on, stored, loading, result, error, busy } = mode;
	return (
		<div className="ffxb-analytics ffxb-prediction">
			<button type="button" className="ffxb-analytics__toggle" aria-pressed={ on } onClick={ toggle } title={ __( 'Predicted visitors on the canvas (P)', 'funnelforms-pro' ) } aria-keyshortcuts="P">
				{ icons.sparkles }
				{ __( 'Prediction', 'funnelforms-pro' ) }
			</button>
			{ on ? (
				<div className="ffxb-analytics__body">
					<div role="status" className="ffxb-analytics__status">
						{ loading ? <Spinner label={ __( 'Loading the prediction…', 'funnelforms-pro' ) } /> : null }
						{ ! loading && ! stored && ! error ? __( 'See how visitors will go through the form before it goes live.', 'funnelforms-pro' ) : null }
						{ ! loading && ! stored && error ? error : null }
						{ result ? (
							<>
								<strong className="ffxb-prediction__rate">{ sprintf( __( '%1$s sent (%2$s to %3$s)', 'funnelforms-pro' ), percent( result.conversion ), percent( result.low ), percent( result.high ) ) }</strong>
								<span>{ sprintf( __( 'of %s virtual visitors', 'funnelforms-pro' ), number( result.visitors ) ) }</span>
								{ result.unknown ? <p className="ffxb-analytics__small">{ sprintf( __( '%d steps are new since the prediction. Predict again to include them.', 'funnelforms-pro' ), result.unknown ) }</p> : null }
							</>
						) : null }
						{ stored && ! result ? <Spinner label={ __( 'Simulating the visitors…', 'funnelforms-pro' ) } /> : null }
					</div>
					<Button size="sm" variant={ stored ? 'secondary' : 'primary' } icon={ icons.sparkles } disabled={ busy || loading } onClick={ () => setAsking( true ) }>
						{ stored ? __( 'Predict again', 'funnelforms-pro' ) : __( 'Predict', 'funnelforms-pro' ) }
					</Button>
					{ mode.remaining ? <p className="ffxb-hint">{ sprintf( __( '%1$d predictions left today, %2$d this month.', 'funnelforms-pro' ), mode.remaining.today, mode.remaining.month ) }</p> : null }
				</div>
			) : null }
			{ asking ? <PredictionDialog onClose={ () => setAsking( false ) } /> : null }
		</div>
	);
}

/** The prediction of the whole form in the inspector while nothing is selected. */
export function PredictionOverview() {
	const mode = usePrediction();
	const doc = useBuilder( ( s ) => s.doc );
	const { store } = useEnv();
	const ask = useAiAsk();
	const result = mode?.result;
	const stored = mode?.stored;
	if ( ! mode?.on || ! result || ! stored || ! doc ) {
		return null;
	}
	const name = ( id: string ): string => {
		const node = doc.nodes.find( ( n ) => n.id === id );
		return ( node && nodeName( node, doc.locales.default ) ) || __( 'Without a title', 'funnelforms-pro' );
	};
	return (
		<section className="ffxb-section ffxb-analytics-section ffxb-prediction-section" aria-label={ __( 'Prediction', 'funnelforms-pro' ) }>
			<h3 className="ffxb-section__title">{ __( 'Prediction', 'funnelforms-pro' ) }</h3>
			<div className="ffxb-prediction__kpis">
				<div>
					<strong>{ percent( result.conversion ) }</strong>
					<span>{ result.simulation.goal === 'sent' ? __( 'send the form', 'funnelforms-pro' ) : __( 'reach an end', 'funnelforms-pro' ) }</span>
					<span className="ffxb-hint">{ sprintf( __( 'likely %1$s to %2$s', 'funnelforms-pro' ), percent( result.low ), percent( result.high ) ) }</span>
				</div>
				<div>
					<strong>{ number( result.simulation.report.totals.completions ) }</strong>
					<span>{ sprintf( __( 'of %s virtual visitors', 'funnelforms-pro' ), number( result.visitors ) ) }</span>
				</div>
			</div>
			{ stored.model.summary ? <p>{ stored.model.summary }</p> : null }
			{ result.sticking.length ? (
				<>
					<h4 className="ffxb-prediction__heading">{ __( 'Sticking points', 'funnelforms-pro' ) }</h4>
					<ul className="ffxb-prediction__list">
						{ result.sticking.map( ( s ) => (
							<li key={ s.id }>
								<button type="button" className="ffxb-link" onClick={ () => store.getState().select( { node: s.id } ) }>
									{ name( s.id ) }
								</button>
								{ ' ' + sprintf( __( '%s leave here', 'funnelforms-pro' ), percent( s.dropRate ) ) }
								{ s.reasons[ 0 ] ? <span className="ffxb-hint">{ s.reasons[ 0 ] }</span> : null }
							</li>
						) ) }
					</ul>
				</>
			) : null }
			{ result.suggestions.length ? (
				<>
					<h4 className="ffxb-prediction__heading">{ __( 'What would help', 'funnelforms-pro' ) }</h4>
					<ul className="ffxb-prediction__list ffxb-prediction__suggestions">
						{ result.suggestions.map( ( s ) => (
							<li key={ s.id }>
								<strong>{ s.title }</strong>
								{ s.gain > 0.0005 ? <span className="ffxb-badge ffxb-badge--success">{ sprintf( __( '%1$s sent instead of %2$s', 'funnelforms-pro' ), percent( s.conversion ), percent( result.conversion ) ) }</span> : null }
								<span className="ffxb-hint">{ s.reason }</span>
								{ ask && s.instruction ? (
									<Button size="sm" variant="ghost" className="ffxb-ask-ai" icon={ icons.sparkles } onClick={ () => ask( s.instruction ) }>
										{ __( 'Apply with AI', 'funnelforms-pro' ) }
									</Button>
								) : null }
							</li>
						) ) }
					</ul>
				</>
			) : null }
			{ result.personas.length > 1 ? (
				<table className="ffxb-stats ffxb-prediction__personas">
					<caption>{ __( 'Kinds of visitors', 'funnelforms-pro' ) }</caption>
					<thead>
						<tr>
							<th>{ __( 'Visitors', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Share', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Sent', 'funnelforms-pro' ) }</th>
						</tr>
					</thead>
					<tbody>
						{ result.personas.map( ( p ) => (
							<tr key={ p.id } title={ p.description }>
								<td>{ p.name }</td>
								<td>{ percent( p.share ) }</td>
								<td>{ percent( p.conversion ) }</td>
							</tr>
						) ) }
					</tbody>
				</table>
			) : null }
			{ stored.model.insights.length ? (
				<ul className="ffxb-prediction__insights">
					{ stored.model.insights.map( ( i ) => (
						<li key={ i }>{ i }</li>
					) ) }
				</ul>
			) : null }
			<p className="ffxb-hint">{ sprintf( __( 'An estimate from the structure of the form, your description of the visitors and our benchmarks (%s), not a measurement. Your real figures appear in the analytics once the form is live.', 'funnelforms-pro' ), stored.model.benchmark ) }</p>
		</section>
	);
}

/** The prediction of the selected step in the inspector: reach, who leaves and why, and the answers. */
export function PredictionNodeSection( { nodeId }: { nodeId: string } ) {
	const mode = usePrediction();
	const result = mode?.result;
	const step = result?.steps.find( ( s ) => s.id === nodeId );
	if ( ! mode?.on || ! result || ! step ) {
		return null;
	}
	const answers = ( result.simulation.report.answers ?? [] ).filter( ( a ) => a.step === nodeId );
	return (
		<section className="ffxb-section ffxb-analytics-section ffxb-prediction-section" aria-label={ __( 'Prediction', 'funnelforms-pro' ) }>
			<h3 className="ffxb-section__title">{ __( 'Prediction', 'funnelforms-pro' ) }</h3>
			<p>
				{ sprintf( __( '%1$s of the visitors reach this step (%2$s to %3$s).', 'funnelforms-pro' ), percent( step.reachRate ), percent( step.reachLow ), percent( step.reachHigh ) ) }
				{ ' ' }
				{ null !== step.dropRate ? sprintf( __( '%s of them leave here.', 'funnelforms-pro' ), percent( step.dropRate ) ) : null }
			</p>
			{ step.unknown ? <Notice tone="info">{ __( 'This step is new since the prediction; it counts with a usual share. Predict again to include it.', 'funnelforms-pro' ) }</Notice> : null }
			{ step.reasons.length ? (
				<ul className="ffxb-prediction__reasons">
					{ step.reasons.map( ( r ) => (
						<li key={ r }>{ r }</li>
					) ) }
				</ul>
			) : null }
			{ answers.map( ( a ) => {
				const total = a.options.reduce( ( sum, o ) => sum + o.chosen, 0 );
				return (
					<table key={ a.field } className="ffxb-stats ffxb-answers">
						<caption>{ a.title || __( 'Without a title', 'funnelforms-pro' ) }</caption>
						<thead>
							<tr>
								<th>{ __( 'Answer', 'funnelforms-pro' ) }</th>
								<th>{ __( 'Chosen', 'funnelforms-pro' ) }</th>
								<th>{ __( 'Sent the form', 'funnelforms-pro' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ a.options.map( ( o ) => (
								<tr key={ o.id }>
									<td>{ o.label || o.id }</td>
									<td>{ percent( total > 0 ? o.chosen / total : null ) }</td>
									<td>{ percent( o.chosen > 0 ? o.completed / o.chosen : null ) }</td>
								</tr>
							) ) }
						</tbody>
					</table>
				);
			} ) }
		</section>
	);
}
