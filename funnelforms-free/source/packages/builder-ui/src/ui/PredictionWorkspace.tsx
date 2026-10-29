/**
 * The tab of the Predictive AI in the form editor (Funnelforms Pro), between Settings and Embed, in
 * three steps: describe the visitors (Audience), watch the virtual visitors go through the form as
 * it is in the editor (Simulation), and read the funnel score with the suggestions (Result).
 * It shares the prediction with the canvas mode (usePredictionState), so a new analysis shows on
 * the canvas at once and the canvas mode reads the same last prediction. The page Funnelforms →
 * Predictive AI stays the overview across all forms.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import type { FormsApi, PredictionQuota } from '../api';
import { DEFAULT_VISITORS, funnelScore, INDUSTRIES, worthApplying, type PredictionParameters } from '../predict';
import { useBuilder } from './context';
import { __, sprintf } from './i18n';
import { defaultParameters, industryNames, NotReady, number, predictionPrivacyText, type PredictionMode } from './Prediction';
import { EarlierList, EarlierView, useEarlier, type CurrentEntry } from './PredictionHistory';
import { PredictionResult } from './PredictionResult';
import { Check, countChips, PredictionStage, stepKind, stepName, stepOrder } from './PredictionStage';
import { Notice, Spinner } from './ui';

type Phase = 'setup' | 'sim' | 'result';

/** Where the setup starts the clock of the stage; the visitors only, to watch them again. */
const VISITORS_PHASE = 5.4;

export function PredictionWorkspace( { api, formId, mode, locale, onCanvas, onPublish }: { api: FormsApi; formId: number; mode: PredictionMode; locale?: string; onCanvas: ( node?: string ) => void; onPublish?: ( note: string ) => void } ) {
	const doc = useBuilder( ( s ) => s.doc );
	const [ parameters, setParameters ] = useState<PredictionParameters>( () => mode.stored?.parameters ?? defaultParameters() );
	// undefined while it loads; null when the server could not be reached.
	const [ quota, setQuota ] = useState<PredictionQuota | null | undefined>( undefined );
	// Null: the result once there is one, the setup before.
	const [ phase, setPhase ] = useState<Phase | null>( null );
	const [ sim, setSim ] = useState<{ from: number; waiting: boolean; key: number }>( { from: 0, waiting: false, key: 0 } );
	const [ progress, setProgress ] = useState( 0 );

	const loadQuota = useCallback( () => {
		if ( ! api.predictionQuota ) {
			setQuota( null );
			return;
		}
		api.predictionQuota()
			.then( setQuota )
			.catch( () => setQuota( null ) );
	}, [ api ] );
	useEffect( loadQuota, [ loadQuota ] );

	// The description of the visitors of the last prediction, once it is loaded.
	const last = mode.stored;
	useEffect( () => {
		if ( last ) {
			setParameters( last.parameters );
		}
	}, [ last ] );

	const steps = doc ? doc.nodes.filter( ( n ) => 'end' !== n.type ) : [];
	const empty = quota?.included === true && quota.remaining <= 0;
	const canRun = mode.ready && !! doc && steps.length > 0 && ! mode.busy && ! empty;
	// The result of the newest prediction only; during a new analysis the old one is not shown on the stage.
	const fresh = mode.result && last && mode.resultOf === last ? mode.result : null;
	const shown: Phase = phase ?? ( fresh ? 'result' : 'setup' );
	// Earlier predictions with the real figures; one of them opened instead of the current one.
	const history = useEarlier( api, formId, last?.created ?? null );
	const [ earlier, setEarlier ] = useState<number | null>( null );
	useEffect( () => setEarlier( null ), [ last ] );
	const opened = null === earlier ? null : history?.history[ earlier ] ?? null;
	const current: CurrentEntry | null =
		fresh && last ? { created: last.created, score: funnelScore( fresh ), conversion: fresh.conversion, open: worthApplying( fresh.suggestions ).length } : null;
	const list = (
		<EarlierList
			current={ current }
			history={ history }
			locale={ locale }
			chosen={ earlier }
			onOpen={ ( i ) => {
				setEarlier( i );
				if ( null === i && fresh ) {
					setPhase( 'result' );
				}
			} }
		/>
	);
	const hasEarlier = !! history?.history.length;

	const run = async (): Promise<void> => {
		setSim( ( s ) => ( { from: 0, waiting: true, key: s.key + 1 } ) );
		setProgress( 0 );
		setPhase( 'sim' );
		const ok = await mode.run( parameters, DEFAULT_VISITORS );
		loadQuota();
		if ( ok ) {
			setSim( ( s ) => ( { ...s, waiting: false } ) );
		} else {
			setPhase( 'setup' );
		}
	};
	const replay = (): void => {
		setSim( ( s ) => ( { from: VISITORS_PHASE, waiting: false, key: s.key + 1 } ) );
		setPhase( 'sim' );
	};

	if ( ! doc ) {
		return null;
	}
	return (
		<div className="ffxb-workspace ffxb-predict-tab ffxb-pai">
			<Stepper phase={ shown } progress={ progress } hasResult={ !! fresh } running={ 'sim' === shown } onPhase={ setPhase } quota={ quota } />
			<div className="ffxb-pai__main">
				{ mode.ready ? null : <NotReady accountUrl={ mode.accountUrl } /> }
				{ mode.error ? <Notice tone="danger">{ mode.error }</Notice> : null }
				{ mode.loading ? <Spinner label={ __( 'Loading the prediction…', 'funnelforms-pro' ) } /> : null }
				{ ! steps.length ? <Notice tone="info">{ __( 'This form has no steps yet. Add steps in the form builder first.', 'funnelforms-pro' ) }</Notice> : null }
				{ empty ? <Notice tone="warning">{ __( 'Your license has no analyses left this month.', 'funnelforms-pro' ) }</Notice> : null }
				{ opened && 'sim' !== shown ? <EarlierView entry={ opened } doc={ doc } locale={ locale } onBack={ () => setEarlier( null ) } /> : null }
				{ 'setup' === shown && ! opened ? <Setup doc={ doc } parameters={ parameters } onChange={ setParameters } canRun={ canRun } busy={ mode.busy } onRun={ () => void run() } quota={ quota } history={ hasEarlier || current ? list : null } /> : null }
				{ 'sim' === shown ? (
					<PredictionStage
						key={ sim.key }
						doc={ doc }
						parameters={ parameters }
						result={ sim.waiting ? null : fresh }
						model={ sim.waiting ? null : last?.model ?? null }
						from={ sim.from }
						onProgress={ setProgress }
						onDone={ () => setPhase( 'result' ) }
					/>
				) : null }
				{ 'result' === shown && fresh && last && ! opened ? <PredictionResult doc={ doc } result={ fresh } stored={ last } locale={ locale } busy={ mode.busy } canRun={ canRun } onReplay={ replay } onCanvas={ onCanvas } onSetup={ () => setPhase( 'setup' ) } onRun={ () => void run() } apply={ mode } onPublish={ onPublish } /> : null }
				{ 'result' === shown && ! fresh && ! mode.loading ? <Spinner label={ __( 'Loading the prediction…', 'funnelforms-pro' ) } /> : null }
				{ ( 'result' === shown || opened ) && hasEarlier ? (
					<section className="ffxb-pai-card ffxb-pai-history-card" aria-labelledby="ffxb-pai-history-title">
						<div className="ffxb-pai-history-card__head">
							<h2 id="ffxb-pai-history-title">{ __( 'History', 'funnelforms-pro' ) }</h2>
							<span className="ffxb-pai-muted">{ __( 'Earlier predictions with the real figures after them', 'funnelforms-pro' ) }</span>
						</div>
						{ list }
					</section>
				) : null }
			</div>
		</div>
	);
}

/** The three steps of the tab and the analyses left, under the top bar. */
function Stepper( { phase, progress, hasResult, running, onPhase, quota }: { phase: Phase; progress: number; hasResult: boolean; running: boolean; onPhase: ( p: Phase ) => void; quota: PredictionQuota | null | undefined } ) {
	const at = 'setup' === phase ? 0 : 'sim' === phase ? 1 : 2;
	const items: Array<[ Phase, string, string ]> = [
		[ 'setup', __( 'Audience', 'funnelforms-pro' ), __( 'Who comes to your form?', 'funnelforms-pro' ) ],
		[ 'sim', __( 'Simulation', 'funnelforms-pro' ), sprintf( __( '%s virtual visitors', 'funnelforms-pro' ), number( DEFAULT_VISITORS ) ) ],
		[ 'result', __( 'Result', 'funnelforms-pro' ), __( 'Score and suggestions', 'funnelforms-pro' ) ],
	];
	return (
		<div className="ffxb-pai-bar">
			<ol className="ffxb-pai-stepper" aria-label={ __( 'Steps of the Predictive AI', 'funnelforms-pro' ) }>
				{ items.map( ( [ id, label, sub ], i ) => {
					const done = i < at;
					const active = i === at;
					// The simulation is no place to go to; the result only with one.
					const link = ! active && ! running && 'sim' !== id && ( 'result' !== id || hasResult );
					const fill = 0 === i ? ( at > 0 ? 100 : 0 ) : 'sim' === phase ? Math.round( progress * 100 ) : at > 1 ? 100 : 0;
					return (
						<li key={ id }>
							<button type="button" className={ 'ffxb-pai-step' + ( active ? ' is-active' : '' ) + ( done ? ' is-done' : '' ) + ( link ? ' is-link' : '' ) } aria-current={ active ? 'step' : undefined } disabled={ ! link && ! active } onClick={ () => link && onPhase( id ) }>
								<span className="ffxb-pai-step__dot">{ done ? <Check /> : i + 1 }</span>
								<span className="ffxb-pai-step__text">
									<strong>{ label }</strong>
									<span>{ sub }</span>
								</span>
							</button>
							{ i < 2 ? (
								<span className="ffxb-pai-step__line" aria-hidden="true">
									<span style={ { width: `${ fill }%` } } />
								</span>
							) : null }
						</li>
					);
				} ) }
			</ol>
			{ quota && quota.included ? (
				<div className="ffxb-pai-quota">
					<span className="ffxb-pai-quota__bar" aria-hidden="true">
						<span style={ { width: `${ quota.limit > 0 ? Math.round( ( 100 * quota.remaining ) / quota.limit ) : 0 }%` } } />
					</span>
					<span>{ sprintf( __( '%1$d of %2$d behaviour analyses left this month', 'funnelforms-pro' ), quota.remaining, quota.limit ) }</span>
				</div>
			) : null }
		</div>
	);
}

function Setup( { doc, parameters: p, onChange, canRun, busy, onRun, quota, history }: { doc: FormDocument; parameters: PredictionParameters; onChange: ( p: PredictionParameters ) => void; canRun: boolean; busy: boolean; onRun: () => void; quota: PredictionQuota | null | undefined; history: React.ReactNode } ) {
	const [ explain, setExplain ] = useState( false );
	const [ more, setMore ] = useState( false );
	const set = <K extends keyof PredictionParameters>( key: K, value: PredictionParameters[ K ] ): void => onChange( { ...p, [ key ]: value } );
	const names = industryNames();
	const order = useMemo( () => stepOrder( doc ), [ doc ] );
	const chips = useMemo( () => countChips( doc ), [ doc ] );
	const intents: Array<[ PredictionParameters[ 'intent' ], string, string ]> = [
		[ 'research', __( 'Just looking around', 'funnelforms-pro' ), __( 'Reads first, decides later', 'funnelforms-pro' ) ],
		[ 'compare', __( 'Comparing offers', 'funnelforms-pro' ), __( 'Interested, checks several providers', 'funnelforms-pro' ) ],
		[ 'ready', __( 'Ready to buy', 'funnelforms-pro' ), __( 'Looking for a provider now', 'funnelforms-pro' ) ],
	];
	const sources: Array<[ PredictionParameters[ 'traffic' ], string ]> = [
		[ 'search_ads', __( 'Search ads', 'funnelforms-pro' ) ],
		[ 'social_ads', __( 'Social media ads', 'funnelforms-pro' ) ],
		[ 'organic', __( 'Search results and own website', 'funnelforms-pro' ) ],
		[ 'email', __( 'Newsletter and e-mail', 'funnelforms-pro' ) ],
		[ 'direct', __( 'Direct, recommendations', 'funnelforms-pro' ) ],
		[ 'mixed', __( 'Mixed', 'funnelforms-pro' ) ],
	];
	const audiences: Array<[ PredictionParameters[ 'audience' ], string ]> = [
		[ 'b2c', __( 'Private customers', 'funnelforms-pro' ) ],
		[ 'b2b', __( 'Business customers', 'funnelforms-pro' ) ],
		[ 'mixed', __( 'Both', 'funnelforms-pro' ) ],
	];
	const mobile = p.mobile_share;
	const shownMobile = mobile ?? 60;
	const line = [
		audiences.find( ( a ) => a[ 0 ] === p.audience )?.[ 1 ],
		intents.find( ( a ) => a[ 0 ] === p.intent )?.[ 1 ],
		sources.find( ( a ) => a[ 0 ] === p.traffic )?.[ 1 ],
		null === mobile ? __( 'usual share on phones', 'funnelforms-pro' ) : sprintf( __( '%s on phones', 'funnelforms-pro' ), `${ mobile }\u00a0%` ),
	]
		.filter( Boolean )
		.join( ' · ' );
	const how: Array<[ string, string ]> = [
		[ __( 'Read the form', 'funnelforms-pro' ), __( 'Steps, fields, required fields, logic and calculations, exactly as they are in the editor.', 'funnelforms-pro' ) ],
		[ __( 'Understand the visitors', 'funnelforms-pro' ), __( 'From your description the AI builds kinds of visitors with their own patience, intent and device.', 'funnelforms-pro' ) ],
		[ sprintf( __( 'Send %s visitors', 'funnelforms-pro' ), number( DEFAULT_VISITORS ) ), __( 'Every visitor goes through your real logic and decides at every field by benchmarks.', 'funnelforms-pro' ) ],
		[ __( 'Work out the suggestions', 'funnelforms-pro' ), __( 'Every improvement is simulated again with the same visitors. That is where the points on each suggestion come from.', 'funnelforms-pro' ) ],
	];
	const faq: Array<[ string, string ]> = [
		[ __( 'What is the funnel score?', 'funnelforms-pro' ), __( 'How much of what is possible with your form you already get today. 100 means: the AI finds nothing that brings noticeably more leads.', 'funnelforms-pro' ) ],
		[ __( 'How exact is it?', 'funnelforms-pro' ), __( 'An estimate with a range, not a promise. Once real visitors come, the statistics put the real figures beside it.', 'funnelforms-pro' ) ],
		[ __( 'What is sent to the AI?', 'funnelforms-pro' ), __( 'Only the structure of your form and what you enter on this page. No entries, no visitor data.', 'funnelforms-pro' ) ],
	];
	return (
		<div className="ffxb-pai-setup">
			<section className="ffxb-pai-setup__main">
				<div className="ffxb-pai-intro">
					<div className="ffxb-pai-intro__text">
						<span className="ffxb-pai-intro__badge">{ __( 'Predictive AI', 'funnelforms-pro' ) }</span>
						<h1>{ sprintf( __( 'Test your form with %s virtual visitors before real ones come.', 'funnelforms-pro' ), number( DEFAULT_VISITORS ) ) }</h1>
						<p>{ __( 'The AI sends your audience through your real steps and logic and shows where leads get lost and what would help.', 'funnelforms-pro' ) }</p>
						<button type="button" className="ffxb-pai-btn ffxb-pai-btn--onbrand" aria-expanded={ explain } onClick={ () => setExplain( ! explain ) }>
							<Help />
							{ explain ? __( 'Close the explanation', 'funnelforms-pro' ) : __( 'How the Predictive AI works', 'funnelforms-pro' ) }
							<Chevron open={ explain } />
						</button>
					</div>
					<div className="ffxb-pai-intro__art" aria-hidden="true">
						<svg width="100%" height="150" viewBox="0 0 240 150" preserveAspectRatio="xMidYMid meet">
							<path d="M4 18 L170 52 L170 98 L4 132 Z" fill="rgba(255,255,255,.12)" />
							<path d="M170 52 L200 64 L200 86 L170 98 Z" fill="rgba(255,255,255,.2)" />
							<circle cx="20" cy="40" r="4" fill="#fff" opacity=".9" />
							<circle cx="34" cy="96" r="4" fill="#fff" opacity=".7" />
							<circle cx="58" cy="66" r="4" fill="#fff" opacity=".9" />
							<circle cx="82" cy="110" r="3.5" fill="#ffd08a" />
							<circle cx="90" cy="128" r="3" fill="#ffd08a" opacity=".6" />
							<circle cx="104" cy="58" r="4" fill="#fff" opacity=".8" />
							<circle cx="128" cy="86" r="4" fill="#fff" opacity=".9" />
							<circle cx="140" cy="104" r="3.5" fill="#ffd08a" />
							<circle cx="152" cy="68" r="4" fill="#fff" />
							<circle cx="186" cy="76" r="5" fill="#7ff0cf" />
							<rect x="208" y="50" width="28" height="50" rx="8" fill="rgba(127,240,207,.25)" stroke="#7ff0cf" />
							<rect x="212" y="74" width="20" height="22" rx="5" fill="#7ff0cf" />
						</svg>
					</div>
				</div>

				{ explain ? (
					<div className="ffxb-pai-card ffxb-pai-how ffxb-pai-in">
						<div className="ffxb-pai-card__head">
							<h2>{ __( 'How the Predictive AI works it out', 'funnelforms-pro' ) }</h2>
							<span>{ __( 'This can take up to a minute.', 'funnelforms-pro' ) }</span>
						</div>
						<ol className="ffxb-pai-how__steps">
							{ how.map( ( [ title, body ], i ) => (
								<li key={ title }>
									<span>
										<span className="ffxb-pai-how__n">{ i + 1 }</span>
										<strong>{ title }</strong>
									</span>
									<span>{ body }</span>
								</li>
							) ) }
						</ol>
						<div className="ffxb-pai-how__faq">
							{ faq.map( ( [ q, a ] ) => (
								<div key={ q }>
									<strong>{ q }</strong>
									<span>{ a }</span>
								</div>
							) ) }
						</div>
					</div>
				) : null }

				<div className="ffxb-pai-card ffxb-pai-audience">
					<div className="ffxb-pai-card__head">
						<h2>{ __( 'Who comes to your form?', 'funnelforms-pro' ) }</h2>
					</div>
					<div className="ffxb-pai-grid">
						<label className="ffxb-pai-field">
							{ __( 'Industry', 'funnelforms-pro' ) }
							<select className="ffxb-pai-input" value={ p.industry } disabled={ busy } onChange={ ( e ) => set( 'industry', e.target.value ) }>
								{ INDUSTRIES.map( ( value ) => (
									<option key={ value } value={ value }>
										{ names[ value ] }
									</option>
								) ) }
							</select>
						</label>
						{ 'other' === p.industry ? (
							<label className="ffxb-pai-field">
								{ __( 'Your industry', 'funnelforms-pro' ) }
								<input className="ffxb-pai-input" type="text" value={ p.industry_label } disabled={ busy } onChange={ ( e ) => set( 'industry_label', e.target.value.slice( 0, 100 ) ) } />
							</label>
						) : null }
						<label className="ffxb-pai-field">
							{ __( 'Value of one lead', 'funnelforms-pro' ) }
							<span className="ffxb-pai-input ffxb-pai-input--unit">
								<input type="text" inputMode="numeric" value={ String( p.lead_value ) } disabled={ busy } onChange={ ( e ) => set( 'lead_value', Math.min( 1000000, Number( e.target.value.replace( /\D/g, '' ) ) || 0 ) ) } />
								<input type="text" aria-label={ __( 'Currency', 'funnelforms-pro' ) } className="ffxb-pai-currency" value={ p.currency } disabled={ busy } onChange={ ( e ) => set( 'currency', e.target.value.toUpperCase().replace( /[^A-Z]/g, '' ).slice( 0, 3 ) ) } />
							</span>
						</label>
					</div>
					<div className="ffxb-pai-group">
						<span className="ffxb-pai-group__label">{ __( 'How ready to buy are they?', 'funnelforms-pro' ) }</span>
						<div role="group" aria-label={ __( 'How ready to buy are they?', 'funnelforms-pro' ) } className="ffxb-pai-intents">
							{ intents.map( ( [ id, label, sub ] ) => (
								<button key={ id } type="button" className={ 'ffxb-pai-intent' + ( p.intent === id ? ' is-on' : '' ) } aria-pressed={ p.intent === id } disabled={ busy } onClick={ () => set( 'intent', id ) }>
									<strong>{ label }</strong>
									<span>{ sub }</span>
									{ p.intent === id ? (
										<span className="ffxb-pai-intent__check">
											<Check />
										</span>
									) : null }
								</button>
							) ) }
						</div>
					</div>
					<div className="ffxb-pai-group">
						<span className="ffxb-pai-group__label">{ __( 'Where do they come from?', 'funnelforms-pro' ) }</span>
						<div role="group" aria-label={ __( 'Where do they come from?', 'funnelforms-pro' ) } className="ffxb-pai-chips">
							{ sources.map( ( [ id, label ] ) => (
								<button key={ id } type="button" className={ 'ffxb-pai-chip' + ( p.traffic === id ? ' is-on' : '' ) } aria-pressed={ p.traffic === id } disabled={ busy } onClick={ () => set( 'traffic', id ) }>
									{ label }
								</button>
							) ) }
						</div>
					</div>
					<div className="ffxb-pai-grid">
						<div className="ffxb-pai-group">
							<span className="ffxb-pai-group__label">{ __( 'Phone or desktop?', 'funnelforms-pro' ) }</span>
							<span className={ 'ffxb-pai-split' + ( null === mobile ? ' is-usual' : '' ) } aria-hidden="true">
								<span style={ { width: `${ shownMobile }%` } }>{ sprintf( __( 'Phone %s', 'funnelforms-pro' ), `${ shownMobile }\u00a0%` ) }</span>
								<span>{ sprintf( __( 'Desktop %s', 'funnelforms-pro' ), `${ 100 - shownMobile }\u00a0%` ) }</span>
							</span>
							<input className="ffxb-pai-range" type="range" min={ 0 } max={ 100 } value={ shownMobile } disabled={ busy } aria-label={ __( 'Share on phones in percent (empty: usual for the source)', 'funnelforms-pro' ) } onChange={ ( e ) => set( 'mobile_share', Number( e.target.value ) ) } />
							<span className="ffxb-pai-muted is-small">
								{ null === mobile ? (
									__( 'Not set: the AI takes the usual share of the source.', 'funnelforms-pro' )
								) : (
									<button type="button" className="ffxb-link" onClick={ () => set( 'mobile_share', null ) }>
										{ __( 'Use the usual share of the source', 'funnelforms-pro' ) }
									</button>
								) }
							</span>
						</div>
						<label className="ffxb-pai-field">
							{ __( 'Anything else about your visitors?', 'funnelforms-pro' ) }
							<textarea className="ffxb-pai-input" rows={ 3 } maxLength={ 500 } value={ p.notes } disabled={ busy } placeholder={ __( 'For example: mostly home owners in the countryside who want a quick price.', 'funnelforms-pro' ) } onChange={ ( e ) => set( 'notes', e.target.value ) } />
						</label>
					</div>
					<button type="button" className="ffxb-pai-more" aria-expanded={ more } onClick={ () => setMore( ! more ) }>
						<span>{ __( 'Customers and age groups', 'funnelforms-pro' ) }</span>
						<span className="ffxb-pai-muted">{ [ audiences.find( ( a ) => a[ 0 ] === p.audience )?.[ 1 ], p.ages.length ? p.ages.join( ', ' ) : __( 'all ages', 'funnelforms-pro' ) ].filter( Boolean ).join( ' · ' ) }</span>
						<Chevron open={ more } />
					</button>
					{ more ? (
						<div className="ffxb-pai-more__body ffxb-pai-in">
							<div className="ffxb-pai-group">
								<span className="ffxb-pai-group__label">{ __( 'Customers', 'funnelforms-pro' ) }</span>
								<div role="group" aria-label={ __( 'Customers', 'funnelforms-pro' ) } className="ffxb-pai-chips">
									{ audiences.map( ( [ id, label ] ) => (
										<button key={ id } type="button" className={ 'ffxb-pai-chip' + ( p.audience === id ? ' is-on' : '' ) } aria-pressed={ p.audience === id } disabled={ busy } onClick={ () => set( 'audience', id ) }>
											{ label }
										</button>
									) ) }
								</div>
							</div>
							<div className="ffxb-pai-group">
								<span className="ffxb-pai-group__label">{ __( 'Age groups (none: mixed)', 'funnelforms-pro' ) }</span>
								<div role="group" aria-label={ __( 'Age groups (none: mixed)', 'funnelforms-pro' ) } className="ffxb-pai-chips">
									{ ( [ '18-29', '30-44', '45-59', '60+' ] as const ).map( ( age ) => {
										const on = p.ages.includes( age );
										return (
											<button key={ age } type="button" className={ 'ffxb-pai-chip' + ( on ? ' is-on' : '' ) } aria-pressed={ on } disabled={ busy } onClick={ () => set( 'ages', on ? p.ages.filter( ( a ) => a !== age ) : [ ...p.ages, age ] ) }>
												{ age }
											</button>
										);
									} ) }
								</div>
							</div>
						</div>
					) : null }
					<div className="ffxb-pai-line">
						<span>
							{ __( 'Simulated:', 'funnelforms-pro' ) } <strong>{ line }</strong>
						</span>
					</div>
				</div>
			</section>

			<aside className="ffxb-pai-setup__side">
				<div className="ffxb-pai-card ffxb-pai-ready">
					<div>
						<h2>{ __( 'Ready for the simulation', 'funnelforms-pro' ) }</h2>
						<span className="ffxb-pai-muted">{ __( 'The AI takes your form as it is in the editor right now.', 'funnelforms-pro' ) }</span>
					</div>
					<div className="ffxb-pai-chips">
						{ chips.map( ( c ) => (
							<span key={ c } className="ffxb-pai-tag">
								{ c }
							</span>
						) ) }
					</div>
					<ol className={ 'ffxb-pai-ready__steps' + ( order.length > 10 ? ' is-long' : '' ) }>
						{ order.map( ( n, i ) => (
							<li key={ n.id }>
								<span className="ffxb-pai-ready__n">{ i + 1 }</span>
								<span className="ffxb-pai-ready__name">{ stepName( doc, n ) }</span>
								<span className="ffxb-pai-ready__kind">{ stepKind( n ) }</span>
							</li>
						) ) }
					</ol>
					<div className="ffxb-pai-ready__visitors">
						<span className="ffxb-pai-ready__icon" aria-hidden="true">
							<People />
						</span>
						<span>
							<strong>{ sprintf( __( '%s virtual visitors', 'funnelforms-pro' ), number( DEFAULT_VISITORS ) ) }</strong>
							<span>{ sprintf( __( 'More would not make the result more exact: from %s on it varies by less than half a percentage point.', 'funnelforms-pro' ), number( DEFAULT_VISITORS ) ) }</span>
						</span>
					</div>
					<button type="button" className="ffxb-pai-btn ffxb-pai-btn--primary ffxb-pai-btn--big" disabled={ ! canRun } onClick={ onRun }>
						<Sparkle />
						{ __( 'Start the simulation', 'funnelforms-pro' ) }
					</button>
					<p className="ffxb-pai-muted is-small">
						{ quota && quota.included ? sprintf( __( 'Uses 1 of %d analyses left.', 'funnelforms-pro' ), quota.remaining ) + ' ' : '' }
						{ predictionPrivacyText() }
					</p>
				</div>
				{ history ? (
					<div className="ffxb-pai-card ffxb-pai-history-card">
						<div className="ffxb-pai-history-card__head">
							<h2>{ __( 'Earlier predictions', 'funnelforms-pro' ) }</h2>
							<span className="ffxb-pai-muted">{ __( 'with the real figures after them', 'funnelforms-pro' ) }</span>
						</div>
						{ history }
					</div>
				) : null }
			</aside>
		</div>
	);
}

function Chevron( { open }: { open: boolean } ) {
	return (
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={ { transform: `rotate(${ open ? 180 : 0 }deg)` } }>
			<path d="M6 9l6 6 6-6" />
		</svg>
	);
}

function Help() {
	return (
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="9" />
			<path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5M12 17h.01" />
		</svg>
	);
}

function Sparkle() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 2l1.9 5.6 5.6 1.9-5.6 1.9L12 17l-1.9-5.6-5.6-1.9 5.6-1.9z" />
			<path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" />
		</svg>
	);
}

function People() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="9" cy="8" r="3.5" />
			<path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
			<path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.8 2.6 3 5.2" />
		</svg>
	);
}
