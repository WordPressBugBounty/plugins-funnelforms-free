import { describe, expect, it, vi } from 'vitest';
import {
	addDays,
	addMonths,
	addressOf,
	AppointmentsClient,
	byDay,
	counts,
	dayOf,
	figures,
	filtered,
	insertAt,
	lanes,
	minutesOf,
	NO_FILTER,
	rangeOf,
	startOfWeek,
	stateFromAddress,
	stateOf,
	step,
	zoneName,
	zoneOf,
} from '../src/appointments';

import { item, NOW } from './appointmentItem';

describe( 'days and times in a zone', () => {
	it( 'understands zone names and whole-hour offsets', () => {
		expect( zoneOf( 'Europe/Berlin' ) ).toBe( 'Europe/Berlin' );
		expect( zoneOf( '+02:00' ) ).toBe( 'Etc/GMT-2' );
		expect( zoneOf( '-05:00' ) ).toBe( 'Etc/GMT+5' );
		expect( zoneOf( '+00:00' ) ).toBe( 'UTC' );
		expect( zoneOf( '+05:30' ) ).toBeUndefined();
		expect( zoneOf( 'Mars/Olympus' ) ).toBeUndefined();
	} );

	it( 'names zones as people read them', () => {
		expect( zoneName( 'Europe/Berlin', 'de-DE' ) ).toBe( 'Mitteleuropäische Zeit' );
		expect( zoneName( 'America/New_York', 'en-US' ) ).toBe( 'Eastern Time' );
		expect( zoneName( '+05:30', 'de-DE' ) ).toBe( '+05:30' );
		expect( zoneName( 'Mars/Olympus', 'de-DE' ) ).toBe( 'Mars/Olympus' );
	} );

	it( 'counts days and minutes in the zone, also across midnight', () => {
		expect( dayOf( '2026-10-19T22:30:00Z', 'Europe/Berlin' ) ).toBe( '2026-10-20' );
		expect( dayOf( '2026-10-19T22:30:00Z', 'UTC' ) ).toBe( '2026-10-19' );
		expect( minutesOf( '2026-10-19T07:30:00Z', 'Europe/Berlin' ) ).toBe( 9 * 60 + 30 );
		expect( minutesOf( '2026-10-19T22:00:00Z', 'Europe/Berlin' ) ).toBe( 0 );
	} );

	it( 'steps through days, weeks and months', () => {
		expect( addDays( '2026-10-31', 1 ) ).toBe( '2026-11-01' );
		expect( addDays( '2026-03-01', -1 ) ).toBe( '2026-02-28' );
		expect( startOfWeek( '2026-10-21', 1 ) ).toBe( '2026-10-19' );
		expect( startOfWeek( '2026-10-21', 0 ) ).toBe( '2026-10-18' );
		expect( startOfWeek( '2026-10-18', 1 ) ).toBe( '2026-10-12' );
		expect( addMonths( '2026-01-31', 1 ) ).toBe( '2026-02-01' );
		expect( addMonths( '2026-01-15', -1 ) ).toBe( '2025-12-01' );
		expect( step( 'list', '2026-10-19', 1 ) ).toBe( '2026-11-02' );
		expect( step( 'week', '2026-10-19', -1 ) ).toBe( '2026-10-12' );
		expect( step( 'month', '2026-10-19', 1 ) ).toBe( '2026-11-01' );
	} );

	it( 'shows two weeks in the list, the week, and the month in whole weeks', () => {
		const list = rangeOf( 'list', '2026-10-19', 1 );
		expect( [ list.from, list.to, list.days.length ] ).toEqual( [ '2026-10-19', '2026-11-01', 14 ] );
		const week = rangeOf( 'week', '2026-10-22', 1 );
		expect( [ week.from, week.to ] ).toEqual( [ '2026-10-19', '2026-10-25' ] );
		const month = rangeOf( 'month', '2026-10-19', 1 );
		expect( [ month.from, month.to, month.days.length ] ).toEqual( [ '2026-09-28', '2026-11-01', 35 ] );
		const sunday = rangeOf( 'month', '2026-02-10', 0 );
		expect( [ sunday.from, sunday.to, sunday.days.length ] ).toEqual( [ '2026-02-01', '2026-02-28', 28 ] );
	} );
} );

describe( 'state, filters and counts', () => {
	const items = [
		item( 1, '2026-10-19T08:00:00Z' ),
		item( 2, '2026-10-19T09:00:00Z', { outcome: 'noshow' } ),
		item( 3, '2026-10-19T14:00:00Z', { people: [] } ),
		item( 4, '2026-10-20T08:00:00Z', { status: 'cancelled', type: { ref: 'bt:2', title: 'Rückruf', kind: 'call', location: '' } } ),
		item( 5, '2026-10-12T08:00:00Z', { outcome: 'done', form: { id: 4, title: 'Beratung' } } ),
	];

	it( 'knows where an appointment stands', () => {
		expect( items.map( ( a ) => stateOf( a, NOW ) ) ).toEqual( [ 'open', 'noshow', 'upcoming', 'cancelled', 'done' ] );
	} );

	it( 'filters by status, form, type and the people booked', () => {
		const ids = ( filter: Partial<typeof NO_FILTER> ): number[] => filtered( items, { ...NO_FILTER, ...filter }, 7, NOW ).map( ( a ) => a.id );
		expect( ids( {} ) ).toEqual( [ 5, 1, 2, 3 ] );
		expect( ids( { status: 'all' } ) ).toEqual( [ 5, 1, 2, 3, 4 ] );
		expect( ids( { status: 'open' } ) ).toEqual( [ 1 ] );
		expect( ids( { status: 'cancelled' } ) ).toEqual( [ 4 ] );
		expect( ids( { form: 4 } ) ).toEqual( [ 5 ] );
		expect( ids( { type: 'bt:2', status: 'all' } ) ).toEqual( [ 4 ] );
		expect( ids( { mine: true } ) ).toEqual( [ 5, 1, 2 ] );
	} );

	it( 'counts what each status would show within the other filters', () => {
		expect( counts( items, NO_FILTER, 7, NOW ) ).toEqual( { active: 4, upcoming: 1, open: 1, done: 1, noshow: 1, cancelled: 1, all: 5 } );
		expect( counts( items, { ...NO_FILTER, form: 4 }, 7, NOW ).all ).toBe( 1 );
	} );

	it( 'groups by day in the site zone', () => {
		const days = byDay( [ item( 1, '2026-10-19T21:30:00Z' ), item( 2, '2026-10-19T22:30:00Z' ) ], 'Europe/Berlin' );
		expect( [ ...days.keys() ] ).toEqual( [ '2026-10-19', '2026-10-20' ] );
	} );

	it( 'sums up today, the next week, what is to mark and the no-shows', () => {
		const f = figures( items, 'Europe/Berlin', NOW );
		expect( f.today ).toBe( 3 );
		expect( f.nextToday?.id ).toBe( 3 );
		expect( [ f.week, f.weekMinutes ] ).toEqual( [ 1, 30 ] );
		expect( [ f.open, f.firstOpen, f.noshow, f.past ] ).toEqual( [ 1, '2026-10-19', 1, 3 ] );
	} );

	it( 'puts overlapping appointments side by side', () => {
		const out = lanes( [
			item( 1, '2026-10-19T08:00:00Z', { duration: 60 } ),
			item( 2, '2026-10-19T08:30:00Z' ),
			item( 3, '2026-10-19T09:00:00Z' ),
			item( 4, '2026-10-19T11:00:00Z' ),
		] );
		expect( out.get( 1 ) ).toEqual( { lane: 0, of: 2 } );
		expect( out.get( 2 ) ).toEqual( { lane: 1, of: 2 } );
		// Starting when the others end is no overlap.
		expect( out.get( 3 ) ).toEqual( { lane: 0, of: 1 } );
		expect( out.get( 4 ) ).toEqual( { lane: 0, of: 1 } );
		const three = lanes( [ item( 1, '2026-10-19T08:00:00Z', { duration: 60 } ), item( 2, '2026-10-19T08:30:00Z' ), item( 3, '2026-10-19T08:45:00Z' ) ] );
		expect( [ ...three.values() ] ).toEqual( [ { lane: 0, of: 3 }, { lane: 1, of: 3 }, { lane: 2, of: 3 } ] );
	} );
} );

describe( 'address of the page', () => {
	it( 'keeps view, day and filters in the address', () => {
		const state = stateFromAddress( '?page=funnelforms-appointments&view=week&date=2026-10-19&form=3&type=bt:1&status=open&mine=1' );
		expect( state ).toEqual( { tab: 'calendar', view: 'week', day: '2026-10-19', filter: { form: 3, type: 'bt:1', status: 'open', mine: true } } );
		const back = addressOf( state, 'https://site.test/wp-admin/admin.php?page=funnelforms-appointments' );
		expect( stateFromAddress( new URL( back ).search ) ).toEqual( state );
		expect( addressOf( { tab: 'calendar', view: 'list', day: '', filter: NO_FILTER }, back ) ).toBe( 'https://site.test/wp-admin/admin.php?page=funnelforms-appointments' );
	} );

	it( 'ignores what it does not know', () => {
		expect( stateFromAddress( '?view=year&date=19.10.2026&form=-1&type=x&status=gone&tab=mails' ) ).toEqual( { tab: 'mails', view: 'list', day: '', filter: NO_FILTER } );
	} );
} );

describe( 'placeholders', () => {
	it( 'go where the cursor is, replacing a selection', () => {
		expect( insertAt( 'Hallo !', 'contact:name', 6, 6 ) ).toEqual( { text: 'Hallo {{contact:name}}!', cursor: 22 } );
		expect( insertAt( 'Hallo Welt', 'contact:name', 6, 10 ) ).toEqual( { text: 'Hallo {{contact:name}}', cursor: 22 } );
		expect( insertAt( 'Hallo', 'booking:date', null, null ) ).toEqual( { text: 'Hallo{{booking:date}}', cursor: 21 } );
	} );
} );

describe( 'client', () => {
	const answer = ( status: number, body: unknown ): Response => new Response( JSON.stringify( body ), { status, headers: { 'Content-Type': 'application/json' } } );

	it( 'builds addresses with and without pretty permalinks, in the user’s language', () => {
		expect( new AppointmentsClient( 'https://site.test/wp-json/', 'n' ).url( 'appointments', { from: '2026-10-19' } ) ).toBe( 'https://site.test/wp-json/funnelforms/v1/appointments?from=2026-10-19&_locale=user' );
		expect( new AppointmentsClient( 'https://site.test/?rest_route=/', 'n' ).url( 'appointments' ) ).toBe( 'https://site.test/?rest_route=%2Ffunnelforms%2Fv1%2Fappointments&_locale=user' );
	} );

	it( 'sends the actions with the nonce and keeps a fresh one', async () => {
		const fetcher = vi.fn( async () => new Response( '{"id":1}', { status: 200, headers: { 'X-WP-Nonce': 'fresh' } } ) );
		const client = new AppointmentsClient( 'https://site.test/wp-json/', 'n1', fetcher as unknown as typeof fetch );
		await client.move( { entryId: 5, id: 9 }, '2026-10-20T08:00:00Z', 'Bis dann' );
		await client.saveMails( 2, { invite: { subject: 'S', text: 'T' } } as never );
		const [ url, init ] = fetcher.mock.calls[ 0 ] as unknown as [ string, RequestInit ];
		expect( url ).toBe( 'https://site.test/wp-json/funnelforms/v1/entries/5/appointments/9/move?_locale=user' );
		expect( init.method ).toBe( 'POST' );
		expect( ( init.headers as Record<string, string> )[ 'X-WP-Nonce' ] ).toBe( 'n1' );
		expect( JSON.parse( String( init.body ) ) ).toEqual( { start: '2026-10-20T08:00:00Z', message: 'Bis dann' } );
		const [ url2, init2 ] = fetcher.mock.calls[ 1 ] as unknown as [ string, RequestInit ];
		expect( url2 ).toContain( '/funnelforms/v1/appointments/mails/2' );
		expect( url2 ).toContain( '_method=PUT' );
		expect( ( init2.headers as Record<string, string> )[ 'X-HTTP-Method-Override' ] ).toBe( 'PUT' );
		expect( ( init2.headers as Record<string, string> )[ 'X-WP-Nonce' ] ).toBe( 'fresh' );
	} );

	it( 'turns refusals into errors with the server’s message', async () => {
		const client = new AppointmentsClient( '/wp-json/', 'n', ( async () => answer( 409, { code: 'slot_taken', message: 'This time is no longer free.' } ) ) as unknown as typeof fetch );
		await expect( client.move( { entryId: 1, id: 2 }, 'x', '' ) ).rejects.toMatchObject( { code: 'slot_taken', message: 'This time is no longer free.', status: 409 } );
		const offline = new AppointmentsClient( '/wp-json/', 'n', ( async () => {
			throw new TypeError( 'network' );
		} ) as unknown as typeof fetch );
		await expect( offline.list( '2026-10-19', '2026-10-25' ) ).rejects.toMatchObject( { code: 'offline' } );
	} );
} );
