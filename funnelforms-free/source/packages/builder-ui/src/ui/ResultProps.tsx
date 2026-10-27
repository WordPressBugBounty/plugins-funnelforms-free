/**
 * Settings of "Live result": which calculations it shows, with which labels, and whether it is a
 * card in the step or a box that stays visible on the following steps.
 */
import React from 'react';
import type { ResultField, ResultLine } from '@funnelforms/form-schema';
import type { Edit } from './Answers';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';
import { put, TextProp } from './texts';
import { Button, ChoiceTiles, IconButton, icons, Notice, Select, Sketch, TextInput, Toggle } from './ui';
import { LineTextToggle, ResultReveal } from './ResultReveal';

const MAX_LINES = 10;
const NONE: never[] = [];

export function ResultProps( { field, edit }: { field: ResultField; edit: Edit } ) {
	const { ctx, lang, readOnly } = useEnv();
	const calculations = useBuilder( ( st ) => st.doc?.calculations ?? NONE );
	const p = field.props;
	const props = ( recipe: ( props: ResultField[ 'props' ] ) => void, key?: string ): void => edit( ( f ) => recipe( ( f as ResultField ).props ), key );
	const line = ( i: number, recipe: ( l: ResultLine ) => void, key: string ): void =>
		props( ( pr ) => {
			const item = pr.lines[ i ];
			if ( item ) {
				recipe( item );
			}
		}, `lines.${ i }.${ key }` );
	const choices = calculations.map( ( c ) => ( { value: c.id, label: c.label || c.id } ) );
	return (
		<>
			<ChoiceTiles
				label={ __( 'Display', 'funnelforms-pro' ) }
				value={ p.style }
				columns={ 2 }
				options={ [
					{ value: 'sticky', label: __( 'Stays visible on the next steps', 'funnelforms-pro' ), icon: <ShownSketch style="sticky" /> },
					{ value: 'card', label: __( 'Card in this step', 'funnelforms-pro' ), icon: <ShownSketch style="card" /> },
				] }
				onChange={ ( v ) => props( ( pr ) => void ( pr.style = v ), 'style' ) }
			/>
			{ 'sticky' === p.style ? <p className="ffxb-hint">{ __( 'A bar at the bottom on phones, a card beside the steps on wide screens.', 'funnelforms-pro' ) }</p> : null }
			{ choices.length ? null : <Notice tone="warning">{ __( 'Add a calculation first, e.g. the price. The live result shows its result and updates it while visitors answer.', 'funnelforms-pro' ) }</Notice> }
			<div className="ffxb-group">
				<p className="ffxb-field__label">{ __( 'Results', 'funnelforms-pro' ) }</p>
				<p className="ffxb-hint">{ __( 'The first result is shown large, the others break it down. Currency and decimals come from the calculation.', 'funnelforms-pro' ) }</p>
				{ p.lines.map( ( l, i ) => (
					<div key={ i } className="ffxb-result-line">
						<div className="ffxb-result-line__head">
							<strong>{ 0 === i ? __( 'Main result', 'funnelforms-pro' ) : sprintf( /* translators: %d: number of the line in the breakdown */ __( 'Line %d', 'funnelforms-pro' ), i ) }</strong>
							<IconButton label={ __( 'Remove result', 'funnelforms-pro' ) } icon={ icons.trash } disabled={ readOnly } onClick={ () => props( ( pr ) => void pr.lines.splice( i, 1 ) ) } />
						</div>
						<TextProp label={ __( 'Label', 'funnelforms-pro' ) } value={ l.label } onChange={ ( v ) => line( i, ( item ) => put( item, 'label', lang, v, ctx.locale ), 'label' ) } />
						<Select
							label={ __( 'Calculation', 'funnelforms-pro' ) }
							value={ l.calculation }
							options={ choices.some( ( c ) => c.value === l.calculation ) ? choices : [ { value: l.calculation, label: l.calculation }, ...choices ] }
							onChange={ ( v ) => line( i, ( item ) => void ( item.calculation = v ), 'calculation' ) }
						/>
						<Select
							label={ __( 'Up to (for a range)', 'funnelforms-pro' ) }
							value={ l.to ?? '' }
							options={ [ { value: '', label: __( 'No range', 'funnelforms-pro' ) }, ...choices.filter( ( c ) => c.value !== l.calculation ) ] }
							onChange={ ( v ) =>
								line(
									i,
									( item ) => {
										if ( v ) {
											item.to = v;
										} else {
											delete item.to;
										}
									},
									'to'
								)
							}
						/>
						<Toggle
							label={ __( 'Starting price ("from")', 'funnelforms-pro' ) }
							checked={ true === l.from }
							disabled={ readOnly }
							onChange={ ( v ) =>
								line(
									i,
									( item ) => {
										if ( v ) {
											item.from = true;
										} else {
											delete item.from;
										}
									},
									'from'
								)
							}
						/>
						<LineTextToggle
							line={ l }
							onChange={ ( v ) =>
								line(
									i,
									( item ) => {
										if ( v ) {
											item.text = true;
										} else {
											delete item.text;
										}
									},
									'text'
								)
							}
						/>
						<div className="ffxb-pair">
							<TextInput label={ __( 'Before the result', 'funnelforms-pro' ) } value={ l.prefix ?? '' } onChange={ ( v ) => line( i, ( item ) => affix( item, 'prefix', v ), 'prefix' ) } />
							<TextInput label={ __( 'After the result', 'funnelforms-pro' ) } value={ l.suffix ?? '' } onChange={ ( v ) => line( i, ( item ) => affix( item, 'suffix', v ), 'suffix' ) } />
						</div>
					</div>
				) ) }
				<div className="ffxb-group__buttons">
					<Button
						size="sm"
						variant="ghost"
						icon={ icons.plus }
						disabled={ readOnly || ! choices.length || p.lines.length >= MAX_LINES }
						onClick={ () => props( ( pr ) => void pr.lines.push( { calculation: choices[ 0 ]?.value ?? '', label: { [ ctx.locale ]: '' } } ) ) }
					>
						{ __( 'Add result', 'funnelforms-pro' ) }
					</Button>
				</div>
			</div>
			<ResultReveal field={ field } edit={ edit } />
			<TextProp
				label={ __( 'Note below the result', 'funnelforms-pro' ) }
				value={ p.disclaimer }
				onChange={ ( v ) => props( ( pr ) => put( pr, 'disclaimer', lang, v, ctx.locale ), 'disclaimer' ) }
				hint={ __( 'E.g. "Estimate without obligation, incl. VAT."', 'funnelforms-pro' ) }
			/>
		</>
	);
}

/** Sets a prefix or suffix of a line; empty ones are removed. */
function affix( item: ResultLine, key: 'prefix' | 'suffix', value: string ): void {
	if ( value ) {
		item[ key ] = value.slice( 0, 40 );
	} else {
		Reflect.deleteProperty( item, key );
	}
}

/** The live result as a box beside the steps, or as a card in its step. */
function ShownSketch( { style }: { style: ResultField[ 'props' ][ 'style' ] } ) {
	return (
		<Sketch>
			{ 'sticky' === style ? (
				<>
					<path d="M4 8h24M4 13h20M4 18h22" />
					<rect x="32" y="5" width="12" height="20" rx="2" fill="currentColor" opacity="0.35" />
				</>
			) : (
				<>
					<path d="M8 6h32" />
					<rect x="8" y="11" width="32" height="15" rx="2" fill="currentColor" opacity="0.35" />
				</>
			) }
		</Sketch>
	);
}
