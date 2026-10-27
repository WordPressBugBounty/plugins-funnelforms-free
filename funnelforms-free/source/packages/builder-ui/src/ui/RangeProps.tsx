/**
 * Settings of date, time, number, slider and scale fields: formats, limits, periods, ranges, units
 * and points.
 */
import React from 'react';
import type { DateField, NumberField, RatingField, SliderField, TimeField } from '@funnelforms/form-schema';
import type { Edit } from './Answers';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { put, TextProp } from './texts';
import { ChoiceTiles, Group, Notice, NumberInput, Select, Sketch, TextInput, Toggle } from './ui';

export function DateProps( { field, edit }: { field: DateField; edit: Edit } ) {
	const p = field.props;
	const set = ( key: string, value: unknown ): void =>
		edit( ( f ) => {
			const props = f.props as Record<string, unknown>;
			if ( undefined === value || false === value || '' === value ) {
				Reflect.deleteProperty( props, key );
			} else {
				props[ key ] = value;
			}
		}, 'props.' + key );
	return (
		<>
			<Select
				label={ __( 'Date format', 'funnelforms-pro' ) }
				value={ [ 'dd.mm.yy', 'mm/dd/yy', 'yy-mm-dd', 'dd/mm/yy' ].includes( p.format ) ? p.format : 'dd.mm.yy' }
				options={ [
					{ value: 'dd.mm.yy', label: '31.12.2026' },
					{ value: 'dd/mm/yy', label: '31/12/2026' },
					{ value: 'mm/dd/yy', label: '12/31/2026' },
					{ value: 'yy-mm-dd', label: '2026-12-31' },
				] }
				onChange={ ( v ) => set( 'format', v ) }
			/>
			<Toggle label={ __( 'A period with start and end', 'funnelforms-pro' ) } checked={ true === p.range } onChange={ ( v ) => set( 'range', v ) } />
			<ChoiceTiles
				label={ __( 'Dates that can be chosen', 'funnelforms-pro' ) }
				value={ p.allow ?? '' }
				options={ [
					{ value: '', label: __( 'Any date', 'funnelforms-pro' ), icon: <DaysSketch open="" /> },
					{ value: 'future', label: __( 'Today and later', 'funnelforms-pro' ), icon: <DaysSketch open="future" /> },
					{ value: 'past', label: __( 'Today and earlier', 'funnelforms-pro' ), icon: <DaysSketch open="past" /> },
				] }
				onChange={ ( v ) => set( 'allow', v ) }
			/>
			<div className="ffxb-pair">
				<TextInput label={ __( 'Earliest date', 'funnelforms-pro' ) } type="date" value={ p.min ?? '' } onChange={ ( v ) => set( 'min', v ) } />
				<TextInput label={ __( 'Latest date', 'funnelforms-pro' ) } type="date" value={ p.max ?? '' } onChange={ ( v ) => set( 'max', v ) } />
			</div>
		</>
	);
}

export function SliderProps( { field, edit }: { field: SliderField; edit: Edit } ) {
	const { ctx, lang } = useEnv();
	const p = field.props;
	const num = ( key: string, required: boolean ) => ( value: number | undefined ): void =>
		edit( ( f ) => {
			const props = f.props as Record<string, unknown>;
			if ( undefined !== value ) {
				props[ key ] = value;
			} else if ( ! required ) {
				Reflect.deleteProperty( props, key );
			}
		}, 'props.' + key );
	const set = ( key: string, value: unknown ): void =>
		edit( ( f ) => {
			const props = f.props as Record<string, unknown>;
			if ( undefined === value || false === value ) {
				Reflect.deleteProperty( props, key );
			} else {
				props[ key ] = value;
			}
		}, 'props.' + key );
	return (
		<>
			<Group title={ __( 'Values', 'funnelforms-pro' ) }>
				<div className="ffxb-pair">
					<NumberInput label={ __( 'Minimum', 'funnelforms-pro' ) } value={ p.min } onChange={ num( 'min', true ) } />
					<NumberInput label={ __( 'Maximum', 'funnelforms-pro' ) } value={ p.max } onChange={ num( 'max', true ) } />
				</div>
				<Toggle label={ __( 'A range with two handles', 'funnelforms-pro' ) } checked={ true === p.range } onChange={ ( v ) => set( 'range', v ) } />
				<div className="ffxb-pair">
					<NumberInput label={ __( 'Steps of', 'funnelforms-pro' ) } value={ p.step } min={ 0 } onChange={ num( 'step', true ) } />
					<NumberInput label={ p.range ? __( 'First handle starts at', 'funnelforms-pro' ) : __( 'Starts at', 'funnelforms-pro' ) } value={ p.start } onChange={ num( 'start', true ) } />
				</div>
				{ p.range ? <NumberInput label={ __( 'Second handle starts at', 'funnelforms-pro' ) } value={ p.startEnd ?? p.max } onChange={ num( 'startEnd', false ) } /> : null }
			</Group>
			<Group title={ __( 'Display', 'funnelforms-pro' ) }>
				<TextProp label={ __( 'Unit', 'funnelforms-pro' ) } value={ p.unit.text } onChange={ ( v ) => edit( ( f ) => put( ( f as SliderField ).props.unit, 'text', lang, v, ctx.locale ), 'unit' ) } />
				<UnitPosition value={ p.unit.position } onChange={ ( v ) => edit( ( f ) => void ( ( f as SliderField ).props.unit.position = v ) ) } />
				<Select
					label={ __( 'Thousands separator', 'funnelforms-pro' ) }
					value={ p.thousandsSeparator ? p.separator ?? '.' : 'none' }
					options={ [
						{ value: 'none', label: __( 'None', 'funnelforms-pro' ) },
						{ value: '.', label: '10.000' },
						{ value: ',', label: '10,000' },
						{ value: ' ', label: '10 000' },
						{ value: "'", label: "10'000" },
					] }
					onChange={ ( v ) =>
						edit( ( f ) => {
							const props = ( f as SliderField ).props;
							props.thousandsSeparator = 'none' !== v;
							if ( 'none' === v || '.' === v ) {
								delete props.separator;
							} else {
								props.separator = v as SliderField[ 'props' ][ 'separator' ];
							}
						}, 'props.separator' )
					}
				/>
				<Toggle label={ __( 'Visitors can type the number', 'funnelforms-pro' ) } checked={ p.manualInput.enabled } onChange={ ( v ) => edit( ( f ) => void ( ( f as SliderField ).props.manualInput.enabled = v ) ) } />
			</Group>
		</>
	);
}

export function RatingProps( { field, edit }: { field: RatingField; edit: Edit } ) {
	const { ctx, lang } = useEnv();
	const p = field.props;
	const points: number[] = [];
	for ( let n = p.min; n <= p.max; n++ ) {
		points.push( n );
	}
	const text = ( key: 'lowLabel' | 'highLabel' ) => ( v: string ): void => edit( ( f ) => put( ( f as RatingField ).props, key, lang, v, ctx.locale ), key );
	return (
		<>
			<Group title={ __( 'Range', 'funnelforms-pro' ) }>
				<div className="ffxb-pair">
					<Select
						label={ __( 'Lowest rating', 'funnelforms-pro' ) }
						value={ String( p.min ) }
						options={ [
							{ value: '0', label: '0' },
							{ value: '1', label: '1' },
						] }
						onChange={ ( v ) => edit( ( f ) => void ( ( f as RatingField ).props.min = '0' === v ? 0 : 1 ), 'props.min' ) }
					/>
					<NumberInput label={ __( 'Highest rating', 'funnelforms-pro' ) } value={ p.max } min={ 2 } max={ 10 } onChange={ ( v ) => undefined !== v && edit( ( f ) => void ( ( f as RatingField ).props.max = Math.min( 10, Math.max( 2, Math.round( v ) ) ) ), 'props.max' ) } />
				</div>
				<TextProp label={ __( 'Text at the low end', 'funnelforms-pro' ) } value={ p.lowLabel } onChange={ text( 'lowLabel' ) } />
				<TextProp label={ __( 'Text at the high end', 'funnelforms-pro' ) } value={ p.highLabel } onChange={ text( 'highLabel' ) } />
			</Group>
			<Group title={ __( 'Display', 'funnelforms-pro' ) }>
				<ChoiceTiles
					label={ __( 'Look', 'funnelforms-pro' ) }
					value={ p.style }
					options={ [
						{ value: 'stars', label: __( 'Stars', 'funnelforms-pro' ), icon: <ScaleSketch look="stars" /> },
						{ value: 'numbers', label: __( 'Numbers', 'funnelforms-pro' ), icon: <ScaleSketch look="numbers" /> },
						{ value: 'colors', label: __( 'Colour scale', 'funnelforms-pro' ), icon: <ScaleSketch look="colors" /> },
					] }
					onChange={ ( v ) => edit( ( f ) => void ( ( f as RatingField ).props.style = v ), 'props.style' ) }
				/>
				<ChoiceTiles
					label={ 'stars' === p.style ? __( 'Below the stars', 'funnelforms-pro' ) : __( 'Points show', 'funnelforms-pro' ) }
					value={ p.show ?? '' }
					options={ [
						{ value: '', label: 'stars' === p.style ? __( 'Nothing', 'funnelforms-pro' ) : __( 'Numbers', 'funnelforms-pro' ), icon: <PointSketch show={ 'stars' === p.style ? '' : 'numbers' } /> },
						{ value: 'emojis', label: __( 'Faces', 'funnelforms-pro' ), icon: <PointSketch show="emojis" /> },
						{ value: 'labels', label: __( 'Own texts', 'funnelforms-pro' ), icon: <PointSketch show="labels" /> },
					] }
					onChange={ ( v ) =>
						edit( ( f ) => {
							const props = ( f as RatingField ).props;
							if ( '' === v ) {
								delete props.show;
							} else {
								props.show = v as 'emojis' | 'labels';
							}
						}, 'props.show' )
					}
				/>
				{ 'labels' === p.show
					? points.map( ( n, i ) => (
							<TextProp
								key={ n }
								label={ sprintf( __( 'Text for %d', 'funnelforms-pro' ), n ) }
								value={ p.labels?.[ i ] }
								onChange={ ( v ) =>
									edit( ( f ) => {
										const props = ( f as RatingField ).props;
										const labels = props.labels ?? [];
										while ( labels.length <= i ) {
											labels.push( {} );
										}
										put( labels, i, lang, v, ctx.locale );
										props.labels = labels;
									}, 'labels.' + i )
								}
							/>
					  ) )
					: null }
			</Group>
		</>
	);
}

/** Number fields: limits, the step of the arrows and a unit such as m² or €. */
export function NumberProps( { field, edit }: { field: NumberField; edit: Edit } ) {
	const { ctx, lang } = useEnv();
	const p = field.props;
	const num = ( key: 'min' | 'max' | 'step' ) => ( value: number | undefined ): void =>
		edit( ( f ) => {
			const props = f.props as Record<string, unknown>;
			if ( undefined === value ) {
				Reflect.deleteProperty( props, key );
			} else {
				props[ key ] = value;
			}
		}, 'props.' + key );
	const unit = ( recipe: ( u: NonNullable<NumberField[ 'props' ][ 'unit' ]> ) => void, key: string ): void =>
		edit( ( f ) => {
			const props = ( f as NumberField ).props;
			props.unit ??= { text: {}, position: 'after' };
			recipe( props.unit );
		}, 'props.unit.' + key );
	return (
		<>
			<div className="ffxb-pair">
				<NumberInput label={ __( 'Minimum', 'funnelforms-pro' ) } value={ p.min } onChange={ num( 'min' ) } />
				<NumberInput label={ __( 'Maximum', 'funnelforms-pro' ) } value={ p.max } onChange={ num( 'max' ) } />
			</div>
			<NumberInput
				label={ __( 'Steps of', 'funnelforms-pro' ) }
				value={ p.step }
				min={ 0 }
				onChange={ num( 'step' ) }
				hint={ __( 'For the arrows in the field; any number can be typed.', 'funnelforms-pro' ) }
			/>
			<TextProp label={ __( 'Unit', 'funnelforms-pro' ) } value={ p.unit?.text } onChange={ ( v ) => unit( ( u ) => put( u, 'text', lang, v, ctx.locale ), 'text' ) } />
			<UnitPosition value={ p.unit?.position ?? 'after' } onChange={ ( v ) => unit( ( u ) => void ( u.position = v ), 'position' ) } />
		</>
	);
}

/** Time fields: the earliest and latest time and the minutes between times. */
export function TimeProps( { field, edit }: { field: TimeField; edit: Edit } ) {
	const p = field.props;
	const set = ( key: 'min' | 'max' | 'stepMinutes', value: string | number | undefined ): void =>
		edit( ( f ) => {
			const props = f.props as Record<string, unknown>;
			if ( undefined === value || '' === value ) {
				Reflect.deleteProperty( props, key );
			} else {
				props[ key ] = value;
			}
		}, 'props.' + key );
	return (
		<>
			<div className="ffxb-pair">
				<TextInput label={ __( 'Earliest time', 'funnelforms-pro' ) } type="time" value={ p.min ?? '' } onChange={ ( v ) => set( 'min', v.slice( 0, 5 ) ) } />
				<TextInput label={ __( 'Latest time', 'funnelforms-pro' ) } type="time" value={ p.max ?? '' } onChange={ ( v ) => set( 'max', v.slice( 0, 5 ) ) } />
			</div>
			{ p.min && p.max && p.min > p.max ? <Notice tone="warning">{ __( 'The latest time is before the earliest, so no time can be chosen.', 'funnelforms-pro' ) }</Notice> : null }
			<NumberInput label={ __( 'Minutes between times', 'funnelforms-pro' ) } value={ p.stepMinutes } min={ 1 } max={ 60 } onChange={ ( v ) => set( 'stepMinutes', v ) } />
		</>
	);
}

/** Where the unit stands, as two tiles: "€ 10" and "10 €". */
function UnitPosition( { value, onChange }: { value: 'before' | 'after'; onChange: ( value: 'before' | 'after' ) => void } ) {
	return (
		<ChoiceTiles
			label={ __( 'Position of the unit', 'funnelforms-pro' ) }
			value={ value }
			columns={ 2 }
			options={ [
				{ value: 'before', label: __( 'Before the number', 'funnelforms-pro' ), icon: <TextSketch text="€ 10" /> },
				{ value: 'after', label: __( 'After the number', 'funnelforms-pro' ), icon: <TextSketch text="10 €" /> },
			] }
			onChange={ onChange }
		/>
	);
}

/* Small drawings of dates, units and scales for the tiles of the properties panel. */

function TextSketch( { text }: { text: string } ) {
	return (
		<Sketch>
			<rect x="4" y="7" width="40" height="18" rx="3" />
			<text x="24" y="20" textAnchor="middle" fontSize="9" fontWeight="600" fill="currentColor" stroke="none">
				{ text }
			</text>
		</Sketch>
	);
}

/** A row of days with today in the middle; the days that can be chosen are filled. */
function DaysSketch( { open }: { open: '' | 'future' | 'past' } ) {
	const days = [ 4, 12, 20, 28, 36 ];
	return (
		<Sketch>
			<rect x="2" y="6" width="44" height="22" rx="3" />
			<path d="M2 12h44" />
			{ days.map( ( x, i ) => {
				const on = '' === open || ( 'future' === open ? i >= 2 : i <= 2 );
				return <rect key={ x } x={ x + 1 } y="16" width="6" height="6" rx="1.5" fill={ on ? 'currentColor' : 'none' } opacity={ on ? 1 : 0.5 } />;
			} ) }
			<path d="M24 14v10" strokeWidth="1" opacity="0.6" />
		</Sketch>
	);
}

function ScaleSketch( { look }: { look: 'stars' | 'numbers' | 'colors' } ) {
	const xs = [ 4, 13, 22, 31, 40 ];
	if ( 'stars' === look ) {
		return (
			<Sketch>
				{ xs.map( ( x, i ) => (
					<polygon key={ x } points={ star( x + 2.5, 16 ) } fill={ i < 3 ? 'currentColor' : 'none' } strokeWidth="1.2" strokeLinejoin="round" />
				) ) }
			</Sketch>
		);
	}
	return (
		<Sketch>
			{ xs.map( ( x, i ) => (
				<rect key={ x } x={ x - 1 } y="10" width="7" height="12" rx="1.5" fill={ 'colors' === look ? 'currentColor' : 'none' } opacity={ 'colors' === look ? 0.25 + i * 0.18 : 1 } />
			) ) }
			{ 'numbers' === look
				? xs.map( ( x, i ) => (
						<text key={ x } x={ x + 2.5 } y="19" textAnchor="middle" fontSize="7" fontWeight="600" fill="currentColor" stroke="none">
							{ i + 1 }
						</text>
				  ) )
				: null }
		</Sketch>
	);
}

/** The corners of a five-pointed star around a centre, 9 wide. */
function star( cx: number, cy: number ): string {
	return Array.from( { length: 10 }, ( _, i ) => {
		const r = i % 2 ? 2 : 4.6;
		const a = ( Math.PI / 5 ) * i - Math.PI / 2;
		return `${ ( cx + r * Math.cos( a ) ).toFixed( 1 ) },${ ( cy + r * Math.sin( a ) ).toFixed( 1 ) }`;
	} ).join( ' ' );
}

/** Five points with what is shown below them: nothing, numbers, faces or texts. */
function PointSketch( { show }: { show: '' | 'numbers' | 'emojis' | 'labels' } ) {
	const xs = [ 8, 16, 24, 32, 40 ];
	return (
		<Sketch>
			{ xs.map( ( x ) => (
				<circle key={ x } cx={ x } cy="11" r="3.4" />
			) ) }
			{ 'numbers' === show
				? xs.map( ( x, i ) => (
						<text key={ x } x={ x } y="26" textAnchor="middle" fontSize="7" fontWeight="600" fill="currentColor" stroke="none">
							{ i + 1 }
						</text>
				  ) )
				: null }
			{ 'emojis' === show
				? xs.map( ( x, i ) => (
						<g key={ x } strokeWidth="1">
							<circle cx={ x } cy="23" r="3" />
							<path d={ i < 2 ? `M${ x - 1.4 } 24.4q1.4-1.2 2.8 0` : i > 2 ? `M${ x - 1.4 } 23.6q1.4 1.2 2.8 0` : `M${ x - 1.4 } 24h2.8` } />
						</g>
				  ) )
				: null }
			{ 'labels' === show ? (
				<>
					<path d="M4 23h10" />
					<path d="M34 23h10" />
					<path d="M19 23h10" opacity="0.5" />
				</>
			) : null }
		</Sketch>
	);
}
