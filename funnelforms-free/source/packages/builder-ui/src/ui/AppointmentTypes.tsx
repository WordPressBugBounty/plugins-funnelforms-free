/**
 * The appointment types on the appointments page: each with when it can be booked, how long,
 * who is booked and where appointments go, and the editor of the booking field to change it or
 * add one. Users who edit forms see this tab.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { BookingType, BookingTypes } from '../api';
import { weekSummary } from '../booking-hours';
import { WpRestAdapter } from '../wp-rest';
import { BookingTypeEditor, INTEGRATIONS_URL, type BookingEditorApi } from './BookingTypes';
import { __, sprintf } from './i18n';

const weekday = ( day: number ): string => new Date( 2024, 0, day ).toLocaleDateString( undefined, { weekday: 'short' } );

/** Durations as "30 or 60 minutes". */
function durationText( minutes: number[] ): string {
	return 1 === minutes.length ? sprintf( __( '%d minutes', 'funnelforms-pro' ), minutes[ 0 ] ?? 0 ) : sprintf( __( '%s minutes', 'funnelforms-pro' ), minutes.join( ' / ' ) );
}

export function TypesTab( { root, nonce, canConnect, api: given, say }: { root: string; nonce: string; canConnect: boolean; api?: BookingEditorApi & { bookingTypes(): Promise<BookingTypes> }; say: ( text: string ) => void } ) {
	const api = useMemo( () => given ?? new WpRestAdapter( { root, nonce } ), [ given, root, nonce ] );
	const [ data, setData ] = useState<BookingTypes | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ editing, setEditing ] = useState<BookingType | 'new' | null>( null );

	useEffect( () => {
		let live = true;
		api.bookingTypes().then(
			( result ) => live && setData( result ),
			( e: unknown ) => live && setError( e instanceof Error ? e.message : String( e ) )
		);
		return () => {
			live = false;
		};
	}, [ api ] );

	if ( error ) {
		return (
			<div className="ffx-notice ffx-notice--danger" role="alert">
				<p>{ error }</p>
			</div>
		);
	}
	if ( ! data ) {
		return (
			<p className="ffx-appt-loading" role="status">
				{ __( 'Loading…', 'funnelforms-pro' ) }
			</p>
		);
	}
	const names = new Map( data.staff.map( ( p ) => [ p.id, p.name ] ) );
	const calendars = new Map( data.calendars.map( ( c ) => [ c.ref, c.label ] ) );
	const writes = ( type: BookingType ): string => {
		const write = type.config.calendars.write;
		if ( 'owner' === write ) {
			return __( 'Into the calendar of the person booked', 'funnelforms-pro' );
		}
		return write ? sprintf( __( 'Into %s', 'funnelforms-pro' ), calendars.get( write ) ?? write ) : __( 'Into no calendar', 'funnelforms-pro' );
	};
	const add = (
		<button type="button" className="ffx-btn ffx-btn--primary" onClick={ () => setEditing( 'new' ) }>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
				<path d="M5 12h14M12 5v14" />
			</svg>
			<span>{ __( 'New appointment type', 'funnelforms-pro' ) }</span>
		</button>
	);

	return (
		<section className="ffx-card ffx-appt-types" aria-labelledby="ffx-appt-types-title">
			<div className="ffx-card__head">
				<div>
					<h2 id="ffx-appt-types-title">{ __( 'Appointment types', 'funnelforms-pro' ) }</h2>
					<p>{ __( 'When you are available, how long an appointment takes and who is booked. Add a booking question to a form and choose the type there.', 'funnelforms-pro' ) }</p>
				</div>
				{ data.types.length ? add : null }
			</div>
			{ data.types.length ? (
				<ul className="ffx-appt-types__list">
					{ data.types.map( ( type ) => {
						const c = type.config;
						const staff = c.staff.map( ( id ) => names.get( id ) ).filter( Boolean ).join( ', ' );
						return (
							<li key={ type.ref }>
								<div className="ffx-appt-types__main">
									<span className="ffx-appt-types__title">{ type.title }</span>
									<span className="ffx-appt-types__hours">{ weekSummary( c.hours, weekday ) || __( 'No hours yet', 'funnelforms-pro' ) }</span>
									<span className="ffx-appt-types__facts">
										{ [
											durationText( c.durations ),
											c.bufferBefore || c.bufferAfter ? sprintf( __( 'breaks %1$d / %2$d min.', 'funnelforms-pro' ), c.bufferBefore, c.bufferAfter ) : '',
											c.special.length ? sprintf( __( '%d day(s) with other hours', 'funnelforms-pro' ), c.special.length ) : '',
											staff || __( 'Books the website', 'funnelforms-pro' ),
											writes( type ),
										]
											.filter( Boolean )
											.join( ' · ' ) }
									</span>
								</div>
								{ type.cronofy ? <span className="ffx-badge ffx-badge--warning">{ __( 'Save again', 'funnelforms-pro' ) }</span> : null }
								<button type="button" className="ffx-btn ffx-btn--sm" aria-label={ sprintf( __( 'Edit %s', 'funnelforms-pro' ), type.title ) } onClick={ () => setEditing( type ) }>
									{ __( 'Edit', 'funnelforms-pro' ) }
								</button>
							</li>
						);
					} ) }
				</ul>
			) : (
				<div className="ffx-empty">
					<h2>{ __( 'No appointment types yet', 'funnelforms-pro' ) }</h2>
					<p>{ __( 'Create one here, or add a booking question to a form and create it there.', 'funnelforms-pro' ) }</p>
					{ add }
				</div>
			) }
			{ canConnect ? (
				<p className="ffx-muted ffx-appt-types__more">
					{ __( 'Calendars are connected under', 'funnelforms-pro' ) }{ ' ' }
					<a className="ffx-link" href={ INTEGRATIONS_URL }>
						{ __( 'Integrations', 'funnelforms-pro' ) }
					</a>
				</p>
			) : null }
			{ editing ? (
				<div className="ffxb ffxb--embedded">
					<BookingTypeEditor
						data={ data }
						type={ 'new' === editing ? null : editing }
						api={ api }
						canConnect={ canConnect }
						onClose={ () => setEditing( null ) }
						onSaved={ ( saved ) => {
							setData( ( d ) => d && { ...d, types: d.types.some( ( t ) => t.ref === saved.ref ) ? d.types.map( ( t ) => ( t.ref === saved.ref ? saved : t ) ) : [ ...d.types, saved ] } );
							setEditing( null );
							say( sprintf( __( '%s was saved.', 'funnelforms-pro' ), saved.title ) );
						} }
						onDeleted={ ( gone ) => {
							setData( ( d ) => d && { ...d, types: d.types.filter( ( t ) => t.ref !== gone.ref ) } );
							setEditing( null );
							say( sprintf( __( '%s was deleted.', 'funnelforms-pro' ), gone.title ) );
						} }
					/>
				</div>
			) : null }
		</section>
	);
}
