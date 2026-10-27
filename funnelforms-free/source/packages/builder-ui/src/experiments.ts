/**
 * A/B tests in the builder. "Test a step in two versions" copies a step as variant B and sends
 * the page views shown B to the copy wherever the form would go to the original; ending a test
 * keeps one variant and removes the paths of the others. A test of designs gives its variants
 * other style tokens instead (colours, corners, shadow); the plugin makes CSS variables of them.
 */
import type { Condition, Edge, Experiment, ExperimentVariant, FormDocument, FormNode } from '@funnelforms/form-schema';
import type { ExperimentStats } from './api';
import { clone, findNode, newId, usedIds } from './document';

export interface TestLabels {
	name: string;
	a: string;
	b: string;
}

export type TestRefusal = 'not_a_step' | 'start_taken' | 'too_many';

/** A new test runs ten days and then shows everyone the winner. */
export const RUN_TIME = { days: 10, onEnd: 'apply' } as const;

/** Whether a condition (or one inside it) is a variant of this test. */
function mentions( condition: Condition | undefined, id: string ): boolean {
	if ( ! condition ) {
		return false;
	}
	if ( 'all' in condition ) {
		return condition.all.some( ( c ) => mentions( c, id ) );
	}
	if ( 'any' in condition ) {
		return condition.any.some( ( c ) => mentions( c, id ) );
	}
	return 'experiment' in condition && condition.experiment === id;
}

/** Rewrites the field and option ids of a condition; leaves of other fields stay. */
function remap( condition: Condition, ids: Map<string, string> ): Condition {
	if ( 'all' in condition ) {
		return { all: condition.all.map( ( c ) => remap( c, ids ) ) };
	}
	if ( 'any' in condition ) {
		return { any: condition.any.map( ( c ) => remap( c, ids ) ) };
	}
	if ( 'field' in condition && ids.has( condition.field ) ) {
		const field = ids.get( condition.field ) ?? condition.field;
		return 'selected' === condition.op || 'selectedOnly' === condition.op ? { ...condition, field, value: ids.get( condition.value ) ?? condition.value } : { ...condition, field };
	}
	return condition;
}

/** Leaves on the original's fields also hold for the same answer in the copy. */
function either( condition: Condition, ids: Map<string, string> ): Condition {
	if ( 'all' in condition ) {
		return { all: condition.all.map( ( c ) => either( c, ids ) ) };
	}
	if ( 'any' in condition ) {
		return { any: condition.any.map( ( c ) => either( c, ids ) ) };
	}
	return 'field' in condition && ids.has( condition.field ) ? { any: [ condition, remap( condition, ids ) ] } : condition;
}

/** A copy of a step with new ids for the step, its fields and options, but the same variable names. */
function variantCopy( doc: FormDocument, node: FormNode, ids: Map<string, string> ): FormNode {
	const taken = usedIds( doc );
	const copy = clone( node );
	copy.id = newId( doc, 'n', taken );
	ids.set( node.id, copy.id );
	if ( 'step' === copy.type ) {
		for ( const field of copy.fields ) {
			const old = field.id;
			field.id = newId( doc, 'q', taken );
			ids.set( old, field.id );
			if ( 'options' in field ) {
				for ( const option of field.options ) {
					const was = option.id;
					option.id = newId( doc, 'o', taken );
					ids.set( was, option.id );
				}
			}
		}
	}
	delete ( copy as { legacy?: unknown } ).legacy;
	return copy;
}

/** Why a step cannot be tested this way; null when it can. */
export function stepTestRefusal( doc: FormDocument, nodeId: string ): TestRefusal | null {
	const node = findNode( doc, nodeId );
	if ( ! node || 'step' !== node.type ) {
		return 'not_a_step';
	}
	if ( ( doc.experiments ?? [] ).length >= 20 ) {
		return 'too_many';
	}
	if ( doc.start === nodeId && ( doc.experiments ?? [] ).some( ( x ) => x.variants.some( ( v ) => v.start ) ) ) {
		return 'start_taken';
	}
	return null;
}

/**
 * Tests a step in two versions: B is a copy with the same paths onward; every path into the step
 * gets a twin into the copy for variant B, checked right before it. Returns the test and the copy.
 */
export function addStepTest( doc: FormDocument, nodeId: string, labels: TestLabels ): { experiment: string; copy: string } | null {
	const node = findNode( doc, nodeId );
	if ( ! node || null !== stepTestRefusal( doc, nodeId ) ) {
		return null;
	}
	const taken = usedIds( doc );
	( doc.experiments ?? [] ).forEach( ( x ) => taken.add( x.id ) );
	const id = newId( doc, 'ab', taken );
	const ids = new Map<string, string>();
	const copy = variantCopy( doc, node, ids );
	doc.nodes.push( copy );
	const at = doc.layout?.nodes[ nodeId ];
	if ( doc.layout && at ) {
		doc.layout.nodes[ copy.id ] = { x: at.x, y: at.y + 220 };
	}
	const b: Condition = { experiment: id, variant: 'b' };

	const edges: Edge[] = [];
	for ( const edge of doc.edges ) {
		if ( edge.to === nodeId && edge.from !== nodeId ) {
			edges.push( { id: newId( doc, 'e', taken ), from: edge.from, to: copy.id, when: edge.when ? { all: [ edge.when, b ] } : b } );
		}
		edges.push( edge.from === nodeId || edge.to === nodeId ? edge : { ...edge, ...( edge.when ? { when: either( edge.when, ids ) } : {} ) } );
	}
	// The copy goes on as the original does, with its own fields in the conditions.
	for ( const edge of doc.edges.filter( ( e ) => e.from === nodeId ) ) {
		const to = edge.to === nodeId ? copy.id : edge.to;
		edges.push( { ...edge, id: newId( doc, 'e', taken ), from: copy.id, to, ...( edge.when ? { when: remap( edge.when, ids ) } : {} ) } );
	}
	doc.edges = edges;

	const experiment: Experiment = {
		id,
		name: labels.name,
		status: 'running',
		...RUN_TIME,
		variants: [
			{ id: 'a', label: labels.a, weight: 50 },
			{ id: 'b', label: labels.b, weight: 50, ...( doc.start === nodeId ? { start: copy.id } : {} ) },
		],
	};
	doc.experiments = [ ...( doc.experiments ?? [] ), experiment ];
	return { experiment: id, copy: copy.id };
}

/** What a test changes: steps (with paths per variant) or the design (style per variant). */
export function testKind( experiment: Experiment ): 'steps' | 'design' {
	return experiment.variants.some( ( v ) => undefined !== v.style ) ? 'design' : 'steps';
}

function newTestId( doc: FormDocument ): string {
	const taken = usedIds( doc );
	( doc.experiments ?? [] ).forEach( ( x ) => taken.add( x.id ) );
	return newId( doc, 'ab', taken );
}

/** Tests the design: B starts like the form and gets its own colours and shapes. */
export function addDesignTest( doc: FormDocument, labels: TestLabels ): string | null {
	if ( ( doc.experiments ?? [] ).length >= 20 ) {
		return null;
	}
	const id = newTestId( doc );
	doc.experiments = [
		...( doc.experiments ?? [] ),
		{
			id,
			name: labels.name,
			status: 'running',
			...RUN_TIME,
			variants: [
				{ id: 'a', label: labels.a, weight: 50 },
				{ id: 'b', label: labels.b, weight: 50, style: {} },
			],
		},
	];
	return id;
}

/** Style tokens a design variant can change, as the form's Design workspace names them. */
export const DESIGN_TOKENS = [ 'color.primary', 'color.button', 'color.onButton', 'color.background', 'color.text', 'radius.card', 'radius.button', 'radius.input', 'shadow', 'space.padding' ] as const;
export type DesignToken = ( typeof DESIGN_TOKENS )[ number ];

/** Sets (or with '' removes) a style token of a design variant. */
export function setVariantStyle( doc: FormDocument, id: string, variant: string, token: DesignToken, value: string ): void {
	const v = ( doc.experiments ?? [] ).find( ( x ) => x.id === id )?.variants.find( ( y ) => y.id === variant );
	if ( ! v || undefined === v.style ) {
		return;
	}
	if ( '' === value.trim() ) {
		Reflect.deleteProperty( v.style, token );
	} else {
		v.style = { ...v.style, [ token ]: value.trim().slice( 0, 200 ) };
	}
}

/** A variant of this round: not waiting in the test plan and not out of an earlier round. */
export function inRound( variant: ExperimentVariant ): boolean {
	return ! variant.planned && ! variant.retired;
}

/** Gives every variant of the round the same share; variants planned or retired get none. */
export function splitEvenly( experiment: Experiment ): void {
	const share = Math.floor( 100 / Math.max( 1, experiment.variants.filter( inRound ).length ) );
	experiment.variants.forEach( ( v ) => ( v.weight = inRound( v ) ? share : 0 ) );
}

/**
 * Puts a variant in the test plan: it waits without views and meets the variant kept when the
 * round ends. Two variants stay in the round. Taking it out of the plan brings it into the round.
 */
export function planLater( experiment: Experiment, variant: string, later: boolean ): void {
	const v = experiment.variants.find( ( x ) => x.id === variant );
	if ( ! v || v.retired || ( later && experiment.variants.filter( inRound ).length <= 2 ) ) {
		return;
	}
	if ( later ) {
		v.planned = true;
	} else {
		delete v.planned;
	}
	splitEvenly( experiment );
}

/** The variant the test plan brings in next, or null. */
export function nextPlanned( experiment: Experiment ): ExperimentVariant | null {
	return experiment.variants.find( ( v ) => v.planned ) ?? null;
}

/**
 * Starts the next round of the test plan (ExperimentSchedule::next_round()): the variant kept
 * comes first and meets the next planned one, half the views each; the others of the round
 * retire. The dates go, so publishing starts the round anew.
 */
export function nextRound( experiment: Experiment, keep: string ): void {
	const next = nextPlanned( experiment );
	if ( ! next || next.id === keep ) {
		return;
	}
	const pair: ExperimentVariant[] = [];
	const rest: ExperimentVariant[] = [];
	for ( const v of experiment.variants ) {
		const waits = !! v.planned;
		delete v.planned;
		delete v.retired;
		if ( v.id === keep || v.id === next.id ) {
			v.weight = 50;
			pair[ v.id === keep ? 0 : 1 ] = v;
			continue;
		}
		v.weight = 0;
		if ( waits ) {
			v.planned = true;
		} else {
			v.retired = true;
		}
		rest.push( v );
	}
	experiment.variants = [ ...pair, ...rest ];
	runAgain( experiment );
}

/** The share of page views of a variant, from 0 to 1. */
export function shareOf( experiment: Experiment, variant: string ): number {
	const total = experiment.variants.reduce( ( sum, v ) => sum + Math.max( 0, v.weight ), 0 );
	const weight = experiment.variants.find( ( v ) => v.id === variant )?.weight ?? 0;
	return total > 0 ? Math.max( 0, weight ) / total : 0;
}

/** Why no variant can be added; null when one can. */
export function variantRefusal( doc: FormDocument, id: string ): 'too_many' | 'not_one_step' | null {
	const experiment = ( doc.experiments ?? [] ).find( ( x ) => x.id === id );
	if ( ! experiment || experiment.variants.length >= 4 ) {
		return 'too_many';
	}
	if ( 'design' === testKind( experiment ) ) {
		return null;
	}
	const b = experiment.variants[ experiment.variants.length - 1 ];
	return b && 1 === ( testSteps( doc, id ).get( b.id ) ?? [] ).length ? null : 'not_one_step';
}

/** Replaces the variant of this test in a condition. */
function swapVariant( condition: Condition, id: string, from: string, to: string ): Condition {
	if ( 'all' in condition ) {
		return { all: condition.all.map( ( c ) => swapVariant( c, id, from, to ) ) };
	}
	if ( 'any' in condition ) {
		return { any: condition.any.map( ( c ) => swapVariant( c, id, from, to ) ) };
	}
	return 'experiment' in condition && condition.experiment === id && condition.variant === from ? { experiment: id, variant: to } : condition;
}

/**
 * Adds a variant (C, D) to a test. In a test of steps it is a copy of the last variant's step,
 * with the same paths in and onward, checked right after those of the last variant; in a test of
 * designs it starts like the form. The shares are then split evenly. Returns the variant's id.
 */
export function addVariant( doc: FormDocument, id: string, label: string ): string | null {
	const experiment = ( doc.experiments ?? [] ).find( ( x ) => x.id === id );
	const last = experiment?.variants[ experiment.variants.length - 1 ];
	if ( ! experiment || ! last || null !== variantRefusal( doc, id ) ) {
		return null;
	}
	const letters = 'abcdefghij';
	const vid = [ ...letters ].find( ( l ) => ! experiment.variants.some( ( v ) => v.id === l ) ) ?? 'x';
	const variant: ExperimentVariant = { id: vid, label, weight: 0 };
	if ( 'design' === testKind( experiment ) ) {
		variant.style = {};
	} else {
		const source = findNode( doc, testSteps( doc, id ).get( last.id )?.[ 0 ] ?? '' );
		if ( ! source ) {
			return null;
		}
		const ids = new Map<string, string>();
		const copy = variantCopy( doc, source, ids );
		doc.nodes.push( copy );
		const at = doc.layout?.nodes[ source.id ];
		if ( doc.layout && at ) {
			doc.layout.nodes[ copy.id ] = { x: at.x, y: at.y + 220 };
		}
		if ( last.start === source.id ) {
			variant.start = copy.id;
		}
		const taken = usedIds( doc );
		const edges: Edge[] = [];
		for ( const edge of doc.edges ) {
			edges.push( edge.from === source.id || ! edge.when ? edge : { ...edge, when: either( edge.when, ids ) } );
			if ( mentions( edge.when, id ) && edge.when && edge.to === source.id ) {
				edges.push( { id: newId( doc, 'e', taken ), from: edge.from, to: copy.id, when: swapVariant( edge.when, id, last.id, vid ) } );
			}
		}
		// The copy goes on as the last variant does, with its own fields in the conditions.
		for ( const edge of doc.edges.filter( ( e ) => e.from === source.id ) ) {
			edges.push( { ...edge, id: newId( doc, 'e', taken ), from: copy.id, to: edge.to === source.id ? copy.id : edge.to, ...( edge.when ? { when: remap( edge.when, ids ) } : {} ) } );
		}
		doc.edges = edges;
	}
	experiment.variants.push( variant );
	splitEvenly( experiment );
	return vid;
}

/** Suggestion from the figures: a clear winner, the comparison holding up, or wait for more views. */
export type WinnerSuggestion = { kind: 'winner'; variant: string; chance: number; uplift: number | null } | { kind: 'control'; variant: string; chance: number } | { kind: 'wait'; views: number };

/** Views each variant needs before a suggestion, and the chance a suggestion needs. */
export const MIN_VIEWS = 100;
export const CONFIDENCE = 0.95;

/**
 * A winner when a variant beats the comparison (the first variant) with at least 95 % chance and
 * every variant has at least 100 views; the comparison when no variant has more than 5 % chance
 * to beat it. Of several variants that beat the comparison, the one with the best conversion.
 */
export function suggestWinner( stats: ExperimentStats | undefined ): WinnerSuggestion | null {
	const [ control, ...others ] = stats?.variants ?? [];
	if ( ! control || ! others.length ) {
		return null;
	}
	const fewest = Math.min( control.views, ...others.map( ( v ) => v.views ) );
	if ( fewest < MIN_VIEWS ) {
		return { kind: 'wait', views: MIN_VIEWS - fewest };
	}
	const better = others.filter( ( v ) => ( v.chanceToBeatControl ?? 0 ) >= CONFIDENCE ).sort( ( a, b ) => ( b.conversionRate ?? 0 ) - ( a.conversionRate ?? 0 ) );
	const best = better[ 0 ];
	if ( best ) {
		return { kind: 'winner', variant: best.id, chance: best.chanceToBeatControl ?? 0, uplift: best.uplift };
	}
	if ( others.every( ( v ) => null !== v.chanceToBeatControl && v.chanceToBeatControl <= 1 - CONFIDENCE ) ) {
		return { kind: 'control', variant: control.id, chance: Math.min( ...others.map( ( v ) => 1 - ( v.chanceToBeatControl ?? 0 ) ) ) };
	}
	return null;
}

/** The condition with the test decided: null when it can never hold, true when it always does. */
function decide( condition: Condition, id: string, keep: string ): Condition | boolean {
	if ( 'all' in condition || 'any' in condition ) {
		const all = 'all' in condition;
		const parts: Condition[] = [];
		for ( const c of all ? condition.all : condition.any ) {
			const d = decide( c, id, keep );
			if ( d === ! all ) {
				return ! all;
			}
			if ( 'boolean' !== typeof d ) {
				parts.push( d );
			}
		}
		if ( ! parts.length ) {
			return all;
		}
		return 1 === parts.length && parts[ 0 ] ? parts[ 0 ] : all ? { all: parts } : { any: parts };
	}
	if ( 'experiment' in condition && condition.experiment === id ) {
		return condition.variant === keep;
	}
	return condition;
}

/**
 * Ends a test and keeps one variant for everyone: paths of the other variants go, those of the
 * kept one lose the variant condition. Steps only the others led to stay, without paths into them.
 */
export function endTest( doc: FormDocument, id: string, keep: string ): void {
	const experiment = ( doc.experiments ?? [] ).find( ( x ) => x.id === id );
	if ( ! experiment ) {
		return;
	}
	const start = experiment.variants.find( ( v ) => v.id === keep )?.start;
	if ( start ) {
		doc.start = start;
	}
	const edges: Edge[] = [];
	for ( const edge of doc.edges ) {
		if ( ! mentions( edge.when, id ) || ! edge.when ) {
			edges.push( edge );
			continue;
		}
		const d = decide( edge.when, id, keep );
		if ( false === d ) {
			continue;
		}
		const rest: Edge = { ...edge };
		delete rest.when;
		edges.push( true === d ? rest : { ...rest, when: d } );
	}
	doc.edges = edges;
	doc.experiments = ( doc.experiments ?? [] ).filter( ( x ) => x.id !== id );
	if ( ! doc.experiments.length ) {
		delete doc.experiments;
	}
}

/**
 * Steps a test sends visitors to: the start of a variant or the target of a variant path; a
 * variant without either sees the form's start and the paths the others are checked before.
 */
export function testSteps( doc: FormDocument, id: string ): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const add = ( variant: string, node: string ): void => {
		out.set( variant, [ ...new Set( [ ...( out.get( variant ) ?? [] ), node ] ) ] );
	};
	const experiment = ( doc.experiments ?? [] ).find( ( x ) => x.id === id );
	for ( const v of experiment?.variants ?? [] ) {
		if ( v.start ) {
			add( v.id, v.start );
		}
	}
	const leaves = ( c: Condition | undefined ): Array<{ experiment: string; variant: string }> => {
		if ( ! c ) {
			return [];
		}
		if ( 'all' in c ) {
			return c.all.flatMap( leaves );
		}
		if ( 'any' in c ) {
			return c.any.flatMap( leaves );
		}
		return 'experiment' in c ? [ c ] : [];
	};
	const rest = new Set<string>();
	doc.edges.forEach( ( edge, i ) => {
		const mine = leaves( edge.when ).filter( ( leaf ) => leaf.experiment === id );
		mine.forEach( ( leaf ) => add( leaf.variant, edge.to ) );
		// Visitors of the other variants go on with the next path from the same step.
		const next = mine.length ? doc.edges.slice( i + 1 ).find( ( e ) => e.from === edge.from && ! mentions( e.when, id ) ) : undefined;
		if ( next ) {
			rest.add( next.to );
		}
	} );
	const named = experiment?.variants.filter( ( v ) => out.has( v.id ) ) ?? [];
	for ( const v of experiment?.variants ?? [] ) {
		if ( out.has( v.id ) ) {
			continue;
		}
		if ( named.some( ( n ) => n.start ) ) {
			add( v.id, doc.start );
		}
		rest.forEach( ( node ) => add( v.id, node ) );
	}
	return out;
}

/** A test of steps seen from one of its steps: the test, the variant that step shows, and the step of each variant. */
export interface StepTest {
	experiment: Experiment;
	variant: string;
	steps: Array<{ variant: string; node: string }>;
}

/** The test of steps a step takes part in, as the original or as a variant; null when none. */
export function testOf( doc: FormDocument, nodeId: string ): StepTest | null {
	for ( const experiment of doc.experiments ?? [] ) {
		if ( 'design' === testKind( experiment ) ) {
			continue;
		}
		const where = testSteps( doc, experiment.id );
		const mine = experiment.variants.find( ( v ) => ( where.get( v.id ) ?? [] ).includes( nodeId ) );
		if ( ! mine ) {
			continue;
		}
		const steps = experiment.variants.flatMap( ( v ) => {
			const nodes = where.get( v.id ) ?? [];
			const node = v.id === mine.id ? nodeId : nodes[ 0 ];
			return node ? [ { variant: v.id, node } ] : [];
		} );
		return { experiment, variant: mine.id, steps };
	}
	return null;
}

/** Fields the plugin keeps when publishing and ending tests (ExperimentSchedule::FIELDS). */
export const SCHEDULE_FIELDS = [ 'startedAt', 'pausedAt', 'pausedDays', 'extended', 'endedAt', 'outcome', 'suggested' ] as const;
type ScheduleField = ( typeof SCHEDULE_FIELDS )[ number ];

/** Takes over the plugin's dates of the tests after publishing. */
export function takeSchedule( doc: FormDocument, fields: Record<string, Partial<Pick<Experiment, ScheduleField>>> ): void {
	for ( const experiment of doc.experiments ?? [] ) {
		const given = fields[ experiment.id ];
		if ( ! given ) {
			continue;
		}
		for ( const key of SCHEDULE_FIELDS ) {
			if ( undefined === given[ key ] ) {
				Reflect.deleteProperty( experiment, key );
			} else {
				Object.assign( experiment, { [ key ]: given[ key ] } );
			}
		}
	}
}

/** Today as YYYY-MM-DD, in the browser's time zone. */
export function today( now: Date = new Date() ): string {
	return `${ now.getFullYear() }-${ String( now.getMonth() + 1 ).padStart( 2, '0' ) }-${ String( now.getDate() ).padStart( 2, '0' ) }`;
}

function daysBetween( from: string, to: string ): number {
	return Math.round( ( Date.parse( `${ to }T00:00:00Z` ) - Date.parse( `${ from }T00:00:00Z` ) ) / 86400000 );
}

function addDays( day: string, days: number ): string {
	return new Date( Date.parse( `${ day }T00:00:00Z` ) + days * 86400000 ).toISOString().slice( 0, 10 );
}

export interface RunTime {
	/** Day of the test, counted from 1, without the days paused. */
	day: number;
	/** Days it runs, with the days added. */
	of: number;
	/** Its last day. */
	last: string;
}

/** Where a published test with days stands; null without days or before it was published. */
export function runTime( experiment: Experiment, now: string ): RunTime | null {
	if ( ! experiment.days || ! experiment.startedAt ) {
		return null;
	}
	const of = experiment.days + ( experiment.extended ?? 0 );
	const paused = ( experiment.pausedDays ?? 0 ) + ( experiment.pausedAt ? Math.max( 0, daysBetween( experiment.pausedAt, now ) ) : 0 );
	const day = Math.min( of, Math.max( 1, daysBetween( experiment.startedAt, now ) - paused + 1 ) );
	return { day, of, last: addDays( experiment.startedAt, of + paused - 1 ) };
}

/** Starts a stopped test again, from the first day. */
export function runAgain( experiment: Experiment ): void {
	experiment.status = 'running';
	delete experiment.winner;
	for ( const key of SCHEDULE_FIELDS ) {
		Reflect.deleteProperty( experiment, key );
	}
}

/** A test that ended and waits for a decision: paused with what the figures said. */
export function waitsForDecision( experiment: Experiment ): boolean {
	return 'paused' === experiment.status && undefined !== experiment.outcome;
}
