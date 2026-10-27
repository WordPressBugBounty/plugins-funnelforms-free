/**
 * The availability of an appointment type in its editor: the weekly hours as one row per weekday
 * (on or off, with one or more time spans) and the days with other hours, such as a shorter
 * Christmas Eve or an open Saturday.
 */
import React from 'react';
import type { BookingConfig } from '../api';
import { hoursOf, nextSpan, overlapping, spansOf, validSpan, weekOf, WEEKDAYS, type Span, type Week } from '../booking-hours';
import { __, sprintf } from './i18n';
import { Button, icons } from './ui';

/** "Monday" … in the editor's language; 1 is Monday. 1 January 2024 was a Monday. */
const dayName = ( day: number, style: 'long' | 'short' = 'long' ): string => new Date( 2024, 0, day ).toLocaleDateString( undefined, { weekday: style } );

/** A date (Y-m-d) as the editor's language writes it, with its weekday. */
const dateName = ( date: string ): string => {
	const d = new Date( date + 'T12:00:00' );
	return Number.isNaN( d.getTime() ) ? date : d.toLocaleDateString( undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } );
};

function SpanRow( { span, label, onChange, onRemove }: { span: Span; label: string; onChange: ( span: Span ) => void; onRemove: () => void } ) {
	return (
		<span className={ 'ffxb-span' + ( validSpan( span ) ? '' : ' is-invalid' ) }>
			<input className="ffxb-input" type="time" step={ 300 } aria-label={ sprintf( __( 'From (%s)', 'funnelforms-pro' ), label ) } value={ span.from } onChange={ ( e ) => onChange( { ...span, from: e.target.value } ) } />
			<span aria-hidden="true">–</span>
			<input className="ffxb-input" type="time" step={ 300 } aria-label={ sprintf( __( 'To (%s)', 'funnelforms-pro' ), label ) } value={ span.to } onChange={ ( e ) => onChange( { ...span, to: e.target.value } ) } />
			<button type="button" className="ffxb-icon-button" aria-label={ sprintf( __( 'Remove the time span (%s)', 'funnelforms-pro' ), label ) } title={ __( 'Remove', 'funnelforms-pro' ) } onClick={ onRemove }>
				{ icons.close }
			</button>
		</span>
	);
}

/** One row per weekday: a switch, its time spans, a button for another span and one to copy the day. */
export function WeeklyHours( { hours, onChange }: { hours: BookingConfig[ 'hours' ]; onChange: ( hours: BookingConfig[ 'hours' ] ) => void } ) {
	const week = weekOf( hours );
	const set = ( day: number, spans: Span[] ): void => onChange( hoursOf( { ...week, [ day ]: spans } ) );
	const copy = ( from: number ): void => {
		const next: Week = { ...week };
		for ( const day of WEEKDAYS ) {
			// Copies to the days that are open, or to every weekday when only this one is.
			if ( day !== from && ( spansOf( week, day ).length || ( day <= 5 && WEEKDAYS.every( ( d ) => d === from || ! spansOf( week, d ).length ) ) ) ) {
				next[ day ] = spansOf( week, from ).map( ( s ) => ( { ...s } ) );
			}
		}
		onChange( hoursOf( next ) );
	};
	return (
		<div className="ffxb-week" role="group" aria-label={ __( 'Weekly hours', 'funnelforms-pro' ) }>
			{ WEEKDAYS.map( ( day ) => {
				const spans = spansOf( week, day );
				const open = spans.length > 0;
				const name = dayName( day );
				return (
					<div key={ day } className={ 'ffxb-week__day' + ( open ? '' : ' is-closed' ) }>
						<label className="ffxb-week__switch">
							<input type="checkbox" checked={ open } onChange={ ( e ) => set( day, e.target.checked ? [ { from: '09:00', to: '17:00' } ] : [] ) } />
							<span>{ name }</span>
						</label>
						<div className="ffxb-week__spans">
							{ open ? (
								spans.map( ( span, i ) => (
									<SpanRow
										key={ i }
										span={ span }
										label={ spans.length > 1 ? `${ name } ${ i + 1 }` : name }
										onChange={ ( changed ) => set( day, spans.map( ( s, j ) => ( j === i ? changed : s ) ) ) }
										onRemove={ () => set( day, spans.filter( ( _, j ) => j !== i ) ) }
									/>
								) )
							) : (
								<span className="ffxb-week__off">{ __( 'Not available', 'funnelforms-pro' ) }</span>
							) }
							{ open && overlapping( spans ) ? <span className="ffxb-week__problem">{ __( 'The time spans overlap.', 'funnelforms-pro' ) }</span> : null }
						</div>
						<div className="ffxb-week__tools">
							<button type="button" className="ffxb-icon-button" aria-label={ sprintf( __( 'Add a time span on %s', 'funnelforms-pro' ), name ) } title={ __( 'Add a time span, e.g. after a lunch break', 'funnelforms-pro' ) } onClick={ () => set( day, [ ...spans, nextSpan( spans ) ] ) }>
								{ icons.plus }
							</button>
							{ open ? (
								<button type="button" className="ffxb-icon-button" aria-label={ sprintf( __( 'Copy the hours of %s to the other days', 'funnelforms-pro' ), name ) } title={ __( 'Copy to the other days', 'funnelforms-pro' ) } onClick={ () => copy( day ) }>
									{ icons.copy }
								</button>
							) : null }
						</div>
					</div>
				);
			} ) }
		</div>
	);
}

/** Days with other hours than the weekly ones; a day without spans is closed. */
export function SpecialDays( { special, onChange }: { special: BookingConfig[ 'special' ]; onChange: ( special: BookingConfig[ 'special' ] ) => void } ) {
	const set = ( i: number, day: BookingConfig[ 'special' ][ number ] ): void => onChange( special.map( ( d, j ) => ( j === i ? day : d ) ) );
	const today = new Date();
	const tomorrow = new Date( today.getFullYear(), today.getMonth(), today.getDate() + 1 );
	const first = `${ tomorrow.getFullYear() }-${ String( tomorrow.getMonth() + 1 ).padStart( 2, '0' ) }-${ String( tomorrow.getDate() ).padStart( 2, '0' ) }`;
	return (
		<div className="ffxb-special">
			{ special.length ? (
				<ul className="ffxb-special__list">
					{ special.map( ( day, i ) => {
						const label = day.date ? dateName( day.date ) : sprintf( __( 'Day %d', 'funnelforms-pro' ), i + 1 );
						return (
							<li key={ i } className="ffxb-special__day">
								<input className="ffxb-input" type="date" aria-label={ sprintf( __( 'Date (%s)', 'funnelforms-pro' ), label ) } value={ day.date } onChange={ ( e ) => set( i, { ...day, date: e.target.value } ) } />
								<div className="ffxb-week__spans">
									{ day.hours.length ? (
										day.hours.map( ( span, j ) => (
											<SpanRow
												key={ j }
												span={ span }
												label={ label }
												onChange={ ( changed ) => set( i, { ...day, hours: day.hours.map( ( s, k ) => ( k === j ? changed : s ) ) } ) }
												onRemove={ () => set( i, { ...day, hours: day.hours.filter( ( _, k ) => k !== j ) } ) }
											/>
										) )
									) : (
										<span className="ffxb-week__off">{ __( 'Closed all day', 'funnelforms-pro' ) }</span>
									) }
								</div>
								<div className="ffxb-week__tools">
									<button type="button" className="ffxb-icon-button" aria-label={ sprintf( __( 'Add a time span on %s', 'funnelforms-pro' ), label ) } title={ __( 'Add a time span', 'funnelforms-pro' ) } onClick={ () => set( i, { ...day, hours: [ ...day.hours, nextSpan( day.hours ) ] } ) }>
										{ icons.plus }
									</button>
									<button type="button" className="ffxb-icon-button" aria-label={ sprintf( __( 'Remove %s', 'funnelforms-pro' ), label ) } title={ __( 'Remove the day', 'funnelforms-pro' ) } onClick={ () => onChange( special.filter( ( _, j ) => j !== i ) ) }>
										{ icons.trash }
									</button>
								</div>
							</li>
						);
					} ) }
				</ul>
			) : null }
			<Button size="sm" variant="ghost" icon={ icons.plus } onClick={ () => onChange( [ ...special, { date: special.some( ( d ) => d.date === first ) ? '' : first, hours: [ { from: '09:00', to: '13:00' } ] } ] ) }>
				{ __( 'Add a day with other hours', 'funnelforms-pro' ) }
			</Button>
		</div>
	);
}
