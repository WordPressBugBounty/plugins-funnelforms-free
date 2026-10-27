import { describe, expect, it } from 'vitest';
import type { EntrySummary } from '../src/api';
import { addressOf, avatarTone, byLeadStatus, change, entryEmail, entryName, exportLink, figureMoments, filtered, initials, moveStage, parseTags, periodStart, relativeTime, stageInputs, stageNameProblem, standardStages, stateFromAddress, valueText } from '../src/entries';

function entry( id: number, changes: Partial<EntrySummary> = {} ): EntrySummary {
	return {
		id,
		uid: 'u' + id,
		form: { id: 3, legacyId: null, title: 'Angebot' },
		status: 'complete',
		leadStatus: 'new',
		read: false,
		archived: false,
		public: false,
		tags: [],
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
		sourceUrl: null,
		device: '',
		contact: [],
		...changes,
	};
}

describe( 'entries screen', () => {
	it( 'keeps filters, view and the open entry in the address', () => {
		const state = stateFromAddress( '?page=funnelforms-entries&form=3&leadStatus=won&tag=b2b&assignedTo=0&archived=1&read=0&paged=2&period=7d&view=board&entry=12&leadStatus=bogus' );
		expect( state ).toEqual( {
			filter: { form: 3, leadStatus: 'won', tag: 'b2b', assignedTo: 0, archived: true, read: false, page: 2 },
			period: '7d',
			view: 'board',
			entry: 12,
		} );
		const url = addressOf( state, 'https://site.test/wp-admin/admin.php?page=funnelforms-entries&entry=4' );
		expect( stateFromAddress( new URL( url ).search ) ).toEqual( state );
		expect( new URL( url ).searchParams.get( 'page' ) ).toBe( 'funnelforms-entries' );
		expect( addressOf( { filter: {}, period: '', view: 'list', entry: null }, url ) ).toBe( 'https://site.test/wp-admin/admin.php?page=funnelforms-entries' );
		expect( stateFromAddress( '?form=abc&leadStatus=hot' ).filter ).toEqual( {} );
	} );

	it( 'names entries by name, else e-mail, and shows values as text', () => {
		const contact = [
			{ label: 'Anrede', type: 'salutation', value: 'Frau' },
			{ label: 'E-Mail', type: 'email', value: 'erika@example.org' },
			{ label: 'Ihr Name', type: 'text', value: 'Erika Muster' },
		];
		expect( entryName( entry( 1, { contact } ) ) ).toBe( 'Erika Muster' );
		expect( entryName( entry( 1, { contact: contact.slice( 0, 2 ) } ) ) ).toBe( 'erika@example.org' );
		expect( entryEmail( entry( 1, { contact } ) ) ).toBe( 'erika@example.org' );
		expect( entryName( entry( 1 ) ) ).toBe( '' );
		expect( valueText( [ 'Rot', 'Blau' ] ) ).toBe( 'Rot, Blau' );
		expect( valueText( 3.5 ) ).toBe( '3.5' );
		expect( valueText( true, 'Ja', 'Nein' ) ).toBe( 'Ja' );
		expect( valueText( [ { Name: 'Ada', Alter: 3 }, { Name: 'Bo' } ] ) ).toBe( 'Name: Ada, Alter: 3, Name: Bo' );
		expect( valueText( null ) ).toBe( '' );
	} );

	it( 'reads tags as the server stores them', () => {
		expect( parseTags( ' B2B, hot   lead,b2b,, ' ) ).toEqual( [ 'b2b', 'hot lead' ] );
		expect( parseTags( 'x'.repeat( 50 ) ) ).toEqual( [ 'x'.repeat( 40 ) ] );
		expect( parseTags( Array.from( { length: 30 }, ( _, i ) => 't' + i ).join( ',' ) ) ).toHaveLength( 20 );
	} );

	it( 'builds the export link from the filters the export knows', () => {
		const base = 'https://site.test/wp-admin/admin-post.php?action=funnelforms_export_entries&_wpnonce=abc';
		const url = new URL( exportLink( base, { form: 3, leadStatus: 'won', search: 'x', archived: true }, 'excel' ) );
		expect( Object.fromEntries( url.searchParams ) ).toEqual( { action: 'funnelforms_export_entries', _wpnonce: 'abc', form: '3', leadStatus: 'won', archived: '1', format: 'excel' } );
		expect( new URL( exportLink( base, {}, 'csv' ) ).searchParams.get( 'archived' ) ).toBe( '0' );
	} );

	it( 'groups the board by the stages of the site; entries of an unknown stage join the first', () => {
		const groups = byLeadStatus( [ entry( 1, { leadStatus: 'offer' } ), entry( 2, { leadStatus: 'gone' } ), entry( 3, { leadStatus: 'won' } ) ], [ 'won', 'offer', 'new' ] );
		expect( Object.keys( groups ) ).toEqual( [ 'won', 'offer', 'new' ] );
		expect( groups.offer?.map( ( e ) => e.id ) ).toEqual( [ 1 ] );
		expect( groups.new?.map( ( e ) => e.id ) ).toEqual( [ 2 ] );
		expect( byLeadStatus( [ entry( 4, { leadStatus: 'x' } ) ], [ 'a', 'b' ] ).a?.map( ( e ) => e.id ) ).toEqual( [ 4 ] );
		expect( stateFromAddress( '?leadStatus=offer', [ 'new', 'offer' ] ).filter ).toEqual( { leadStatus: 'offer' } );
		expect( stateFromAddress( '?leadStatus=offer' ).filter ).toEqual( {} );
	} );

	it( 'moves, checks and sends back stages', () => {
		expect( moveStage( [ 'a', 'b', 'c' ], 0, 2 ) ).toEqual( [ 'b', 'c', 'a' ] );
		expect( moveStage( [ 'a', 'b', 'c' ], 2, -1 ) ).toEqual( [ 'a', 'c', 'b' ] );
		expect( moveStage( [ 'a', 'b' ], 0, -1 ) ).toEqual( [ 'a', 'b' ] );
		expect( moveStage( [ 'a', 'b' ], 5, 1 ) ).toEqual( [ 'a', 'b' ] );
		expect( stageNameProblem( '  ', [] ) ).toBe( 'empty' );
		expect( stageNameProblem( 'x'.repeat( 41 ), [] ) ).toBe( 'long' );
		expect( stageNameProblem( ' won ', [ 'New', 'Won' ] ) ).toBe( 'taken' );
		expect( stageNameProblem( 'Offer sent', [ 'New' ] ) ).toBe( '' );
		const stages = standardStages( ( k ) => k.toUpperCase() );
		expect( stages.map( ( s ) => [ s.key, s.name, s.tone, s.locked ] ) ).toEqual( [
			[ 'new', 'NEW', 'info', true ],
			[ 'contacted', 'CONTACTED', 'warning', false ],
			[ 'won', 'WON', 'success', false ],
			[ 'lost', 'LOST', 'neutral', false ],
		] );
		expect( stageInputs( [ { key: 'new', name: 'Inbox', tone: 'info', entries: 3, locked: true } ] ) ).toEqual( [ { key: 'new', name: 'Inbox', tone: 'info' } ] );
	} );

	it( 'groups the board by lead status and starts periods at midnight', () => {
		const groups = byLeadStatus( [ entry( 1 ), entry( 2, { leadStatus: 'won' } ), entry( 3 ) ] );
		expect( groups.new?.map( ( e ) => e.id ) ).toEqual( [ 1, 3 ] );
		expect( groups.won ).toHaveLength( 1 );
		const now = new Date( 2026, 9, 16, 15, 30 );
		expect( new Date( periodStart( '7d', now ) ?? '' ) ).toEqual( new Date( 2026, 9, 10 ) );
		expect( new Date( periodStart( 'today', now ) ?? '' ) ).toEqual( new Date( 2026, 9, 16 ) );
		expect( periodStart( '', now ) ).toBeUndefined();
		expect( filtered( { filter: { archived: true, page: 3 }, period: '', view: 'list', entry: null } ) ).toBe( false );
		expect( filtered( { filter: { tag: 'b2b' }, period: '', view: 'list', entry: null } ) ).toBe( true );
	} );

	it( 'says when an entry came in as people say it', () => {
		const now = new Date( 2026, 9, 19, 15, 0, 0 );
		const ago = ( ms: number ): string => new Date( now.getTime() - ms ).toISOString();
		expect( relativeTime( ago( 20000 ), now, 'en_US' ) ).toBe( 'now' );
		expect( relativeTime( ago( 5 * 60000 ), now, 'de_DE' ) ).toBe( 'vor 5 Min.' );
		expect( relativeTime( ago( 3 * 3600000 ), now, 'en_US' ) ).toBe( '3 hr. ago' );
		expect( relativeTime( new Date( 2026, 9, 18, 23, 0 ).toISOString(), now, 'de_DE' ) ).toBe( 'vor 16 Std.' );
		expect( relativeTime( new Date( 2026, 9, 18, 9, 0 ).toISOString(), now, 'de_DE' ) ).toBe( 'gestern' );
		expect( relativeTime( new Date( 2026, 9, 2, 9, 0 ).toISOString(), now, 'de_DE' ) ).toBe( '2. Okt.' );
		expect( relativeTime( new Date( 2025, 11, 24, 9, 0 ).toISOString(), now, 'de_DE' ) ).toBe( '24. Dez. 2025' );
		expect( relativeTime( null, now ) ).toBe( '' );
		expect( relativeTime( 'not a date', now ) ).toBe( '' );
	} );

	it( 'draws avatars from names and addresses', () => {
		expect( initials( 'Erika Muster' ) ).toBe( 'EM' );
		expect( initials( 'Anna Maria von Weber' ) ).toBe( 'AW' );
		expect( initials( 'élise' ) ).toBe( 'É' );
		expect( initials( 'max@example.org' ) ).toBe( 'M' );
		expect( initials( '  ' ) ).toBe( '' );
		expect( initials( 'Jo (Kunde)' ) ).toBe( 'JK' );
		expect( avatarTone( 'Erika Muster' ) ).toBe( avatarTone( 'Erika Muster' ) );
		const tones = new Set( [ 'Erika', 'Max', 'Mia', 'Jonas', 'Lea', 'Tom', 'Paul', 'Anna', 'Ben', 'Clara' ].map( avatarTone ) );
		expect( [ ...tones ].every( ( n ) => n >= 0 && n < 6 ) ).toBe( true );
		expect( tones.size ).toBeGreaterThan( 2 );
	} );

	it( 'asks the figures for the moments the period filter uses', () => {
		const now = new Date( 2026, 9, 19, 15, 30 );
		const m = figureMoments( now );
		expect( m.today ).toBe( periodStart( 'today', now ) );
		expect( m.week ).toBe( periodStart( '7d', now ) );
		expect( new Date( m.week ).getTime() - new Date( m.previous ).getTime() ).toBe( 7 * 86400000 );
		expect( change( 12, 8 ) ).toBe( 50 );
		expect( change( 5, 10 ) ).toBe( -50 );
		expect( change( 3, 0 ) ).toBeNull();
		expect( change( 3, null ) ).toBeNull();
	} );
} );
