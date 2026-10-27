import { describe, expect, it } from 'vitest';
import { weekStart, zoneName } from '../src/booking';

describe( 'weekStart', () => {
	it( 'starts the week on Monday in Europe and on Sunday in the US', () => {
		expect( weekStart( 'de_DE' ) ).toBe( 1 );
		expect( weekStart( 'fr-FR' ) ).toBe( 1 );
		expect( weekStart( 'en_US' ) ).toBe( 0 );
		expect( weekStart( 'pt-BR' ) ).toBe( 0 );
	} );

	it( 'falls back to Monday without a region', () => {
		expect( weekStart( 'de' ) ).toBe( 1 );
		expect( weekStart( undefined ) ).toBe( 1 );
		expect( weekStart( 'not a tag' ) ).toBe( 1 );
	} );
} );

describe( 'zoneName', () => {
	it( 'names a time zone as people read it, not by its database id', () => {
		expect( zoneName( 'Europe/Berlin', 'de-DE' ) ).toBe( 'Mitteleuropäische Zeit' );
		expect( zoneName( 'Europe/Berlin', 'en-US' ) ).toBe( 'Central European Time' );
		expect( zoneName( 'America/New_York', 'en-US' ) ).toBe( 'Eastern Time' );
	} );

	it( 'falls back to the city', () => {
		expect( zoneName( 'Not/A_Zone', 'de-DE' ) ).toBe( 'A Zone' );
		expect( zoneName( 'Asia/Kolkata', 'de-DE' ) ).not.toContain( '/' );
	} );
} );
