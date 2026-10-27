import { describe, expect, it } from 'vitest';
import { validateDocument } from '@funnelforms/form-schema';
import { abandonDefaults, consentBoxes, isoFromInput, localInput, paymentGaps } from '../src/ui/Settings';
import { addCalculation } from '../src/calculations';
import { blank } from './blank';

describe( 'form settings', () => {
	it( 'turn input times into ISO times with offset and back', () => {
		const iso = isoFromInput( '2026-03-29T02:30' );
		expect( iso ).toMatch( /^2026-03-29T0\d:30:00[+-]\d{2}:\d{2}$/ );
		expect( localInput( isoFromInput( '2026-11-01T09:05' ) ) ).toBe( '2026-11-01T09:05' );
		expect( isoFromInput( '' ) ).toBeUndefined();
		expect( localInput( 'not a time' ) ).toBe( '' );
		const doc = blank();
		doc.settings.access = { opensAt: isoFromInput( '2026-11-01T09:05' ), closesAt: '2026-12-01T10:00:00Z' };
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );

	it( 'name what the payment is missing', () => {
		const doc = blank();
		const payment = { connection: '', amount: { fixed: 0 }, currency: 'EUR', mode: 'payment' as const, description: { de_DE: 'Kurs' } };
		expect( paymentGaps( payment, doc ) ).toEqual( [ 'connection', 'amount' ] );
		const calc = addCalculation( doc, 'Preis' );
		expect( paymentGaps( { ...payment, connection: 'mollie:abc', amount: { calculation: calc } }, doc ) ).toEqual( [] );
		expect( paymentGaps( { ...payment, connection: 'mollie:abc', amount: { calculation: 'gone' } }, doc ) ).toEqual( [ 'amount' ] );
		doc.settings.payment = { ...payment, connection: 'mollie:abc', amount: { fixed: 12.5 } };
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );

	it( 'start reminders to visitors who leave with a safe basis', () => {
		const doc = blank();
		const eu = abandonDefaults( doc, true );
		expect( eu ).toMatchObject( { field: 'c_email', basis: 'consent', delayMinutes: 60, layout: 'branded' } );
		expect( eu?.consentField ).toBeUndefined();
		doc.settings.abandonment = eu ?? undefined;
		// Without a box the EU default cannot be published until one is chosen.
		expect( validateDocument( doc ).errors ).toEqual( [ 'abandonment refers to unknown consent field ' ] );

		const contact = doc.nodes[ 0 ];
		if ( contact && 'contact' === contact.type ) {
			contact.fields.push( { id: 'c_ok', key: 'ok', type: 'consent', label: { de_DE: '' }, required: false, props: { html: { de_DE: 'Erinnern Sie <b>mich</b>' } } } );
		}
		expect( consentBoxes( doc ) ).toEqual( [ { id: 'c_ok', label: 'Erinnern Sie mich' } ] );
		doc.settings.abandonment = abandonDefaults( doc, true ) ?? undefined;
		expect( doc.settings.abandonment?.consentField ).toBe( 'c_ok' );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		expect( abandonDefaults( doc, false ) ).toMatchObject( { basis: 'notice' } );
		expect( abandonDefaults( doc, false )?.consentField ).toBeUndefined();
		expect( abandonDefaults( { ...doc, nodes: [] }, true ) ).toBeNull();
	} );
} );
