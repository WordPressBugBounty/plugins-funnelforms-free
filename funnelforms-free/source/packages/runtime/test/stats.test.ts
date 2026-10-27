import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/api';
import { setPrivacy } from '../src/consent';
import { Stats, VISITOR_KEY } from '../src/stats';

describe( 'statistics batches', () => {
	it( 'sends at most 30 events per request, the plugin takes no more', () => {
		const events = vi.fn( async () => undefined );
		const stats = new Stats( { events } as unknown as Api );
		stats.answer( 'q1', Array.from( { length: 45 }, ( _, i ) => 'o' + i ) );
		stats.answer( 'q1', [ 'o99' ] );
		stats.answer( 'q2', [] );
		stats.flush();
		const sizes = ( events.mock.calls as unknown as Array<[ string, unknown[] ]> ).map( ( c ) => c[ 1 ].length );
		expect( sizes ).toEqual( [ 30, 15 ] );
	} );
} );

describe( 'traffic sources', () => {
	it( 'sends the address the visitor came from and the query of the page with the view, once', () => {
		window.history.replaceState( null, '', '/?utm_source=ads&utm_medium=cpc&utm_campaign=Herbst' );
		const events = vi.fn( async () => undefined );
		const stats = new Stats( { events } as unknown as Api );
		stats.record( 'view' );
		stats.record( 'view' );
		stats.flush();
		expect( ( events.mock.calls as unknown as Array<[ string, unknown[] ]> )[ 0 ]?.[ 1 ] ).toEqual( [
			{ event: 'source', step: '', variant: '?utm_source=ads&utm_medium=cpc&utm_campaign=Herbst' },
			{ event: 'view', step: '' },
		] );
		window.history.replaceState( null, '', '/' );
	} );

	it( 'sends nothing more for a direct visit, and nothing at all in previews', () => {
		const events = vi.fn( async () => undefined );
		const stats = new Stats( { events } as unknown as Api );
		stats.record( 'view' );
		stats.flush();
		expect( ( events.mock.calls as unknown as Array<[ string, unknown[] ]> )[ 0 ]?.[ 1 ] ).toEqual( [ { event: 'view', step: '' } ] );

		window.history.replaceState( null, '', '/?utm_source=ads' );
		const none = vi.fn( async () => undefined );
		const preview = new Stats( { events: none } as unknown as Api, false );
		preview.record( 'view' );
		preview.answer( 'q1', [ 'o1' ] );
		preview.flush();
		expect( none ).not.toHaveBeenCalled();
		window.history.replaceState( null, '', '/' );
	} );
} );

describe( 'paths and checks', () => {
	it( 'sends a step once per node and node before it, and a stopping field once', () => {
		const events = vi.fn( async () => undefined );
		const stats = new Stats( { events } as unknown as Api );
		stats.record( 'step', 'n1', '' );
		stats.record( 'step', 'n2', 'n1' );
		stats.record( 'step', 'n2', 'n1' );
		// The same step reached on another way is another path.
		stats.record( 'step', 'n2', 'n3' );
		stats.record( 'invalid', 'q1' );
		stats.record( 'invalid', 'q1' );
		// Without the extended level the input into fields is not counted.
		stats.field( 'q1' );
		stats.flush();
		expect( events ).toHaveBeenCalledWith( stats.sid, [
			{ event: 'step', step: 'n1', variant: '' },
			{ event: 'step', step: 'n2', variant: 'n1' },
			{ event: 'step', step: 'n2', variant: 'n3' },
			{ event: 'invalid', step: 'q1' },
		], false, false );
	} );
} );

describe( 'extended level', () => {
	const visible = (): void => {
		vi.stubGlobal( 'IntersectionObserver', class {
			constructor( private readonly callback: ( entries: Array<{ isIntersecting: boolean }> ) => void ) {}
			observe(): void {
				this.callback( [ { isIntersecting: true } ] );
			}
			disconnect(): void {}
		} );
	};

	afterEach( () => {
		setPrivacy();
		vi.unstubAllGlobals();
		localStorage.clear();
	} );

	it( 'is decided with the view and flags every batch of that page view', () => {
		visible();
		setPrivacy( 'global' );
		vi.stubGlobal( 'innerWidth', 800 );
		const events = vi.fn( async () => undefined );
		const stats = new Stats( { events } as unknown as Api );
		stats.field( 'q1' );
		stats.viewWhenVisible( document.body );
		stats.field( 'q1' );
		stats.field( 'q1' );
		stats.flush();
		const calls = events.mock.calls as unknown as Array<[ string, Array<{ event: string; step: string }>, boolean, boolean ]>;
		expect( calls[ 0 ]?.[ 1 ].map( ( e ) => `${ e.event }:${ e.step }` ) ).toEqual( [ 'device:tablet', `visitor:${ stats.sid }`, 'view:', 'field:q1' ] );
		expect( calls[ 0 ]?.[ 3 ] ).toBe( true );
		expect( localStorage.getItem( VISITOR_KEY ) ).toMatch( new RegExp( `^${ stats.sid }\\.\\d+$` ) );
	} );

	it( 'counts the view without a visitor where storage is blocked', () => {
		visible();
		setPrivacy( 'global' );
		const blocked = (): never => {
			throw new Error( 'blocked' );
		};
		vi.stubGlobal( 'localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked } );
		const events = vi.fn( async () => undefined );
		const stats = new Stats( { events } as unknown as Api );
		stats.viewWhenVisible( document.body );
		stats.flush();
		const calls = events.mock.calls as unknown as Array<[ string, Array<{ event: string }> ]>;
		expect( calls[ 0 ]?.[ 1 ].map( ( e ) => e.event ) ).toEqual( [ 'device', 'view' ] );
	} );
} );
