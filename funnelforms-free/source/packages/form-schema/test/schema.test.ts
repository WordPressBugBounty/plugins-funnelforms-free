import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, type Action, type Condition, type FormDocument, type RatingField, type ResultField, type TextField } from '../src/index';

const examplesDir = fileURLToPath( new URL( './examples', import.meta.url ) );

function load( name: string ): FormDocument {
	return JSON.parse( readFileSync( join( examplesDir, name ), 'utf8' ) ) as FormDocument;
}

describe( 'form schema v1', () => {
	const files = readdirSync( examplesDir ).filter( ( f: string ) => f.endsWith( '.json' ) );

	const first = (): string => {
		const [ file ] = files;
		if ( file === undefined ) {
			throw new Error( 'no examples' );
		}
		return file;
	};

	it( 'has example documents', () => {
		expect( files.length ).toBeGreaterThan( 0 );
	} );

	it.each( files )( '%s is valid', ( file: string ) => {
		const result = validateDocument( load( file ) );
		expect( result.errors ).toEqual( [] );
		expect( result.valid ).toBe( true );
	} );

	it( 'rejects edges to unknown nodes and unknown options', () => {
		const doc = load( first() );
		doc.edges.push( { id: 'broken', from: doc.start, to: 'nowhere' } );
		doc.edges.push( {
			id: 'broken2',
			from: doc.start,
			to: doc.start,
			when: { field: 'nope', op: 'selected', value: 'x' },
		} );
		const result = validateDocument( doc );
		expect( result.valid ).toBe( false );
		expect( result.errors ).toContain( 'edge broken connects unknown nodes' );
		expect( result.errors ).toContain( 'edge broken2 refers to unknown field nope' );
	} );

	it( 'accepts fields shown on earlier answers and rejects broken or calculated ones', () => {
		const doc = load( first() );
		const step = doc.nodes.find( ( n ) => n.type === 'step' );
		if ( step?.type !== 'step' || ! step.fields[ 0 ] ) {
			throw new Error( 'no step' );
		}
		const asked = step.fields[ 0 ].id;
		const shown: TextField = { id: 'shown', key: 'shown', type: 'text', label: {}, description: {}, required: true, props: { placeholder: {} }, showWhen: { any: [ { field: asked, op: 'filled' }, { experiment: 'nope', variant: 'a' } ] } };
		step.fields.push( shown );
		expect( validateDocument( doc ).errors ).toEqual( [ 'field shown refers to unknown experiment nope' ] );
		shown.showWhen = { field: asked, op: 'filled' };
		expect( validateDocument( doc ).errors ).toEqual( [] );
		shown.showWhen = { all: [ { field: 'shown', op: 'filled' }, { calc: 'x', op: 'gt', value: 1 } ] };
		expect( validateDocument( doc ).errors ).toEqual( [ 'field shown refers to unknown calculation x', 'field shown is shown by a calculation', 'field shown is shown by its own answer' ] );
		( shown as unknown as Record<string, unknown> ).showWhen = { field: asked };
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'checks what the condition of an action asks for and accepts the mail layouts', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const mail = doc.actions.find( ( a ) => a.kind === 'email' );
		if ( mail?.kind !== 'email' ) {
			throw new Error( 'no mail' );
		}
		mail.config.layout = 'branded';
		mail.when = { any: [ { field: 'c_email', op: 'endsWith', value: '.org' }, { field: 'q2', op: 'selected', value: 'q2_o0' } ] };
		expect( validateDocument( doc ).errors ).toEqual( [] );
		mail.when = { field: 'gone', op: 'filled' };
		expect( validateDocument( doc ).errors ).toEqual( [ `action ${ mail.id } refers to unknown field gone` ] );
		( mail.config as unknown as Record<string, unknown> ).layout = 'fancy';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'rejects unknown properties', () => {
		const doc = load( first() ) as unknown as Record<string, unknown>;
		doc.surprise = true;
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts a retention period of whole days', () => {
		const doc = load( first() );
		doc.settings.retentionDays = 90;
		expect( validateDocument( doc ).valid ).toBe( true );
		doc.settings.retentionDays = 0;
		expect( validateDocument( doc ).valid ).toBe( false );
		doc.settings.retentionDays = 1.5;
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts access rules with a time window in ISO 8601', () => {
		const doc = load( first() );
		doc.settings.access = { password: { hash: '$P$Bhash' }, maxEntries: 50, opensAt: '2026-11-01T08:00:00Z', closesAt: '2026-11-30T18:00:00+01:00' };
		expect( validateDocument( doc ).valid ).toBe( true );
		doc.settings.access = { closesAt: '30.11.2026' };
		expect( validateDocument( doc ).valid ).toBe( false );
		doc.settings.access = { maxEntries: 0 };
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts the conditions of the shared cases and rejects broken ones', () => {
		const shared = JSON.parse( readFileSync( fileURLToPath( new URL( '../../form-core/test/conditions.json', import.meta.url ) ), 'utf8' ) ) as { cases: Array<{ condition: Condition }> };
		const doc = load( first() );
		const edge = doc.edges[ 0 ] as FormDocument[ 'edges' ][ number ];
		for ( const c of shared.cases ) {
			edge.when = c.condition;
			// The cases ask for fields f, g and h, which the example does not have.
			expect( validateDocument( doc ).errors.filter( ( e ) => ! / unknown field [fgh]$/.test( e ) ), JSON.stringify( c.condition ) ).toEqual( [] );
		}
		for ( const broken of [
			{ field: 'f', op: 'dateOn', value: '24.12.2026' },
			{ field: 'f', op: 'contains', value: 'x', part: 'floor' },
			{ field: 'f', op: 'filled', value: 'x' },
			{ field: 'f', op: 'gte', value: 1, number: 'many' },
		] ) {
			edge.when = broken as unknown as Condition;
			expect( validateDocument( doc ).errors.filter( ( e ) => ! / unknown field [fgh]$/.test( e ) ), JSON.stringify( broken ) ).not.toEqual( [] );
		}
	} );

	it( 'accepts a time limit of whole minutes up to a day', () => {
		const doc = load( first() );
		doc.settings.timeLimit = { minutes: 15, message: { de_DE: 'Zu spät' } };
		expect( validateDocument( doc ).valid ).toBe( true );
		doc.settings.timeLimit = { minutes: 1441 };
		expect( validateDocument( doc ).valid ).toBe( false );
		doc.settings.timeLimit = { minutes: 0.5 };
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts the field types of 5.0', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const step = doc.nodes.find( ( node ) => node.type === 'step' );
		if ( ! step || step.type !== 'step' ) {
			throw new Error( 'no step' );
		}
		const base = { label: { en_US: 'Q' }, description: {}, required: false };
		step.fields.push(
			{ ...base, id: 'f_email', key: 'f_email', type: 'email', props: { placeholder: {}, b2bOnly: true } },
			{ ...base, id: 'f_phone', key: 'f_phone', type: 'phone', props: { placeholder: {} } },
			{ ...base, id: 'f_url', key: 'f_url', type: 'url', props: { placeholder: {} } },
			{ ...base, id: 'f_number', key: 'f_number', type: 'number', props: { placeholder: {}, min: 0, max: 100, step: 0.5, unit: { text: { en_US: 'm²' }, position: 'after' } } },
			{ ...base, id: 'f_time', key: 'f_time', type: 'time', props: { min: '08:00', max: '18:30', stepMinutes: 15 } },
			{ ...base, id: 'f_rating', key: 'f_rating', type: 'rating', props: { min: 0, max: 10, style: 'numbers', lowLabel: { en_US: 'Unlikely' }, highLabel: {} } },
			{ ...base, id: 'f_sign', key: 'f_sign', type: 'signature', props: { clearLabel: {}, typeLabel: { en_US: 'Or type your name' } } }
		);
		expect( validateDocument( doc ).errors ).toEqual( [] );

		const rating = step.fields.at( -2 );
		if ( rating?.type !== 'rating' ) {
			throw new Error( 'no rating' );
		}
		rating.props.max = 11;
		expect( validateDocument( doc ).valid ).toBe( false );
		rating.props.max = 5;
		const time = step.fields.at( -3 );
		if ( time?.type !== 'time' ) {
			throw new Error( 'no time' );
		}
		time.props.min = '8:00';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts the settings of answers from Funnelforms 4', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const step = doc.nodes.find( ( node ) => node.type === 'step' );
		if ( ! step || step.type !== 'step' ) {
			throw new Error( 'no step' );
		}
		const base = { label: { en_US: 'Q' }, description: {}, required: false, options: [ { id: 'a', label: { en_US: 'A' }, value: 'a' } ] };
		step.fields.push(
			{ ...base, id: 'f_tiles', key: 'f_tiles', type: 'choice', props: { multiple: true, layout: { desktop: 'grid', mobile: 'grid' }, hideIcons: false, minChoices: 1, maxChoices: 2, columns: { desktop: 4, mobile: 1 }, iconPosition: 'right', size: 's', imageFull: true } },
			{ ...base, id: 'f_pick', key: 'f_pick', type: 'dropdown', props: { placeholder: { en_US: 'Pick' }, search: true, multiple: true, minChoices: 1, maxChoices: 3 } }
		);
		expect( validateDocument( doc ).errors ).toEqual( [] );
		const tiles = step.fields.at( -2 );
		if ( tiles?.type !== 'choice' ) {
			throw new Error( 'no choice' );
		}
		( tiles.props.columns as Record<string, number> ).mobile = 3;
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts periods, date limits and range sliders', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const step = doc.nodes.find( ( node ) => node.type === 'step' );
		if ( ! step || step.type !== 'step' ) {
			throw new Error( 'no step' );
		}
		const base = { label: { en_US: 'Q' }, description: {}, required: false };
		step.fields.push(
			{ ...base, id: 'f_when', key: 'f_when', type: 'date', props: { placeholder: {}, format: 'dd.mm.yy', range: true, allow: 'future', min: '2026-01-01', max: '2027-12-31' } },
			{ ...base, id: 'f_budget', key: 'f_budget', type: 'slider', props: { min: 0, max: 100000, step: 500, start: 1000, startEnd: 50000, range: true, separator: "'", unit: { text: {}, position: 'after' }, thousandsSeparator: true, manualInput: { enabled: true, label: {} } } }
		);
		expect( validateDocument( doc ).errors ).toEqual( [] );
		const when = step.fields.at( -2 );
		if ( when?.type !== 'date' ) {
			throw new Error( 'no date' );
		}
		when.props.min = '1.1.2026';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts colour scales, faces and own texts of points', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const step = doc.nodes.find( ( node ) => node.type === 'step' );
		if ( ! step || step.type !== 'step' ) {
			throw new Error( 'no step' );
		}
		const scale: RatingField = { id: 'f_scale', key: 'f_scale', label: { en_US: 'Q' }, description: {}, required: false, type: 'rating', props: { min: 1, max: 3, style: 'colors', lowLabel: {}, highLabel: {}, show: 'labels', labels: [ { en_US: 'Bad' }, {}, { en_US: 'Good' } ] } };
		step.fields.push( scale );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		( scale.props as Record<string, unknown> ).show = 'icons';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts lists, long texts and boxes to tick in contact steps, and their look', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const contact = doc.nodes.find( ( node ) => node.type === 'contact' );
		if ( ! contact || contact.type !== 'contact' ) {
			throw new Error( 'no contact step' );
		}
		contact.layout = { columns: { desktop: 2, mobile: 1 }, hideLabels: true, inputHeight: 44, button: { size: 'l', align: 'full' } };
		contact.fields.push(
			{ id: 'c_topic', key: 'topic', type: 'select', label: { en_US: 'Topic' }, required: true, props: { options: [ { id: 'o1', label: { en_US: 'A' } } ] } },
			{ id: 'c_note', key: 'note', type: 'textarea', label: { en_US: 'Note' }, required: false, props: {} },
			{ id: 'c_news', key: 'news', type: 'checkbox', label: {}, required: false, props: { html: { en_US: 'News' } } }
		);
		expect( validateDocument( doc ).errors ).toEqual( [] );
		contact.layout.inputHeight = 300;
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts images, videos and more loading screens in content fields', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const field = doc.nodes.flatMap( ( node ) => ( node.type === 'step' ? node.fields : [] ) ).find( ( f ) => f.type === 'content' );
		if ( field?.type !== 'content' ) {
			throw new Error( 'no content field' );
		}
		field.props.media = { kind: 'video', url: '', caption: { en_US: 'Film' }, width: 60 };
		field.props.button.show = false;
		field.props.autoAdvanceMs = 3000;
		field.props.loader = { style: 'circle', messages: [] };
		expect( validateDocument( doc ).errors ).toEqual( [] );
		field.props.media.url = 'javascript:alert(1)';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts file types, hints and previews of uploads and the ink and picture of signatures', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const step = doc.nodes.find( ( node ) => node.type === 'step' );
		if ( ! step || step.type !== 'step' ) {
			throw new Error( 'no step' );
		}
		const base = { label: { en_US: 'Q' }, description: {}, required: false };
		const file = { ...base, id: 'f_file', key: 'f_file', type: 'file' as const, props: { dropzoneText: {}, maxSizeMb: 5, maxFiles: 2, deniedMimeTypes: [], visibility: 'private' as const, allowedExtensions: [ 'pdf', 'jpg' ], hint: { en_US: 'PDF or JPG' }, preview: true } };
		const sign = { ...base, id: 'f_sign', key: 'f_sign', type: 'signature' as const, props: { clearLabel: {}, typeLabel: {}, penColor: '#1d3a8a', upload: true } };
		step.fields.push( file, sign );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		file.props.allowedExtensions = [ '.PDF' ];
		expect( validateDocument( doc ).valid ).toBe( false );
		file.props.allowedExtensions = [ 'pdf' ];
		sign.props.penColor = 'blue';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts autofill of text fields and the location button of addresses', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const step = doc.nodes.find( ( node ) => node.type === 'step' );
		if ( ! step || step.type !== 'step' ) {
			throw new Error( 'no step' );
		}
		const base = { label: { en_US: 'Q' }, description: {}, required: false };
		const text: TextField = { ...base, id: 'f_zip', key: 'f_zip', type: 'text', props: { placeholder: {}, restrict: 'digits', autocomplete: 'postal-code' } };
		step.fields.push(
			text,
			{ ...base, id: 'f_note', key: 'f_note', type: 'textarea', props: { placeholder: {}, autocomplete: 'street-address' } },
			{ ...base, id: 'f_where', key: 'f_where', type: 'address', props: { zoom: 12, start: { name: '', lat: 52.5, lng: 13.4 }, combined: true, showCountry: false, placesAutocomplete: true, locate: true } }
		);
		expect( validateDocument( doc ).errors ).toEqual( [] );
		( text.props as Record<string, unknown> ).autocomplete = 'credit-card';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts thank-you pages with heading, animation, downloads, a button and a redirect countdown', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.nodes.push( {
			id: 'thanks',
			type: 'end',
			success: {
				show: true,
				text: { en_US: 'Thanks' },
				heading: { en_US: 'Done' },
				animation: 'confetti',
				button: { label: { en_US: 'Shop' }, url: { en_US: 'https://example.org/shop' }, newTab: true },
				downloads: [ { label: { en_US: 'Prices' }, url: 'https://example.org/prices.pdf' } ],
				showAnswers: true,
			},
			redirect: { url: { en_US: 'https://example.org' }, newTab: false, delayMs: 3000, params: [], countdown: true },
		} );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		const end = doc.nodes.at( -1 );
		if ( end?.type !== 'end' || ! end.success?.downloads?.[ 0 ] ) {
			throw new Error( 'no end' );
		}
		end.success.downloads[ 0 ].url = 'javascript:alert(1)';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts PDF settings and PDF attachments of mails', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.pdf = { title: { en_US: 'Offer {{entry:id}}' }, intro: {}, footer: {}, showAnswers: false, showContact: true, showCalculations: true };
		for ( const action of doc.actions ) {
			if ( action.kind === 'email' ) {
				action.config.attachPdf = true;
			}
		}
		expect( validateDocument( doc ).errors ).toEqual( [] );
		( doc.pdf as unknown as Record<string, unknown> ).logo = 'x';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts repeat groups of simple fields', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const step = doc.nodes.find( ( node ) => node.type === 'step' );
		if ( ! step || step.type !== 'step' ) {
			throw new Error( 'no step' );
		}
		const base = { label: { en_US: 'Q' }, description: {}, required: true };
		const group = {
			...base,
			id: 'f_people',
			key: 'f_people',
			type: 'repeat' as const,
			props: {
				minItems: 1,
				maxItems: 5,
				addLabel: { en_US: 'Add person' },
				itemLabel: { en_US: 'Person %d' },
				fields: [
					{ ...base, id: 'name', key: 'name', type: 'text' as const, props: { placeholder: {} } },
					{ ...base, id: 'age', key: 'age', type: 'number' as const, props: { placeholder: {}, min: 0 } },
				],
			},
		};
		step.fields.push( group );
		expect( validateDocument( doc ).errors ).toEqual( [] );

		group.props.fields.push( { ...base, id: 'name', key: 'name2', type: 'text' as const, props: { placeholder: {} } } );
		expect( validateDocument( doc ).errors ).toEqual( [ 'duplicate field id name in repeat group f_people' ] );
		group.props.fields.pop();

		// Only simple fields: no file uploads or nested groups inside a group.
		( group.props.fields as unknown[] ).push( { ...base, id: 'sign', key: 'sign', type: 'signature', props: { clearLabel: {}, typeLabel: {} } } );
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts conditions on calculations and a score calculation', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const calc = doc.calculations[ 0 ]?.id ?? '';
		doc.edges.unshift( { id: 'e_score', from: doc.start, to: 'n2_0', when: { calc, op: 'gte', value: 10 } } );
		doc.settings.scoreCalculation = calc;
		expect( validateDocument( doc ).errors ).toEqual( [] );

		doc.edges[ 0 ] = { id: 'e_score', from: doc.start, to: 'n2_0', when: { calc: 'nope', op: 'gte', value: 10 } };
		doc.settings.scoreCalculation = 'nope';
		expect( validateDocument( doc ).errors ).toEqual( [ 'edge e_score refers to unknown calculation nope', 'score refers to unknown calculation nope' ] );
	} );

	it( 'accepts live results that refer to what exists', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
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
				style: 'sticky',
				lines: [ { calculation: calc, to: calc, label: { en_US: 'Total' }, from: true, prefix: '', suffix: ' €' } ],
				disclaimer: { en_US: 'Estimate' },
			},
		};
		step.fields.push( field );
		expect( validateDocument( doc ).errors ).toEqual( [] );

		field.props = { style: 'card', lines: [ { calculation: 'nope', label: { en_US: '' } } ] };
		expect( validateDocument( doc ).errors ).toEqual( [ 'field r1 refers to unknown calculation nope' ] );
		( field.props as { style: string } ).style = 'floating';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts Slack and Teams messages', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.actions.push( {
			id: 'a_chat',
			on: 'submit',
			kind: 'chat',
			config: { service: 'teams', connectionRef: 'teams:x', message: { en_US: 'New lead {{field:email}}' }, showAnswers: true, showContact: false },
		} );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		// The webhook address belongs in the connection, not in the document.
		( doc.actions.at( -1 )?.config as Record<string, unknown> ).url = 'https://hooks.slack.com/services/x';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts double opt-in on an e-mail contact field', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.settings.doubleOptIn = { field: 'c_email', subject: { en_US: 'Please confirm' }, body: { en_US: 'Click {{confirm_url}}' }, confirmation: { en_US: '<p>Thanks</p>' } };
		expect( validateDocument( doc ).errors ).toEqual( [] );
		doc.settings.doubleOptIn.field = 'q1';
		expect( validateDocument( doc ).errors ).toEqual( [ 'double opt-in refers to unknown e-mail field q1' ] );
	} );

	it( 'accepts reminders to visitors who leave, with notice or consent', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.settings.abandonment = { field: 'c_email', basis: 'notice', delayMinutes: 60, subject: { en_US: 'Still interested?' }, body: { en_US: 'Continue: {{resume_url}}' }, layout: 'branded' };
		expect( validateDocument( doc ).errors ).toEqual( [] );
		doc.settings.abandonment.basis = 'consent';
		expect( validateDocument( doc ).errors ).toEqual( [ 'abandonment refers to unknown consent field ' ] );
		doc.settings.abandonment.field = 'q1';
		doc.settings.abandonment.consentField = 'c_email';
		expect( validateDocument( doc ).errors ).toEqual( [ 'abandonment refers to unknown e-mail field q1', 'abandonment refers to unknown consent field c_email' ] );
		doc.settings.abandonment.delayMinutes = 5;
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts text messages through the customer\'s SMS provider', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.actions.push( {
			id: 'a_sms',
			on: 'submit',
			kind: 'sms',
			config: { connectionRef: 'twilio:x', to: { en_US: '+4917012345678, {{field:phone}}' }, sender: 'Funnel', message: { en_US: 'New lead' }, countryCode: '49' },
		} );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		( doc.actions.at( -1 )?.config as Record<string, unknown> ).countryCode = '+49';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts WhatsApp template messages', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.actions.push( {
			id: 'a_whatsapp',
			on: 'submit',
			kind: 'whatsapp',
			config: { connectionRef: 'whatsapp:x', to: { en_US: '+4917012345678' }, template: 'new_lead', language: 'de', parameters: [ { en_US: '{{field:email}}' } ] },
		} );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		( doc.actions.at( -1 )?.config as Record<string, unknown> ).template = 'New Lead';
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts server-side conversions with a value from a calculation', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const calc = doc.calculations[ 0 ]?.id ?? '';
		doc.actions.push( {
			id: 'a_meta',
			on: 'submit',
			kind: 'conversion',
			config: { platform: 'meta', connectionRef: 'meta:x', eventName: '', valueCalculation: calc, currency: 'EUR', requireConsent: true },
		} );
		expect( validateDocument( doc ).errors ).toEqual( [] );
		doc.actions.push( {
			id: 'a_ga4',
			on: 'submit',
			kind: 'conversion',
			config: { platform: 'ga4', connectionRef: 'ga4:x', eventName: 'generate_lead', valueCalculation: 'nope', requireConsent: false },
		} );
		expect( validateDocument( doc ).errors ).toEqual( [ 'action a_ga4 refers to unknown calculation nope' ] );
	} );

	it( 'accepts A/B tests of whole funnels and single steps', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.experiments = [
			{ id: 'x_start', name: 'Start', status: 'running', variants: [ { id: 'a', label: 'Original', weight: 50 }, { id: 'b', weight: 50, start: 'n1_0' } ] },
			{ id: 'x_step', status: 'stopped', winner: 'b', variants: [ { id: 'a', weight: 1 }, { id: 'b', weight: 1 } ] },
		];
		doc.edges.unshift( { id: 'e_ab', from: doc.start, to: 'n2_0', when: { experiment: 'x_step', variant: 'b' } } );
		expect( validateDocument( doc ).errors ).toEqual( [] );

		doc.experiments.push( { id: 'x_start', status: 'running', winner: 'c', variants: [ { id: 'a', weight: 0, start: 'nope' }, { id: 'a', weight: 0 } ] } );
		doc.edges.unshift( { id: 'e_ab2', from: doc.start, to: 'n2_0', when: { experiment: 'x_step', variant: 'c' } } );
		doc.edges.unshift( { id: 'e_ab3', from: doc.start, to: 'n2_0', when: { any: [ { experiment: 'nope', variant: 'a' } ] } } );
		expect( validateDocument( doc ).errors ).toEqual( [
			'duplicate experiment id x_start',
			'experiment x_start starts variant a at unknown node nope',
			'duplicate variant id a in experiment x_start',
			'experiment x_start has no variant c',
			'experiment x_start has no variant with a weight',
			'experiments x_start and x_start both set start nodes',
			'edge e_ab3 refers to unknown experiment nope',
			'edge e_ab2 refers to unknown variant c of experiment x_step',
		] );

		// Variant ids end up in a short column of the statistics.
		doc.experiments = [ { id: 'x', status: 'running', variants: [ { id: 'a'.repeat( 33 ), weight: 1 }, { id: 'b', weight: 1 } ] } ];
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts entries on the website with suitable fields only', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.settings.publicEntries = { fields: [ 'q1', 'q2' ], approval: true, shortNames: true, showDate: true, perPage: 10 };
		expect( validateDocument( doc ).errors ).toEqual( [] );
		doc.settings.publicEntries = { fields: [ 'q1', 'c_email', 'nope' ], approval: false, consentField: 'q2' };
		expect( validateDocument( doc ).errors ).toEqual( [
			'public entries show unknown or unsuitable field c_email',
			'public entries show unknown or unsuitable field nope',
			'public entries refer to unknown consent field q2',
		] );
		doc.settings.publicEntries = { fields: [], approval: false };
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts loading screens that move on by themselves', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const step = doc.nodes.find( ( n ) => n.id === 'n1_1' );
		const field = step?.type === 'step' ? step.fields[ 0 ] : undefined;
		if ( field?.type !== 'content' ) {
			throw new Error( 'n1_1 holds a content field' );
		}
		field.props = { ...field.props, autoAdvanceMs: 3000, button: { show: false, label: {} }, loader: { style: 'bar', messages: [ { en_US: 'Calculating…' } ] } };
		expect( validateDocument( doc ).errors ).toEqual( [] );
		field.props.button.show = true;
		expect( validateDocument( doc ).errors ).toEqual( [ `field ${ field.id } shows a loader but does not move on by itself` ] );
	} );

	it( 'checks the countries and the text message of phone fields', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		const contact = doc.nodes.find( ( n ) => n.type === 'contact' );
		if ( contact?.type !== 'contact' ) {
			throw new Error( 'The example has a contact step' );
		}
		contact.fields.push( { id: 'c_phone', type: 'phone', key: 'phone', label: { en_US: 'Mobile' }, required: true, props: { placeholder: { en_US: '' }, country: { default: 'DE', preferred: [ 'DE', 'AT' ] }, sms: { connectionRef: 'twilio:x', text: { en_US: 'Code {{code}}' } } } } );
		const step = doc.nodes.find( ( n ) => n.type === 'step' );
		if ( step?.type !== 'step' ) {
			throw new Error( 'The example has a step' );
		}
		step.fields.push( { id: 'q_phone', type: 'phone', key: 'q_phone', label: { en_US: 'Phone' }, description: {}, required: false, props: { placeholder: {}, country: { allowed: [ 'CH' ] } } } );
		expect( validateDocument( doc ).errors ).toEqual( [] );

		( contact.fields.at( -1 )?.props as { country: { allowed?: string[] } } ).country.allowed = [ 'AT' ];
		( contact.fields.at( -1 )?.props as { sms: { connectionRef: string } } ).sms.connectionRef = '';
		expect( validateDocument( doc ).errors ).toEqual( [ 'field c_phone starts with a country it does not allow', 'field c_phone confirms numbers by text message without an SMS connection' ] );

		const field = step.fields.at( -1 );
		if ( field?.type !== 'phone' ) {
			throw new Error( 'q_phone is a phone field' );
		}
		field.props.country = { default: 'germany' };
		expect( validateDocument( doc ).valid ).toBe( false );
	} );

	it( 'accepts payments that refer to what exists', () => {
		const doc = load( 'synthetic-kitchen-sink.json' );
		doc.actions = [ { ...( doc.actions[ 0 ] as Action ), on: 'paid' } ];
		expect( validateDocument( doc ).errors ).toEqual( [ `action ${ doc.actions[ 0 ]?.id } waits for a payment but the form takes none` ] );
		doc.settings.payment = { connection: 'stripe:abc', amount: { calculation: 'calc50' }, currency: 'EUR', mode: 'payment', description: { en_US: 'Order' }, emailField: 'c_email', node: 'n2_0' };
		expect( validateDocument( doc ).errors ).toEqual( [] );
		doc.settings.payment = { connection: 'mollie:abc', amount: { calculation: 'nope' }, currency: 'EUR', mode: 'subscription', description: { en_US: 'Order' }, emailField: 'q1', node: 'n1_2' };
		expect( validateDocument( doc ).errors ).toEqual( [
			'payment refers to unknown calculation nope',
			'payment refers to unknown e-mail field q1',
			'payment refers to unknown contact node n1_2',
			'subscription payment needs an interval',
			'subscription payment needs a Stripe connection',
		] );
		doc.settings.payment = { connection: 'stripe:abc', amount: { fixed: 49 }, currency: 'EUR', mode: 'deposit', description: {} };
		expect( validateDocument( doc ).errors ).toEqual( [ 'deposit payment needs depositPercent' ] );
		// Amounts above 0, a currency code and a known provider.
		doc.settings.payment = { connection: 'klarna:abc', amount: { fixed: 0 }, currency: 'euro', mode: 'payment', description: {} };
		expect( validateDocument( doc ).valid ).toBe( false );
	} );
} );

