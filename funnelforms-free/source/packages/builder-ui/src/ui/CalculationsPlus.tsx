/**
 * The parts of a calculation card for calculator funnels (Funnelforms Pro): the functions clamp,
 * lookup, days and age with a table that writes lookup() for price tiers, texts by range of the
 * result ({{calc:<id>:text}}), the lead value and test dates for days() and age().
 */
import React, { useState } from 'react';
import type { Calculation, CalcFunction, ExpressionNode, Field, FormDocument } from '@funnelforms/form-schema';
import { parseFormula, printFormula, rangeText } from '../calculations';
import type { Recipe } from '../store';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { put, TextProp } from './texts';
import { Badge, Button, Field as FieldRow, IconButton, icons, Notice, Toggle } from './ui';

/** Most texts by range a calculation can have (form.v1.schema.json). */
const MAX_TEXTS = 20;

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

/** Changes one calculation of the document. */
function useCalc( id: string ): ( recipe: ( c: Calculation ) => void, key: string ) => void {
	const change = useChange();
	return ( recipe, key ) =>
		change( ( d ) => {
			const c = d.calculations.find( ( x ) => x.id === id );
			if ( c ) {
				recipe( c );
			}
		}, `calc:${ id }:${ key }` );
}

/** The new functions as the editor offers them, next to round(), if() and the others. */
export function moreFunctionHelp(): Array<{ fn: CalcFunction; insert: string; text: string }> {
	return [
		{ fn: 'clamp', insert: 'clamp(; ; )', text: __( 'Keeps a value between a minimum and a maximum: clamp([m2] * 12; 99; 2500).', 'funnelforms-pro' ) },
		{ fn: 'lookup', insert: 'lookup(; ; ; )', text: __( 'Price tiers: the value of the first limit the number is up to, else the last value. lookup([quantity]; 10; 25; 50; 20; 15).', 'funnelforms-pro' ) },
		{ fn: 'days', insert: 'days()', text: __( 'Days from today until a date field: days([move_date]). Days between two dates: days([arrival]; [departure]).', 'funnelforms-pro' ) },
		{ fn: 'age', insert: 'age()', text: __( 'Full years since a date field until today: age([birthday]).', 'funnelforms-pro' ) },
	];
}

interface Tier {
	limit: string;
	value: string;
}

/** The parts of a lookup() whose limits are plain numbers, to edit it as a table; null for anything else. */
function tableOf( node: ExpressionNode ): { input: string; tiers: Tier[]; otherwise: string } | null {
	if ( ! ( 'fn' in node ) || 'lookup' !== node.fn || node.args.length < 4 || node.args.length % 2 ) {
		return null;
	}
	const [ input, ...rest ] = node.args;
	const otherwise = rest.pop();
	const tiers: Tier[] = [];
	for ( let i = 0; i < rest.length; i += 2 ) {
		const limit = rest[ i ];
		const value = rest[ i + 1 ];
		if ( ! limit || ! value || ! ( 'num' in limit || ( 'neg' in limit && 'num' in limit.neg ) ) ) {
			return null;
		}
		tiers.push( { limit: printFormula( limit ), value: printFormula( value ) } );
	}
	return input && otherwise ? { input: printFormula( input ), tiers, otherwise: printFormula( otherwise ) } : null;
}

/** The formula of a table: tiers by their limits, the smallest first; empty values count 0. */
export function lookupFormula( input: string, tiers: Tier[], otherwise: string ): string {
	const rows = tiers
		.map( ( t ) => ( { limit: Number( t.limit.replace( ',', '.' ) ), value: t.value.trim() || '0' } ) )
		.filter( ( t ) => Number.isFinite( t.limit ) )
		.sort( ( a, b ) => a.limit - b.limit );
	return `lookup(${ [ input.trim() || '0', ...rows.flatMap( ( t ) => [ String( t.limit ), t.value ] ), otherwise.trim() || '0' ].join( '; ' ) })`;
}

/**
 * "Price table": tiers of a number, e.g. a price per piece by quantity or a price per zone, as
 * rows of "up to" and result. Writes lookup(); a formula that is such a lookup is edited in place.
 */
export function LookupTable( props: { expression: ExpressionNode; fields: Field[]; readOnly: boolean; insert: ( text: string ) => void; replace: ( text: string ) => void } ) {
	const { expression, fields, readOnly } = props;
	const [ open, setOpen ] = useState( false );
	const [ input, setInput ] = useState( '' );
	const [ tiers, setTiers ] = useState<Tier[]>( [] );
	const [ otherwise, setOtherwise ] = useState( '' );
	const [ editing, setEditing ] = useState( false );
	const start = (): void => {
		const table = tableOf( expression );
		const first = fields.find( ( f ) => [ 'slider', 'number', 'choice', 'dropdown' ].includes( f.type ) ) ?? fields[ 0 ];
		setEditing( null !== table );
		setInput( table?.input ?? ( first ? `[${ first.key }]` : '' ) );
		setTiers(
			table?.tiers ?? [
				{ limit: '10', value: '' },
				{ limit: '50', value: '' },
			]
		);
		setOtherwise( table?.otherwise ?? '' );
		setOpen( true );
	};
	if ( ! open ) {
		return (
			<div className="ffxb-calc-table__start">
				<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly } onClick={ start }>
					{ null === tableOf( expression ) ? __( 'Price table', 'funnelforms-pro' ) : __( 'Edit as price table', 'funnelforms-pro' ) }
				</Button>
				<span className="ffxb-hint">{ __( 'Tiers without nested if(): a price per quantity, zone or size.', 'funnelforms-pro' ) }</span>
			</div>
		);
	}
	const formula = lookupFormula( input, tiers, otherwise );
	const parsed = parseFormula( formula );
	const setTier = ( i: number, patch: Partial<Tier> ): void => setTiers( ( list ) => list.map( ( t, j ) => ( i === j ? { ...t, ...patch } : t ) ) );
	return (
		<div className="ffxb-calc-table" role="group" aria-label={ __( 'Price table', 'funnelforms-pro' ) }>
			<FieldRow label={ __( 'Look up', 'funnelforms-pro' ) } hint={ __( 'The number the table looks up, e.g. [quantity] or [m2] * 2.', 'funnelforms-pro' ) }>
				{ ( id ) => (
					<div className="ffxb-inline">
						<input id={ id } className="ffxb-input ffxb-input--code" value={ input } onChange={ ( e ) => setInput( e.target.value ) } />
						<select className="ffxb-input" aria-label={ __( 'Insert a field', 'funnelforms-pro' ) } value="" onChange={ ( e ) => e.target.value && setInput( `[${ e.target.value }]` ) }>
							<option value="">{ __( 'Field…', 'funnelforms-pro' ) }</option>
							{ fields.map( ( f ) => (
								<option key={ f.id } value={ f.key }>
									{ f.key }
								</option>
							) ) }
						</select>
					</div>
				) }
			</FieldRow>
			<table className="ffxb-calc-table__rows">
				<thead>
					<tr>
						<th scope="col">{ __( 'Up to', 'funnelforms-pro' ) }</th>
						<th scope="col">{ __( 'Result', 'funnelforms-pro' ) }</th>
						<th scope="col" aria-label={ __( 'Remove', 'funnelforms-pro' ) } />
					</tr>
				</thead>
				<tbody>
					{ tiers.map( ( t, i ) => (
						<tr key={ i }>
							<td>
								<input className="ffxb-input" type="number" step="any" aria-label={ sprintf( /* translators: %d: number of the row of a price table */ __( 'Limit of row %d', 'funnelforms-pro' ), i + 1 ) } value={ t.limit } onChange={ ( e ) => setTier( i, { limit: e.target.value } ) } />
							</td>
							<td>
								<input className="ffxb-input ffxb-input--code" aria-label={ sprintf( /* translators: %d: number of the row of a price table */ __( 'Result of row %d', 'funnelforms-pro' ), i + 1 ) } placeholder="0" value={ t.value } onChange={ ( e ) => setTier( i, { value: e.target.value } ) } />
							</td>
							<td>
								<IconButton label={ __( 'Remove row', 'funnelforms-pro' ) } icon={ icons.trash } disabled={ tiers.length <= 1 } onClick={ () => setTiers( ( list ) => list.filter( ( _, j ) => j !== i ) ) } />
							</td>
						</tr>
					) ) }
					<tr>
						<th scope="row">{ __( 'Above that', 'funnelforms-pro' ) }</th>
						<td>
							<input className="ffxb-input ffxb-input--code" aria-label={ __( 'Result above the last limit', 'funnelforms-pro' ) } placeholder="0" value={ otherwise } onChange={ ( e ) => setOtherwise( e.target.value ) } />
						</td>
						<td />
					</tr>
				</tbody>
			</table>
			<div className="ffxb-row-actions">
				<Button
					size="sm"
					variant="ghost"
					icon={ icons.plus }
					disabled={ tiers.length >= 24 }
					onClick={ () => {
						const last = Number( tiers[ tiers.length - 1 ]?.limit ) || 0;
						setTiers( ( list ) => [ ...list, { limit: String( last * 2 || 10 ), value: '' } ] );
					} }
				>
					{ __( 'Add row', 'funnelforms-pro' ) }
				</Button>
			</div>
			<code className="ffxb-calc-table__formula">{ formula }</code>
			{ parsed.ok ? null : <Notice tone="danger">{ __( 'A value of the table cannot be read. Use numbers, fields in [brackets] and the operators of formulas.', 'funnelforms-pro' ) }</Notice> }
			<div className="ffxb-row-actions">
				<Button
					size="sm"
					disabled={ readOnly || ! parsed.ok }
					onClick={ () => {
						// A formula that is only a number (a new calculation: 0) becomes the table.
						( editing || 'num' in expression ? props.replace : props.insert )( formula );
						setOpen( false );
					} }
				>
					{ editing || 'num' in expression ? __( 'Apply table', 'funnelforms-pro' ) : __( 'Insert into the formula', 'funnelforms-pro' ) }
				</Button>
				<Button size="sm" variant="ghost" onClick={ () => setOpen( false ) }>
					{ __( 'Cancel', 'funnelforms-pro' ) }
				</Button>
			</div>
		</div>
	);
}

/** Texts by range of the result: "0 to 40: Beginner", "from 5,000: We recommend a visit". */
export function ResultTexts( { calc, result, readOnly }: { calc: Calculation; result: number | undefined; readOnly: boolean } ) {
	const { ctx, lang } = useEnv();
	const set = useCalc( calc.id );
	const texts = calc.texts ?? [];
	const token = `{{calc:${ calc.id }:text}}`;
	const current = rangeText( calc, result );
	const number = ( value: string ): number | undefined => ( '' === value.trim() || ! Number.isFinite( Number( value ) ) ? undefined : Number( value ) );
	const bound = ( i: number, key: 'from' | 'to', value: string ): void =>
		set( ( c ) => {
			const range = c.texts?.[ i ];
			if ( range ) {
				const n = number( value );
				if ( undefined !== n ) {
					range[ key ] = n;
				} else if ( 'from' === key ) {
					delete range.from;
				} else {
					delete range.to;
				}
			}
		}, `texts.${ i }.${ key }` );
	return (
		<div className="ffxb-calc-texts">
			<h3 className="ffxb-subtitle">{ __( 'Text by result', 'funnelforms-pro' ) }</h3>
			<p className="ffxb-hint">{ __( 'A text for each range of the result, e.g. a level for a score or a recommendation for a high price. The first range the result lies in counts; an empty limit leaves the range open.', 'funnelforms-pro' ) }</p>
			{ texts.map( ( range, i ) => (
				<div key={ i } className={ 'ffxb-calc-texts__row' + ( current && current === range.text ? ' is-current' : '' ) }>
					<div className="ffxb-calc-texts__range">
						<input className="ffxb-input" type="number" step="any" aria-label={ sprintf( /* translators: %d: number of a text by result */ __( 'From (text %d)', 'funnelforms-pro' ), i + 1 ) } placeholder={ __( 'From', 'funnelforms-pro' ) } value={ range.from ?? '' } readOnly={ readOnly } onChange={ ( e ) => bound( i, 'from', e.target.value ) } />
						<span aria-hidden="true">–</span>
						<input className="ffxb-input" type="number" step="any" aria-label={ sprintf( /* translators: %d: number of a text by result */ __( 'To (text %d)', 'funnelforms-pro' ), i + 1 ) } placeholder={ __( 'To', 'funnelforms-pro' ) } value={ range.to ?? '' } readOnly={ readOnly } onChange={ ( e ) => bound( i, 'to', e.target.value ) } />
						{ current && current === range.text ? <Badge tone="brand">{ __( 'Applies to the test', 'funnelforms-pro' ) }</Badge> : null }
						<IconButton label={ __( 'Remove text', 'funnelforms-pro' ) } icon={ icons.trash } disabled={ readOnly } onClick={ () => set( ( c ) => void c.texts?.splice( i, 1 ), 'texts' ) } />
					</div>
					<TextProp label={ __( 'Text', 'funnelforms-pro' ) } value={ range.text } onChange={ ( v ) => set( ( c ) => c.texts?.[ i ] && put( c.texts[ i ], 'text', lang, v, ctx.locale ), `texts.${ i }.text` ) } />
				</div>
			) ) }
			<div className="ffxb-row-actions">
				<Button
					size="sm"
					variant="ghost"
					icon={ icons.plus }
					disabled={ readOnly || texts.length >= MAX_TEXTS }
					onClick={ () =>
						set( ( c ) => {
							const last = c.texts?.[ c.texts.length - 1 ];
							const from = undefined !== last?.to ? last.to + 1 : undefined;
							( c.texts ??= [] ).push( { ...( undefined === from ? {} : { from } ), text: { [ ctx.locale ]: '' } } );
						}, 'texts' )
					}
				>
					{ __( 'Add text', 'funnelforms-pro' ) }
				</Button>
			</div>
			{ texts.length ? (
				<FieldRow label={ __( 'Placeholder of the text', 'funnelforms-pro' ) } hint={ __( 'In steps, on thank-you pages and in mails; a live result can show it as a line too.', 'funnelforms-pro' ) }>
					{ ( id ) => (
						<div className="ffxb-inline">
							<input id={ id } className="ffxb-input ffxb-input--code" readOnly value={ token } onFocus={ ( e ) => e.target.select() } />
							<Button size="sm" variant="ghost" icon={ icons.copy } aria-label={ __( 'Copy placeholder', 'funnelforms-pro' ) } title={ __( 'Copy placeholder', 'funnelforms-pro' ) } onClick={ () => void navigator.clipboard?.writeText( token ).catch( () => undefined ) } />
						</div>
					) }
				</FieldRow>
			) : null }
		</div>
	);
}

/** "This is the order value of the lead": settings.valueCalculation. */
export function LeadValueToggle( { doc, calc, readOnly }: { doc: FormDocument; calc: Calculation; readOnly: boolean } ) {
	const change = useChange();
	const on = doc.settings.valueCalculation === calc.id;
	const other = doc.calculations.find( ( c ) => c.id === doc.settings.valueCalculation && c.id !== calc.id );
	return (
		<Toggle
			label={ __( 'This is the order value of the lead', 'funnelforms-pro' ) }
			checked={ on }
			disabled={ readOnly }
			hint={
				other && ! on
					? sprintf( /* translators: %s: name of another calculation */ __( 'Now “%s” is the lead value; switching it on here replaces it.', 'funnelforms-pro' ), other.label || other.id )
					: __( 'Each entry keeps this result as its lead value: the lead list shows and sorts by it, the export, webhooks and CRMs get it.', 'funnelforms-pro' )
			}
			onChange={ ( v ) =>
				change( ( d ) => {
					if ( v ) {
						d.settings.valueCalculation = calc.id;
					} else if ( d.settings.valueCalculation === calc.id ) {
						delete d.settings.valueCalculation;
					}
				} )
			}
		/>
	);
}

/** A date for the test, in the format of the field: YYYY-MM-DD of the date input written as dd.mm.yy and so on. */
function formatted( iso: string, format: string ): string {
	const [ y = '', m = '', d = '' ] = iso.split( '-' );
	return iso ? format.replace( 'dd', d ).replace( 'mm', m ).replace( 'yy', y ) : '';
}

/** The YYYY-MM-DD of a date written in the format of the field, for the date input. */
function isoOf( text: string, format: string ): string {
	const order: string[] = format.match( /dd|mm|yy/g ) ?? [];
	const digits = text.match( /\d+/g ) ?? [];
	const part = ( key: string, size: number ): string => ( digits[ order.indexOf( key ) ] ?? '' ).padStart( size, '0' );
	return 3 === digits.length ? `${ part( 'yy', 4 ) }-${ part( 'mm', 2 ) }-${ part( 'dd', 2 ) }` : '';
}

/** Test answer of a date field: one date, or two for a period. */
export function DateTestAnswer( { field, value, onChange }: { field: Extract<Field, { type: 'date' }>; value: unknown; onChange: ( v: unknown ) => void } ) {
	const format = field.props.format || 'dd.mm.yy';
	const [ from = '', to = '' ] = ( 'string' === typeof value ? value : '' ).split( ' – ' );
	const write = ( a: string, b: string ): void => onChange( field.props.range ? ( a && b ? `${ a } – ${ b }` : a ) : a );
	return (
		<div className="ffxb-inline">
			<input className="ffxb-input ffxb-calc__answer" type="date" aria-label={ field.props.range ? __( 'From', 'funnelforms-pro' ) : __( 'Answer', 'funnelforms-pro' ) } value={ isoOf( from, format ) } onChange={ ( e ) => write( formatted( e.target.value, format ), to ) } />
			{ field.props.range ? <input className="ffxb-input ffxb-calc__answer" type="date" aria-label={ __( 'To', 'funnelforms-pro' ) } value={ isoOf( to, format ) } onChange={ ( e ) => write( from, formatted( e.target.value, format ) ) } /> : null }
		</div>
	);
}
