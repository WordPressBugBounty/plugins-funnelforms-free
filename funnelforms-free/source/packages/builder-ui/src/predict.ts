/**
 * Predictive AI (Funnelforms Pro, docs/api/predictions.md): the simulation of a form's visitors
 * without React. The Funnelforms server answers with a behaviour model of the visitors (personas,
 * the share of each that finishes each step, answer distributions, reasons and suggestions); here
 * N virtual visitors go through the form with it and with the form's own logic: A/B variants,
 * fields shown by conditions, paths, and calculations where paths compare them. The result has the
 * shape of the statistics of a published form, so the analytics mode can draw it on the canvas.
 * The same model, form and seed always give the same figures.
 */
import type { FormStatsReport } from './api';
import { assignVariants, holds, next, startNode, usesCalculations, type Answers, type CalcValues, type Variants } from '@funnelforms/form-core';
import type { ContactNode, Field, FormDocument, FormNode, StepNode } from '@funnelforms/form-schema';
import { testValues } from './calculations';
import { nodeName, text } from './document';

/** What the owner says about the visitors (KiPrognoseAnfrageSchema of the server). */
export interface PredictionParameters {
	industry: string;
	/** The industry in the owner's words, with industry "other". */
	industry_label: string;
	lead_value: number;
	currency: string;
	audience: 'b2c' | 'b2b' | 'mixed';
	ages: string[];
	intent: 'research' | 'compare' | 'ready';
	traffic: 'search_ads' | 'social_ads' | 'organic' | 'email' | 'direct' | 'mixed';
	/** Percent; null: the usual share of the traffic source. */
	mobile_share: number | null;
	notes: string;
}

export const INDUSTRIES = [ 'solar', 'heat_pump', 'real_estate_buy', 'luxury_real_estate', 'property_valuation', 'trades', 'construction', 'insurance', 'financing', 'legal_tax', 'coaching', 'recruiting', 'health', 'beauty', 'fitness', 'education', 'software_b2b', 'agency', 'automotive', 'travel_events', 'product_advice', 'gastronomy', 'energy_tariffs', 'other' ] as const;
export const AGES = [ '18-29', '30-44', '45-59', '60+' ] as const;
export const SUGGESTION_KINDS = [ 'move_step', 'reword', 'optional_field', 'remove_field', 'split_step', 'help_text', 'trust', 'fewer_options', 'qualify', 'other' ] as const;

/** Per persona id. */
type PerPersona = Record<string, number>;

/** The behaviour model of the server (model of POST /kunde/v1/ki/prognose). */
export interface PredictionModel {
	/** Version of the benchmarks the prior values come from. */
	benchmark: string;
	personas: Array<{ id: string; name: string; share: number; description: string }>;
	steps: Array<{
		node: string;
		/** Share that finishes the step after the benchmarks alone. */
		prior: number;
		/** Without numbers of the AI: the prior for every persona. */
		estimated: boolean;
		uncertainty: number;
		continue: PerPersona;
		reasons: string[];
		fields: Array<{ field: string; fill?: PerPersona; options?: Record<string, PerPersona>; buckets?: Record<string, number[]> }>;
	}>;
	/**
	 * What makes a lead worth most to the owner: with field, the leads who chose one of its options;
	 * otherwise each persona's share of qualified leads. Missing in models before 5.0.1.
	 */
	qualified?: { label: string; field: string | null; options: string[]; share: PerPersona } | null;
	insights: string[];
	suggestions: PredictionSuggestion[];
	summary: string;
}

/** Where a suggestion comes from: a rule of the benchmarks (assumed or measured), or an estimate of the AI. */
export interface SuggestionSource {
	rule: string | null;
	origin: 'assumption' | 'measured' | 'ai';
	/** One sentence in the form's language. */
	text: string;
}

export interface PredictionSuggestion {
	id: string;
	kind: ( typeof SUGGESTION_KINDS )[ number ];
	node: string;
	field: string | null;
	title: string;
	reason: string;
	/** An instruction for the AI bar, in the form's language. */
	instruction: string;
	/** Change of the share that finishes each step it touches. */
	effect: Array<{ node: string; delta: number }>;
	/** more: more visitors send the form; better: more of the leads are qualified. More without it. */
	goal?: 'more' | 'better';
	/** Change of the share of qualified leads among all leads. */
	quality?: number;
	source?: SuggestionSource | null;
}

/** A prediction as the plugin keeps it: the last one per form (Predictions in the plugin). */
export interface StoredPrediction {
	model: PredictionModel;
	parameters: PredictionParameters;
	/** Simulated visitors. */
	visitors: number;
	/** UTC, ISO 8601. */
	created: string;
	/** Suggestions put into the form since, with what the AI changed; the oldest first. */
	applied?: AppliedSuggestion[];
	/** The figures the builder simulated with it, for the statistics; null before the first simulation. */
	figures?: PredictionFigures | null;
}

/**
 * The figures of a prediction as the plugin keeps them (POST …/prediction/figures): the share that
 * sends the form with the applied suggestions (conversion) and without them (original), its range,
 * with all suggestions (best), the funnel score, what each suggestion adds (open ones against the
 * form now, applied ones their share) and which were applied then. Shares from 0 to 1.
 */
export interface PredictionFigures {
	conversion: number;
	original: number;
	low: number;
	high: number;
	best: number;
	score: number;
	suggestions: Record<string, number>;
	applied: string[];
	/** UTC, ISO 8601; set by the plugin. */
	at?: string;
}

/** Views, sent entries and their rate of the published form in a time (PredictionChanges in the plugin). */
export interface MeasuredFigures {
	views: number;
	completions: number;
	rate: number | null;
	/** Enough views (300) to compare. */
	enough: boolean;
	days: number;
}

/** The real figures around a prediction: the 30 days before it, and after the first publishing since (null: none yet). */
export interface RealFigures {
	before: MeasuredFigures;
	after: MeasuredFigures | null;
	/** UTC, ISO 8601. */
	published: string | null;
}

/** An earlier prediction of a form, without its model (GET …/prediction, history). */
export interface EarlierPrediction {
	created: string;
	visitors: number;
	industry: string;
	applied: AppliedSuggestion[];
	figures: PredictionFigures | null;
	suggestions: Array<{ id: string; kind: string; node: string; title: string }>;
	real: RealFigures;
}

/** The figures to keep with a prediction. */
export function figuresOf( result: Prediction ): PredictionFigures {
	const round = ( v: number ): number => Math.round( v * 10000 ) / 10000;
	const suggestions: Record<string, number> = {};
	for ( const s of [ ...result.suggestions, ...result.applied ] ) {
		suggestions[ s.id ] = round( Math.max( -1, Math.min( 1, s.gain ) ) );
	}
	return {
		conversion: round( result.conversion ),
		original: round( result.original ),
		low: round( result.low ),
		high: round( result.high ),
		best: round( Math.max( result.best, result.conversion ) ),
		score: funnelScore( result ),
		suggestions,
		applied: result.applied.map( ( s ) => s.id ),
	};
}

/** A suggestion the AI put into the form with one click (Umsetzen in the tab of the Predictive AI). */
export interface AppliedSuggestion {
	suggestion: string;
	/** What the AI said it changed. */
	summary: string;
	/** UTC, ISO 8601. */
	at: string;
}

/** The ids of the suggestions of a prediction that were put into the form. */
export function appliedIds( stored: Pick<StoredPrediction, 'applied'> | null | undefined ): string[] {
	return ( stored?.applied ?? [] ).map( ( a ) => a.suggestion );
}

export const VISITORS = [ 1000, 10000, 50000 ] as const;
export const DEFAULT_VISITORS = 10000;
const SEED = 20261023;
/** Visitors whose way the canvas plays (simulation.traces of a prediction): one dot each. */
export const TRACED = 100;
/** Share that finishes a step the model does not know (added after the prediction). */
const UNKNOWN_STEP = 0.85;
/**
 * A sticking point: at least 8 % of those who reach the step leave, and 1.5 times as many as on the
 * median step; a step that loses 30 % or more always is one (the band "many leave" of the analytics).
 */
const STICKING_MIN = 0.08;
const STICKING_FACTOR = 1.5;
const STICKING_ALWAYS = 0.3;
const STICKING_MAX = 3;

/** Small fast random numbers with a seed (mulberry32): the same seed gives the same visitors. */
export function seeded( seed: number ): () => number {
	let a = seed >>> 0;
	return () => {
		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}

function clamp( value: number, low: number, high: number ): number {
	return Math.min( high, Math.max( low, value ) );
}

/** The key of a share by weights: the first whose running sum passes r times the total. */
function pick( weights: Array<[ string, number ]>, r: number ): string | null {
	const total = weights.reduce( ( sum, [ , w ] ) => sum + Math.max( 0, w ), 0 );
	if ( total <= 0 ) {
		return weights[ Math.floor( r * weights.length ) ]?.[ 0 ] ?? null;
	}
	let point = r * total;
	for ( const [ key, w ] of weights ) {
		if ( w > 0 && point < w ) {
			return key;
		}
		point -= Math.max( 0, w );
	}
	return weights[ weights.length - 1 ]?.[ 0 ] ?? null;
}

interface Scenario {
	/** -1 to 1: every share that finishes a step moved by that many times its uncertainty. */
	shift?: number;
	/** Changes of the share that finishes steps (a suggestion). */
	effect?: Array<{ node: string; delta: number }>;
	/** Keep the way of this many visitors, the first ones (simulation.traces). */
	trace?: number;
}

/** The way of one virtual visitor through the form, to play on the canvas. */
export interface VisitorTrace {
	persona: string;
	/** The nodes the visitor reached, in order; an end last when they got to one. */
	nodes: string[];
	/** They left the form on the last of the nodes. */
	left: boolean;
	/** From this node on (its index in nodes) the visitor is a lead: the contact step after it was sent, or the end of a form without one; -1: never. */
	lead: number;
}

/** One run of the simulation: the figures in the shape of the statistics, and per persona. */
export interface Simulation {
	report: FormStatsReport;
	/** Visitors and those who reached the goal, per persona id. */
	personas: Map<string, { visitors: number; completions: number }>;
	/** sent: the form has a contact step and the goal is sending it; end: the goal is reaching an end. */
	goal: 'sent' | 'end';
	/** Of those who reached the goal, the qualified ones (model.qualified); 0 without it. */
	qualified: number;
	/** The ways of the first visitors (scenario.trace); empty without it. */
	traces: VisitorTrace[];
}

/** A count that also counts the visitors who reached the goal. */
interface Counted {
	completed: number;
}

/** A node in one run: how visitors leave it and what they answer there, and its counts. */
interface NodeVisit {
	/** null for the start, before the first node. */
	node: FormNode | null;
	/** Its edges, and the steps with date fields (their formats), for next(). */
	route: Pick<FormDocument, 'edges' | 'nodes'>;
	fields: Array<{ field: Field; model: PredictionModel[ 'steps' ][ number ][ 'fields' ][ number ] | undefined; weights: Map<string, Array<[ string, number ]>> }>;
	reached: number;
	left: number;
	/** The ways from it, by the node they lead to. */
	into: Map<string, Counted & { from: string; to: string; sessions: number }>;
}

/** Answer fields a visitor gives, in the order of the step; content and results ask nothing. */
function answerFields( node: StepNode ): Field[] {
	return node.fields.filter( ( f ) => 'content' !== f.type && 'result' !== f.type );
}

/**
 * A made-up answer of a field: the model's distribution for choices and numbers, a filled value
 * otherwise. The weights per persona are kept in weights, so a run works them out once per field.
 */
function answerOf( field: Field, model: PredictionModel[ 'steps' ][ number ][ 'fields' ][ number ] | undefined, persona: string, random: () => number, weights: Map<string, Array<[ string, number ]>> = new Map() ): unknown {
	if ( ! field.required ) {
		const fill = model?.fill?.[ persona ] ?? 0.5;
		if ( random() >= fill ) {
			return undefined;
		}
	}
	switch ( field.type ) {
		case 'choice':
		case 'dropdown': {
			let options = weights.get( persona );
			if ( ! options ) {
				const shares = model?.options?.[ persona ] ?? {};
				options = field.options.map( ( o ) => [ o.id, shares[ o.id ] ?? 1 / Math.max( 1, field.options.length ) ] );
				weights.set( persona, options );
			}
			if ( field.props.multiple ) {
				// Each option ticked by its own share; a required field gets at least one.
				const ticked = options.filter( ( [ , share ] ) => random() < clamp( share, 0, 1 ) ).map( ( [ id ] ) => id );
				if ( ticked.length ) {
					return ticked;
				}
			}
			const one = pick( options, random() );
			return null === one ? undefined : [ one ];
		}
		case 'slider':
		case 'number':
		case 'rating': {
			const { min, max } = field.props;
			if ( undefined === min || undefined === max || max < min ) {
				return 'number' === field.type ? undefined : min;
			}
			let buckets = weights.get( persona );
			if ( ! buckets ) {
				buckets = ( model?.buckets?.[ persona ] ?? [ 0.25, 0.25, 0.25, 0.25 ] ).map( ( share, i ) => [ String( i ), share ] );
				weights.set( persona, buckets );
			}
			const bucket = Number( pick( buckets, random() ) ?? 0 );
			const width = ( max - min ) / 4;
			let value = min + width * ( bucket + random() );
			const step = 'slider' === field.type ? field.props.step : 'rating' === field.type ? 1 : field.props.step;
			if ( step && step > 0 ) {
				value = min + Math.round( ( value - min ) / step ) * step;
			}
			value = clamp( value, min, max );
			return 'slider' === field.type && field.props.range ? [ min, value ] : value;
		}
		case 'repeat':
			return Array.from( { length: Math.max( 1, field.props.minItems ) }, () => ( {} ) );
		case 'address':
			return { street: 'x', city: 'x' };
		case 'date':
		case 'booking':
		case 'file':
		case 'signature':
			// Conditions rarely look at these; filled is enough.
			return 'filled';
		default:
			return 'x';
	}
}

/**
 * One run: every visitor gets a persona by its share and the variants of running A/B tests by
 * their weights, then goes from the start. On a step the visitor answers the fields shown to them,
 * then finishes the step by the persona's share or leaves; the path after it is the one the form
 * would take with these answers. A contact step finished is a sent form.
 */
export function simulate( doc: FormDocument, model: PredictionModel, visitors: number, seed: number = SEED, scenario: Scenario = {} ): Simulation {
	const random = seeded( seed );
	const steps = new Map( model.steps.map( ( s ) => [ s.node, s ] ) );
	const effect = new Map<string, number>();
	for ( const e of scenario.effect ?? [] ) {
		effect.set( e.node, ( effect.get( e.node ) ?? 0 ) + e.delta );
	}
	const shift = scenario.shift ?? 0;
	const personas: Array<[ string, number ]> = model.personas.length ? model.personas.map( ( p ) => [ p.id, p.share ] ) : [ [ '', 1 ] ];
	const goal: Simulation[ 'goal' ] = doc.nodes.some( ( n ) => 'contact' === n.type ) ? 'sent' : 'end';
	const dateFormats: Record<string, string> = {};
	for ( const n of doc.nodes ) {
		for ( const f of 'step' === n.type ? n.fields : [] ) {
			if ( 'date' === f.type ) {
				dateFormats[ f.id ] = f.props.format;
			}
		}
	}
	const finish = ( nodeId: string, persona: string ): number => {
		const s = steps.get( nodeId );
		const base = s ? s.continue[ persona ] ?? s.prior : UNKNOWN_STEP;
		return clamp( base + shift * ( s?.uncertainty ?? 0.1 ) + ( effect.get( nodeId ) ?? 0 ), 0.005, 0.995 );
	};
	const calcPaths = new Set( doc.nodes.filter( ( n ) => doc.calculations.length > 0 && usesCalculations( doc, n.id ) ).map( ( n ) => n.id ) );

	// What each visitor needs of a node, worked out once per run and not on every visit: a long
	// form would otherwise cost time by the square of its steps (next() reads all edges each time).
	const dateNodes = doc.nodes.filter( ( n ) => 'step' === n.type && n.fields.some( ( f ) => 'date' === f.type ) );
	const visits = new Map<string, NodeVisit>();
	for ( const n of doc.nodes ) {
		const fieldModels = new Map( ( steps.get( n.id )?.fields ?? [] ).map( ( f ) => [ f.field, f ] ) );
		visits.set( n.id, {
			node: n,
			route: { edges: doc.edges.filter( ( e ) => e.from === n.id ), nodes: dateNodes },
			fields: 'step' === n.type ? answerFields( n ).map( ( field ) => ( { field, model: fieldModels.get( field.id ), weights: new Map() } ) ) : [],
			reached: 0,
			left: 0,
			into: new Map(),
		} );
	}
	const start: NodeVisit = { node: null, route: { edges: [], nodes: [] }, fields: [], reached: 0, left: 0, into: new Map() };
	// The ways in the order they were first taken, as the statistics list them.
	const ways = new Map<string, Counted & { from: string; to: string; sessions: number }>();
	const wayOf = ( from: NodeVisit, to: string ): Counted & { sessions: number } => {
		let way = from.into.get( to );
		if ( ! way ) {
			const id = from.node?.id ?? '';
			way = { from: id, to, sessions: 0, completed: 0 };
			from.into.set( to, way );
			ways.set( id + '>' + to, way );
		}
		return way;
	};
	const chosen = new Map<string, Map<string, Counted & { chosen: number }>>();
	const choiceOf = ( field: string, option: string ): Counted & { chosen: number } => {
		let options = chosen.get( field );
		if ( ! options ) {
			options = new Map();
			chosen.set( field, options );
		}
		let c = options.get( option );
		if ( ! c ) {
			c = { chosen: 0, completed: 0 };
			options.set( option, c );
		}
		return c;
	};
	const perPersona = new Map<string, { visitors: number; completions: number }>( personas.map( ( [ id ] ) => [ id, { visitors: 0, completions: 0 } ] ) );
	let starts = 0;
	let completions = 0;
	// Qualified leads: by the answer to the field that shows it, else by the persona's share. A
	// stream of its own, one number per visitor, so the other figures stay as they are and every
	// run decides the same visitor the same way.
	const quality = model.qualified ?? null;
	const qualifying = qualifyingOf( doc, model );
	const qualifyingOptions = new Set( quality?.options ?? [] );
	const qualifyRandom = seeded( seed ^ 0x5bd1e995 );
	let qualified = 0;
	const traces: VisitorTrace[] = [];
	const traced = Math.max( 0, Math.min( visitors, scenario.trace ?? 0 ) );
	const limit = doc.nodes.length * 3 + 5;

	for ( let v = 0; v < visitors; v++ ) {
		const persona = pick( personas, random() ) ?? '';
		const draw = qualifyRandom();
		const variants: Variants = assignVariants( doc, random );
		const answers: Answers = {};
		// The ways and answers of this visitor, counted as completed once the goal is reached.
		const taken: Counted[] = [];
		const given: Array<Counted & { chosen: number }> = [];
		let from = start;
		let at: string | null = startNode( doc, variants );
		let done = false;
		let started = false;
		const trace: VisitorTrace | null = v < traced ? { persona, nodes: [], left: false, lead: -1 } : null;
		for ( let hop = 0; at && hop < limit; hop++ ) {
			const visit = visits.get( at );
			if ( ! visit ) {
				break;
			}
			const node = visit.node as FormNode;
			const way = wayOf( from, at );
			taken.push( way );
			way.sessions++;
			trace?.nodes.push( at );
			if ( 'end' === node.type ) {
				if ( trace && ! done && 'end' === goal ) {
					trace.lead = trace.nodes.length - 1;
				}
				done = done || 'end' === goal;
				break;
			}
			visit.reached++;
			for ( const { field, model: fieldModel, weights } of visit.fields ) {
				// Shown only while its condition holds for the answers before it (form-core shownAnswers).
				if ( field.showWhen && ! holds( field.showWhen, answers, {}, variants, { formats: dateFormats } ) ) {
					continue;
				}
				const answer = answerOf( field, fieldModel, persona, random, weights );
				if ( undefined !== answer ) {
					answers[ field.id ] = answer;
					if ( 'choice' === field.type || 'dropdown' === field.type ) {
						for ( const o of answer as string[] ) {
							given.push( choiceOf( field.id, o ) );
						}
					}
				}
			}
			if ( random() >= finish( at, persona ) ) {
				visit.left++;
				if ( trace ) {
					trace.left = true;
				}
				break;
			}
			started = true;
			for ( const c of given ) {
				c.chosen++;
				// Kept to count it as completed below.
				taken.push( c );
			}
			given.length = 0;
			if ( 'contact' === node.type ) {
				if ( trace && ! done ) {
					// A lead on the way after it.
					trace.lead = trace.nodes.length;
				}
				done = true;
			}
			let calcs: CalcValues = {};
			if ( calcPaths.has( at ) ) {
				const values = testValues( doc, answers );
				calcs = Object.fromEntries(
					doc.calculations.map( ( c ): [ string, number | null ] => {
						const value = values[ 'calc:' + c.id ];
						return [ c.id, undefined !== value && Number.isFinite( value ) ? value : null ];
					} )
				);
			}
			from = visit;
			at = next( visit.route, at, answers, calcs, variants );
		}
		if ( trace ) {
			traces.push( trace );
		}
		const p = perPersona.get( persona );
		if ( p ) {
			p.visitors++;
		}
		if ( started ) {
			starts++;
		}
		if ( done ) {
			completions++;
			if ( p ) {
				p.completions++;
			}
			for ( const c of taken ) {
				c.completed++;
			}
			if ( quality ) {
				const answer = qualifying ? answers[ qualifying ] : undefined;
				const yes = Array.isArray( answer ) ? answer.some( ( o ) => qualifyingOptions.has( String( o ) ) ) : draw < ( quality.share[ persona ] ?? 0.5 );
				qualified += yes ? 1 : 0;
			}
		}
	}

	const locale = doc.locales.default;
	const report: FormStatsReport = {
		form: 0,
		from: '',
		to: '',
		totals: { views: visitors, starts, completions, conversionRate: visitors > 0 ? completions / visitors : null },
		daily: [],
		steps: doc.nodes
			.filter( ( n ): n is StepNode | ContactNode => 'end' !== n.type )
			.map( ( n ) => ( { id: n.id, type: n.type, title: nodeName( n, locale ), reached: visits.get( n.id )?.reached ?? 0, left: visits.get( n.id )?.left ?? 0 } ) ),
		answers: doc.nodes.flatMap( ( n ) =>
			( 'step' === n.type ? n.fields : [] )
				.filter( ( f ): f is Extract<Field, { type: 'choice' | 'dropdown' }> => 'choice' === f.type || 'dropdown' === f.type )
				.map( ( f ) => ( {
					field: f.id,
					step: n.id,
					title: text( f.label, locale ),
					options: f.options.map( ( o ) => {
						const c = chosen.get( f.id )?.get( o.id );
						return { id: o.id, label: text( o.label, locale ), chosen: c?.chosen ?? 0, completed: c?.completed ?? 0 };
					} ),
				} ) )
		),
		paths: [ ...ways.values() ].map( ( w ) => ( { from: w.from, to: w.to, sessions: w.sessions, completed: w.completed } ) ),
	};
	return { report, personas: perPersona, goal, qualified, traces };
}

export interface PredictedStep {
	id: string;
	type: 'step' | 'contact';
	title: string;
	reached: number;
	left: number;
	/** Share of the visitors that reach the step, with the range of the uncertainty. */
	reachRate: number;
	reachLow: number;
	reachHigh: number;
	/** Share of those who reach the step and leave there. */
	dropRate: number | null;
	sticking: boolean;
	reasons: string[];
	/** Not in the model (added after the prediction): the step counts with a fixed share. */
	unknown: boolean;
}

export interface Prediction {
	simulation: Simulation;
	visitors: number;
	/** Share of the visitors that reach the goal, with the range of the uncertainty. */
	conversion: number;
	low: number;
	high: number;
	steps: PredictedStep[];
	/** Most visitors leave there, at most three, worst first. */
	sticking: PredictedStep[];
	personas: Array<{ id: string; name: string; share: number; description: string; visitors: number; completions: number; conversion: number | null }>;
	/**
	 * Qualified leads (model.qualified): the share among the leads, with the suggestions applied
	 * (their quality added), and whether the form's answers tell it (else the personas' shares).
	 * Null without model.qualified.
	 */
	quality: { label: string; share: number; byAnswers: boolean } | null;
	/** With the conversion the form would have with each, best first; quality: the share of qualified leads with it. */
	suggestions: Array<PredictionSuggestion & { conversion: number; gain: number; qualityShare: number | null }>;
	/** The conversion with all suggestions that help, together; the conversion itself without any. */
	best: number;
	/** The conversion without the suggestions put into the form; the conversion itself without any. */
	original: number;
	/** The suggestions put into the form (applied), in the order of the model, with what each adds now. */
	applied: Array<PredictionSuggestion & { gain: number }>;
	/** Steps and contact steps of the form the model does not know. */
	unknown: number;
}

function median( values: number[] ): number {
	if ( ! values.length ) {
		return 0;
	}
	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	const mid = Math.floor( sorted.length / 2 );
	return sorted.length % 2 ? sorted[ mid ] ?? 0 : ( ( sorted[ mid - 1 ] ?? 0 ) + ( sorted[ mid ] ?? 0 ) ) / 2;
}

/**
 * The prediction of a form: one run with the model, one each with all shares at the low and high
 * end of their uncertainty (the range), and one per suggestion with its effect. All runs use the
 * same visitors (seed), so a difference comes from the change and not from chance.
 * Suggestions put into the form (applied) count with their effect in every run, since the model
 * was made for the form before them; they are no longer offered. The model knows nothing of the
 * change itself: moving a step changes no share, the effect is what the suggestion promised.
 */
export function predict( doc: FormDocument, model: PredictionModel, visitors: number = DEFAULT_VISITORS, seed: number = SEED, applied: readonly string[] = [] ): Prediction {
	const done = new Set( applied );
	const nodeIds = new Set( doc.nodes.map( ( n ) => n.id ) );
	const put = model.suggestions.filter( ( s ) => done.has( s.id ) );
	const base = put.flatMap( ( s ) => s.effect );
	const main = simulate( doc, model, visitors, seed, { effect: base, trace: TRACED } );
	const low = simulate( doc, model, visitors, seed, { shift: -1, effect: base } );
	const high = simulate( doc, model, visitors, seed, { shift: 1, effect: base } );
	const rate = ( s: Simulation ): number => ( visitors > 0 ? s.report.totals.completions / visitors : 0 );
	const reachOf = ( s: Simulation ): Map<string, number> => new Map( s.report.steps.map( ( r ) => [ r.id, visitors > 0 ? r.reached / visitors : 0 ] ) );
	const lows = reachOf( low );
	const highs = reachOf( high );
	const known = new Map( model.steps.map( ( s ) => [ s.node, s ] ) );
	const steps: PredictedStep[] = main.report.steps.map( ( r ) => {
		const reachRate = visitors > 0 ? r.reached / visitors : 0;
		return {
			...r,
			reachRate,
			reachLow: Math.min( reachRate, lows.get( r.id ) ?? reachRate ),
			reachHigh: Math.max( reachRate, highs.get( r.id ) ?? reachRate ),
			dropRate: r.reached > 0 ? r.left / r.reached : null,
			sticking: false,
			reasons: known.get( r.id )?.reasons ?? [],
			unknown: ! known.has( r.id ),
		};
	} );
	const drops = steps.filter( ( s ) => s.reached > 0 && null !== s.dropRate ).map( ( s ) => s.dropRate as number );
	const bar = Math.max( STICKING_MIN, Math.min( STICKING_ALWAYS, STICKING_FACTOR * median( drops ) ) );
	const sticking = steps
		.filter( ( s ) => null !== s.dropRate && s.dropRate >= bar && s.left > 0 )
		.sort( ( a, b ) => b.left - a.left )
		.slice( 0, STICKING_MAX );
	sticking.forEach( ( s ) => ( s.sticking = true ) );
	const conversion = rate( main );
	// The share of qualified leads of a run, with the quality of the suggestions applied added.
	const lift = put.reduce( ( sum, s ) => sum + ( s.quality ?? 0 ), 0 );
	const shareOf = ( s: Simulation, more = 0 ): number | null => ( model.qualified && s.report.totals.completions > 0 ? clamp( s.qualified / s.report.totals.completions + lift + more, 0, 1 ) : model.qualified ? clamp( lift + more, 0, 1 ) : null );
	const suggestions = model.suggestions
		.filter( ( s ) => nodeIds.has( s.node ) && ! done.has( s.id ) )
		.map( ( s ) => {
			const run = simulate( doc, model, visitors, seed, { effect: [ ...base, ...s.effect ] } );
			const c = rate( run );
			return { ...s, conversion: c, gain: c - conversion, qualityShare: shareOf( run, s.quality ?? 0 ) };
		} )
		// Better leads after more leads, by their quality; more leads by what they bring.
		.sort( ( a, b ) => Number( isBetter( a ) ) - Number( isBetter( b ) ) || ( isBetter( a ) ? ( b.quality ?? 0 ) - ( a.quality ?? 0 ) : b.gain - a.gain ) );
	const together = suggestions.filter( ( s ) => s.gain > 0 ).flatMap( ( s ) => s.effect );
	const best = together.length ? Math.max( conversion, rate( simulate( doc, model, visitors, seed, { effect: [ ...base, ...together ] } ) ) ) : conversion;
	return {
		simulation: main,
		visitors,
		conversion,
		low: Math.min( conversion, rate( low ) ),
		high: Math.max( conversion, rate( high ) ),
		steps,
		sticking,
		personas: model.personas.map( ( p ) => {
			const figures = main.personas.get( p.id ) ?? { visitors: 0, completions: 0 };
			return { ...p, ...figures, conversion: figures.visitors > 0 ? figures.completions / figures.visitors : null };
		} ),
		quality: model.qualified ? { label: model.qualified.label, share: shareOf( main ) ?? 0, byAnswers: null !== qualifyingOf( doc, model ) } : null,
		suggestions,
		best,
		original: base.length ? rate( simulate( doc, model, visitors, seed ) ) : conversion,
		applied: put.map( ( s ) => {
			const others = put.filter( ( o ) => o !== s ).flatMap( ( o ) => o.effect );
			return { ...s, gain: conversion - rate( simulate( doc, model, visitors, seed, { effect: others } ) ) };
		} ),
		unknown: steps.filter( ( s ) => s.unknown ).length,
	};
}

/** A suggestion for better leads that raises their quality noticeably. */
export function isBetter( s: Pick<PredictionSuggestion, 'goal' | 'quality'> ): boolean {
	return 'better' === s.goal && ( s.quality ?? 0 ) > 0.005;
}

/** The suggestions still worth applying: those that bring more leads, or better ones. */
export function worthApplying<T extends PredictionSuggestion & { gain: number }>( suggestions: T[] ): T[] {
	return suggestions.filter( ( s ) => s.gain > 0.0005 || isBetter( s ) );
}

/** The field of the form that tells qualified leads (model.qualified), or null. */
function qualifyingOf( doc: FormDocument, model: PredictionModel ): string | null {
	const field = model.qualified?.field;
	return field && doc.nodes.some( ( n ) => 'step' === n.type && n.fields.some( ( f ) => f.id === field ) ) ? field : null;
}

/**
 * The funnel score: how much of what the form could reach with all suggestions it reaches today,
 * 0 to 100. 100: the AI finds nothing that brings noticeably more or better leads; while a
 * suggestion for better leads is open, 99 at most.
 */
export function funnelScore( prediction: Pick<Prediction, 'conversion' | 'best'> & { suggestions?: Array<Pick<PredictionSuggestion, 'goal' | 'quality'>> } ): number {
	const cap = prediction.suggestions?.some( isBetter ) ? 99 : 100;
	if ( prediction.best <= 0 || prediction.best - prediction.conversion < 0.0005 ) {
		return cap;
	}
	return Math.max( 0, Math.min( cap, Math.round( ( 100 * prediction.conversion ) / prediction.best ) ) );
}
