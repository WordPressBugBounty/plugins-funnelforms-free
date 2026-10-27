/**
 * "Calculations": prices, scores and other numbers computed from the answers, in the settings of
 * the form. Formulas are typed as text ([key] for a field, functions such as round() or if(),
 * {id} for another result) with pickers for fields, results and functions, tried out with test
 * answers right below, and stored as the expression tree; the plugin computes them again on the
 * server.
 */
import React, { useRef, useState } from 'react';
import type { CalcFunction, Calculation, Field, FormDocument } from '@funnelforms/form-schema';
import { addCalculation, addResultRule, calculationUses, formatResult, formulaRefs, formulaVars, nameCalculation, printFormula, readFormula, removeCalculation, removeEdgeOf, renameFieldKey, resultPaths, resultPlaces, setFormula, setOtherwise, setResultRule, showResultIn, testValues, type CalculationUse, type FormulaResult, type ResultOp, type ResultPlace } from '../calculations';
import { findNode, nodeName } from '../document';
import type { Recipe } from '../store';
import { useEnv } from './context';
import { AskAiButton } from './AiForm';
import { fieldTitle } from './describe';
import { __, sprintf } from './i18n';
import { TypeIcon } from './typeIcons';
import { Badge, Button, Field as FieldRow, icons, Notice, Select, TextInput } from './ui';
import { DateTestAnswer, LeadValueToggle, LookupTable, moreFunctionHelp, ResultTexts } from './CalculationsPlus';

/** Field types whose answers count in calculations (Domain\Form\Calculator). */
const NUMERIC = [ 'choice', 'dropdown', 'slider', 'number', 'rating', 'text', 'textarea', 'repeat' ];

/** Field types whose number of answers counts with count([key]). */
const COUNTED = [ 'file', 'signature', 'email', 'phone', 'url', 'date', 'time', 'address', 'booking' ];

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

/** Fields a formula can use, one per key (fields may share a key). */
export function formulaFields( doc: FormDocument ): Field[] {
	const out = new Map<string, Field>();
	for ( const node of doc.nodes ) {
		if ( 'step' !== node.type ) {
			continue;
		}
		for ( const field of node.fields ) {
			if ( ( NUMERIC.includes( field.type ) || COUNTED.includes( field.type ) ) && ! out.has( field.key ) ) {
				out.set( field.key, field );
			}
		}
	}
	return [ ...out.values() ];
}

function parseError( result: Extract<FormulaResult, { ok: false }> ): string {
	switch ( result.error ) {
		case 'empty':
			return __( 'Enter a formula, e.g. [quantity] * 25.', 'funnelforms-pro' );
		case 'unexpected':
			return sprintf( __( 'The formula cannot be read from character %d on. Use numbers, fields in [brackets], + - * / % ^, parentheses and functions.', 'funnelforms-pro' ), result.at + 1 );
		case 'parenthesis':
			return sprintf( __( 'A parenthesis is not closed or not opened (character %d).', 'funnelforms-pro' ), result.at + 1 );
		case 'end':
			return __( 'The formula ends too early.', 'funnelforms-pro' );
		case 'function':
			return sprintf( __( 'There is no function by this name (character %d). Choose one under Functions.', 'funnelforms-pro' ), result.at + 1 );
		case 'arguments':
			return sprintf( __( 'The function at character %d gets too many or too few values. Separate them with a semicolon.', 'funnelforms-pro' ), result.at + 1 );
		case 'reference':
			return sprintf( __( '{%s} is not a calculation of this form.', 'funnelforms-pro' ), result.ref );
		case 'cycle':
			return __( 'The calculations would use each other in a circle. A calculation cannot use itself, not even through another one.', 'funnelforms-pro' );
	}
}

function whereName( use: CalculationUse ): string {
	const names: Record<CalculationUse, string> = {
		path: __( 'a path', 'funnelforms-pro' ),
		text: __( 'a text', 'funnelforms-pro' ),
		result: __( 'a live result', 'funnelforms-pro' ),
		payment: __( 'the payment', 'funnelforms-pro' ),
		conversion: __( 'a conversion', 'funnelforms-pro' ),
		score: __( 'the lead score', 'funnelforms-pro' ),
		quiz: __( 'the quiz', 'funnelforms-pro' ),
		calculation: __( 'another calculation', 'funnelforms-pro' ),
		value: __( 'the lead value', 'funnelforms-pro' ),
	};
	return names[ use ];
}

/** The functions as the editor offers them: what to insert and what it does. */
function functionHelp(): Array<{ fn: CalcFunction | 'count'; insert: string; text: string }> {
	return [
		{ fn: 'round', insert: 'round(; 2)', text: __( 'Rounds to decimal places: round([price]; 2). With -2 to hundreds.', 'funnelforms-pro' ) },
		{ fn: 'floor', insert: 'floor()', text: __( 'Rounds down: floor([m2] / 10).', 'funnelforms-pro' ) },
		{ fn: 'ceil', insert: 'ceil()', text: __( 'Rounds up: ceil([persons] / 4) cars.', 'funnelforms-pro' ) },
		{ fn: 'min', insert: 'min(; )', text: __( 'The smallest value: min([discount]; 20).', 'funnelforms-pro' ) },
		{ fn: 'max', insert: 'max(; )', text: __( 'The largest value: max(49; [rooms] * 15) for a minimum price.', 'funnelforms-pro' ) },
		{ fn: 'if', insert: 'if(; ; )', text: __( 'If, then, else: if([m2] > 100; 0.9; 1). Compare with < <= > >= = !=.', 'funnelforms-pro' ) },
		{ fn: 'sum', insert: 'sum(; )', text: __( 'Adds up: sum([a]; [b]; [c]).', 'funnelforms-pro' ) },
		{ fn: 'avg', insert: 'avg(; )', text: __( 'The average: avg([rating1]; [rating2]).', 'funnelforms-pro' ) },
		{ fn: 'count', insert: 'count()', text: __( 'How many answers a field has: count([extras]) * 15.', 'funnelforms-pro' ) },
		{ fn: 'abs', insert: 'abs()', text: __( 'The value without its sign.', 'funnelforms-pro' ) },
		{ fn: 'sqrt', insert: 'sqrt()', text: __( 'The square root: sqrt([area]) for the side of a square.', 'funnelforms-pro' ) },
		{ fn: 'and', insert: 'and(; )', text: __( '1 when all hold: and([a] > 1; [b] > 1).', 'funnelforms-pro' ) },
		{ fn: 'or', insert: 'or(; )', text: __( '1 when one of them holds.', 'funnelforms-pro' ) },
		{ fn: 'not', insert: 'not()', text: __( '1 when it does not hold: not([extras] > 0).', 'funnelforms-pro' ) },
	];
}

export function CalculationsSection( { doc }: { doc: FormDocument } ) {
	const { readOnly } = useEnv();
	const change = useChange();
	const [ open, setOpen ] = useState<string | null>( null );
	const add = (): void => {
		let id = '';
		change( ( d ) => {
			id = addCalculation( d, sprintf( __( 'Calculation %d', 'funnelforms-pro' ), d.calculations.length + 1 ) );
		} );
		setOpen( id );
	};
	const results = testValues( doc, {} );
	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Calculations', 'funnelforms-pro' ) }</h2>
				<div className="ffxb-section__actions">
					<AskAiButton start={ __( 'Create a calculation: ', 'funnelforms-pro' ) } label={ __( 'Create with AI', 'funnelforms-pro' ) } />
				</div>
			</header>
			<p className="ffxb-hint">{ __( 'Compute prices, scores or other numbers from the answers. Show them in steps, on the thank-you page and in mails, use them in paths, for the payment or as lead score.', 'funnelforms-pro' ) }</p>
			<ul className="ffxb-actions">
				{ doc.calculations.map( ( calc ) => {
					const expanded = open === calc.id;
					const uses = calculationUses( doc, calc.id );
					return (
						<li key={ calc.id } className={ `ffxb-action ffxb-calc${ expanded ? ' is-open' : '' }` }>
							<div className="ffxb-action__head">
								<button type="button" className="ffxb-action__toggle" aria-expanded={ expanded } onClick={ () => setOpen( expanded ? null : calc.id ) }>
									<strong>{ calc.label || calc.id }</strong>
									{ calc.legacy?.error || Number.isNaN( results[ 'calc:' + calc.id ] ) ? <span className="ffxb-action__gap">{ __( 'Does not compute', 'funnelforms-pro' ) }</span> : null }
									{ uses.includes( 'score' ) ? <Badge>{ __( 'Lead score', 'funnelforms-pro' ) }</Badge> : null }
									{ uses.includes( 'value' ) ? <Badge>{ __( 'Lead value', 'funnelforms-pro' ) }</Badge> : null }
									{ uses.includes( 'payment' ) ? <Badge>{ __( 'Payment', 'funnelforms-pro' ) }</Badge> : null }
									{ uses.includes( 'quiz' ) ? <Badge tone="brand">{ __( 'Quiz', 'funnelforms-pro' ) }</Badge> : null }
									<span className="ffxb-action__target ffxb-calc__formula">{ printFormula( calc.expression ) }</span>
								</button>
							</div>
							{ expanded ? (
								<div className="ffxb-action__body">
									<CalculationEditor doc={ doc } calc={ calc } readOnly={ readOnly } />
								</div>
							) : null }
						</li>
					);
				} ) }
			</ul>
			<div className="ffxb-row-actions">
				<Button size="sm" icon={ icons.plus } disabled={ readOnly } onClick={ add }>
					{ __( 'Add calculation', 'funnelforms-pro' ) }
				</Button>
			</div>
			{ doc.calculations.length ? (
				<div className="ffxb-calc-score">
					<Select
						label={ __( 'Lead score', 'funnelforms-pro' ) }
						value={ doc.settings.scoreCalculation ?? '' }
						options={ [ { value: '', label: __( 'No lead score', 'funnelforms-pro' ) }, ...doc.calculations.map( ( c ) => ( { value: c.id, label: c.label || c.id } ) ) ] }
						onChange={ ( v ) =>
							change( ( d ) => {
								if ( v ) {
									d.settings.scoreCalculation = v;
								} else {
									delete d.settings.scoreCalculation;
								}
							} )
						}
						hint={ __( 'The result of this calculation rates each entry; entries can be sorted and filtered by it.', 'funnelforms-pro' ) }
					/>
				</div>
			) : null }
		</section>
	);
}

/** Text before and after the number: none, a currency or own text. */
const UNITS: Array<{ id: string; prefix?: string; suffix?: string }> = [
	{ id: 'none' },
	{ id: 'eur', suffix: ' €' },
	{ id: 'eur-before', prefix: '€ ' },
	{ id: 'usd', prefix: '$' },
	{ id: 'gbp', prefix: '£' },
	{ id: 'chf', prefix: 'CHF ' },
	{ id: 'percent', suffix: ' %' },
];

function unitOf( calc: Calculation ): string {
	const prefix = calc.format.prefix ?? '';
	const suffix = calc.format.suffix ?? '';
	return UNITS.find( ( u ) => ( u.prefix ?? '' ) === prefix && ( u.suffix ?? '' ) === suffix )?.id ?? 'own';
}

function CalculationEditor( { doc, calc, readOnly }: { doc: FormDocument; calc: Calculation; readOnly: boolean } ) {
	const { ctx } = useEnv();
	const change = useChange();
	const locale = doc.locales.default;
	const area = useRef<HTMLTextAreaElement>( null );
	// What is typed; null shows the stored formula (also after undo).
	const [ draft, setDraft ] = useState<string | null>( null );
	const [ test, setTest ] = useState<Record<string, unknown>>( {} );
	const [ added, setAdded ] = useState<string | null>( null );
	const [ ownUnit, setOwnUnit ] = useState( false );
	const source = draft ?? printFormula( calc.expression );
	const parsed = readFormula( doc, calc.id, source );
	const fields = formulaFields( doc );
	const expression = parsed.ok ? parsed.expression : calc.expression;
	const vars = formulaVars( expression );
	const unknown = vars.filter( ( v ) => ! fields.some( ( f ) => f.key === v ) );
	const uses = calculationUses( doc, calc.id );
	const token = `{{calc:${ calc.id }}}`;
	const others = doc.calculations.filter( ( c ) => c.id !== calc.id );

	// The quiz writes its formula itself: the sum of its questions.
	const managed = doc.settings.quiz?.calculation === calc.id;
	const write = ( value: string ): void => {
		setDraft( value );
		change( ( d ) => void setFormula( d, calc.id, value ), 'calc:' + calc.id );
	};
	/** Puts text where the cursor is; `back` moves the cursor that far back from the end of it. */
	const insert = ( text: string, back = 0 ): void => {
		if ( readOnly || managed ) {
			return;
		}
		const el = area.current;
		const from = el?.selectionStart ?? source.length;
		const to = el?.selectionEnd ?? source.length;
		const before = source.slice( 0, from );
		const pad = before && ! /[\s(;]$/.test( before ) ? ' ' : '';
		const next = before + pad + text + source.slice( to );
		write( next );
		const at = before.length + pad.length + text.length - back;
		window.requestAnimationFrame( () => {
			el?.focus();
			el?.setSelectionRange( at, at );
		} );
	};
	const set = ( recipe: ( c: Calculation ) => void, key: string ): void =>
		change( ( d ) => {
			const c = d.calculations.find( ( x ) => x.id === calc.id );
			if ( c ) {
				recipe( c );
			}
		}, `calc:${ calc.id }:${ key }` );

	// Test answers: the stored answers of the fields the formula uses, results of the others included.
	const answers: Record<string, unknown> = {};
	for ( const f of fields ) {
		if ( vars.includes( f.key ) && f.id in test ) {
			answers[ f.id ] = test[ f.id ];
		} else if ( vars.includes( f.key ) && 'slider' === f.type ) {
			// A slider always has an answer: where it starts.
			answers[ f.id ] = f.props.start;
		}
	}
	const values = testValues( { nodes: doc.nodes, calculations: doc.calculations.map( ( c ) => ( c.id === calc.id ? { ...c, expression } : c ) ) }, answers );
	const result = values[ 'calc:' + calc.id ];
	const places = resultPlaces( doc, calc.id );
	const placeName = ( p: ResultPlace ): string => {
		if ( 'step' === p ) {
			return __( 'A new step before the contact step', 'funnelforms-pro' );
		}
		if ( 'live' === p ) {
			return __( 'Live result while visitors answer', 'funnelforms-pro' );
		}
		if ( p.startsWith( 'end:' ) ) {
			const node = findNode( doc, p.slice( 4 ) );
			return sprintf( __( 'Thank-you page: %s', 'funnelforms-pro' ), ( node ? nodeName( node, locale ) : '' ) || __( 'Without a title', 'funnelforms-pro' ) );
		}
		const action = doc.actions.find( ( a ) => a.id === p.slice( 7 ) );
		const subject = action && ( 'email' === action.kind || 'autoresponder' === action.kind ) ? action.config.subject[ locale ] ?? '' : '';
		return sprintf( 'autoresponder' === action?.kind ? __( 'Mail to the visitor: %s', 'funnelforms-pro' ) : __( 'Mail to you: %s', 'funnelforms-pro' ), subject.replace( /\{\{[^}]*\}\}/g, '…' ) || __( 'Without a subject', 'funnelforms-pro' ) );
	};

	return (
		<>
			{ calc.legacy?.formula ? (
				<Notice tone={ calc.legacy.error ? 'warning' : 'info' }>
					{ calc.legacy.error
						? sprintf( __( 'The formula from Funnelforms 3 (%s) could not be taken over; visitors see the error text of calculations. Write it here again.', 'funnelforms-pro' ), calc.legacy.formula )
						: sprintf( __( 'Taken over from Funnelforms 3: %s', 'funnelforms-pro' ), calc.legacy.formula ) }
				</Notice>
			) : null }
			<TextInput label={ __( 'Name', 'funnelforms-pro' ) } value={ calc.label } onChange={ ( v ) => change( ( d ) => nameCalculation( d, calc.id, v ), `calc:${ calc.id }:label` ) } hint={ __( 'Shown with the result in entries, the PDF and where you add it.', 'funnelforms-pro' ) } />
			<FieldRow
				label={ __( 'Formula', 'funnelforms-pro' ) }
				hint={ managed ? __( 'The quiz keeps this formula: the sum of its questions.', 'funnelforms-pro' ) : __( 'Answers count with their number; unanswered fields count as 0. Separate the values of a function with a semicolon.', 'funnelforms-pro' ) }
			>
				{ ( id ) => (
					<textarea
						id={ id }
						ref={ area }
						className="ffxb-input ffxb-input--code ffxb-calc__source"
						rows={ 3 }
						spellCheck={ false }
						readOnly={ readOnly || managed }
						aria-invalid={ ! parsed.ok }
						value={ source }
						onChange={ ( e ) => write( e.target.value ) }
						onBlur={ () => parsed.ok && setDraft( null ) }
					/>
				) }
			</FieldRow>
			{ parsed.ok ? null : <Notice tone="danger">{ parseError( parsed ) }</Notice> }
			{ unknown.map( ( v ) => (
				<Notice key={ v } tone="warning">
					{ sprintf( __( '[%s] is not a field of this form and counts as 0.', 'funnelforms-pro' ), v ) }
				</Notice>
			) ) }
			{ managed ? null : (
				<div className="ffxb-calc__tools">
					<div className="ffxb-calc__pickers">
						<Select
							label={ __( 'Insert a field', 'funnelforms-pro' ) }
							value=""
							options={ [
								{ value: '', label: fields.length ? __( 'Choose…', 'funnelforms-pro' ) : __( 'No fields with numbers yet', 'funnelforms-pro' ) },
								...fields.map( ( f ) => ( { value: f.key, label: `${ fieldTitle( f, locale ) } [${ f.key }]` } ) ),
							] }
							onChange={ ( key ) => {
								const f = fields.find( ( x ) => x.key === key );
								if ( f ) {
									// A date counts in days: from today until it.
									insert( 'date' === f.type ? `days([${ key }])` : COUNTED.includes( f.type ) ? `count([${ key }])` : `[${ key }]` );
								}
							} }
						/>
						{ others.length ? (
							<Select
								label={ __( 'Insert a result', 'funnelforms-pro' ) }
								value=""
								options={ [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) }, ...others.map( ( c ) => ( { value: c.id, label: `${ c.label || c.id } {${ c.id }}` } ) ) ] }
								onChange={ ( id ) => id && insert( `{${ id }}` ) }
							/>
						) : null }
					</div>
					<div className="ffxb-calc__keys" role="group" aria-label={ __( 'Operators', 'funnelforms-pro' ) }>
						{ [ '+', '-', '*', '/', '(', ')', '>', '<', '=' ].map( ( op ) => (
							<button key={ op } type="button" className="ffxb-calc__key" disabled={ readOnly } onClick={ () => insert( '(' === op || ')' === op ? op : op + ' ' ) }>
								{ { '*': '×', '/': '÷', '-': '−' }[ op ] ?? op }
							</button>
						) ) }
					</div>
					<div className="ffxb-calc__functions" role="group" aria-label={ __( 'Functions', 'funnelforms-pro' ) }>
						<span className="ffxb-calc__label">{ __( 'Functions', 'funnelforms-pro' ) }</span>
						{ [ ...functionHelp(), ...moreFunctionHelp() ].map( ( h ) => (
							<button key={ h.fn } type="button" className="ffxb-chip ffxb-calc__fn" title={ h.text } aria-label={ `${ h.fn }: ${ h.text }` } disabled={ readOnly } onClick={ () => insert( h.insert, h.insert.length - h.insert.indexOf( '(' ) - 1 ) }>
								{ h.fn }
							</button>
						) ) }
					</div>
				</div>
			) }

			{ managed ? null : <LookupTable expression={ expression } fields={ fields } readOnly={ readOnly } insert={ ( text ) => insert( text ) } replace={ write } /> }

			<TestPanel doc={ doc } fields={ fields.filter( ( f ) => vars.includes( f.key ) ) } refs={ formulaRefs( expression ) } test={ test } setTest={ setTest } readOnly={ readOnly } result={ parsed.ok ? result : undefined } calc={ calc } values={ values } />

			<div className="ffxb-calc__format">
				<Select
					label={ __( 'Decimal places', 'funnelforms-pro' ) }
					value={ String( calc.format.decimals ) }
					options={ [ 0, 1, 2, 3, 4 ].map( ( n ) => ( { value: String( n ), label: String( n ) } ) ) }
					onChange={ ( v ) => set( ( c ) => void ( c.format.decimals = Number( v ) ), 'decimals' ) }
				/>
				<Select
					label={ __( 'Number format', 'funnelforms-pro' ) }
					value={ calc.format.decimalSeparator + calc.format.thousandsSeparator }
					options={ [
						{ value: ',.', label: '1.234,50' },
						{ value: '.,', label: '1,234.50' },
						{ value: ', ', label: '1 234,50' },
						{ value: '.’', label: '1’234.50' },
						{ value: ',', label: '1234,50' },
						{ value: '.', label: '1234.50' },
						...( [ ',.', '.,', ', ', '.’', ',', '.' ].includes( calc.format.decimalSeparator + calc.format.thousandsSeparator ) ? [] : [ { value: calc.format.decimalSeparator + calc.format.thousandsSeparator, label: formatResult( 1234.5, { ...calc.format, prefix: '', suffix: '', decimals: 2 } ) } ] ),
					] }
					onChange={ ( v ) =>
						set( ( c ) => {
							c.format.decimalSeparator = v.charAt( 0 );
							c.format.thousandsSeparator = v.slice( 1 );
						}, 'format' )
					}
				/>
				<Select
					label={ __( 'Unit', 'funnelforms-pro' ) }
					value={ ownUnit ? 'own' : unitOf( calc ) }
					options={ [
						{ value: 'none', label: __( 'None', 'funnelforms-pro' ) },
						{ value: 'eur', label: '1.234 €' },
						{ value: 'eur-before', label: '€ 1.234' },
						{ value: 'usd', label: '$1,234' },
						{ value: 'gbp', label: '£1,234' },
						{ value: 'chf', label: 'CHF 1’234' },
						{ value: 'percent', label: '12 %' },
						{ value: 'own', label: __( 'Own text…', 'funnelforms-pro' ) },
					] }
					onChange={ ( v ) => {
						setOwnUnit( 'own' === v );
						const unit = UNITS.find( ( u ) => u.id === v );
						if ( unit ) {
							set( ( c ) => {
								c.format = { decimals: c.format.decimals, decimalSeparator: c.format.decimalSeparator, thousandsSeparator: c.format.thousandsSeparator, ...( unit.prefix ? { prefix: unit.prefix } : {} ), ...( unit.suffix ? { suffix: unit.suffix } : {} ) };
							}, 'unit' );
						}
					} }
				/>
			</div>
			{ ownUnit || 'own' === unitOf( calc ) ? (
				<div className="ffxb-inline">
					<TextInput label={ __( 'Before the number', 'funnelforms-pro' ) } value={ calc.format.prefix ?? '' } placeholder="ca. " onChange={ ( v ) => set( ( c ) => void ( v ? ( c.format.prefix = v.slice( 0, 20 ) ) : delete c.format.prefix ), 'prefix' ) } />
					<TextInput label={ __( 'After the number', 'funnelforms-pro' ) } value={ calc.format.suffix ?? '' } placeholder=" m²" onChange={ ( v ) => set( ( c ) => void ( v ? ( c.format.suffix = v.slice( 0, 20 ) ) : delete c.format.suffix ), 'suffix' ) } />
				</div>
			) : null }

			<LeadValueToggle doc={ doc } calc={ calc } readOnly={ readOnly } />

			<h3 className="ffxb-subtitle">{ __( 'Show the result', 'funnelforms-pro' ) }</h3>
			<div className="ffxb-inline">
				<Select
					label={ __( 'Add it to', 'funnelforms-pro' ) }
					value=""
					options={ [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) }, ...places.map( ( p ) => ( { value: p, label: placeName( p ) } ) ) ] }
					onChange={ ( p ) => {
						if ( ! p || readOnly ) {
							return;
						}
						change( ( d ) => void showResultIn( d, calc.id, p as ResultPlace, ctx ) );
						setAdded( placeName( p as ResultPlace ) );
					} }
				/>
			</div>
			{ added ? (
				<p className="ffxb-hint ffxb-calc__added" role="status">
					{ icons.check } { sprintf( __( 'Added to %s.', 'funnelforms-pro' ), added.replace( /[.!?…]+$/, '' ) ) }
				</p>
			) : null }
			<FieldRow label={ __( 'Placeholder', 'funnelforms-pro' ) } hint={ __( 'Works in the texts of steps and the contact step, on thank-you pages, in mails, the payment description and redirects.', 'funnelforms-pro' ) }>
				{ ( id ) => (
					<div className="ffxb-inline">
						<input id={ id } className="ffxb-input ffxb-input--code" readOnly value={ token } onFocus={ ( e ) => e.target.select() } />
						<Button size="sm" variant="ghost" icon={ icons.copy } aria-label={ __( 'Copy placeholder', 'funnelforms-pro' ) } title={ __( 'Copy placeholder', 'funnelforms-pro' ) } onClick={ () => void navigator.clipboard?.writeText( token ).catch( () => undefined ) } />
					</div>
				) }
			</FieldRow>
			<ResultTexts calc={ calc } result={ parsed.ok && ! Number.isNaN( result ) ? result : undefined } readOnly={ readOnly } />
			<ResultPaths doc={ doc } calc={ calc } readOnly={ readOnly } />
			{ uses.length ? <p className="ffxb-hint">{ sprintf( __( 'Used in %s. Remove it there to delete the calculation.', 'funnelforms-pro' ), uses.map( whereName ).join( ', ' ) ) }</p> : null }
			<div className="ffxb-row-actions">
				<Button size="sm" variant="danger" icon={ icons.trash } disabled={ readOnly || uses.length > 0 } onClick={ () => change( ( d ) => void removeCalculation( d, calc.id ) ) }>
					{ __( 'Delete calculation', 'funnelforms-pro' ) }
				</Button>
			</div>
		</>
	);
}

/**
 * Test answers for the fields of a formula and the result they give. The numbers of the answers
 * of choice fields are edited right here: they are the prices or points of the answers.
 */
/** The variable of a field in the test; a click renames it, and formulas and placeholders follow. */
function KeyName( { doc, field, readOnly }: { doc: FormDocument; field: Field; readOnly: boolean } ) {
	const change = useChange();
	const [ value, setValue ] = useState<string | null>( null );
	if ( null === value ) {
		return readOnly ? (
			<code>[{ field.key }]</code>
		) : (
			<button type="button" className="ffxb-calc__key-name" title={ __( 'Rename the variable', 'funnelforms-pro' ) } onClick={ () => setValue( field.key ) }>
				<code>[{ field.key }]</code>
			</button>
		);
	}
	const key = value.trim().replace( /[^A-Za-z0-9_-]/g, '_' );
	const taken = doc.nodes.some( ( n ) => 'end' !== n.type && ( n.fields as Array<{ id: string; key: string }> ).some( ( f ) => f.id !== field.id && f.key === key ) );
	const save = (): void => {
		if ( key && ! taken && key !== field.key ) {
			change( ( d ) => void renameFieldKey( d, field.id, key ) );
		}
		setValue( null );
	};
	return (
		<input
			className="ffxb-input ffxb-input--code ffxb-input--narrow"
			aria-label={ sprintf( /* translators: %s: title of a field */ __( 'Variable name of %s', 'funnelforms-pro' ), fieldTitle( field, doc.locales.default ) ) }
			title={ taken ? __( 'Another field has this name.', 'funnelforms-pro' ) : __( 'Formulas and placeholders use the new name.', 'funnelforms-pro' ) }
			aria-invalid={ taken || ! key }
			value={ value }
			autoFocus
			onChange={ ( e ) => setValue( e.target.value ) }
			onBlur={ save }
			onKeyDown={ ( e ) => {
				if ( 'Enter' === e.key ) {
					e.preventDefault();
					save();
				} else if ( 'Escape' === e.key ) {
					setValue( null );
				}
			} }
		/>
	);
}

function TestPanel( props: {
	doc: FormDocument;
	fields: Field[];
	refs: string[];
	test: Record<string, unknown>;
	setTest: ( update: ( t: Record<string, unknown> ) => Record<string, unknown> ) => void;
	readOnly: boolean;
	result: number | undefined;
	calc: Calculation;
	values: Record<string, number>;
} ) {
	const { doc, fields, refs, test, setTest, readOnly, result, calc, values } = props;
	const change = useChange();
	const locale = doc.locales.default;
	const setAnswer = ( id: string, value: unknown ): void => setTest( ( t ) => ( { ...t, [ id ]: value } ) );
	const setValue = ( fieldId: string, optionId: string, value: number | undefined ): void =>
		change( ( d ) => {
			for ( const node of d.nodes ) {
				for ( const f of 'step' === node.type ? node.fields : [] ) {
					if ( f.id === fieldId && 'options' in f ) {
						const option = f.options.find( ( o ) => o.id === optionId );
						if ( option ) {
							if ( undefined === value ) {
								delete option.calcValue;
							} else {
								option.calcValue = value;
							}
						}
					}
				}
			}
		}, `calc-value:${ optionId }` );
	const shown = undefined === result || Number.isNaN( result ) ? null : formatResult( result, calc.format );
	return (
		<div className="ffxb-calc__test">
			<div className="ffxb-calc__test-head">
				<h3 className="ffxb-subtitle">{ __( 'Try it out', 'funnelforms-pro' ) }</h3>
				<div className="ffxb-calc__result" role="status" aria-live="polite">
					<span>{ __( 'Result', 'funnelforms-pro' ) }</span>
					<strong className={ null === shown ? 'is-error' : '' }>{ null === shown ? __( 'cannot be computed', 'funnelforms-pro' ) : shown }</strong>
				</div>
			</div>
			{ fields.length || refs.length ? null : <p className="ffxb-hint">{ __( 'Insert fields into the formula to try it with answers.', 'funnelforms-pro' ) }</p> }
			{ fields.map( ( f ) => (
				<div key={ f.id } className="ffxb-calc__row">
					<div className="ffxb-calc__row-label">
						<TypeIcon type={ f.type } size={ 16 } />
						<span>{ fieldTitle( f, locale ) }</span>
						<KeyName doc={ doc } field={ f } readOnly={ readOnly } />
					</div>
					<TestAnswer field={ f } value={ test[ f.id ] } onChange={ ( v ) => setAnswer( f.id, v ) } onValue={ readOnly ? undefined : ( o, v ) => setValue( f.id, o, v ) } locale={ locale } />
				</div>
			) ) }
			{ refs.map( ( id ) => {
				const other = doc.calculations.find( ( c ) => c.id === id );
				const v = values[ 'calc:' + id ];
				return other ? (
					<div key={ id } className="ffxb-calc__row">
						<div className="ffxb-calc__row-label">
							<span>{ other.label || other.id }</span>
							<code>{ `{${ id }}` }</code>
						</div>
						<span className="ffxb-calc__ref">{ undefined === v || Number.isNaN( v ) ? __( 'cannot be computed', 'funnelforms-pro' ) : formatResult( v, other.format ) }</span>
					</div>
				) : null;
			} ) }
			{ shown === null && undefined !== result ? <p className="ffxb-hint">{ __( 'With these answers the formula divides by 0 or uses a result that cannot be computed. Visitors then see the error text of calculations.', 'funnelforms-pro' ) }</p> : null }
		</div>
	);
}

function TestAnswer( { field, value, onChange, onValue, locale }: { field: Field; value: unknown; onChange: ( v: unknown ) => void; onValue?: ( option: string, value: number | undefined ) => void; locale: string } ) {
	if ( 'date' === field.type ) {
		return <DateTestAnswer field={ field } value={ value } onChange={ onChange } />;
	}
	if ( 'choice' === field.type || 'dropdown' === field.type ) {
		const chosen = Array.isArray( value ) ? ( value as string[] ) : [];
		const multiple = Boolean( field.props.multiple );
		const knowledge = field.options.some( ( o ) => o.correct );
		return (
			<ul className="ffxb-calc__options">
				{ field.options.map( ( o ) => (
					<li key={ o.id }>
						<label className="ffxb-calc__option">
							<input
								type={ multiple ? 'checkbox' : 'radio' }
								name={ 'test-' + field.id }
								checked={ chosen.includes( o.id ) }
								onChange={ ( e ) => onChange( multiple ? ( e.target.checked ? [ ...chosen, o.id ] : chosen.filter( ( x ) => x !== o.id ) ) : [ o.id ] ) }
							/>
							<span>{ o.label[ locale ] ?? Object.values( o.label )[ 0 ] ?? o.value }</span>
						</label>
						{ knowledge ? (
							<span className="ffxb-calc__right">{ o.correct ? __( 'right', 'funnelforms-pro' ) : '' }</span>
						) : (
							<input
								className="ffxb-input ffxb-input--tiny"
								type="number"
								step="any"
								aria-label={ sprintf( __( 'Value of “%s”', 'funnelforms-pro' ), o.label[ locale ] ?? o.value ) }
								placeholder="0"
								value={ undefined === o.calcValue ? '' : o.calcValue }
								readOnly={ ! onValue }
								onChange={ ( e ) => onValue?.( o.id, '' === e.target.value ? undefined : Number( e.target.value ) ) }
							/>
						) }
					</li>
				) ) }
			</ul>
		);
	}
	const label = 'repeat' === field.type ? __( 'Items', 'funnelforms-pro' ) : COUNTED.includes( field.type ) ? __( 'Answers', 'funnelforms-pro' ) : __( 'Answer', 'funnelforms-pro' );
	const number = 'repeat' === field.type || COUNTED.includes( field.type );
	const shown = number ? ( Array.isArray( value ) ? String( value.length ) : '' ) : String( value ?? ( 'slider' === field.type ? field.props.start : '' ) );
	return (
		<input
			className="ffxb-input ffxb-calc__answer"
			type="number"
			step="any"
			min={ number ? 0 : undefined }
			aria-label={ label }
			placeholder={ 'slider' === field.type ? String( field.props.start ) : '0' }
			value={ shown }
			onChange={ ( e ) => onChange( number ? Array.from( { length: Math.max( 0, Math.min( 50, Number( e.target.value ) || 0 ) ) }, ( _, i ) => ( { i } ) ) : e.target.value ) }
		/>
	);
}

/** "Continue by result": after a step the way on depends on the result, checked from the top. */
function ResultPaths( { doc, calc, readOnly }: { doc: FormDocument; calc: Calculation; readOnly: boolean } ) {
	const change = useChange();
	const locale = doc.locales.default;
	const paths = resultPaths( doc, calc.id );
	const sources = doc.nodes.filter( ( n ) => 'end' !== n.type );
	const name = ( id: string ): string => {
		const node = findNode( doc, id );
		return ( node ? nodeName( node, locale ) : '' ) || __( 'Without a title', 'funnelforms-pro' );
	};
	const targets = ( from: string ) => doc.nodes.filter( ( n ) => n.id !== from ).map( ( n ) => ( { value: n.id, label: ( 'end' === n.type ? '⚑ ' : '' ) + name( n.id ) } ) );
	const ops: Array<{ value: ResultOp; label: string }> = [
		{ value: 'gte', label: __( 'from', 'funnelforms-pro' ) },
		{ value: 'gt', label: __( 'above', 'funnelforms-pro' ) },
		{ value: 'lte', label: __( 'up to', 'funnelforms-pro' ) },
		{ value: 'lt', label: __( 'below', 'funnelforms-pro' ) },
		{ value: 'eq', label: __( 'exactly', 'funnelforms-pro' ) },
		{ value: 'neq', label: __( 'not', 'funnelforms-pro' ) },
	];
	const start = ( node: string ): void => {
		const next = doc.edges.find( ( e ) => e.from === node && ( e.default || ! e.when ) )?.to ?? doc.nodes.find( ( n ) => n.id !== node && 'end' === n.type )?.id ?? doc.nodes.find( ( n ) => n.id !== node )?.id;
		if ( next ) {
			change( ( d ) => void addResultRule( d, node, calc.id, next ) );
		}
	};
	return (
		<div className="ffxb-calc__paths">
			<h3 className="ffxb-subtitle">{ __( 'Continue by result', 'funnelforms-pro' ) }</h3>
			{ paths.map( ( p ) => (
				<div key={ p.node } className="ffxb-calc__path">
					<p className="ffxb-calc__path-head">{ sprintf( __( 'After “%s”', 'funnelforms-pro' ), name( p.node ) ) }</p>
					{ p.rules.map( ( r ) => (
						<div key={ r.edge } className="ffxb-calc__rule">
							<select className="ffxb-input" aria-label={ __( 'Comparison', 'funnelforms-pro' ) } value={ r.op } disabled={ readOnly } onChange={ ( e ) => change( ( d ) => setResultRule( d, r.edge, calc.id, { op: e.target.value as ResultOp } ) ) }>
								{ ops.map( ( o ) => (
									<option key={ o.value } value={ o.value }>
										{ o.label }
									</option>
								) ) }
							</select>
							<input className="ffxb-input" type="number" step="any" aria-label={ __( 'Value', 'funnelforms-pro' ) } value={ r.value } readOnly={ readOnly } onChange={ ( e ) => '' !== e.target.value && change( ( d ) => setResultRule( d, r.edge, calc.id, { value: Number( e.target.value ) } ), 'rule:' + r.edge ) } />
							<span aria-hidden="true">→</span>
							<select className="ffxb-input" aria-label={ __( 'Go to', 'funnelforms-pro' ) } value={ r.to } disabled={ readOnly } onChange={ ( e ) => change( ( d ) => setResultRule( d, r.edge, calc.id, { to: e.target.value } ) ) }>
								{ targets( p.node ).map( ( t ) => (
									<option key={ t.value } value={ t.value }>
										{ t.label }
									</option>
								) ) }
							</select>
							<Button size="sm" variant="ghost" icon={ icons.trash } aria-label={ __( 'Remove rule', 'funnelforms-pro' ) } title={ __( 'Remove rule', 'funnelforms-pro' ) } disabled={ readOnly } onClick={ () => change( ( d ) => removeEdgeOf( d, r.edge ) ) } />
						</div>
					) ) }
					<div className="ffxb-calc__rule">
						<span className="ffxb-calc__otherwise">{ __( 'Otherwise', 'funnelforms-pro' ) }</span>
						<span aria-hidden="true">→</span>
						<select className="ffxb-input" aria-label={ __( 'Otherwise go to', 'funnelforms-pro' ) } value={ p.otherwise ?? '' } disabled={ readOnly } onChange={ ( e ) => change( ( d ) => setOtherwise( d, p.node, e.target.value ) ) }>
							{ null === p.otherwise ? <option value="">{ __( 'Choose…', 'funnelforms-pro' ) }</option> : null }
							{ targets( p.node ).map( ( t ) => (
								<option key={ t.value } value={ t.value }>
									{ t.label }
								</option>
							) ) }
						</select>
					</div>
					<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly } onClick={ () => start( p.node ) }>
						{ __( 'Add rule', 'funnelforms-pro' ) }
					</Button>
				</div>
			) ) }
			<Select
				label={ paths.length ? __( 'Also after', 'funnelforms-pro' ) : __( 'After the step', 'funnelforms-pro' ) }
				value=""
				options={ [ { value: '', label: __( 'Choose a step…', 'funnelforms-pro' ) }, ...sources.filter( ( n ) => ! paths.some( ( p ) => p.node === n.id ) ).map( ( n ) => ( { value: n.id, label: name( n.id ) } ) ) ] }
				onChange={ ( v ) => v && ! readOnly && start( v ) }
				hint={ __( 'The result counts the answers given up to that step. Rules are checked from the top; the first that holds decides.', 'funnelforms-pro' ) }
			/>
		</div>
	);
}
