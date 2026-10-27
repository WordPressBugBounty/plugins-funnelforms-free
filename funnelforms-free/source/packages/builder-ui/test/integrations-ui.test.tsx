import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type BookingConfig, type BookingTypes, type CalendarAccount, type CalendarsOverview } from '../src/api';
import { CalendarDialog } from '../src/ui/BookingTypes';
import { TypesTab } from '../src/ui/AppointmentTypes';
import { IntegrationsScreen, type IntegrationsApi } from '../src/ui/Integrations';

( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
	// happy-dom has no modal dialogs.
	HTMLDialogElement.prototype.showModal ??= function ( this: HTMLDialogElement ) {
		this.setAttribute( 'open', '' );
	};
} );

afterEach( () => {
	act( () => root.unmount() );
	container.remove();
} );

async function settle(): Promise<void> {
	await act( async () => {
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );
}

function button( label: string, scope: ParentNode = container ): HTMLButtonElement {
	const found = [ ...scope.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.trim() === label || b.getAttribute( 'aria-label' ) === label );
	if ( ! found ) {
		throw new Error( 'No button ' + label );
	}
	return found;
}

async function choose( select: HTMLSelectElement, value: string ): Promise<void> {
	await act( async () => {
		Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( select, value );
		select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	} );
}

const google: CalendarAccount = { ref: 'google:g1', type: 'google', label: 'ada@example.com', account: 'ada@example.com', calendar: 'primary', busy: [ 'primary' ], owner: 0, ownerName: '', error: null, usedBy: [ { ref: 'bt:1', title: 'Beratung' } ], removable: true, createdAt: '2026-10-01T09:00:00Z' };
const icloud: CalendarAccount = { ref: 'caldav:c1', type: 'caldav', label: 'Privat', account: 'grace@icloud.com · caldav.icloud.com', calendar: 'https://caldav.icloud.com/1/home/', busy: [ 'https://caldav.icloud.com/1/home/' ], owner: 2, ownerName: 'Grace', error: 'auth_failed', usedBy: [], removable: true, createdAt: '2026-10-02T09:00:00Z' };

function overview( changes: Partial<CalendarsOverview> = {} ): CalendarsOverview {
	return {
		connections: [ google, icloud ],
		people: [
			{ id: 1, name: 'Ada' },
			{ id: 2, name: 'Grace' },
		],
		website: { connected: true, accountUrl: 'admin.php?page=funnelforms-account' },
		types: [ { ref: 'bt:1', title: 'Beratung', staff: [], write: 'google:g1' } ],
		timezone: 'Europe/Berlin',
		...changes,
	};
}

function fakeApi( overrides: Partial<IntegrationsApi> = {} ): IntegrationsApi {
	return {
		calendarsOverview: vi.fn( async () => overview() ),
		accountCalendars: vi.fn( async () => [
			{ id: 'primary', name: 'Ada', writable: true, primary: true },
			{ id: 'team', name: 'Team', writable: true, primary: false },
			{ id: 'holidays', name: 'Feiertage', writable: false, primary: false },
		] ),
		arrangeCalendar: vi.fn( async ( ref: string, changes: { owner?: number; busy?: string[] } ) => overview( { connections: [ { ...google, ...( undefined === changes.owner ? {} : { owner: changes.owner, ownerName: 'Ada' } ), ...( changes.busy ? { busy: changes.busy } : {} ) }, icloud ] } ) ),
		deleteConnection: vi.fn( async () => undefined ),
		testConnection: vi.fn( async () => undefined ),
		startCalendarSignIn: vi.fn( async () => ( { url: 'https://api.example.com/oauth/google/authorize?ticket=t', state: 's1' } ) ),
		calendarSignIn: vi.fn( async () => null ),
		createConnection: vi.fn(),
		updateConnection: vi.fn(),
		...overrides,
	};
}

const config = { root: '/wp-json/', nonce: 'n', appointmentsUrl: 'admin.php?page=funnelforms-appointments', interfacesUrl: 'admin.php?page=funnelforms-settings&tab=interfaces' };

describe( 'integrations', () => {
	it( 'shows the calendars with their state, whose they are and what uses them', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsScreen api={ api } config={ config } /> ) );
		await settle();
		const rows = [ ...container.querySelectorAll( '.ffx-cal-row' ) ];
		expect( rows ).toHaveLength( 2 );
		expect( rows[ 0 ]?.textContent ).toContain( 'Google Calendar' );
		expect( rows[ 0 ]?.textContent ).toContain( 'Connected' );
		expect( rows[ 0 ]?.textContent ).toContain( 'Counts for: Beratung' );
		// CalDAV at iCloud is Apple iCloud; its access ran out.
		expect( rows[ 1 ]?.textContent ).toContain( 'Apple iCloud' );
		expect( rows[ 1 ]?.textContent ).toContain( 'Access expired' );
		expect( ( rows[ 1 ]?.querySelector( 'select' ) as HTMLSelectElement ).value ).toBe( '2' );
		// Only Google and Microsoft are signed in to again; CalDAV gets a new password instead.
		expect( [ ...( rows[ 1 ]?.querySelectorAll( 'button' ) ?? [] ) ].map( ( b ) => b.textContent ) ).not.toContain( 'Connect again' );
		expect( [ ...container.querySelectorAll( '.ffx-cal-more a' ) ].map( ( a ) => a.getAttribute( 'href' ) ) ).toEqual( [ config.appointmentsUrl, config.interfacesUrl ] );
	} );

	it( 'gives a calendar to a team member and chooses the calendars checked for busy times', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsScreen api={ api } config={ config } /> ) );
		await settle();
		const row = (): Element => container.querySelector( '.ffx-cal-row' ) as Element;
		await choose( row().querySelector( 'select' ) as HTMLSelectElement, '1' );
		await settle();
		expect( api.arrangeCalendar ).toHaveBeenLastCalledWith( 'google:g1', { owner: 1 } );
		expect( ( row().querySelector( 'select' ) as HTMLSelectElement ).value ).toBe( '1' );

		await act( async () => button( 'Calendars', row() ).click() );
		await settle();
		expect( api.accountCalendars ).toHaveBeenCalledWith( 'google:g1' );
		// Read-only calendars can block times but cannot get appointments.
		const main = row().querySelectorAll( 'select' )[ 1 ] as HTMLSelectElement;
		expect( [ ...main.options ].map( ( o ) => o.textContent ) ).toEqual( [ 'Ada', 'Team' ] );
		const holidays = [ ...row().querySelectorAll( '.ffx-cal-busy label' ) ].find( ( l ) => l.textContent?.startsWith( 'Feiertage' ) )?.querySelector( 'input' ) as HTMLInputElement;
		await act( async () => holidays.click() );
		await settle();
		expect( api.arrangeCalendar ).toHaveBeenLastCalledWith( 'google:g1', { busy: [ 'primary', 'holidays' ] } );
	} );

	it( 'removes a calendar after asking, naming the types that lose it', async () => {
		const api = fakeApi();
		await act( async () => root.render( <IntegrationsScreen api={ api } config={ config } /> ) );
		await settle();
		await act( async () => button( 'Remove ada@example.com' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Remove calendar"]' ) as HTMLDialogElement;
		expect( dialog.textContent ).toContain( 'Appointment types that use this calendar lose it and need another calendar: Beratung.' );
		await act( async () => button( 'Remove', dialog ).click() );
		await settle();
		expect( api.deleteConnection ).toHaveBeenCalledWith( 'google:g1' );
		expect( api.calendarsOverview ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'saves a new password of a CalDAV calendar and only offers it for CalDAV', async () => {
		const api = fakeApi( { updateConnection: vi.fn( async () => ( { ref: 'caldav:c1', type: 'caldav', label: 'Privat' } ) ) } );
		await act( async () => root.render( <IntegrationsScreen api={ api } config={ config } /> ) );
		await settle();
		const rows = [ ...container.querySelectorAll( '.ffx-cal-row' ) ];
		expect( rows[ 0 ]?.querySelector( 'input[type="password"]' ) ).toBeNull();
		const input = rows[ 1 ]?.querySelector<HTMLInputElement>( 'input[type="password"]' ) as HTMLInputElement;
		expect( button( 'Save password', rows[ 1 ] as Element ).disabled ).toBe( true );
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, ' s3cret ' );
			input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		} );
		await act( async () => button( 'Save password', rows[ 1 ] as Element ).click() );
		await settle();
		expect( api.updateConnection ).toHaveBeenCalledWith( 'caldav:c1', { password: 's3cret' } );
		expect( ( container.querySelectorAll( '.ffx-cal-row' )[ 1 ]?.querySelector( 'input[type="password"]' ) as HTMLInputElement ).value ).toBe( '' );
	} );

	it( 'links to the Account page when the website is not connected with Funnelforms', async () => {
		vi.spyOn( window, 'open' ).mockImplementation( () => null );
		const api = fakeApi( { startCalendarSignIn: vi.fn( async () => Promise.reject( new ApiError( 'not_connected', 'Connect this website on the Account page first.', 409, { url: 'https://site.test/wp-admin/admin.php?page=funnelforms-account' } ) ) ) } );
		await act( async () => root.render( <CalendarDialog service="google" api={ api } onClose={ () => undefined } onConnected={ () => undefined } /> ) );
		await settle();
		await act( async () => button( 'Sign in to Google' ).click() );
		await settle();
		const link = [ ...document.querySelectorAll<HTMLAnchorElement>( 'a' ) ].find( ( a ) => 'Connect the website' === a.textContent );
		expect( link?.getAttribute( 'href' ) ).toBe( 'https://site.test/wp-admin/admin.php?page=funnelforms-account' );
		expect( document.body.textContent ).toContain( 'Connect this website on the Account page first.' );
	} );

	it( 'needs the Funnelforms account for Google and Microsoft, not for CalDAV', async () => {
		const api = fakeApi( { calendarsOverview: vi.fn( async () => overview( { connections: [], website: { connected: false, accountUrl: 'admin.php?page=funnelforms-account' } } ) ) } );
		await act( async () => root.render( <IntegrationsScreen api={ api } config={ config } /> ) );
		await settle();
		expect( container.textContent ).toContain( 'Connect this website with it first' );
		expect( container.textContent ).toContain( 'No calendar yet' );
		const tiles = [ ...container.querySelectorAll<HTMLButtonElement>( '.ffx-cal-service' ) ];
		expect( tiles.map( ( t ) => t.disabled ) ).toEqual( [ true, true, false, false ] );
		await act( async () => tiles[ 2 ]?.click() );
		const dialog = container.querySelector( 'dialog[aria-label="Connect calendar"]' ) as HTMLDialogElement;
		expect( dialog.textContent ).toContain( 'App-specific password' );
	} );
} );

describe( 'appointment types on the appointments page', () => {
	const config: BookingConfig = { version: 2, kind: 'video', location: '', timezone: '', hours: [ { days: [ 1, 2, 3, 4, 5 ], from: '09:00', to: '17:00' } ], durations: [ 30, 60 ], interval: 30, bufferBefore: 10, bufferAfter: 15, notice: 60, horizon: { mode: 'rolling', amount: 2, unit: 'week' }, closed: [], special: [], dailyLimit: 0, staff: [ 1 ], assignment: 'roundRobin', invitation: true, reminders: [], calendars: { write: 'owner', conflicts: [] } };
	const data: BookingTypes = { types: [ { ref: 'bt:1', id: 1, title: 'Beratung', config, legacy: false, cronofy: false } ], staff: [ { id: 1, name: 'Ada' } ], calendars: [], timezone: 'Europe/Berlin', defaults: config };

	it( 'lists the types with their hours and opens the editor', async () => {
		const api = { bookingTypes: vi.fn( async () => data ), saveBookingType: vi.fn( async ( _id: number | null, title: string, c: BookingConfig ) => ( { ref: 'bt:1', id: 1, title, config: c, legacy: false, cronofy: false } ) ), deleteBookingType: vi.fn(), startCalendarSignIn: vi.fn(), calendarSignIn: vi.fn(), createConnection: vi.fn(), updateConnection: vi.fn() };
		const say = vi.fn();
		await act( async () => root.render( <TypesTab root="/" nonce="n" canConnect api={ api } say={ say } /> ) );
		await settle();
		const item = container.querySelector( '.ffx-appt-types__list li' ) as HTMLElement;
		expect( item.textContent ).toContain( 'Beratung' );
		expect( item.textContent ).toContain( '09:00–17:00' );
		expect( item.textContent ).toContain( '30 / 60 minutes' );
		expect( item.textContent ).toContain( 'breaks 10 / 15 min.' );
		expect( item.textContent ).toContain( 'Ada' );
		expect( item.textContent ).toContain( 'Into the calendar of the person booked' );
		await act( async () => button( 'Edit Beratung' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Edit appointment type"]' ) as HTMLDialogElement;
		expect( dialog.querySelector( 'a[href="admin.php?page=funnelforms-integrations"]' ) ).not.toBeNull();
		await act( async () => button( 'Save', dialog ).click() );
		await settle();
		expect( api.saveBookingType ).toHaveBeenCalledWith( 1, 'Beratung', expect.objectContaining( { bufferBefore: 10, calendars: { write: 'owner', conflicts: [] } } ) );
		expect( say ).toHaveBeenCalledWith( 'Beratung was saved.' );
	} );

	it( 'checks the fields as they are filled and shows what the plugin still finds', async () => {
		const api = {
			bookingTypes: vi.fn( async () => data ),
			saveBookingType: vi
				.fn()
				.mockRejectedValueOnce( new ApiError( 'invalid_booking_type', 'The appointment type is incomplete.', 400, { problems: [ 'invalid_timezone' ] } ) )
				.mockImplementation( async ( _id: number | null, title: string, c: BookingConfig ) => ( { ref: 'bt:1', id: 1, title, config: c, legacy: false, cronofy: false } ) ),
			deleteBookingType: vi.fn(),
			startCalendarSignIn: vi.fn(),
			calendarSignIn: vi.fn(),
			createConnection: vi.fn(),
			updateConnection: vi.fn(),
		};
		await act( async () => root.render( <TypesTab root="/" nonce="n" canConnect={ false } api={ api } say={ vi.fn() } /> ) );
		await settle();
		await act( async () => button( 'Edit Beratung' ).click() );
		const dialog = container.querySelector( 'dialog[aria-label="Edit appointment type"]' ) as HTMLDialogElement;
		const type = async ( input: HTMLInputElement, value: string ): Promise<void> => {
			await act( async () => {
				Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, value );
				input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			} );
		};
		const field = ( label: string ): HTMLInputElement => document.getElementById( [ ...dialog.querySelectorAll( 'label' ) ].find( ( l ) => l.textContent === label )?.htmlFor ?? '' ) as HTMLInputElement;

		// The kind is a group of tiles; the video link is checked while it is typed.
		const kinds = [ ...dialog.querySelectorAll<HTMLInputElement>( '.ffxb-bt-kind input[type="radio"]' ) ];
		expect( kinds.map( ( k ) => k.checked ) ).toEqual( [ false, false, true ] );
		await type( field( 'Video link' ), 'meet.example.test/beratung' );
		expect( field( 'Video link' ).getAttribute( 'aria-invalid' ) ).toBe( 'true' );
		expect( dialog.textContent ).toContain( 'The video link has to start with https://.' );
		await act( async () => kinds[ 1 ]?.click() );
		expect( field( 'Phone number' ) ).not.toBeNull();
		expect( dialog.textContent ).not.toContain( 'The video link has to start with https://.' );
		expect( dialog.querySelector( '.ffxb-bt-card__head' )?.textContent ).toContain( 'Phone call' );

		// Durations: chips, another one typed in, at most five, at least one.
		const chips = (): HTMLButtonElement[] => [ ...dialog.querySelectorAll<HTMLButtonElement>( '.ffxb-bt-chip' ) ];
		const chip = ( name: string ): HTMLButtonElement => chips().find( ( b ) => b.textContent === name ) as HTMLButtonElement;
		await type( field( 'Other duration (minutes)' ), '25' );
		await act( async () => field( 'Other duration (minutes)' ).dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ) ) );
		expect( chip( '25 min' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		await act( async () => chip( '15 min' ).click() );
		await act( async () => chip( '45 min' ).click() );
		expect( chips().filter( ( b ) => 'true' === b.getAttribute( 'aria-pressed' ) ) ).toHaveLength( 5 );
		expect( chip( '1 h 30 min' ).disabled ).toBe( true );
		for ( const name of [ '15 min', '25 min', '30 min', '45 min', '1 h' ] ) {
			await act( async () => chip( name ).click() );
		}
		expect( dialog.textContent ).toContain( 'Choose at least one duration.' );
		await act( async () => button( 'Save', dialog ).click() );
		expect( api.saveBookingType ).not.toHaveBeenCalled();
		expect( document.activeElement ).toBe( chip( '15 min' ) );
		await act( async () => chip( '45 min' ).click() );
		expect( dialog.textContent ).not.toContain( 'Choose at least one duration.' );

		// What only the plugin knows shows above the form.
		await act( async () => button( 'Save', dialog ).click() );
		await settle();
		expect( dialog.querySelector( '.ffxb-notice--danger' )?.textContent ).toContain( 'The appointment type is incomplete.' );
		expect( dialog.textContent ).toContain( 'This time zone is not known.' );
		await act( async () => button( 'Save', dialog ).click() );
		await settle();
		expect( api.saveBookingType ).toHaveBeenLastCalledWith( 1, 'Beratung', expect.objectContaining( { kind: 'call', location: 'meet.example.test/beratung', durations: [ 45 ] } ) );
	} );
} );
