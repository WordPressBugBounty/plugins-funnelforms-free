import { describe, expect, it } from 'vitest';
import type { ContactField, Field } from '@funnelforms/form-schema';
import { contactPrefill, isHiddenField, stepPrefill } from '../src/prefill';

const de = ( text: string ): Record<string, string> => ( { de_DE: text } );
const label = ( o: { label: Record<string, string> } ): string => o.label.de_DE ?? '';
const q = ( query: string ): URLSearchParams => new URLSearchParams( query );
const step = ( type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {} ): Field =>
	( { id: 'f', key: 'f', type, label: de( '' ), description: de( '' ), required: false, props: { placeholder: de( '' ), ...props }, ...extra } ) as unknown as Field;
const contact = ( type: string, props: Record<string, unknown> ): ContactField => ( { id: 'c', key: 'c', type, label: de( '' ), required: false, props } ) as ContactField;
const options = [
	{ id: 'o1', label: de( '<b>Wärmepumpe</b>' ), value: 'wp' },
	{ id: 'o2', label: de( 'Solar' ), value: 'Solar' },
	{ id: 'o3', label: de( 'Speicher' ), value: 'Speicher' },
];

describe( 'prefill from the page address', () => {
	it( 'fills text, numbers and typed fields only when the field asks for a parameter', () => {
		expect( stepPrefill( step( 'text', { prefillFromQuery: 'kundenname' } ), q( 'kundenname=Erika+Muster' ), label ) ).toBe( 'Erika Muster' );
		expect( stepPrefill( step( 'text', {} ), q( 'f=1' ), label ) ).toBeUndefined();
		expect( stepPrefill( step( 'text', { prefillFromQuery: 'a' } ), q( 'a=' ), label ) ).toBeUndefined();
		expect( stepPrefill( step( 'text', { prefillFromQuery: 'a', maxLength: 3 } ), q( 'a=abcdef' ), label ) ).toBe( 'abc' );
		expect( stepPrefill( step( 'number', { prefillFromQuery: 'n' } ), q( 'n=12,5' ), label ) ).toBe( 12.5 );
		expect( stepPrefill( step( 'number', { prefillFromQuery: 'n' } ), q( 'n=viel' ), label ) ).toBeUndefined();
		expect( stepPrefill( step( 'email', { prefillFromQuery: 'mail' } ), q( 'mail=a%40b.de' ), label ) ).toBe( 'a@b.de' );
		// Dates, sliders and the like are not filled.
		expect( stepPrefill( step( 'date', { prefillFromQuery: 'd', format: 'dd.mm.yy' } ), q( 'd=01.01.2027' ), label ) ).toBeUndefined();
	} );

	it( 'chooses options by id, value or label', () => {
		const single = step( 'choice', { prefillFromQuery: 'p', multiple: false }, { options } );
		expect( stepPrefill( single, q( 'p=o2' ), label ) ).toEqual( [ 'o2' ] );
		expect( stepPrefill( single, q( 'p=WP' ), label ) ).toEqual( [ 'o1' ] );
		expect( stepPrefill( single, q( 'p=w%C3%A4rmepumpe' ), label ) ).toEqual( [ 'o1' ] );
		expect( stepPrefill( single, q( 'p=Solar,Speicher' ), label ) ).toBeUndefined();
		expect( stepPrefill( single, q( 'p=Wind' ), label ) ).toBeUndefined();
		const multiple = step( 'dropdown', { prefillFromQuery: 'p', multiple: true, maxChoices: 2 }, { options } );
		expect( stepPrefill( multiple, q( 'p=speicher,%20wp,wind,solar' ), label ) ).toEqual( [ 'o3', 'o1' ] );
	} );

	it( 'fills contact fields: salutation, list, checkbox and text', () => {
		expect( contactPrefill( contact( 'salutation', { prefillFromQuery: 'anrede' } ), q( 'anrede=Frau' ), label ) ).toBe( 'female' );
		expect( contactPrefill( contact( 'salutation', { prefillFromQuery: 'anrede' } ), q( 'anrede=company' ), label ) ).toBe( 'company' );
		expect( contactPrefill( contact( 'salutation', { prefillFromQuery: 'anrede', allow: { diverse: false } } ), q( 'anrede=divers' ), label ) ).toBeUndefined();
		expect( contactPrefill( contact( 'select', { prefillFromQuery: 'l', options } ), q( 'l=solar' ), label ) ).toBe( 'o2' );
		expect( contactPrefill( contact( 'checkbox', { prefillFromQuery: 'nl' } ), q( 'nl=ja' ), label ) ).toBe( true );
		expect( contactPrefill( contact( 'checkbox', { prefillFromQuery: 'nl' } ), q( 'nl=nein' ), label ) ).toBeUndefined();
		// A consent is the visitor's own; the address never gives it.
		expect( contactPrefill( contact( 'consent', { prefillFromQuery: 'ok' } ), q( 'ok=1' ), label ) ).toBeUndefined();
		expect( contactPrefill( contact( 'text', { prefillFromQuery: 'kundennummer', hidden: true } ), q( 'kundennummer=123456' ), label ) ).toBe( '123456' );
	} );

	it( 'knows hidden fields', () => {
		expect( isHiddenField( contact( 'text', { hidden: true } ) ) ).toBe( true );
		expect( isHiddenField( contact( 'name', { hidden: true } ) ) ).toBe( false );
		expect( isHiddenField( contact( 'text', {} ) ) ).toBe( false );
	} );
} );
