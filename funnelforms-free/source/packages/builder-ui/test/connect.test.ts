import { describe, expect, it, vi } from 'vitest';
import { choicesFor, contactKey, contactToken, createConnectApi, mappingGaps, suggestMapping, type CrmProvider } from '../src/connect';
import { blank } from './blank';
import { contactFields } from '../src/connect';

const hubspot: CrmProvider = {
	provider: 'hubspot',
	label: 'HubSpot',
	category: 'crm',
	lookups: true,
	signIn: false,
	help: '',
	credentials: [],
	mapping: [
		{ name: 'email', label: 'E-mail', kind: 'contact', required: true },
		{ name: 'firstname', label: 'First name', kind: 'contact', required: false },
		{ name: 'lastname', label: 'Last name', kind: 'contact', required: false },
		{ name: 'phone', label: 'Phone', kind: 'contact', required: false },
		{ name: 'dealname', label: 'Deal name', kind: 'text', required: true },
		{ name: 'pipeline', label: 'Pipeline', kind: 'choice', required: true },
		{ name: 'dealstage', label: 'Deal stage', kind: 'choice', required: true, dependsOn: 'pipeline' },
	],
};

describe( 'CRM mapping', () => {
	it( 'stores contact fields in brackets, as Funnelforms 3 did', () => {
		expect( contactToken( 'email' ) ).toBe( '[email]' );
		expect( contactKey( '[email]' ) ).toBe( 'email' );
		expect( contactKey( 'email' ) ).toBeNull();
		expect( contactKey( 3 ) ).toBeNull();
	} );

	it( 'names the required values that are still empty', () => {
		expect( mappingGaps( hubspot, {} ) ).toEqual( [ 'email', 'dealname', 'pipeline', 'dealstage' ] );
		expect( mappingGaps( hubspot, { email: '[email]', dealname: ' ', pipeline: 'p', dealstage: 's' } ) ).toEqual( [ 'dealname' ] );
	} );

	it( 'offers the stages of the chosen pipeline only', () => {
		const options = { checked: true, options: { pipeline: [ { value: 'a', label: 'A' } ], dealstage: { a: [ { value: 'x', label: 'X' } ], b: [ { value: 'y', label: 'Y' } ] } } };
		const stage = hubspot.mapping[ 6 ];
		if ( ! stage ) {
			throw new Error( 'missing' );
		}
		expect( choicesFor( stage, options, { pipeline: 'b' } ) ).toEqual( [ { value: 'y', label: 'Y' } ] );
		expect( choicesFor( stage, options, {} ) ).toEqual( [] );
		expect( choicesFor( stage, null, {} ) ).toBeNull();
		expect( choicesFor( { name: 'tag', label: 'Tag', kind: 'choice', required: false }, options, {} ) ).toBeNull();
	} );

	it( 'suggests the contact fields that fit by type and name, each once', () => {
		const fields = contactFields( blank() );
		const suggested = suggestMapping( hubspot, fields );
		expect( suggested.email ).toBe( '[email]' );
		expect( Object.values( suggested ) ).toEqual( [ ...new Set( Object.values( suggested ) ) ] );
		expect( suggested.dealname ).toBeUndefined();
	} );
} );

describe( 'connect API', () => {
	it( 'talks to the CRM and import routes', async () => {
		const request = vi.fn( async () => ( { pending: true } ) );
		const api = createConnectApi( request as never );
		await api.crmProviders();
		await api.createCrmConnection( 'hubspot', 'Vertrieb', { access_token: 't' } );
		await api.updateCrmConnection( 'hubspot:abc', { label: 'X' } );
		await api.deleteCrmConnection( 'hubspot:abc' );
		await api.crmOptions( 'hubspot:abc' );
		await api.importSite( 'wpforms', [ '1' ], true );
		await api.createSpreadsheet( 'googlesheets:abc', 'Anfragen' );
		expect( await api.crmSignIn( 'state' ) ).toBeNull();
		expect( request.mock.calls.map( ( c ) => ( c as unknown[] ).slice( 0, 3 ) ) ).toEqual( [
			[ 'GET', '~/crm/providers' ],
			[ 'POST', '~/crm/connections', { provider: 'hubspot', label: 'Vertrieb', credentials: { access_token: 't' } } ],
			[ 'PATCH', '~/crm/connections/hubspot:abc', { label: 'X' } ],
			[ 'DELETE', '~/crm/connections/hubspot:abc' ],
			[ 'GET', '~/crm/connections/hubspot:abc/options' ],
			[ 'POST', '~/admin/import/site', { source: 'wpforms', ids: [ '1' ], again: true } ],
			[ 'POST', '~/crm/connections/googlesheets:abc/spreadsheets', { title: 'Anfragen' } ],
			[ 'GET', '~/crm/googlesheets/connect/state' ],
		] );
	} );

	it( 'uploads a file as multipart', async () => {
		const request = vi.fn( async () => ( { source: 'wpforms', forms: [] } ) );
		await createConnectApi( request as never ).importFile( new Blob( [ '{}' ] ), 'forms.json' );
		const call = request.mock.calls[ 0 ] as unknown as [ string, string, FormData ];
		expect( call[ 1 ] ).toBe( '~/admin/import/file' );
		expect( call[ 2 ].get( 'file' ) ).toBeInstanceOf( Blob );
	} );
} );
