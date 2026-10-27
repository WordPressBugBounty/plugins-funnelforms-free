import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntriesApi, EntryDetail, EntrySummary, LeadStage, LeadStageInput } from '../src/api';
import { abandonBadge, appointmentTime, deliveryName, EntriesScreen } from '../src/ui/Entries';

( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

function summary( id: number, changes: Partial<EntrySummary> = {} ): EntrySummary {
	return {
		id,
		uid: 'u' + id,
		form: { id: 3, legacyId: null, title: 'Angebot' },
		status: 'complete',
		leadStatus: 'new',
		read: 1 !== id,
		archived: false,
		public: false,
		tags: 2 === id ? [ 'b2b' ] : [],
		score: null,
		variants: {},
		optIn: null,
		payment: null,
		assignedTo: null,
		imported: false,
		legacyLeadId: null,
		locale: 'de_DE',
		createdAt: '2026-10-15T08:00:00Z',
		completedAt: '2026-10-15T08:00:00Z',
		sourceUrl: 'https://site.test/angebot/',
		device: '',
		contact: [
			{ label: 'Name', type: 'text', value: 1 === id ? 'Erika Muster' : 'Max Beispiel' },
			{ label: 'E-Mail', type: 'email', value: 1 === id ? 'erika@example.org' : 'max@example.org' },
		],
		...changes,
	};
}

function detail( id: number, changes: Partial<EntryDetail> = {} ): EntryDetail {
	return {
		...summary( id ),
		answers: [
			{ label: 'Wie viele Zimmer?', value: '3' },
			{ label: 'Plan', value: [ 'plan.pdf' ], fileIds: [ 9 ] },
		],
		hiddenFields: {},
		calculations: [ { title: 'Preis', value: 142.8, formatted: '142,80', error: null } ],
		page: { title: 'Angebot', url: 'https://site.test/angebot/' },
		utm: { utm_source: 'google' },
		consent: [],
		files: [ { id: 9, fieldId: 'q1', name: 'plan.pdf', type: 'application/pdf', size: 100, url: 'https://site.test/file/9' } ],
		pdfUrl: 'https://site.test/pdf/1',
		notes: [ { id: 5, text: 'Rückruf am Montag', author: { id: 2, name: 'Mia' }, createdAt: '2026-10-15T09:00:00Z' } ],
		deliveries: [ { id: 1, action: 'a1', status: 'failed', attempts: 3, error: 'Timeout', updatedAt: '2026-10-15T08:01:00Z' } ],
		actions: [ { id: 'a1', kind: 'webhook' } ],
		appointments: [],
		visit: null,
		...changes,
	};
}

function fakeApi( overrides: Partial<EntriesApi> = {} ): EntriesApi {
	return {
		entries: vi.fn( async () => ( { entries: [ summary( 1 ), summary( 2 ) ], total: 2, pages: 1 } ) ),
		entry: vi.fn( async ( id: number ) => detail( id ) ),
		updateEntry: vi.fn( async ( id: number, changes ) => ( { ...summary( id ), ...changes } as EntrySummary ) ),
		bulkEntries: vi.fn( async () => ( { updated: 2, missing: [] } ) ),
		deleteEntry: vi.fn( async () => undefined ),
		notSpam: vi.fn( async ( id: number ) => ( { ...summary( id ), appointmentTaken: false } ) ),
		addNote: vi.fn( async ( _id: number, text: string ) => ( { id: 6, text, author: { id: 1, name: 'Ich' }, createdAt: null } ) ),
		deleteNote: vi.fn( async () => undefined ),
		resend: vi.fn( async () => undefined ),
		checkPayment: vi.fn(),
		cancelAppointment: vi.fn(),
		entryTags: vi.fn( async () => [ { tag: 'b2b', entries: 1 } ] ),
		assignees: vi.fn( async () => [ { id: 1, name: 'Ich' }, { id: 2, name: 'Mia' } ] ),
		...overrides,
	};
}

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries' );
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

function control<T extends HTMLElement>( label: string, scope: ParentNode = container ): T {
	const found = [ ...scope.querySelectorAll<HTMLElement>( 'label, [aria-label]' ) ].find( ( l ) => l.querySelector( '.ffxb-filter__label' )?.textContent === label || l.getAttribute( 'aria-label' ) === label );
	const el = found?.matches( 'select, input, textarea' ) ? found : found?.querySelector( 'select, input, textarea' );
	if ( ! el ) {
		throw new Error( 'No control ' + label );
	}
	return el as T;
}

async function choose( label: string, value: string, scope: ParentNode = container ): Promise<void> {
	const el = control<HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement>( label, scope );
	const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	await act( async () => {
		Object.getOwnPropertyDescriptor( proto, 'value' )?.set?.call( el, value );
		el.dispatchEvent( new Event( el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true } ) );
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

/** Types the name of a stage into its dialog. */
async function typeName( value: string, dialog: HTMLElement ): Promise<void> {
	const input = dialog.querySelector( '#ffxb-stage-name' ) as HTMLInputElement;
	await act( async () => {
		Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, value );
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	} );
}

async function click( el: HTMLElement ): Promise<void> {
	await act( async () => el.click() );
	await settle();
}

describe( 'entries screen', () => {
	it( 'lists entries with contact, form, status and tags, and filters through the address', async () => {
		const api = fakeApi();
		await act( async () => root.render( <EntriesScreen api={ api } config={ { forms: [ { id: 3, title: 'Angebot' } ], user: { id: 1, admin: true }, exportUrl: '/wp-admin/admin-post.php?action=funnelforms_export_entries&_wpnonce=n' } } /> ) );
		await settle();
		const rows = container.querySelectorAll( 'tbody tr' );
		expect( rows ).toHaveLength( 2 );
		expect( rows[ 0 ]?.textContent ).toContain( 'Erika Muster' );
		expect( rows[ 0 ]?.className ).toBe( 'is-unread' );
		expect( rows[ 1 ]?.textContent ).toContain( 'b2b' );
		expect( container.textContent ).toContain( '2 entries' );

		await choose( 'Form', '3' );
		await choose( 'Lead status', 'won' );
		await choose( 'Assigned to', '0' );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { form: 3, leadStatus: 'won', assignedTo: 0, page: 1, perPage: 25 } ) );
		expect( window.location.search ).toBe( '?page=funnelforms-entries&form=3&leadStatus=won&assignedTo=0' );
		const csv = container.querySelector<HTMLAnchorElement>( '.ffxb-menu__item' );
		expect( csv?.getAttribute( 'href' ) ).toContain( 'form=3&leadStatus=won&assignedTo=0&archived=0' );

		await click( button( 'Clear filters' ) );
		expect( window.location.search ).toBe( '?page=funnelforms-entries' );
	} );

	it( 'shows key figures of the open entries and filters by a click on one', async () => {
		const entryFigures = vi.fn( async () => ( { total: 40, unread: 3, today: 2, week: 12, previous: 8, leads: { new: 20, contacted: 10, won: 6, lost: 4 } } ) );
		const api = fakeApi( { entryFigures } );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { forms: [ { id: 3, title: 'Angebot' } ] } } /> ) );
		await settle();
		const kpis = (): HTMLButtonElement[] => [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-kpis button' ) ];
		expect( kpis() ).toHaveLength( 4 );
		expect( kpis()[ 0 ]?.textContent ).toBe( 'New today2Since midnight' );
		expect( kpis()[ 1 ]?.textContent ).toBe( 'Unread3Not opened yet' );
		expect( kpis()[ 2 ]?.textContent ).toBe( 'Last 7 days12+50 % against the 7 days before' );
		expect( kpis()[ 2 ]?.querySelector( '.ffx-kpi__hint' )?.className ).toContain( 'is-up' );
		expect( kpis()[ 3 ]?.textContent ).toBe( 'Won615 % of the open entries' );
		expect( container.querySelector( '.ffxb-scope__count' )?.textContent ).toBe( '40' );
		const moments = ( entryFigures.mock.calls as unknown as Array<[ Record<string, string> ]> )[ 0 ]?.[ 0 ] ?? {};
		expect( new Date( moments.today ?? '' ).getHours() ).toBe( 0 );
		expect( Math.round( ( Date.parse( moments.week ?? '' ) - Date.parse( moments.previous ?? '' ) ) / 86400000 ) ).toBe( 7 );

		await click( kpis()[ 1 ] as HTMLButtonElement );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { read: false } ) );
		expect( kpis()[ 1 ]?.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( container.querySelector( '.ffxb-chips' )?.textContent ).toContain( 'Unread' );
		await click( button( 'Remove filter Unread' ) );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.not.objectContaining( { read: false } ) );
		expect( kpis()[ 1 ]?.getAttribute( 'aria-pressed' ) ).toBe( 'false' );

		await click( kpis()[ 0 ] as HTMLButtonElement );
		expect( window.location.search ).toContain( 'period=today' );
		await click( kpis()[ 0 ] as HTMLButtonElement );
		expect( window.location.search ).not.toContain( 'period' );

		await click( kpis()[ 3 ] as HTMLButtonElement );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { leadStatus: 'won' } ) );

		await choose( 'Form', '3' );
		expect( entryFigures ).toHaveBeenLastCalledWith( expect.objectContaining( { form: 3 } ) );
	} );

	it( 'keeps the rarer filters behind a button and shows them as chips', async () => {
		const api = fakeApi();
		await act( async () => root.render( <EntriesScreen api={ api } config={ { user: { id: 1, admin: true } } } /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-kpis' ) ).toBeNull();
		const more = button( 'Filters' );
		const panel = container.querySelector<HTMLElement>( '#ffxb-more-filters' );
		expect( more.getAttribute( 'aria-controls' ) ).toBe( 'ffxb-more-filters' );
		expect( panel?.hidden ).toBe( true );
		await click( more );
		expect( more.getAttribute( 'aria-expanded' ) ).toBe( 'true' );
		expect( panel?.hidden ).toBe( false );

		await choose( 'Tag', 'b2b' );
		await choose( 'Assigned to', '1' );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { tag: 'b2b', assignedTo: 1 } ) );
		const chips = [ ...container.querySelectorAll( '.ffxb-chip' ) ].map( ( c ) => c.textContent );
		expect( chips ).toEqual( [ 'Assigned to: Me', 'Tag: b2b' ] );
		expect( container.querySelector( '.ffxb-morebtn__count' )?.textContent ).toBe( '2' );

		await click( button( 'Remove filter Tag: b2b' ) );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.not.objectContaining( { tag: 'b2b' } ) );
		expect( window.location.search ).toBe( '?page=funnelforms-entries&assignedTo=1' );
	} );

	it( 'shows each entry with initials, a relative time and the full date on hover', async () => {
		const api = fakeApi( { entries: vi.fn( async () => ( { entries: [ summary( 1, { createdAt: new Date( Date.now() - 5 * 60000 ).toISOString(), completedAt: null, assignedTo: { id: 2, name: 'Mia Kaiser' }, leadStatus: 'won' } ) ], total: 1, pages: 1 } ) ) } );
		await act( async () => root.render( <EntriesScreen api={ api } config={ {} } /> ) );
		await settle();
		const row = container.querySelector( 'tbody tr' ) as HTMLElement;
		expect( row.querySelector( '.ffxb-avatar' )?.textContent ).toBe( 'EM' );
		const time = row.querySelector( 'time' );
		expect( time?.textContent ).toBe( '5 min. ago' );
		expect( time?.getAttribute( 'title' ) ).toMatch( /\d{4}/ );
		expect( row.querySelector( '.ffx-badge--success' )?.textContent ).toBe( 'Won' );
		expect( row.textContent ).toContain( 'Mia Kaiser' );
	} );

	it( 'changes selected entries at once', async () => {
		const api = fakeApi();
		await act( async () => root.render( <EntriesScreen api={ api } config={ {} } /> ) );
		await settle();
		await click( control<HTMLInputElement>( 'Select all on this page' ) );
		expect( container.textContent ).toContain( '2 selected' );
		await choose( 'Add tags', 'Hot, b2b' );
		await click( button( 'Add', container.querySelector( '.ffxb-bulk' ) ?? container ) );
		expect( api.bulkEntries ).toHaveBeenCalledWith( [ 1, 2 ], { addTags: [ 'hot', 'b2b' ] } );
		await click( control<HTMLInputElement>( 'Select all on this page' ) );
		await click( button( 'Archive', container.querySelector( '.ffxb-bulk' ) ?? container ) );
		expect( api.bulkEntries ).toHaveBeenLastCalledWith( [ 1, 2 ], { archived: true } );
		expect( container.textContent ).toContain( '2 entries archived.' );
		expect( container.querySelector( '.ffxb-bulk' ) ).toBeNull();
	} );

	it( 'keeps spam in a folder of its own and takes entries back', async () => {
		const spam = ( id: number ): EntrySummary => summary( id, { status: 'spam', spam: { reasons: [ 'honeypot', 'rule_words' ] } } );
		const entries = vi.fn( async ( filter: { status?: string } ) => ( 'spam' === filter.status ? { entries: [ spam( 1 ), spam( 2 ) ], total: 2, pages: 1 } : { entries: [ summary( 1 ) ], total: 1, pages: 1 } ) );
		const entryFigures = vi.fn( async () => ( { total: 1, unread: 0, today: 0, week: 0, previous: 0, leads: { new: 1, contacted: 0, won: 0, lost: 0 }, spam: 2 } ) );
		const api = fakeApi( {
			entries: entries as unknown as EntriesApi['entries'],
			entryFigures,
			entry: vi.fn( async ( id: number ) => ( { ...detail( id ), status: 'spam', spam: { reasons: [ 'honeypot', 'rule_words' ] } } as EntryDetail ) ),
			updateEntry: vi.fn( async ( id: number, changes ) => ( { ...spam( id ), ...changes } as EntrySummary ) ),
			bulkEntries: vi.fn( async () => ( { updated: 0, released: 2, missing: [] } ) ),
		} );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { user: { id: 1, admin: true } } } /> ) );
		await settle();
		const scope = button( 'Spam2' );
		await click( scope );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { status: 'spam' } ) );
		expect( window.location.search ).toContain( 'status=spam' );
		expect( scope.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( container.textContent ).toContain( 'These entries sent no mail and ran no action.' );
		expect( () => control( 'Lead status' ) ).toThrow();

		await click( control<HTMLInputElement>( 'Select all on this page' ) );
		const bar = container.querySelector( '.ffxb-bulk' ) ?? container;
		expect( () => button( 'Archive', bar ) ).toThrow();
		await click( button( 'Not spam', bar ) );
		expect( api.bulkEntries ).toHaveBeenLastCalledWith( [ 1, 2 ], { notSpam: true } );

		await click( button( 'Erika Muster' ) );
		const panel = container.querySelector( '.ffxb-panel' ) as HTMLElement;
		expect( panel.textContent ).toContain( 'In the spam folder' );
		expect( panel.textContent ).toContain( 'A hidden field was filled in, as bots do' );
		expect( panel.textContent ).toContain( 'Contains a word of the blocklist' );
		expect( panel.querySelector( '.ffxb-panel__crm' ) ).toBeNull();
		await click( button( 'Not spam', panel ) );
		expect( api.notSpam ).toHaveBeenCalledWith( 1 );
		expect( panel.textContent ).toContain( 'Taken back. Mails and actions are being sent now.' );
	} );

	it( 'says when the spam folder is empty', async () => {
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries&status=spam' );
		const api = fakeApi( { entries: vi.fn( async () => ( { entries: [], total: 0, pages: 0 } ) ) } );
		await act( async () => root.render( <EntriesScreen api={ api } config={ {} } /> ) );
		await settle();
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { status: 'spam' } ) );
		expect( container.textContent ).toContain( 'No spam' );
	} );

	it( 'opens an entry with answers, files, notes and deliveries, and marks it as read', async () => {
		const api = fakeApi();
		await act( async () => root.render( <EntriesScreen api={ api } config={ { user: { id: 1, admin: false } } } /> ) );
		await settle();
		await click( button( 'Erika Muster' ) );
		expect( window.location.search ).toContain( 'entry=1' );
		expect( api.updateEntry ).toHaveBeenCalledWith( 1, { read: true } );
		const panel = container.querySelector( '.ffxb-panel' ) as HTMLElement;
		expect( panel.textContent ).toContain( 'Wie viele Zimmer?' );
		expect( panel.querySelector( 'a[href="https://site.test/file/9"]' )?.textContent ).toBe( 'plan.pdf' );
		expect( panel.textContent ).toContain( '142,80' );
		expect( panel.textContent ).toContain( 'Rückruf am Montag' );
		expect( panel.textContent ).toContain( 'Timeout' );
		expect( panel.querySelector( 'a[href="mailto:erika@example.org"]' ) ).not.toBeNull();
		// Notes of others can be deleted by administrators only.
		expect( [ ...panel.querySelectorAll( 'button' ) ].some( ( b ) => b.closest( '.ffxb-note' ) ) ).toBe( false );

		await choose( 'New note', 'Angebot geschickt', panel );
		await click( button( 'Add note', panel ) );
		expect( api.addNote ).toHaveBeenCalledWith( 1, 'Angebot geschickt' );

		await choose( 'Action to send again', 'a1', panel );
		await click( button( 'Send', panel ) );
		expect( api.resend ).toHaveBeenCalledWith( 1, 'a1' );

		await choose( 'Lead status', 'contacted', panel );
		expect( api.updateEntry ).toHaveBeenLastCalledWith( 1, { leadStatus: 'contacted' } );

		await click( button( 'Close', panel ) );
		expect( container.querySelector( '.ffxb-panel' ) ).toBeNull();
		expect( window.location.search ).not.toContain( 'entry=' );
	} );

	it( 'shows the receipt of a payment: test payment, coupon, subscription and the link to the provider', async () => {
		const payment = { status: 'paid' as const, provider: 'stripe', mode: 'subscription', interval: 'month', amount: 18.9, total: 18.9, currency: 'EUR', reference: 'cs_test_1', paidAt: '2026-10-15T08:05:00Z', error: null, test: true, coupon: 'SOMMER10', discount: 2.1, subscriptionStatus: 'past_due', dashboardUrl: 'https://dashboard.stripe.com/test/subscriptions/sub_1' };
		const api = fakeApi( { entries: vi.fn( async () => ( { entries: [ summary( 1, { payment } ) ], total: 1, pages: 1 } ) ), entry: vi.fn( async ( id: number ) => detail( id, { payment, read: true } ) ) } );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { user: { id: 1, admin: false } } } /> ) );
		await settle();
		await click( button( 'Erika Muster' ) );
		const panel = container.querySelector( '.ffxb-panel' ) as HTMLElement;
		expect( panel.textContent ).toContain( 'Test payment' );
		expect( panel.textContent ).toContain( 'SOMMER10' );
		expect( panel.textContent ).toContain( 'Payment overdue, monthly' );
		expect( panel.querySelector( 'a[href="https://dashboard.stripe.com/test/subscriptions/sub_1"]' )?.textContent ).toContain( 'cs_test_1' );
	} );

	it( 'shows how the visitor filled in the form and filters by device', async () => {
		const api = fakeApi( {
			entry: vi.fn( async ( id: number ) =>
				detail( id, {
					device: 'mobile',
					visit: {
						device: 'mobile',
						browser: 'Safari',
						os: 'iOS',
						referrer: 'https://www.google.com/search',
						seconds: 185,
						steps: [
							{ node: 'n1', title: 'Wie viele Zimmer?', seconds: 12 },
							{ node: 'n2', title: '', seconds: 140 },
						],
					},
				} )
			),
		} );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { user: { id: 1, admin: false } } } /> ) );
		await settle();
		await choose( 'Device', 'mobile' );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { device: 'mobile' } ) );
		expect( window.location.search ).toContain( 'device=mobile' );
		await click( button( 'Erika Muster' ) );
		const panel = container.querySelector( '.ffxb-panel' ) as HTMLElement;
		const facts = Object.fromEntries( [ ...panel.querySelectorAll( '.ffxb-facts__row' ) ].map( ( r ) => [ r.querySelector( 'dt' )?.textContent, r.querySelector( 'dd' )?.textContent ] ) );
		expect( facts ).toMatchObject( { Device: 'Mobile', Browser: 'Safari, iOS', 'Time to fill in': '3 min 05 s', 'Came from': 'www.google.com/search' } );
		expect( [ ...panel.querySelectorAll( '.ffxb-steps-time tr' ) ].map( ( r ) => [ r.querySelector( 'th' )?.textContent, r.querySelector( 'td' )?.textContent, r.className ] ) ).toEqual( [
			[ 'Wie viele Zimmer?', '12 s', '' ],
			[ 'n2', '2 min 20 s', 'is-longest' ],
		] );
	} );

	it( 'deletes an entry only after asking', async () => {
		const api = fakeApi();
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries&entry=2' );
		await act( async () => root.render( <EntriesScreen api={ api } config={ {} } /> ) );
		await settle();
		const panel = container.querySelector( '.ffxb-panel' ) as HTMLElement;
		expect( api.updateEntry ).not.toHaveBeenCalled();
		await click( button( 'Delete', panel ) );
		expect( api.deleteEntry ).not.toHaveBeenCalled();
		await click( button( 'Delete for good' ) );
		expect( api.deleteEntry ).toHaveBeenCalledWith( 2 );
		expect( container.querySelector( '.ffxb-panel' ) ).toBeNull();
		expect( container.textContent ).toContain( 'Entry deleted.' );
	} );

	it( 'shows a board by lead status and moves entries', async () => {
		const api = fakeApi();
		await act( async () => root.render( <EntriesScreen api={ api } config={ {} } /> ) );
		await settle();
		await click( button( 'Board' ) );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { perPage: 100, page: 1 } ) );
		const columns = container.querySelectorAll( '.ffxb-board__column' );
		expect( columns ).toHaveLength( 4 );
		expect( columns[ 0 ]?.querySelectorAll( '.ffxb-card' ) ).toHaveLength( 2 );
		await choose( 'Lead status of Max Beispiel', 'won' );
		expect( api.updateEntry ).toHaveBeenCalledWith( 2, { leadStatus: 'won' } );
	} );

	it( 'renames, adds, moves and deletes the stages of the board', async () => {
		HTMLDialogElement.prototype.showModal ??= function ( this: HTMLDialogElement ) {
			this.setAttribute( 'open', '' );
		};
		const stages: LeadStage[] = [
			{ key: 'new', name: 'New', tone: 'info', standard: true, locked: true, entries: 2 },
			{ key: 'contacted', name: 'Contacted', tone: 'warning', standard: true, entries: 3 },
			{ key: 'won', name: 'Won', tone: 'success', standard: true, entries: 0 },
		];
		const saveLeadStages = vi.fn( async ( list: LeadStageInput[] ) => list.map( ( s, i ) => ( { entries: 0, locked: 'new' === s.key, ...s, key: s.key || 'stage_abc' + i } ) ) );
		const api = fakeApi( { saveLeadStages } );
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries&view=board&leadStatus=contacted' );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { stages, editStages: true } } /> ) );
		await settle();
		// The address may name a stage of the site; the board shows them all, in their order.
		expect( [ ...container.querySelectorAll( '.ffxb-board__name' ) ].map( ( n ) => n.textContent ) ).toEqual( [ 'New', 'Contacted', 'Won' ] );
		expect( container.querySelectorAll( '.ffxb-board__column--warning' ) ).toHaveLength( 1 );

		// Rename: an empty name is refused where it is typed.
		await click( button( 'Edit stage Contacted' ) );
		let dialog = container.querySelector( 'dialog[aria-label="Edit stage"]' ) as HTMLDialogElement;
		await typeName( '', dialog );
		await click( button( 'Save', dialog ) );
		expect( dialog.textContent ).toContain( 'Give the stage a name.' );
		expect( ( dialog.querySelector( '#ffxb-stage-name' ) as HTMLInputElement ).getAttribute( 'aria-invalid' ) ).toBe( 'true' );
		await typeName( 'won', dialog );
		await click( button( 'Save', dialog ) );
		expect( dialog.textContent ).toContain( 'Another stage has this name.' );
		expect( saveLeadStages ).not.toHaveBeenCalled();
		await typeName( 'Offer sent', dialog );
		await act( async () => ( dialog.querySelector( 'input[value="danger"]' ) as HTMLInputElement ).click() );
		await click( button( 'Move right', dialog ) );
		expect( dialog.textContent ).toContain( 'Column 3 of 3' );
		await click( button( 'Save', dialog ) );
		expect( saveLeadStages ).toHaveBeenLastCalledWith(
			[
				{ key: 'new', name: 'New', tone: 'info' },
				{ key: 'won', name: 'Won', tone: 'success' },
				{ key: 'contacted', name: 'Offer sent', tone: 'danger' },
			],
			undefined
		);
		expect( container.querySelector( 'dialog[aria-label="Edit stage"]' ) ).toBeNull();
		expect( container.textContent ).toContain( 'Stage “Offer sent” saved.' );
		expect( [ ...container.querySelectorAll( '.ffxb-board__name' ) ].map( ( n ) => n.textContent ) ).toEqual( [ 'New', 'Won', 'Offer sent' ] );
		expect( [ ...control<HTMLSelectElement>( 'Lead status of Max Beispiel' ).options ].map( ( o ) => o.text ) ).toEqual( [ 'New', 'Won', 'Offer sent' ] );

		// Add a stage at the end.
		await click( button( 'Add stage' ) );
		dialog = container.querySelector( 'dialog[aria-label="New stage"]' ) as HTMLDialogElement;
		await typeName( 'Lost', dialog );
		await click( button( 'Add stage', dialog ) );
		expect( saveLeadStages.mock.calls.at( -1 )?.[ 0 ].at( -1 ) ).toEqual( { name: 'Lost', tone: 'warning' } );
		expect( container.querySelectorAll( '.ffxb-board__column' ) ).toHaveLength( 4 );

		// Delete: the stage new entries arrive in stays; another asks where its entries go.
		await click( button( 'Edit stage New' ) );
		dialog = container.querySelector( 'dialog[aria-label="Edit stage"]' ) as HTMLDialogElement;
		expect( dialog.textContent ).toContain( 'New entries arrive in this stage' );
		expect( () => button( 'Delete stage…', dialog ) ).toThrow();
		await click( button( 'Cancel', dialog ) );
		saveLeadStages.mockImplementationOnce( async () => Promise.reject( new Error( 'Choose the stage that takes the entries of the deleted stage.' ) ) );
		await click( button( 'Edit stage Won' ) );
		dialog = container.querySelector( 'dialog[aria-label="Edit stage"]' ) as HTMLDialogElement;
		await click( button( 'Delete stage…', dialog ) );
		expect( dialog.textContent ).toContain( 'No entries are in “Won”' );
		await click( button( 'Delete stage', dialog ) );
		expect( dialog.textContent ).toContain( 'Choose the stage that takes the entries' );
		await click( button( 'Delete stage', dialog ) );
		expect( saveLeadStages ).toHaveBeenLastCalledWith( [ expect.objectContaining( { key: 'new' } ), expect.objectContaining( { key: 'contacted' } ), expect.objectContaining( { name: 'Lost' } ) ], { won: 'new' } );
		expect( container.textContent ).toContain( 'Stage “Won” deleted.' );
		// Without a "won" stage there is no figure for it.
		expect( container.querySelectorAll( '.ffxb-board__column' ) ).toHaveLength( 3 );
	} );

	it( 'moves a stage with its entries elsewhere when it is deleted, and drags columns', async () => {
		HTMLDialogElement.prototype.showModal ??= function ( this: HTMLDialogElement ) {
			this.setAttribute( 'open', '' );
		};
		const stages: LeadStage[] = [
			{ key: 'new', name: 'Neu', tone: 'info', locked: true, entries: 2 },
			{ key: 'call', name: 'Anrufen', tone: 'warning', entries: 4 },
			{ key: 'won', name: 'Kunde', tone: 'success', entries: 1 },
		];
		const saveLeadStages = vi.fn( async ( list: LeadStageInput[] ) => list.map( ( s ) => ( { ...s, key: s.key ?? '' } ) ) );
		const api = fakeApi( { saveLeadStages, entryFigures: vi.fn( async () => ( { total: 10, unread: 1, today: 0, week: 0, previous: 0, leads: { new: 2, call: 4, won: 1 } } ) ) } );
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries&view=board' );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { stages, editStages: true } } /> ) );
		await settle();
		expect( [ ...container.querySelectorAll( '.ffx-kpi__label' ) ].map( ( k ) => k.textContent ) ).toContain( 'Kunde' );
		await click( button( 'Edit stage Anrufen' ) );
		const dialog = container.querySelector( 'dialog[aria-label="Edit stage"]' ) as HTMLDialogElement;
		await click( button( 'Delete stage…', dialog ) );
		expect( dialog.textContent ).toContain( '4 entries are in “Anrufen”. Where should they go?' );
		await choose( 'Move the entries to', 'won', dialog );
		await click( button( 'Delete stage', dialog ) );
		expect( saveLeadStages ).toHaveBeenLastCalledWith( [ expect.objectContaining( { key: 'new' } ), expect.objectContaining( { key: 'won' } ) ], { call: 'won' } );
		expect( container.textContent ).toContain( 'its entries are now in “Kunde”' );

		// A column dragged by its title onto another takes its place.
		const heads = container.querySelectorAll<HTMLElement>( '.ffxb-board__head' );
		const columns = container.querySelectorAll<HTMLElement>( '.ffxb-board__column' );
		const data = new Map<string, string>();
		const transfer = { setData: ( k: string, v: string ) => data.set( k, v ), getData: ( k: string ) => data.get( k ) ?? '', effectAllowed: '' };
		const fire = ( el: HTMLElement, type: string ): void => {
			const event = new Event( type, { bubbles: true, cancelable: true } );
			Object.defineProperty( event, 'dataTransfer', { value: transfer } );
			el.dispatchEvent( event );
		};
		expect( heads[ 1 ]?.getAttribute( 'draggable' ) ).toBe( 'true' );
		await act( async () => {
			fire( heads[ 1 ] as HTMLElement, 'dragstart' );
			fire( columns[ 0 ] as HTMLElement, 'drop' );
		} );
		await settle();
		expect( saveLeadStages ).toHaveBeenLastCalledWith( [ expect.objectContaining( { key: 'won' } ), expect.objectContaining( { key: 'new' } ) ], undefined );
		expect( api.updateEntry ).not.toHaveBeenCalled();
	} );

	it( 'keeps the stages as they are for those who may not change them', async () => {
		const api = fakeApi( { saveLeadStages: vi.fn() } );
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries&view=board' );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { stages: [ { key: 'new', name: 'Inbox', tone: 'info' } ] } } /> ) );
		await settle();
		expect( container.querySelector( '.ffxb-board__edit' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-board__add' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-board__head' )?.getAttribute( 'draggable' ) ).toBe( 'false' );
		expect( container.querySelector( '.ffxb-board__name' )?.textContent ).toBe( 'Inbox' );
	} );

	it( 'tells an empty site from filters without results', async () => {
		const api = fakeApi( { entries: vi.fn( async () => ( { entries: [], total: 0, pages: 1 } ) ) } );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { builderUrl: '/wp-admin/admin.php?page=funnelforms-builder' } } /> ) );
		await settle();
		expect( container.textContent ).toContain( 'No entries yet' );
		await choose( 'Period', '7d' );
		expect( container.textContent ).toContain( 'No entries found' );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.objectContaining( { after: expect.any( String ) } ) );
	} );
} );

describe( 'deliveryName', () => {
	it( 'names the appointment mails the plugin queues itself', () => {
		expect( [ ':booking:12:0', ':booking:12:2', ':reminder:12:1:60', ':booking-cancel:12', ':calendar:12:1', 'a_mail' ].map( deliveryName ) ).toEqual( [ 'Appointment invitation', 'Appointment moved', 'Appointment reminder', 'Appointment cancellation', 'Calendar entry', 'a_mail' ] );
	} );

	it( 'names the reminders to visitors who leave and their badges', () => {
		expect( [ ':abandon:1', ':abandon:2', ':abandon:owner' ].map( deliveryName ) ).toEqual( [ 'Reminder to the visitor', 'Second reminder to the visitor', 'Note about the abandoned lead' ] );
		const label = ( entry: Pick<EntrySummary, 'status' | 'abandon'> ): unknown => ( abandonBadge( entry ) as React.ReactElement<{ children: unknown }> | null )?.props.children ?? null;
		const abandon = { lastStep: null, leftAt: null, remindedAt: null, reminders: 0 };
		expect( label( { status: 'abandoned', abandon: { ...abandon, state: 'waiting' } } ) ).toBe( 'Abandoned' );
		expect( label( { status: 'abandoned', abandon: { ...abandon, state: 'sent' } } ) ).toBe( 'Abandoned, reminded' );
		expect( label( { status: 'abandoned', abandon: { ...abandon, state: 'stopped' } } ) ).toBe( 'Abandoned, no reminders' );
		expect( label( { status: 'complete', abandon: { ...abandon, state: 'recovered' } } ) ).toBe( 'Recovered by the reminder' );
		expect( label( { status: 'complete', abandon: { ...abandon, state: 'completed' } } ) ).toBeNull();
		expect( label( { status: 'complete', abandon: null } ) ).toBeNull();
	} );
} );

describe( 'appointments of an entry', () => {
	it( 'shows the booked time in the zone of the type and cancels it after asking', async () => {
		const booked = {
			id: 31,
			entryId: 1,
			status: 'confirmed',
			start: '2026-10-20T07:00:00Z',
			end: '2026-10-20T07:30:00Z',
			duration: 30,
			timezone: 'Europe/Berlin',
			type: { ref: 'bt:1', title: 'Erstgespräch', kind: 'call' as const, location: '' },
			people: [ { id: 2, name: 'Mia' } ],
			visitor: { name: 'Erika Muster', email: 'erika@example.org' },
			form: { id: 7, title: 'Angebot' },
			changeable: true,
		};
		const entry = vi.fn().mockResolvedValueOnce( detail( 1, { appointments: [ booked ] } ) ).mockResolvedValue( detail( 1, { appointments: [ { ...booked, status: 'cancelled', changeable: false } ] } ) );
		const api = fakeApi( { entry, cancelAppointment: vi.fn( async () => ( { ...booked, status: 'cancelled', changeable: false } ) ) } );
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries&entry=1' );
		await act( async () => root.render( <EntriesScreen api={ api } /> ) );
		await settle();
		expect( container.textContent ).toContain( appointmentTime( booked ) );
		expect( appointmentTime( booked ) ).toMatch( /\b0?9[:.]00\b/ );
		expect( container.textContent ).toContain( 'Erstgespräch · 30 min · Mia · Central European Time' );

		const confirm = vi.spyOn( window, 'confirm' ).mockReturnValueOnce( false ).mockReturnValueOnce( true );
		const cancel = (): HTMLButtonElement => [ ...container.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent === 'Cancel appointment' ) as HTMLButtonElement;
		await act( async () => cancel().click() );
		expect( api.cancelAppointment ).not.toHaveBeenCalled();
		await act( async () => cancel().click() );
		await settle();
		expect( api.cancelAppointment ).toHaveBeenCalledWith( 1, 31 );
		expect( container.textContent ).toContain( 'The appointment is cancelled.' );
		expect( container.textContent ).toContain( 'Cancelled' );
		expect( [ ...container.querySelectorAll( 'button' ) ].some( ( b ) => b.textContent === 'Cancel appointment' ) ).toBe( false );
		confirm.mockRestore();
	} );
} );


describe( 'entries screen in Funnelforms Free', () => {
	beforeEach( () => {
		process.env.FUNNELFORMS_EDITION = 'free';
	} );
	afterEach( () => {
		delete process.env.FUNNELFORMS_EDITION;
	} );

	it( 'has no lead status, tags, assignment, board or Excel export, and ignores them in the address', async () => {
		window.history.replaceState( null, '', '/wp-admin/admin.php?page=funnelforms-entries&view=board&leadStatus=won&assignedTo=1&tag=b2b' );
		const entryFigures = vi.fn( async () => ( { total: 40, unread: 3, today: 2, week: 12, previous: 8, leads: { new: 20, contacted: 10, won: 6, lost: 4 } } ) );
		const api = fakeApi( { entryFigures } );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { user: { id: 1, admin: true }, exportUrl: '/export' } } /> ) );
		await settle();
		expect( api.entryTags ).not.toHaveBeenCalled();
		expect( api.assignees ).not.toHaveBeenCalled();
		expect( api.entries ).toHaveBeenLastCalledWith( expect.not.objectContaining( { leadStatus: 'won' } ) );
		expect( api.entries ).toHaveBeenLastCalledWith( expect.not.objectContaining( { tag: 'b2b', assignedTo: 1 } ) );
		expect( container.querySelector( '.ffxb-board' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-table' ) ).not.toBeNull();
		expect( [ ...container.querySelectorAll( 'th' ) ].map( ( th ) => th.textContent ) ).not.toContain( 'Lead status' );
		expect( container.querySelectorAll( '.ffxb-kpis button' ) ).toHaveLength( 3 );
		const text = container.textContent ?? '';
		for ( const gone of [ 'Board', 'Lead status', 'Assigned to', 'Tag', 'For Excel' ] ) {
			expect( text ).not.toContain( gone );
		}
		expect( text ).toContain( 'CSV file' );

		await click( control<HTMLInputElement>( 'Select all on this page' ) );
		const bulk = container.querySelector( '.ffxb-bulk' ) as HTMLElement;
		expect( bulk.querySelector( 'select' ) ).toBeNull();
		expect( bulk.querySelector( '.ffxb-bulk__tags' ) ).toBeNull();
		expect( bulk.textContent ).toContain( 'Archive' );
		expect( bulk.textContent ).toContain( 'Delete' );
	} );

	it( 'opens an entry without CRM fields, notes, sending again, PDF or publishing', async () => {
		const api = fakeApi( { entry: vi.fn( async ( id: number ) => detail( id, { read: true, public: true } ) ) } );
		await act( async () => root.render( <EntriesScreen api={ api } config={ { user: { id: 1, admin: true } } } /> ) );
		await settle();
		await click( button( 'Erika Muster' ) );
		const panel = container.querySelector( '.ffxb-panel' ) as HTMLElement;
		expect( panel.textContent ).toContain( 'Wie viele Zimmer?' );
		expect( panel.querySelector( '.ffxb-panel__crm' ) ).toBeNull();
		for ( const gone of [ 'Notes', 'Send again', 'PDF', 'Show on the website', 'Hide on the website', 'Shown on the website', 'Rückruf am Montag' ] ) {
			expect( panel.textContent ).not.toContain( gone );
		}
		expect( panel.textContent ).toContain( 'Timeout' );
		expect( panel.textContent ).toContain( 'Archive' );
		expect( panel.textContent ).toContain( 'Mark as unread' );
		expect( panel.textContent ).toContain( 'Delete' );
	} );
} );
