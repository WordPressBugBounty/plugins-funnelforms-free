import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentItem, AppointmentsClient, AppointmentsConfig, MailSettings } from '../src/appointments';
import { AppointmentsScreen } from '../src/ui/Appointments';
import { item, NOW } from './appointmentItem';

( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const config: AppointmentsConfig = {
	screen: 'appointments',
	root: '/wp-json/',
	nonce: 'n',
	userLocale: 'en_US',
	timezone: 'Europe/Berlin',
	weekStart: 1,
	forms: [
		{ id: 3, title: 'Termin' },
		{ id: 4, title: 'Beratung' },
	],
	types: [ { ref: 'bt:1', title: 'Erstgespräch' } ],
	entriesUrl: '/wp-admin/admin.php?page=funnelforms-entries',
	user: 7,
	canEditTypes: true,
};

function items(): AppointmentItem[] {
	return [
		item( 1, '2026-10-19T08:00:00Z', { visitor: { name: 'Jakob Scholz', email: 'jakob@example.org', phone: '' } } ),
		item( 2, '2026-10-19T14:00:00Z', { visitor: { name: 'Frieda Möller', email: 'frieda@example.org', phone: '+49 170 1' } } ),
		item( 3, '2026-10-21T09:30:00Z', { visitor: { name: 'Oskar Busch', email: 'oskar@example.org', phone: '' }, form: { id: 4, title: 'Beratung' } } ),
		item( 4, '2026-10-22T09:30:00Z', { status: 'cancelled', visitor: { name: 'Rosa Graf', email: 'rosa@example.org', phone: '' }, changeable: false } ),
	];
}

const mailSettings: MailSettings = {
	types: [
		{
			id: 1,
			ref: 'bt:1',
			title: 'Erstgespräch',
			invitation: true,
			reminders: [],
			mails: {
				invite: { subject: '', text: '' },
				moved: { subject: '', text: '' },
				cancel: { subject: '', text: '' },
				reminder: { subject: '', text: '' },
			},
		},
	],
	defaults: {
		invite: { subject: 'Your appointment: {{booking:name}}', intro: 'Hello {{contact:name}}, your appointment is booked.' },
		moved: { subject: 'Moved: {{booking:name}}', intro: 'Hello {{contact:name}}, your appointment has a new time.' },
		cancel: { subject: 'Cancelled: {{booking:name}}', intro: 'Your appointment was cancelled.' },
		reminder: { subject: 'Reminder: {{booking:name}}', intro: 'This is a reminder of your appointment.' },
	},
	tokens: [ 'contact:name', 'booking:name', 'booking:date', 'booking:message' ],
};

function must<T>( value: T | null | undefined ): T {
	if ( null === value || undefined === value ) {
		throw new Error( 'Missing' );
	}
	return value;
}

function fakeClient( overrides: { move?: ReturnType<typeof vi.fn> } = {} ) {
	const client = {
		list: vi.fn( async () => items() ),
		slots: vi.fn( async () => ( { timezone: 'Europe/Berlin', duration: 30, window: null, days: { '2026-10-20': [ '2026-10-20T07:00:00Z', '2026-10-20T07:30:00Z' ] } } ) ),
		move: vi.fn( async ( a: AppointmentItem, start: string ) => ( { ...must( items()[ 1 ] ), id: a.id, start, changedBy: { kind: 'team', name: 'Mia' } } ) ),
		cancel: vi.fn( async ( a: AppointmentItem, message: string ) => ( { ...must( items()[ 1 ] ), id: a.id, status: 'cancelled', changeable: false, message } ) ),
		mark: vi.fn( async ( a: AppointmentItem, outcome: string ) => ( { ...must( items()[ 0 ] ), id: a.id, outcome: 'none' === outcome ? null : outcome } ) ),
		mails: vi.fn( async () => structuredClone( mailSettings ) ),
		saveMails: vi.fn( async ( _type: number, mails: unknown ) => ( { ...must( mailSettings.types[ 0 ] ), mails } ) ),
		...overrides,
	};
	return client;
}

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-appointments' );
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
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

async function show( client: ReturnType<typeof fakeClient> ): Promise<void> {
	await act( async () => {
		root.render( <AppointmentsScreen config={ config } client={ client as unknown as AppointmentsClient } now={ () => NOW } /> );
	} );
	await settle();
}

function button( label: string, scope: ParentNode = container ): HTMLButtonElement {
	const found = [ ...scope.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.trim() === label || b.getAttribute( 'aria-label' ) === label );
	if ( ! found ) {
		throw new Error( 'No button ' + label );
	}
	return found;
}

async function click( el: HTMLElement ): Promise<void> {
	await act( async () => {
		el.click();
	} );
	await settle();
}

async function type( el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string ): Promise<void> {
	const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	await act( async () => {
		Object.getOwnPropertyDescriptor( proto, 'value' )?.set?.call( el, value );
		el.dispatchEvent( new Event( el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true } ) );
	} );
	await settle();
}

function select( label: string ): HTMLSelectElement {
	const found = [ ...container.querySelectorAll( 'label' ) ].find( ( l ) => l.textContent === label );
	const el = found ? document.getElementById( found.htmlFor ) : null;
	if ( ! ( el instanceof HTMLSelectElement ) ) {
		throw new Error( 'No select ' + label );
	}
	return el;
}

const rows = (): string[] => [ ...container.querySelectorAll( '.ffx-appt-row .ffx-appt-row__who' ) ].map( ( e ) => e.textContent ?? '' );

describe( 'appointments page', () => {
	it( 'lists the appointments by day with key figures and filters', async () => {
		const client = fakeClient();
		await show( client );
		expect( client.list ).toHaveBeenCalledWith( '2026-10-19', '2026-11-01' );
		expect( client.list ).toHaveBeenCalledWith( '2026-09-19', '2026-10-26' );
		const days = [ ...container.querySelectorAll( '.ffx-appt-day' ) ];
		expect( days ).toHaveLength( 2 );
		expect( days[ 0 ]?.classList.contains( 'is-today' ) ).toBe( true );
		expect( days[ 0 ]?.querySelector( '.ffx-appt-day__count' )?.textContent ).toBe( '2 appointments' );
		expect( rows() ).toEqual( [ 'Jakob Scholz', 'Frieda Möller', 'Oskar Busch' ] );
		expect( container.querySelector( '.ffx-appt-row.is-open' ) ).not.toBeNull();
		expect( container.querySelector( '#ffx-appt-range' )?.textContent ).toContain( '2026' );
		const kpis = [ ...container.querySelectorAll( '.ffx-kpi__value' ) ].map( ( e ) => e.textContent );
		expect( kpis ).toEqual( [ '2', '2', '1', '0' ] );

		await type( select( 'Status' ), 'all' );
		expect( rows() ).toContain( 'Rosa Graf' );
		expect( window.location.search ).toContain( 'status=all' );
		await type( select( 'Form' ), '4' );
		expect( rows() ).toEqual( [ 'Oskar Busch' ] );
		expect( window.location.search ).toContain( 'form=4' );
		await type( select( 'Form' ), '0' );
		await type( select( 'Status' ), 'open' );
		expect( rows() ).toEqual( [ 'Jakob Scholz' ] );
	} );

	it( 'gives appointments at the same time in the week their names, with the time on hover', async () => {
		const client = fakeClient();
		client.list = vi.fn( async () => [ ...items(), item( 5, '2026-10-19T08:00:00Z', { visitor: { name: 'Lena Wolf', email: 'lena@example.org', phone: '' } } ) ] );
		await show( client );
		await click( button( 'Week' ) );
		const parallel = [ ...container.querySelectorAll<HTMLElement>( '.ffx-appt-event.is-lane' ) ];
		expect( parallel.map( ( e ) => e.querySelector( '.ffx-appt-event__who' )?.textContent ) ).toEqual( [ 'Jakob Scholz', 'Lena Wolf' ] );
		expect( parallel[ 0 ]?.title ).toContain( 'Jakob Scholz' );
		expect( container.querySelectorAll( '.ffx-appt-event:not(.is-lane)' ) ).toHaveLength( 2 );
	} );

	it( 'shows a week and a month', async () => {
		await show( fakeClient() );
		await click( button( 'Week' ) );
		expect( window.location.search ).toContain( 'view=week' );
		const events = [ ...container.querySelectorAll( '.ffx-appt-week .ffx-appt-event' ) ];
		expect( events.map( ( e ) => e.querySelector( '.ffx-appt-event__who' )?.textContent ) ).toEqual( [ 'Jakob Scholz', 'Frieda Möller', 'Oskar Busch' ] );
		expect( container.querySelectorAll( '.ffx-appt-week__col' ) ).toHaveLength( 7 );
		expect( container.querySelector( '.ffx-appt-week__now' ) ).not.toBeNull();

		await click( button( 'Month' ) );
		expect( container.querySelectorAll( '.ffx-appt-month__cell' ) ).toHaveLength( 35 );
		expect( container.querySelectorAll( '.ffx-appt-chip' ) ).toHaveLength( 3 );
		await click( button( 'Later' ) );
		expect( window.location.search ).toContain( 'date=2026-11-01' );
	} );

	it( 'cancels with a message', async () => {
		const client = fakeClient();
		await show( client );
		await click( must( container.querySelectorAll<HTMLButtonElement>( '.ffx-appt-row__main' )[ 1 ] ) );
		const dialog = must( container.querySelector<HTMLDialogElement>( 'dialog.ffx-appt-dialog' ) );
		expect( dialog.textContent ).toContain( 'Frieda Möller' );
		expect( dialog.textContent ).toContain( '+49 170 1' );
		expect( dialog.querySelector( 'a[href$="entry=102"]' ) ).not.toBeNull();
		await click( button( 'Cancel appointment', dialog ) );
		await type( must( dialog.querySelector( 'textarea' ) ), 'Leider nicht' );
		await click( button( 'Cancel appointment', must( dialog.querySelector( '.ffx-appt-dialog__foot' ) ) ) );
		expect( client.cancel ).toHaveBeenCalledWith( expect.objectContaining( { id: 2, entryId: 102 } ), 'Leider nicht' );
		expect( dialog.querySelector( '.ffx-notice--success' )?.textContent ).toBe( 'The appointment is cancelled.' );
		expect( client.list.mock.calls.length ).toBeGreaterThan( 2 );
	} );

	it( 'moves to a free time', async () => {
		const client = fakeClient();
		await show( client );
		await click( must( container.querySelectorAll<HTMLButtonElement>( '.ffx-appt-row__main' )[ 1 ] ) );
		const dialog = must( container.querySelector<HTMLDialogElement>( 'dialog.ffx-appt-dialog' ) );
		await click( button( 'Reschedule', dialog ) );
		expect( client.slots ).toHaveBeenCalledWith( expect.objectContaining( { id: 2 } ), '2026-10-19', '2026-10-25' );
		const move = button( 'Move appointment', dialog );
		expect( move.disabled ).toBe( true );
		const slots = [ ...dialog.querySelectorAll<HTMLButtonElement>( '.ffx-appt-slot' ) ];
		expect( slots.map( ( s ) => s.textContent ) ).toEqual( [ '09:00 AM', '09:30 AM' ] );
		await click( must( slots[ 1 ] ) );
		expect( slots[ 1 ]?.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( dialog.querySelector( '.ffx-appt-move__chosen' )?.textContent ).toContain( '09:30' );
		await type( must( dialog.querySelector( 'textarea' ) ), 'Passt das?' );
		await click( button( 'Move appointment', dialog ) );
		expect( client.move ).toHaveBeenCalledWith( expect.objectContaining( { id: 2 } ), '2026-10-20T07:30:00Z', 'Passt das?' );
		expect( dialog.querySelector( '.ffx-notice--success' )?.textContent ).toContain( 'gets the new time by e-mail' );
	} );

	it( 'shows why a time could not be taken', async () => {
		const client = fakeClient( {
			move: vi.fn( async () => {
				throw new Error( 'This time is no longer free. Choose another one.' );
			} ),
		} );
		await show( client );
		await click( must( container.querySelectorAll<HTMLButtonElement>( '.ffx-appt-row__main' )[ 1 ] ) );
		const dialog = must( container.querySelector<HTMLDialogElement>( 'dialog.ffx-appt-dialog' ) );
		await click( button( 'Reschedule', dialog ) );
		await click( must( dialog.querySelector<HTMLButtonElement>( '.ffx-appt-slot' ) ) );
		await click( button( 'Move appointment', dialog ) );
		expect( dialog.querySelector( '[role="alert"]' )?.textContent ).toBe( 'This time is no longer free. Choose another one.' );
		expect( button( 'Move appointment', dialog ).disabled ).toBe( false );
	} );

	it( 'marks an appointment that has started', async () => {
		const client = fakeClient();
		await show( client );
		await click( must( container.querySelectorAll<HTMLButtonElement>( '.ffx-appt-row__main' )[ 0 ] ) );
		const dialog = must( container.querySelector<HTMLDialogElement>( 'dialog.ffx-appt-dialog' ) );
		expect( () => button( 'Reschedule', dialog ) ).toThrow();
		await click( button( 'Done', dialog ) );
		expect( client.mark ).toHaveBeenCalledWith( expect.objectContaining( { id: 1 } ), 'done' );
		await click( button( 'Take back the mark', dialog ) );
		expect( client.mark ).toHaveBeenLastCalledWith( expect.objectContaining( { id: 1 } ), 'none' );
	} );

	it( 'edits the mails of a type with placeholders', async () => {
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-appointments&tab=mails' );
		const client = fakeClient();
		await show( client );
		expect( client.mails ).toHaveBeenCalled();
		const cards = [ ...container.querySelectorAll( '.ffx-appt-mail' ) ];
		expect( cards ).toHaveLength( 4 );
		expect( cards[ 3 ]?.querySelector( '.ffx-appt-mail__off' ) ).not.toBeNull();
		const subject = must( cards[ 1 ]?.querySelector( 'input' ) );
		expect( subject.placeholder ).toBe( 'Moved: {{booking:name}}' );
		const save = button( 'Save mails' );
		expect( save.disabled ).toBe( true );

		await type( subject, 'Neue Zeit: ' );
		await act( async () => {
			subject.focus();
			subject.dispatchEvent( new FocusEvent( 'focus' ) );
			subject.dispatchEvent( new FocusEvent( 'focusin', { bubbles: true } ) );
			subject.setSelectionRange( 11, 11 );
		} );
		await click( button( 'Insert Name of the appointment type' ) );
		expect( subject.value ).toBe( 'Neue Zeit: {{booking:name}}' );
		expect( cards[ 1 ]?.querySelector( '.ffx-badge--info' )?.textContent ).toBe( 'Own text' );

		await click( button( 'Save mails' ) );
		expect( client.saveMails ).toHaveBeenCalledWith( 1, expect.objectContaining( { moved: { subject: 'Neue Zeit: {{booking:name}}', text: '' } } ) );
		expect( container.querySelector( '.ffx-appt-mails__saved' )?.textContent ).toContain( 'The mails are saved.' );
		expect( button( 'Save mails' ).disabled ).toBe( true );
	} );

	it( 'keeps the mails tab from those who may not edit forms', async () => {
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-appointments&tab=mails' );
		const client = fakeClient();
		await act( async () => {
			root.render( <AppointmentsScreen config={ { ...config, canEditTypes: false } } client={ client as unknown as AppointmentsClient } now={ () => NOW } /> );
		} );
		await settle();
		expect( client.mails ).not.toHaveBeenCalled();
		expect( container.querySelector( '.ffx-tabs' ) ).toBeNull();
		expect( container.querySelector( '.ffx-appt-agenda' ) ).not.toBeNull();
	} );
} );
