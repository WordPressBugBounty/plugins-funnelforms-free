/**
 * "A/B tests": test a step or the design in two or more versions, set the shares and how long a
 * test runs, see how the variants convert with a suggestion when one clearly wins, and pause, stop
 * or end a test. The plugin ends a test after its days (ExperimentSchedule). Shown in the
 * Settings workspace as the overview of all tests; a step is tested right where it is edited,
 * with "Add a variation" and the variant tabs in its properties (StepVariants).
 */
import React, { useContext, useEffect, useState } from 'react';
import type { Experiment, FormDocument } from '@funnelforms/form-schema';
import type { ExperimentStats } from '../api';
import { nodeName } from '../document';
import { addDesignTest, addStepTest, addVariant, DESIGN_TOKENS, endTest, inRound, nextPlanned, nextRound, planLater, runAgain, runTime, setVariantStyle, shareOf, splitEvenly, stepTestRefusal, suggestWinner, testKind, testOf, testSteps, today, variantRefusal, waitsForDecision, type DesignToken } from '../experiments';
import type { Recipe } from '../store';
import { effectiveTokens } from '../themes';
import { useBuilder, useEnv, ViewContext } from './context';
import { __, sprintf } from './i18n';
import { Badge, Button, icons, Notice, NumberInput, Select, TextInput, Toggle } from './ui';

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

function percent( value: number | null ): string {
	return null === value ? '–' : `${ ( value * 100 ).toFixed( 1 ).replace( /\.0$/, '' ) } %`;
}

function variantName( experiment: Experiment, id: string ): string {
	const v = experiment.variants.find( ( x ) => x.id === id );
	return v?.label || id.toUpperCase();
}

const LETTER = ( experiment: Experiment ): string => String.fromCharCode( 65 + experiment.variants.length );

const dayName = ( day: string ): string => new Date( day + 'T12:00:00' ).toLocaleDateString( undefined, { day: 'numeric', month: 'long' } );

/** Running, paused, waiting for a decision after its days, or stopped. */
function TestStatus( { experiment }: { experiment: Experiment } ) {
	if ( 'running' === experiment.status ) {
		return <Badge tone="success">{ __( 'Running', 'funnelforms-pro' ) }</Badge>;
	}
	if ( waitsForDecision( experiment ) ) {
		return <Badge tone="brand">{ __( 'Waits for you', 'funnelforms-pro' ) }</Badge>;
	}
	return 'paused' === experiment.status ? <Badge tone="warning">{ __( 'Paused', 'funnelforms-pro' ) }</Badge> : <Badge>{ __( 'Stopped', 'funnelforms-pro' ) }</Badge>;
}

/** Opens the A/B tests of the Settings workspace, with one test unfolded. */
const OPEN_EVENT = 'ffxb:open-experiment';

function useOpenTest(): ( id: string ) => void {
	const view = useContext( ViewContext );
	return ( id: string ): void => {
		view( 'settings' );
		window.setTimeout( () => {
			window.dispatchEvent( new CustomEvent( OPEN_EVENT, { detail: id } ) );
			document.getElementById( 'ffxb-part-experiments' )?.scrollIntoView?.( { behavior: 'smooth', block: 'start' } );
		}, 50 );
	};
}

/**
 * The top of a step's properties: "Add a variation" when the step is in no test; tabs of the
 * variants (A, B, …) when it is, each selecting its step, with "+" for one more variant.
 */
export function StepVariants( { doc, nodeId }: { doc: FormDocument; nodeId: string } ) {
	const { store, readOnly, ctx } = useEnv();
	const change = useChange();
	const openTest = useOpenTest();
	const test = testOf( doc, nodeId );
	if ( ! test ) {
		const refusal = stepTestRefusal( doc, nodeId );
		if ( 'not_a_step' === refusal ) {
			return null;
		}
		const node = doc.nodes.find( ( n ) => n.id === nodeId );
		const add = (): void => {
			let copy = '';
			change( ( d ) => {
				copy =
					addStepTest( d, nodeId, {
						name: sprintf( __( 'Test of “%s”', 'funnelforms-pro' ), node ? nodeName( node, ctx.locale ) : nodeId ),
						a: __( 'Original', 'funnelforms-pro' ),
						b: __( 'Variant B', 'funnelforms-pro' ),
					} )?.copy ?? '';
			} );
			if ( copy ) {
				store.getState().select( { node: copy } );
			}
		};
		return (
			<div className="ffxb-step-ab">
				<Button size="sm" icon={ icons.plus } disabled={ readOnly || null !== refusal } onClick={ add }>
					{ __( 'Add a variation', 'funnelforms-pro' ) }
				</Button>
				<p className="ffxb-hint">
					{ 'too_many' === refusal
						? __( 'This form has the most tests it can have.', 'funnelforms-pro' )
						: 'start_taken' === refusal
							? __( 'Another test already tries a different first step.', 'funnelforms-pro' )
							: __( 'A/B test: variant B starts as a copy of this step. Visitors see A or B, and the figures show which one brings more entries.', 'funnelforms-pro' ) }
				</p>
			</div>
		);
	}
	const { experiment, variant, steps } = test;
	const refusal = variantRefusal( doc, experiment.id );
	const more = (): void => {
		let added: string | null = null;
		change( ( d ) => {
			added = addVariant( d, experiment.id, sprintf( __( 'Variant %s', 'funnelforms-pro' ), LETTER( experiment ) ) );
		} );
		const next = added ? testOf( store.getState().doc ?? doc, nodeId )?.steps.find( ( s ) => s.variant === added ) : undefined;
		if ( next ) {
			store.getState().select( { node: next.node } );
		}
	};
	return (
		<div className="ffxb-step-ab">
			<div className="ffxb-step-ab__head">
				<span className="ffxb-step-ab__title">{ __( 'A/B test', 'funnelforms-pro' ) }</span>
				<TestStatus experiment={ experiment } />
			</div>
			<div className="ffxb-segmented ffxb-step-ab__tabs" role="group" aria-label={ __( 'Variants of this step', 'funnelforms-pro' ) }>
				{ steps.map( ( s, i ) => (
					<button
						key={ s.variant }
						type="button"
						className="ffxb-segmented__item"
						aria-pressed={ s.variant === variant }
						title={ variantName( experiment, s.variant ) }
						onClick={ () => s.node !== nodeId && store.getState().select( { node: s.node } ) }
					>
						<strong>{ s.variant.toUpperCase() }</strong>
						{ 0 === i ? <span>{ __( 'Original', 'funnelforms-pro' ) }</span> : null }
					</button>
				) ) }
				<button
					type="button"
					className="ffxb-segmented__item"
					aria-label={ sprintf( __( 'Add variant %s', 'funnelforms-pro' ), LETTER( experiment ) ) }
					title={ 'not_one_step' === refusal ? __( 'Only tests of one step get more variants.', 'funnelforms-pro' ) : sprintf( __( 'Add variant %s', 'funnelforms-pro' ), LETTER( experiment ) ) }
					disabled={ readOnly || null !== refusal }
					onClick={ more }
				>
					+
				</button>
			</div>
			<p className="ffxb-hint">
				{ steps[ 0 ]?.node === nodeId
					? __( 'You are editing the original. Paths, answers to the questions and calculations apply to every variant.', 'funnelforms-pro' )
					: sprintf( __( 'You are editing %s. Change its texts, answers or images; paths and calculations stay those of the original.', 'funnelforms-pro' ), variantName( experiment, variant ) ) }
			</p>
			<button type="button" className="ffxb-link" onClick={ () => openTest( experiment.id ) }>
				{ __( 'Shares, results and end of the test', 'funnelforms-pro' ) }
			</button>
		</div>
	);
}

export function ExperimentsSection( { doc }: { doc: FormDocument } ) {
	const { api, rights, readOnly, ctx } = useEnv();
	const change = useChange();
	const formId = useBuilder( ( s ) => s.form?.id ?? null );
	const published = useBuilder( ( s ) => null !== s.form?.currentRevision );
	const [ open, setOpen ] = useState<string | null>( null );
	const [ stats, setStats ] = useState<ExperimentStats[]>( [] );
	useEffect( () => {
		const unfold = ( e: Event ): void => setOpen( String( ( e as CustomEvent<string> ).detail ) );
		window.addEventListener( OPEN_EVENT, unfold );
		return () => window.removeEventListener( OPEN_EVENT, unfold );
	}, [] );
	const experiments = doc.experiments ?? [];
	const steps = doc.nodes.filter( ( n ) => 'step' === n.type );

	useEffect( () => {
		if ( null === formId || ! rights.entries || ! published || 0 === experiments.length ) {
			return undefined;
		}
		let live = true;
		api.experimentStats( formId ).then(
			( list ) => live && setStats( list ),
			() => undefined
		);
		return () => {
			live = false;
		};
	}, [ api, formId, rights.entries, published, experiments.length ] );

	const add = ( nodeId: string ): void => {
		let id = '';
		change( ( d ) => {
			id =
				addStepTest( d, nodeId, {
					name: sprintf( __( 'Test of “%s”', 'funnelforms-pro' ), nodeName( doc.nodes.find( ( n ) => n.id === nodeId ) ?? { id: nodeId, type: 'step', fields: [] }, ctx.locale ) ),
					a: __( 'Original', 'funnelforms-pro' ),
					b: __( 'Variant B', 'funnelforms-pro' ),
				} )?.experiment ?? '';
		} );
		setOpen( id );
	};
	const addDesign = (): void => {
		let id = '';
		change( ( d ) => {
			id = addDesignTest( d, { name: __( 'Test of the design', 'funnelforms-pro' ), a: __( 'Current design', 'funnelforms-pro' ), b: __( 'Variant B', 'funnelforms-pro' ) } ) ?? '';
		} );
		setOpen( id );
	};

	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'A/B tests', 'funnelforms-pro' ) }</h2>
			</header>
			<p className="ffxb-hint">
				{ 0 === experiments.length
					? __( 'Show visitors different versions of a step or of the design and see which one brings more entries. To test a step, select it on the canvas and click “Add a variation”.', 'funnelforms-pro' )
					: __( 'All tests of this form. A step’s variants are also edited right at the step, with the tabs A, B and +.', 'funnelforms-pro' ) }
			</p>
			<ul className="ffxb-actions">
				{ experiments.map( ( x ) => {
					const expanded = open === x.id;
					const suggestion = 'running' === x.status ? suggestWinner( stats.find( ( s ) => s.id === x.id ) ) : null;
					return (
						<li key={ x.id } className={ `ffxb-action${ expanded ? ' is-open' : '' }` }>
							<div className="ffxb-action__head">
								<button type="button" className="ffxb-action__toggle" aria-expanded={ expanded } onClick={ () => setOpen( expanded ? null : x.id ) }>
									<strong>{ x.name || x.id }</strong>
									<span className="ffxb-action__target">
										{ 'design' === testKind( x ) ? __( 'Design', 'funnelforms-pro' ) : __( 'Step', 'funnelforms-pro' ) } · { x.variants.map( ( v ) => `${ variantName( x, v.id ) } ${ Math.round( shareOf( x, v.id ) * 100 ) } %` ).join( ' · ' ) }
									</span>
									{ suggestion && 'wait' !== suggestion.kind ? <span className="ffxb-badge ffxb-badge--brand">{ __( 'Winner found', 'funnelforms-pro' ) }</span> : null }
									<TestStatus experiment={ x } />
								</button>
							</div>
							{ expanded ? (
								<div className="ffxb-action__body">
									<ExperimentEditor doc={ doc } experiment={ x } stats={ stats.find( ( s ) => s.id === x.id ) } readOnly={ readOnly } />
								</div>
							) : null }
						</li>
					);
				} ) }
			</ul>
			<div className="ffxb-ab-new">
				{ steps.length ? (
					<Select
						label={ __( 'Test a step in two versions', 'funnelforms-pro' ) }
						hint={ __( 'Variant B is a copy of the step: change its texts, questions or images.', 'funnelforms-pro' ) }
						value=""
						options={ [
							{ value: '', label: __( 'Choose a step…', 'funnelforms-pro' ) },
							...steps.filter( ( n ) => null === stepTestRefusal( doc, n.id ) ).map( ( n ) => ( { value: n.id, label: nodeName( n, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' ) } ) ),
						] }
						onChange={ ( v ) => v && ! readOnly && add( v ) }
					/>
				) : null }
				<div className="ffxb-field">
					<span className="ffxb-field__label">{ __( 'Test the design', 'funnelforms-pro' ) }</span>
					<div>
						<Button size="sm" icon={ icons.plus } disabled={ readOnly || experiments.length >= 20 } onClick={ addDesign }>
							{ __( 'New design test', 'funnelforms-pro' ) }
						</Button>
					</div>
					<p className="ffxb-field__hint">{ __( 'Variant B gets its own colours, corners and shadow.', 'funnelforms-pro' ) }</p>
				</div>
			</div>
		</section>
	);
}

function ExperimentEditor( { doc, experiment, stats, readOnly }: { doc: FormDocument; experiment: Experiment; stats: ExperimentStats | undefined; readOnly: boolean } ) {
	const { ctx, rights, store } = useEnv();
	const change = useChange();
	const [ keep, setKeep ] = useState( experiment.winner ?? experiment.variants[ 0 ]?.id ?? 'a' );
	const set = ( recipe: ( x: Experiment ) => void, key?: string ): void =>
		change( ( d ) => {
			const x = ( d.experiments ?? [] ).find( ( e ) => e.id === experiment.id );
			if ( x ) {
				recipe( x );
			}
		}, key && `ab:${ experiment.id }:${ key }` );
	const setVariant = ( id: string, recipe: ( v: Experiment[ 'variants' ][ number ] ) => void, key: string ): void =>
		set( ( x ) => {
			const v = x.variants.find( ( y ) => y.id === id );
			if ( v ) {
				recipe( v );
			}
		}, key + id );
	const stop = ( winner: string ): void =>
		set( ( x ) => {
			x.status = 'stopped';
			x.winner = winner;
		} );
	const design = 'design' === testKind( experiment );
	const where = design ? new Map<string, string[]>() : testSteps( doc, experiment.id );
	const total = experiment.variants.reduce( ( sum, v ) => sum + v.weight, 0 );
	const options = experiment.variants.map( ( v ) => ( { value: v.id, label: variantName( experiment, v.id ) } ) );
	const suggestion = 'running' === experiment.status ? suggestWinner( stats ) : null;
	const refusal = variantRefusal( doc, experiment.id );
	const plannable = experiment.variants.filter( ( v ) => ! v.retired ).length >= 3;
	const planned = experiment.variants.filter( ( v ) => v.planned );

	return (
		<>
			<TextInput label={ __( 'Name', 'funnelforms-pro' ) } value={ experiment.name ?? '' } onChange={ ( v ) => set( ( x ) => void ( x.name = v ), 'name' ) } />
			{ experiment.variants.map( ( v, i ) => {
				const nodes = where.get( v.id ) ?? [];
				return (
					<div key={ v.id } className="ffxb-variant">
						<div className="ffxb-inline">
							<TextInput label={ sprintf( __( 'Variant %s', 'funnelforms-pro' ), v.id.toUpperCase() ) } value={ v.label ?? '' } onChange={ ( label ) => setVariant( v.id, ( y ) => void ( y.label = label ), 'label' ) } />
							<NumberInput
								label={ __( 'Share', 'funnelforms-pro' ) }
								hint={ sprintf( __( '%s of the views', 'funnelforms-pro' ), percent( shareOf( experiment, v.id ) ) ) }
								value={ v.weight }
								min={ 0 }
								max={ 100 }
								step={ 1 }
								disabled={ ! inRound( v ) }
								onChange={ ( w ) => setVariant( v.id, ( y ) => void ( y.weight = Math.max( 0, Math.min( 100, Math.round( w ?? 0 ) ) ) ), 'weight' ) }
							/>
						</div>
						{ v.retired ? <p className="ffxb-hint">{ __( 'Lost an earlier round and gets no views.', 'funnelforms-pro' ) }</p> : null }
						{ i > 0 && plannable && ! v.retired ? (
							<Toggle
								label={ __( 'Test later against the winner', 'funnelforms-pro' ) }
								hint={ v.planned ? __( 'Gets no views in this round. When it ends, the variant kept meets this one.', 'funnelforms-pro' ) : undefined }
								checked={ !! v.planned }
								disabled={ readOnly || ( ! v.planned && experiment.variants.filter( inRound ).length <= 2 ) }
								onChange={ ( later ) => set( ( x ) => planLater( x, v.id, later ), 'plan' + v.id ) }
							/>
						) : null }
						{ design ? (
							undefined === v.style ? (
								<p className="ffxb-hint">{ 0 === i ? __( 'Shows the form’s design.', 'funnelforms-pro' ) : null }</p>
							) : (
								<DesignControls doc={ doc } experiment={ experiment } variant={ v.id } style={ v.style } readOnly={ readOnly } />
							)
						) : nodes.length ? (
							<p className="ffxb-hint">
								{ __( 'Shows:', 'funnelforms-pro' ) }{ ' ' }
								{ nodes.map( ( id, n ) => {
									const node = doc.nodes.find( ( x ) => x.id === id );
									return (
										<React.Fragment key={ id }>
											{ n > 0 ? ', ' : '' }
											<button type="button" className="ffxb-link" onClick={ () => store.getState().select( { node: id } ) }>
												{ node ? nodeName( node, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' ) : id }
											</button>
										</React.Fragment>
									);
								} ) }
							</p>
						) : null }
					</div>
				);
			} ) }
			{ planned.length ? (
				<p className="ffxb-hint">
					{ sprintf( __( 'Test plan: when this round ends, the variant kept meets %s, one round each.', 'funnelforms-pro' ), planned.map( ( v ) => variantName( experiment, v.id ) ).join( ', ' ) ) }
				</p>
			) : null }
			{ 'running' === experiment.status && 0 === total ? <Notice tone="warning">{ __( 'Give at least one variant a share above 0.', 'funnelforms-pro' ) }</Notice> : null }
			<div className="ffxb-row-actions">
				<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => set( splitEvenly, 'even' ) }>
					{ __( 'Split evenly', 'funnelforms-pro' ) }
				</Button>
				<Button
					size="sm"
					icon={ icons.plus }
					disabled={ readOnly || null !== refusal }
					title={ 'not_one_step' === refusal ? __( 'Only tests of one step get more variants.', 'funnelforms-pro' ) : undefined }
					onClick={ () => change( ( d ) => void addVariant( d, experiment.id, sprintf( __( 'Variant %s', 'funnelforms-pro' ), LETTER( experiment ) ) ) ) }
				>
					{ sprintf( __( 'Add variant %s', 'funnelforms-pro' ), LETTER( experiment ) ) }
				</Button>
			</div>

			<RunTimeControls doc={ doc } experiment={ experiment } readOnly={ readOnly } set={ set } />

			<h3 className="ffxb-subtitle">{ __( 'Results', 'funnelforms-pro' ) }</h3>
			{ waitsForDecision( experiment ) ? <Decision experiment={ experiment } readOnly={ readOnly } set={ set } onApply={ stop } /> : null }
			{ suggestion ? <Suggestion experiment={ experiment } suggestion={ suggestion } readOnly={ readOnly } onApply={ stop } /> : null }
			{ stats ? (
				<table className="ffxb-stats">
					<thead>
						<tr>
							<th>{ __( 'Variant', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Views', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Entries', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Conversion', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Uplift', 'funnelforms-pro' ) }</th>
							<th>{ __( 'Chance to win', 'funnelforms-pro' ) }</th>
						</tr>
					</thead>
					<tbody>
						{ stats.variants.map( ( v ) => (
							<tr key={ v.id }>
								<td>{ variantName( experiment, v.id ) }</td>
								<td>{ v.views }</td>
								<td>{ v.completions }</td>
								<td>{ percent( v.conversionRate ) }</td>
								<td>{ null === v.uplift ? '–' : `${ v.uplift > 0 ? '+' : '' }${ percent( v.uplift ) }` }</td>
								<td>{ percent( v.chanceToBeatControl ) }</td>
							</tr>
						) ) }
					</tbody>
				</table>
			) : (
				<p className="ffxb-hint">{ rights.entries ? __( 'Figures appear here once the published form has views.', 'funnelforms-pro' ) : __( 'The figures need the right to see entries.', 'funnelforms-pro' ) }</p>
			) }
			<p className="ffxb-hint">{ __( 'Changes to the test take effect when you publish. Figures are of the last 30 days; the first variant is the comparison.', 'funnelforms-pro' ) }</p>
			{ 'stopped' !== experiment.status ? (
				<div className="ffxb-inline">
					<Select label={ __( 'Show everyone', 'funnelforms-pro' ) } value={ keep } options={ options } onChange={ setKeep } />
					<Button size="sm" disabled={ readOnly } onClick={ () => stop( keep ) }>
						{ __( 'Stop test', 'funnelforms-pro' ) }
					</Button>
				</div>
			) : (
				<>
					<p className="ffxb-hint">
						{ sprintf( __( 'Stopped: everyone sees %s.', 'funnelforms-pro' ), variantName( experiment, experiment.winner ?? experiment.variants[ 0 ]?.id ?? '' ) ) }
						{ experiment.outcome && experiment.endedAt ? ' ' + sprintf( __( 'The test ended on its own on %1$s: %2$s', 'funnelforms-pro' ), dayName( experiment.endedAt ), outcomeText( experiment ) ) : null }
					</p>
					<div className="ffxb-row-actions">
						<Button
							size="sm"
							disabled={ readOnly }
							onClick={ () =>
								set( runAgain )
							}
						>
							{ __( 'Run again', 'funnelforms-pro' ) }
						</Button>
						{ design ? (
							<Button
								size="sm"
								variant="danger"
								icon={ icons.trash }
								disabled={ readOnly }
								onClick={ () =>
									change( ( d ) => {
										// The design kept becomes the form's.
										const winner = experiment.variants.find( ( v ) => v.id === ( experiment.winner ?? experiment.variants[ 0 ]?.id ) );
										d.style.tokens = { ...d.style.tokens, ...( winner?.style ?? {} ) };
										endTest( d, experiment.id, winner?.id ?? 'a' );
									} )
								}
							>
								{ __( 'End test and keep this design', 'funnelforms-pro' ) }
							</Button>
						) : (
							<Button size="sm" variant="danger" icon={ icons.trash } disabled={ readOnly } onClick={ () => change( ( d ) => endTest( d, experiment.id, experiment.winner ?? experiment.variants[ 0 ]?.id ?? 'a' ) ) }>
								{ __( 'End test and keep this variant', 'funnelforms-pro' ) }
							</Button>
						) }
					</div>
					<p className="ffxb-hint">{ design ? __( 'Ending makes the kept design the form’s design.', 'funnelforms-pro' ) : __( 'Ending removes the paths to the other variants; their steps stay on the canvas until you delete them.', 'funnelforms-pro' ) }</p>
				</>
			) }
		</>
	);
}

type SetTest = ( recipe: ( x: Experiment ) => void, key?: string ) => void;

const DURATIONS = [ 7, 10, 14, 30 ];

/** What the figures said when the test ended on its own. */
function outcomeText( experiment: Experiment ): string {
	if ( 'winner' === experiment.outcome && experiment.suggested ) {
		return sprintf( __( '%s brought the most entries.', 'funnelforms-pro' ), variantName( experiment, experiment.suggested ) );
	}
	return 'tie' === experiment.outcome ? __( 'No variant was clearly better.', 'funnelforms-pro' ) : __( 'There were too few views for a clear result, also after the test ran longer.', 'funnelforms-pro' );
}

/** How long a test runs, what happens at its end, where it stands, and pausing it. */
function RunTimeControls( { doc, experiment, readOnly, set }: { doc: FormDocument; experiment: Experiment; readOnly: boolean; set: SetTest } ) {
	const time = runTime( experiment, today() );
	const days = [ ...new Set( [ ...DURATIONS, ...( experiment.days ? [ experiment.days ] : [] ) ] ) ].sort( ( a, b ) => a - b );
	const first = variantName( experiment, experiment.variants[ 0 ]?.id ?? 'a' );
	let where = '';
	if ( 'paused' === experiment.status ) {
		where = waitsForDecision( experiment ) ? '' : sprintf( __( 'Paused: everyone sees %s. The days paused do not count.', 'funnelforms-pro' ), first );
	} else if ( 'running' === experiment.status ) {
		if ( ! experiment.days ) {
			where = __( 'Runs until you stop it.', 'funnelforms-pro' );
		} else if ( ! time ) {
			where = sprintf( __( 'Runs %d days from the day you publish it.', 'funnelforms-pro' ), experiment.days );
		} else {
			where = sprintf( __( 'Day %1$d of %2$d, the last day is %3$s.', 'funnelforms-pro' ), time.day, time.of, dayName( time.last ) );
		}
	}
	return (
		<>
			<h3 className="ffxb-subtitle">{ __( 'Run time', 'funnelforms-pro' ) }</h3>
			<div className="ffxb-inline">
				<Select
					label={ __( 'Runs for', 'funnelforms-pro' ) }
					value={ experiment.days ? String( experiment.days ) : '' }
					disabled={ readOnly || 'stopped' === experiment.status }
					options={ [ ...days.map( ( d ) => ( { value: String( d ), label: sprintf( __( '%d days', 'funnelforms-pro' ), d ) } ) ), { value: '', label: __( 'Until I stop it', 'funnelforms-pro' ) } ] }
					onChange={ ( v ) =>
						set( ( x ) => {
							if ( v ) {
								x.days = Number( v );
							} else {
								delete x.days;
							}
						} )
					}
				/>
				<Select
					label={ __( 'At the end', 'funnelforms-pro' ) }
					value={ experiment.onEnd ?? 'apply' }
					disabled={ readOnly || 'stopped' === experiment.status || ! experiment.days }
					options={ [
						{ value: 'apply', label: __( 'Show everyone the winner', 'funnelforms-pro' ) },
						{ value: 'ask', label: __( 'Pause and ask me', 'funnelforms-pro' ) },
					] }
					onChange={ ( v ) => set( ( x ) => void ( x.onEnd = v ) ) }
				/>
			</div>
			<p className="ffxb-hint">
				{ 'ask' === experiment.onEnd
					? sprintf( __( 'At the end the test pauses, everyone sees %s, and you get a mail to decide.', 'funnelforms-pro' ), first )
					: nextPlanned( experiment )
					? __( 'At the end the variant that brought the most entries, or the original when none was clearly better, meets the next variant of the test plan, and the days start anew. You get a mail.', 'funnelforms-pro' )
					: __( 'At the end everyone sees the variant that brought the most entries, or the original when none was clearly better. You get a mail. With too few views the test runs half its days longer, once.', 'funnelforms-pro' ) }
			</p>
			{ doc.settings.valueCalculation || 'value' === experiment.goal ? (
				<Select
					label={ __( 'Main goal', 'funnelforms-pro' ) }
					hint={ __( 'Decides which variant wins at the end.', 'funnelforms-pro' ) }
					value={ experiment.goal ?? 'complete' }
					disabled={ readOnly || 'stopped' === experiment.status }
					options={ [
						{ value: 'complete', label: __( 'More sent forms', 'funnelforms-pro' ) },
						{ value: 'value', label: __( 'More lead value per view', 'funnelforms-pro' ) },
					] }
					onChange={ ( v ) =>
						set( ( x ) => {
							if ( 'value' === v ) {
								x.goal = v;
							} else {
								delete x.goal;
							}
						} )
					}
				/>
			) : null }
			{ where ? <p className="ffxb-hint ffxb-ab-time">{ where }</p> : null }
			{ 'running' === experiment.status || ( 'paused' === experiment.status && ! waitsForDecision( experiment ) ) ? (
				<div className="ffxb-row-actions">
					<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => set( ( x ) => void ( x.status = 'running' === x.status ? 'paused' : 'running' ) ) }>
						{ 'running' === experiment.status ? __( 'Pause test', 'funnelforms-pro' ) : __( 'Go on with the test', 'funnelforms-pro' ) }
					</Button>
				</div>
			) : null }
		</>
	);
}

/** A test that ended after its days and waits: show the result everyone, run two more days, or end it. */
function Decision( { experiment, readOnly, set, onApply }: { experiment: Experiment; readOnly: boolean; set: SetTest; onApply: ( winner: string ) => void } ) {
	const first = experiment.variants[ 0 ]?.id ?? 'a';
	const best = experiment.suggested ?? first;
	const next = nextPlanned( experiment );
	return (
		<Notice tone="info" title={ __( 'The test has ended and waits for you', 'funnelforms-pro' ) }>
			<p>
				{ outcomeText( experiment ) } { sprintf( __( 'Until you decide, everyone sees %s.', 'funnelforms-pro' ), variantName( experiment, first ) ) }
			</p>
			<div className="ffxb-row-actions">
				{ next ? (
					<Button size="sm" variant="primary" disabled={ readOnly } onClick={ () => set( ( x ) => nextRound( x, best ) ) }>
						{ sprintf( __( 'Next round: %1$s against %2$s', 'funnelforms-pro' ), variantName( experiment, best ), variantName( experiment, next.id ) ) }
					</Button>
				) : null }
				<Button size="sm" variant={ next ? 'secondary' : 'primary' } disabled={ readOnly } onClick={ () => onApply( best ) }>
					{ sprintf( __( 'Show everyone %s', 'funnelforms-pro' ), variantName( experiment, best ) ) }
				</Button>
				<Button
					size="sm"
					disabled={ readOnly }
					onClick={ () =>
						set( ( x ) => {
							x.extended = Math.min( 365, ( x.extended ?? 0 ) + 2 );
							x.status = 'running';
						} )
					}
				>
					{ __( 'Run 2 more days', 'funnelforms-pro' ) }
				</Button>
				{ best !== first ? (
					<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => onApply( first ) }>
						{ sprintf( __( 'Keep %s', 'funnelforms-pro' ), variantName( experiment, first ) ) }
					</Button>
				) : null }
			</div>
			<p className="ffxb-hint">{ __( 'Takes effect when you publish.', 'funnelforms-pro' ) }</p>
		</Notice>
	);
}

/** What the figures say: a winner to show everyone, or how many views are still missing. */
function Suggestion( { experiment, suggestion, readOnly, onApply }: { experiment: Experiment; suggestion: NonNullable<ReturnType<typeof suggestWinner>>; readOnly: boolean; onApply: ( winner: string ) => void } ) {
	if ( 'wait' === suggestion.kind ) {
		return <p className="ffxb-hint">{ sprintf( __( 'Too early for a winner: every variant needs about %d more views.', 'funnelforms-pro' ), suggestion.views ) }</p>;
	}
	const name = variantName( experiment, suggestion.variant );
	const text =
		'winner' === suggestion.kind
			? null === suggestion.uplift
				? sprintf( __( '%1$s brings more entries than the comparison, with %2$s certainty.', 'funnelforms-pro' ), name, percent( suggestion.chance ) )
				: sprintf( __( '%1$s brings %2$s more entries than the comparison, with %3$s certainty.', 'funnelforms-pro' ), name, percent( suggestion.uplift ), percent( suggestion.chance ) )
			: sprintf( __( 'No variant beats %1$s; it stays ahead with %2$s certainty.', 'funnelforms-pro' ), name, percent( suggestion.chance ) );
	return (
		<Notice
			tone="success"
			title={ __( 'Winner found', 'funnelforms-pro' ) }
			action={
				<Button size="sm" variant="primary" disabled={ readOnly } onClick={ () => onApply( suggestion.variant ) }>
					{ sprintf( __( 'Show everyone %s', 'funnelforms-pro' ), name ) }
				</Button>
			}
		>
			{ text }
		</Notice>
	);
}

const TOKEN_LABELS = (): Record<DesignToken, string> => ( {
	'color.primary': __( 'Main colour', 'funnelforms-pro' ),
	'color.button': __( 'Button', 'funnelforms-pro' ),
	'color.onButton': __( 'Button text', 'funnelforms-pro' ),
	'color.background': __( 'Background', 'funnelforms-pro' ),
	'color.text': __( 'Text', 'funnelforms-pro' ),
	'radius.card': __( 'Corners of the form (px)', 'funnelforms-pro' ),
	'radius.button': __( 'Corners of buttons (px)', 'funnelforms-pro' ),
	'radius.input': __( 'Corners of fields (px)', 'funnelforms-pro' ),
	shadow: __( 'Shadow', 'funnelforms-pro' ),
	'space.padding': __( 'Inner spacing (px)', 'funnelforms-pro' ),
} );

/** Colours and shapes of a design variant; empty means like the form. */
function DesignControls( { doc, experiment, variant, style, readOnly }: { doc: FormDocument; experiment: Experiment; variant: string; style: Record<string, string>; readOnly: boolean } ) {
	const change = useChange();
	const base = effectiveTokens( doc.style.tokens );
	const labels = TOKEN_LABELS();
	const own = ( token: DesignToken ): string => style[ token ] ?? '';
	const form = ( token: DesignToken ): string => base[ token ] ?? ( 'color.button' === token ? base[ 'color.primary' ] : 'color.onButton' === token ? base[ 'color.onPrimary' ] : '' ) ?? '';
	const setToken = ( token: DesignToken, value: string ): void => change( ( d ) => setVariantStyle( d, experiment.id, variant, token, value ), `ab-style:${ experiment.id }:${ variant }:${ token }` );
	return (
		<div className="ffxb-ab-design">
			{ DESIGN_TOKENS.map( ( token ) => {
				const id = `ab-${ experiment.id }-${ variant }-${ token }`;
				const changed = '' !== own( token );
				return (
					<div key={ token } className={ 'ffxb-ab-token' + ( changed ? ' is-changed' : '' ) }>
						<label htmlFor={ id }>{ labels[ token ] }</label>
						{ token.startsWith( 'color.' ) ? (
							<input id={ id } type="color" className="ffxb-ab-color" value={ /^#[0-9a-f]{6}$/i.test( own( token ) || form( token ) ) ? own( token ) || form( token ) : '#000000' } disabled={ readOnly } onChange={ ( e ) => setToken( token, e.target.value ) } />
						) : 'shadow' === token ? (
							<select id={ id } className="ffxb-input" value={ own( token ) } disabled={ readOnly } onChange={ ( e ) => setToken( token, e.target.value ) }>
								<option value="">{ __( 'Like the form', 'funnelforms-pro' ) }</option>
								<option value="none">{ __( 'None', 'funnelforms-pro' ) }</option>
								<option value="soft">{ __( 'Soft', 'funnelforms-pro' ) }</option>
								<option value="medium">{ __( 'Medium', 'funnelforms-pro' ) }</option>
								<option value="strong">{ __( 'Strong', 'funnelforms-pro' ) }</option>
							</select>
						) : (
							<input id={ id } type="number" min={ 0 } max={ 80 } className="ffxb-input ffxb-input--tiny" placeholder={ form( token ) } value={ own( token ) } disabled={ readOnly } onChange={ ( e ) => setToken( token, e.target.value ) } />
						) }
						{ changed && token.startsWith( 'color.' ) ? (
							<Button size="sm" variant="ghost" icon={ icons.undo } aria-label={ sprintf( __( 'Reset %s', 'funnelforms-pro' ), labels[ token ] ) } title={ __( 'Like the form', 'funnelforms-pro' ) } disabled={ readOnly } onClick={ () => setToken( token, '' ) } />
						) : null }
					</div>
				);
			} ) }
		</div>
	);
}
