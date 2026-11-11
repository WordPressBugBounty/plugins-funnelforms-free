import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLeadcallerApi, type AiAgent, type LeadcallerApi, type LeadcallerState } from '../src/aicall';
import { consentTitle } from '../src/ui/AiCall';
import { e164, LeadcallerScreen, voiceTitle, windowText } from '../src/ui/Leadcaller';

( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const config = { root: '/wp-json/', nonce: 'n', userLocale: 'en_US', formsUrl: '/wp-admin/admin.php?page=funnelforms' };

function state( changes: Partial<LeadcallerState> = {} ): LeadcallerState {
	return {
		connected: false,
		error: null,
		numbers: [],
		agents: [],
		twilio: [],
		stages: [ { key: 'qualified', name: 'Qualified' } ],
		site: 'Solar Example',
		about: 'Solar panels for homes',
		timezone: 'Europe/Berlin',
		user: 'Pat',
		...changes,
	};
}

const NUMBER = { id: 'phnum_1', number: '+4930123456', label: 'Funnelforms +4930123456', provider: 'twilio', outbound: true };

function fakeApi( first: LeadcallerState, more: Partial<LeadcallerApi> = {} ): LeadcallerApi {
	return {
		state: vi.fn( async () => first ),
		connect: vi.fn( async () => state( { connected: true } ) ),
		disconnect: vi.fn( async () => state() ),
		voices: vi.fn( async () => [ { id: 'voice_1', name: 'Aria', language: 'en', gender: 'female', accent: 'american', use: '', preview: '' } ] ),
		twilioNumbers: vi.fn( async () => [ { number: '+4930123456', name: 'Office' } ] ),
		importNumber: vi.fn( async () => state( { connected: true, numbers: [ NUMBER ] } ) ),
		saveAgent: vi.fn( async ( agent: AiAgent ) => ( { ...agent, id: 'agent_0123456789abcdef', remote: 'agent_remote', missing: [] } ) ),
		deleteAgent: vi.fn( async () => undefined ),
		testCall: vi.fn( async () => ( { conversation: 'conv_1' } ) ),
		callResult: vi.fn( async () => ( { done: true, reached: true, goal: true, duration: 80, summary: 'Wants panels for a house.', details: [ { label: 'Budget', value: 'about 15,000 euros' } ], transcript: [] } ) ),
		...more,
	};
}

let container: HTMLDivElement;
let root: Root;

beforeEach( () => {
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
} );

afterEach( () => {
	act( () => root.unmount() );
	container.remove();
	vi.useRealTimers();
} );

async function settle(): Promise<void> {
	await act( async () => {
		await new Promise( ( r ) => setTimeout( r, 0 ) );
	} );
}

async function render( api: LeadcallerApi ): Promise<void> {
	await act( async () => {
		root.render( <LeadcallerScreen config={ config } api={ api } /> );
	} );
	await settle();
}

async function click( el: Element | null | undefined ): Promise<void> {
	if ( ! ( el instanceof HTMLElement ) ) {
		throw new Error( 'Nothing to click' );
	}
	await act( async () => {
		el.click();
	} );
	await settle();
}

function button( text: string ): HTMLButtonElement | undefined {
	return [ ...document.querySelectorAll<HTMLButtonElement>( 'button' ) ].find( ( b ) => b.textContent === text );
}

function field( label: string ): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
	const found = [ ...document.querySelectorAll( 'label' ) ].find( ( l ) => l.textContent === label );
	const el = found ? document.getElementById( found.htmlFor ) : null;
	if ( ! ( el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ) ) {
		throw new Error( 'No field ' + label );
	}
	return el;
}

async function type( el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string ): Promise<void> {
	const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	await act( async () => {
		Object.getOwnPropertyDescriptor( proto, 'value' )?.set?.call( el, value );
		el.dispatchEvent( new Event( el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true } ) );
	} );
	await settle();
}

describe( 'the AI Phone Agent page', () => {
	it( 'starts with connecting ElevenLabs: only the key is asked for', async () => {
		const api = fakeApi( state() );
		await render( api );
		const steps = [ ...container.querySelectorAll( '.ffx-lc-step' ) ];
		expect( steps ).toHaveLength( 4 );
		expect( steps[ 0 ]?.classList.contains( 'is-current' ) ).toBe( true );
		expect( button( 'Connect' )?.disabled ).toBe( true );
		expect( button( 'Add number from Twilio' )?.disabled ).toBe( true );
		await type( field( 'ElevenLabs API key' ), 'sk_0123456789abcdef' );
		await click( button( 'Connect' ) );
		expect( api.connect ).toHaveBeenCalledWith( 'sk_0123456789abcdef' );
		expect( container.querySelector( '.ffx-lc__said' )?.textContent ).toBe( 'ElevenLabs is connected.' );
		expect( container.querySelectorAll( '.ffx-lc-step' )[ 1 ]?.classList.contains( 'is-current' ) ).toBe( true );
	} );

	it( 'brings a number from Twilio and connects it to ElevenLabs', async () => {
		const api = fakeApi( state( { connected: true } ) );
		await render( api );
		await click( button( 'Add number from Twilio' ) );
		expect( button( 'Show my numbers' )?.disabled ).toBe( true );
		await type( field( 'Account SID' ), 'AC' + '0'.repeat( 32 ) );
		await type( field( 'Auth Token' ), 'f'.repeat( 32 ) );
		await click( button( 'Show my numbers' ) );
		expect( api.twilioNumbers ).toHaveBeenCalledWith( { accountSid: 'AC' + '0'.repeat( 32 ), authToken: 'f'.repeat( 32 ) } );
		await click( button( 'Use this number' ) );
		expect( api.importNumber ).toHaveBeenCalledWith( { accountSid: 'AC' + '0'.repeat( 32 ), authToken: 'f'.repeat( 32 ) }, '+4930123456' );
		expect( container.querySelector( '.ffx-lc-numbers' )?.textContent ).toContain( '+4930123456' );
	} );

	it( 'creates an agent with the texts of its goal and the only number, then offers a test call', async () => {
		const api = fakeApi( state( { connected: true, numbers: [ NUMBER ] } ) );
		await render( api );
		await click( button( 'Create agent' ) );
		expect( ( field( 'Greeting' ) as HTMLTextAreaElement ).value ).toContain( 'two minutes' );
		// The preview starts with the sentence that an AI assistant calls.
		expect( document.querySelector( '.ffxb-lc-bubble' )?.textContent ).toContain( 'Hello, this is the AI assistant of Solar Example.' );
		// Another goal brings its texts while they were not changed.
		await click( [ ...document.querySelectorAll( '.ffxb-lc-goals input' ) ][ 1 ] );
		expect( ( field( 'Greeting' ) as HTMLTextAreaElement ).value ).toContain( 'consultation' );
		await click( [ ...document.querySelectorAll( '.ffxb-dialog__actions button' ) ].find( ( b ) => 'Create agent' === b.textContent ) );
		expect( api.saveAgent ).not.toHaveBeenCalled();
		expect( document.body.textContent ).toContain( 'Please enter a name.' );
		await type( field( 'Name' ), 'Solar call back' );
		await click( [ ...document.querySelectorAll( '.ffxb-dialog__actions button' ) ].find( ( b ) => 'Create agent' === b.textContent ) );
		expect( api.saveAgent ).toHaveBeenCalledWith( expect.objectContaining( { id: '', name: 'Solar call back', goal: 'appointment', language: 'en', number: 'phnum_1', numberProvider: 'twilio', company: 'Solar Example' } ) );
		expect( container.querySelector( '.ffx-lc-list' )?.textContent ).toContain( 'Solar call back' );
		expect( document.querySelector( '.ffxb-dialog' )?.getAttribute( 'aria-label' ) ).toBe( 'Test call: Solar call back' );
	} );

	it( 'takes prompt notes, a time zone and the country of the leads', async () => {
		const api = fakeApi( state( { connected: true, numbers: [ NUMBER ], zones: [ 'Europe/Berlin', 'Europe/Vienna', 'America/New_York' ], country: 'DE' } ) );
		await render( api );
		await click( button( 'Create agent' ) );
		expect( document.body.textContent ).not.toContain( 'About you' );
		const notes = field( 'Notes for the agent' ) as HTMLTextAreaElement;
		expect( notes.value ).toBe( '' );
		expect( notes.placeholder ).toContain( 'Address people formally' );
		expect( ( field( 'Time zone' ) as HTMLSelectElement ).options[ 0 ]?.textContent ).toBe( 'Time zone of the website (Europe/Berlin)' );
		await type( notes, 'Always formal. Never name prices.' );
		await type( field( 'Time zone' ), 'America/New_York' );
		expect( document.body.textContent ).toContain( 'Times in the time zone America/New_York.' );
		await type( field( 'Country of the leads' ), 'AT' );
		await type( field( 'Name' ), 'Vienna' );
		await click( [ ...document.querySelectorAll( '.ffxb-dialog__actions button' ) ].find( ( b ) => 'Create agent' === b.textContent ) );
		expect( api.saveAgent ).toHaveBeenCalledWith( expect.objectContaining( { about: 'Always formal. Never name prices.', timezone: 'America/New_York', country: 'AT' } ) );
	} );

	it( 'books into an appointment type and says when no calendar counts', async () => {
		const types = [ { ref: 'bt:3', title: 'Consultation', durations: [ 30 ], conflicts: 0, write: false } ];
		const api = fakeApi( state( { connected: true, numbers: [ NUMBER ], types, calendars: 0, reachable: true } ) );
		await act( async () => {
			root.render( <LeadcallerScreen config={ { ...config, typesUrl: '/types', calendarsUrl: '/integrations' } } api={ api } /> );
		} );
		await settle();
		await click( button( 'Create agent' ) );
		expect( document.body.textContent ).not.toContain( 'Books into the appointment type' );
		await click( [ ...document.querySelectorAll( '.ffxb-lc-goals input' ) ][ 1 ] );
		// The first type is taken; the type brings day and time, so the starting questions go.
		expect( ( field( 'Books into the appointment type' ) as HTMLSelectElement ).value ).toBe( 'bt:3' );
		expect( document.querySelectorAll( '.ffxb-lc-questions li' ) ).toHaveLength( 0 );
		expect( document.body.textContent ).toContain( 'No calendar connected to this type' );
		expect( document.querySelector<HTMLAnchorElement>( 'a[href="/integrations"]' )?.textContent ).toBe( 'Connect a calendar' );
		expect( document.querySelector( '.ffxb-lc-chat' )?.textContent ).toContain( 'Offers two free times for “Consultation”' );
		await type( field( 'Connect with this number' ), '+49 30 1234567' );
		await type( field( 'Name' ), 'Appointments' );
		await click( [ ...document.querySelectorAll( '.ffxb-dialog__actions button' ) ].find( ( b ) => 'Create agent' === b.textContent ) );
		expect( api.saveAgent ).toHaveBeenCalledWith( expect.objectContaining( { goal: 'appointment', bookingType: 'bt:3', transfer: '+49 30 1234567', questions: [] } ) );
	} );

	it( 'asks for an appointment type first when there is none', async () => {
		const api = fakeApi( state( { connected: true, numbers: [ NUMBER ], types: [] } ) );
		await act( async () => {
			root.render( <LeadcallerScreen config={ { ...config, typesUrl: '/types' } } api={ api } /> );
		} );
		await settle();
		await click( button( 'Create agent' ) );
		await click( [ ...document.querySelectorAll( '.ffxb-lc-goals input' ) ][ 1 ] );
		expect( document.body.textContent ).toContain( 'No appointment type yet' );
		expect( document.querySelector<HTMLAnchorElement>( 'a[href="/types"]' )?.textContent ).toBe( 'Create an appointment type' );
	} );

	it( 'picks a voice of the call language and lets the user choose among all', async () => {
		const voices = [
			{ id: 'voice_aria', name: 'Aria', language: 'en', gender: 'female', accent: 'american', use: '', preview: '' },
			{ id: 'voice_hans', name: 'Hans - Calm German Explainer', language: 'de', gender: 'male', accent: 'standard', use: 'informative_educational', preview: 'https://example.org/hans.mp3' },
			{ id: 'voice_marcel', name: 'Marcel - Friendly German Voice', language: 'de', gender: 'male', accent: 'standard', use: 'conversational', preview: '' },
		];
		const api = fakeApi( state( { connected: true, numbers: [ NUMBER ] } ), { voices: vi.fn( async () => voices ) } );
		await render( api );
		await click( button( 'Create agent' ) );
		const checked = (): string => document.querySelector( '.ffxb-lc-voice.is-active strong' )?.textContent ?? '';
		expect( checked() ).toBe( 'Aria' );
		await type( field( 'Language of the call' ), 'de' );
		// The conversational voice of the language comes first and is taken.
		expect( checked() ).toBe( 'Marcel' );
		expect( [ ...document.querySelectorAll( '.ffxb-lc-voices__list strong' ) ].map( ( n ) => n.textContent ) ).toEqual( [ 'Marcel', 'Hans' ] );
		expect( document.querySelector( '.ffxb-lc-voice.is-active' )?.textContent ).toContain( 'Good for calls' );
		await click( button( 'All voices (3)' ) );
		expect( document.querySelectorAll( '.ffxb-lc-voices__list li' ) ).toHaveLength( 4 );
		await click( button( 'Female' ) );
		// The chosen voice stays on top, then the female voices.
		expect( [ ...document.querySelectorAll( '.ffxb-lc-voices__list strong' ) ].map( ( n ) => n.textContent ) ).toEqual( [ 'Marcel', 'Aria' ] );
		await click( button( 'Female' ) );
		await click( [ ...document.querySelectorAll<HTMLInputElement>( '.ffxb-lc-voice input' ) ].find( ( i ) => i.closest( 'li' )?.textContent?.includes( 'Hans' ) ) );
		// Chosen by hand: another language keeps it.
		await type( field( 'Language of the call' ), 'en' );
		expect( checked() ).toBe( 'Hans' );
		await type( field( 'Name' ), 'Solar call back' );
		await click( [ ...document.querySelectorAll( '.ffxb-dialog__actions button' ) ].find( ( b ) => 'Create agent' === b.textContent ) );
		expect( api.saveAgent ).toHaveBeenCalledWith( expect.objectContaining( { voice: 'voice_hans', voiceName: 'Hans - Calm German Explainer', language: 'en' } ) );
	} );

	it( 'calls for a test and shows what the entry would get', async () => {
		const agent = { ...( await import( '../src/aicall' ) ).newAgent( 'en', 'Solar Example' ), id: 'agent_0123456789abcdef', name: 'Solar call back', number: 'phnum_1', remote: 'r', missing: [] };
		const api = fakeApi( state( { connected: true, numbers: [ NUMBER ], agents: [ agent ] } ) );
		await render( api );
		await click( button( 'Test call' ) );
		await type( field( 'Your phone number' ), '0170 123' );
		expect( button( 'Call me now' )?.disabled ).toBe( true );
		await type( field( 'Your phone number' ), '+49 170 1234567' );
		vi.useFakeTimers();
		await act( async () => {
			button( 'Call me now' )?.click();
		} );
		await act( async () => {
			await vi.advanceTimersByTimeAsync( 4100 );
		} );
		expect( api.testCall ).toHaveBeenCalledWith( 'agent_0123456789abcdef', '+491701234567', '' );
		expect( api.callResult ).toHaveBeenCalledWith( 'conv_1', 'agent_0123456789abcdef' );
		expect( document.querySelector( '.ffxb-lc-result' )?.textContent ).toContain( 'Goal reached' );
		expect( document.querySelector( '.ffxb-lc-details' )?.textContent ).toBe( 'Budgetabout 15,000 euros' );
	} );
} );

describe( 'the AI Phone Agent helpers', () => {
	it( 'name a consent box by its text, never by its key', () => {
		expect( consentTitle( { key: 'c_mr2k1h', label: {}, props: { html: { en: '<p>Yes, you may call me about my request, also with an AI assistant.</p>' } } }, 'en' ) ).toBe( 'Yes, you may call me about my request, also with an AI assistant.' );
		expect( consentTitle( { key: 'c_mr2k1h', label: { en: 'Call me' } }, 'en' ) ).toBe( 'Call me' );
		expect( consentTitle( { key: 'c_mr2k1h' }, 'en' ) ).toBe( 'Consent' );
	} );

	it( 'split the name of a voice from its tagline', () => {
		expect( voiceTitle( 'Marcel - Friendly German Explainer' ) ).toEqual( { title: 'Marcel', tagline: 'Friendly German Explainer' } );
		expect( voiceTitle( 'Elise – Warm, Natural and Engaging' ) ).toEqual( { title: 'Elise', tagline: 'Warm, Natural and Engaging' } );
		expect( voiceTitle( 'Yvonne German female' ) ).toEqual( { title: 'Yvonne German female', tagline: '' } );
	} );

	it( 'write call hours in runs of days', () => {
		expect( windowText( { days: [ 1, 2, 3, 4, 5 ], from: '09:00', to: '19:00' }, 'en-US' ) ).toBe( 'Mon–Fri, 09:00–19:00' );
		expect( windowText( { days: [ 1, 3, 6, 7 ], from: '10:00', to: '12:00' }, 'en-US' ) ).toBe( 'Mon, Wed, Sat, Sun, 10:00–12:00' );
	} );

	it( 'read numbers with the country code only', () => {
		expect( e164( '+49 (170) 123-4567' ) ).toBe( '+491701234567' );
		expect( e164( '0049 170 1234567' ) ).toBe( '+491701234567' );
		expect( e164( '0170 1234567' ) ).toBeNull();
	} );

	it( 'reach the routes of Http\\LeadcallerController', async () => {
		const request = vi.fn( async () => ( {} ) ) as unknown as Parameters<typeof createLeadcallerApi>[ 0 ];
		const api = createLeadcallerApi( request );
		await api.saveAgent( { id: 'agent_ab' } as AiAgent );
		await api.callResult( 'conv_1', 'agent_ab' );
		await api.importNumber( { connectionRef: 'twilio:1' }, '+4930123456' );
		expect( ( request as unknown as ReturnType<typeof vi.fn> ).mock.calls ).toEqual( [
			[ 'POST', '~/leadcaller/agents/agent_ab', { id: 'agent_ab' } ],
			[ 'GET', '~/leadcaller/agents/agent_ab/calls/conv_1' ],
			[ 'POST', '~/leadcaller/numbers', { connectionRef: 'twilio:1', number: '+4930123456' } ],
		] );
	} );
} );
