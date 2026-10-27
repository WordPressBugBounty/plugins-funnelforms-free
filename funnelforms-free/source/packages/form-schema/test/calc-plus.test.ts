import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDocument, type FormDocument, type ResultField } from '../src/index';

function kitchenSink(): FormDocument {
	return JSON.parse( readFileSync( fileURLToPath( new URL( './examples/synthetic-kitchen-sink.json', import.meta.url ) ), 'utf8' ) ) as FormDocument;
}

/** Functions of 5.0 calculators, texts by range, the locked live result and the lead value. */
describe( 'calculator funnels', () => {
	it( 'accept the new functions and dates, texts by range and the lead value', () => {
		const doc = kitchenSink();
		const calc = doc.calculations[ 0 ];
		if ( ! calc ) {
			throw new Error( 'no calculation' );
		}
		calc.expression = {
			fn: 'lookup',
			args: [ { fn: 'clamp', args: [ { var: 'q1' }, { num: 0 }, { num: 100 } ] }, { num: 10 }, { fn: 'days', args: [ { date: 'd' }, { date: 'e' } ] }, { fn: 'age', args: [ { date: 'd' } ] } ],
		};
		calc.texts = [ { to: 40, text: { en_US: 'Beginner' } }, { from: 41, text: { en_US: 'Pro' } } ];
		doc.settings.valueCalculation = calc.id;
		const end = doc.nodes.find( ( n ) => n.type === 'end' );
		if ( end?.type !== 'end' ) {
			throw new Error( 'no end' );
		}
		end.success = { show: true, text: { en_US: 'You are a {{calc:' + calc.id + ':text}}' } };
		expect( validateDocument( doc ).errors ).toEqual( [] );

		calc.expression = { fn: 'lookup', args: [ { num: 1 }, { num: 2 }, { num: 3 } ] };
		doc.settings.valueCalculation = 'nope';
		end.success.text = { en_US: '{{calc:nope:text}}' };
		expect( validateDocument( doc ).errors ).toEqual( [ 'token refers to unknown calculation nope', 'lead value refers to unknown calculation nope', `calculation ${ calc.id } calls lookup with 3 arguments` ] );

		( calc as { texts: unknown } ).texts = [ { from: 1 } ];
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accept a live result that waits for the contact step and lines with the text of the range', () => {
		const doc = kitchenSink();
		const calc = doc.calculations[ 0 ]?.id ?? '';
		const step = doc.nodes.find( ( n ) => n.id === doc.start );
		if ( step?.type !== 'step' ) {
			throw new Error( 'no first step' );
		}
		const field: ResultField = {
			id: 'r1',
			key: 'r1',
			type: 'result',
			label: { en_US: 'Your price' },
			description: { en_US: '' },
			required: false,
			props: {
				style: 'card',
				lines: [
					{ calculation: calc, label: { en_US: 'Total' } },
					{ calculation: calc, label: { en_US: 'Level' }, text: true },
				],
				reveal: 'contact',
				teaser: { en_US: 'Your result is ready.' },
			},
		};
		step.fields.push( field );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		( field.props as { reveal: string } ).reveal = 'never';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );
} );
