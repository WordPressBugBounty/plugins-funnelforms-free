/**
 * Connections to CRM and newsletter tools, and the import of forms from other form plugins:
 * the types of their REST routes (docs/integrations/README.md, docs/import/README.md), a client
 * for them, and the small rules the screens share (what a mapping still lacks, which choices a
 * field offers, which contact field suits which CRM field).
 */
import type { ContactField, FormDocument, Text } from '@funnelforms/form-schema';

export interface CrmCredentialField {
	name: string;
	label: string;
	/** text, url, email or password. */
	input: string;
	secret: boolean;
	required: boolean;
}

/** contact: a field of the contact step; text: an own text; choice: a value from the account. */
export interface CrmMappingField {
	name: string;
	label: string;
	kind: 'contact' | 'text' | 'choice';
	required: boolean;
	/** Name of the mapping value whose choice decides which choices this one offers. */
	dependsOn?: string;
}

export interface CrmProvider {
	provider: string;
	label: string;
	category: 'crm' | 'newsletter' | 'spreadsheet';
	credentials: CrmCredentialField[];
	mapping: CrmMappingField[];
	/** Whether the choices can be read from the account. */
	lookups: boolean;
	/** Connected by signing in (Google Sheets), not by credentials. */
	signIn: boolean;
	/** Where the customer finds the access data; may be empty. */
	help: string;
}

/** How a sign-in to a tool ended (docs/integrations/README.md). */
export interface CrmSignIn {
	ok: boolean;
	state: string;
	connection?: { ref: string; provider: string; label: string };
	spreadsheets?: CrmChoice[];
	code?: string;
	message?: string;
	/** The Account page, when the website has to be connected with Funnelforms first. */
	url?: string;
}

export interface CrmConnection {
	ref: string;
	provider: string;
	label: string;
	/** Came from Funnelforms 3. */
	legacy: boolean;
	createdAt: string;
	/** Forms that use it. */
	forms: number;
}

export interface CrmChoice {
	value: string;
	label: string;
}

/** Choices by mapping name; for dependent values (deal stages) by the value they depend on. */
export interface CrmOptions {
	checked: boolean;
	options: Record<string, CrmChoice[] | Record<string, CrmChoice[]>>;
}

export interface ImportSourceForm {
	id: string;
	title: string;
	/** The form it became, when it was imported before and that form still exists. */
	importedAs: number | null;
}

/** A form plugin with forms on this site. */
export interface ImportSource {
	source: string;
	label: string;
	forms: ImportSourceForm[];
}

export type ImportSkipped = 'already_imported' | 'not_found' | 'document_too_large';

export interface ImportItem {
	source: string;
	sourceId: string;
	/** The new form; for a skipped one the form it became before, or null. */
	id: number | null;
	title?: string;
	/** What would keep the draft from being published. */
	problems?: string[];
	notes?: string[];
	/** The notes in words. */
	messages?: string[];
	skipped?: ImportSkipped;
}

export interface ImportResult {
	source: string;
	forms: ImportItem[];
}

export interface ConnectApi {
	crmProviders(): Promise<CrmProvider[]>;
	crmConnections(): Promise<CrmConnection[]>;
	createCrmConnection( provider: string, label: string, credentials: Record<string, string> ): Promise<CrmConnection>;
	/** Empty secret fields keep the stored ones. */
	updateCrmConnection( ref: string, changes: { label?: string; credentials?: Record<string, string> } ): Promise<CrmConnection>;
	deleteCrmConnection( ref: string ): Promise<void>;
	/** The choices of the account; fails with credentials_rejected or unreachable, so it also tests the connection. */
	crmOptions( ref: string ): Promise<CrmOptions>;
	/** Starts signing in to a tool (Google Sheets), a connection again with ref; open url in a window. */
	startCrmSignIn( ref?: string ): Promise<{ url: string; state: string }>;
	/** The end of a sign-in; null while it runs. */
	crmSignIn( state: string ): Promise<CrmSignIn | null>;
	/** Creates a spreadsheet in the account of a Google Sheets connection and answers it as a choice. */
	createSpreadsheet( ref: string, title: string ): Promise<CrmChoice>;
	importSources(): Promise<ImportSource[]>;
	importFile( file: Blob, name: string ): Promise<ImportResult>;
	importSite( source: string, ids: string[], again: boolean ): Promise<ImportResult>;
}

type Request = <T>( method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown ) => Promise<T>;

/** The client over a request function that takes paths below funnelforms/v1 ("~/crm/providers"). */
export function createConnectApi( request: Request ): ConnectApi {
	return {
		crmProviders: () => request( 'GET', '~/crm/providers' ),
		crmConnections: () => request( 'GET', '~/crm/connections' ),
		createCrmConnection: ( provider, label, credentials ) => request( 'POST', '~/crm/connections', { provider, label, credentials } ),
		updateCrmConnection: ( ref, changes ) => request( 'PATCH', '~/crm/connections/' + ref, changes ),
		deleteCrmConnection: async ( ref ) => {
			await request( 'DELETE', '~/crm/connections/' + ref );
		},
		crmOptions: ( ref ) => request( 'GET', '~/crm/connections/' + ref + '/options' ),
		startCrmSignIn: ( ref ) => request( 'POST', '~/crm/googlesheets/connect', ref ? { ref } : {} ),
		crmSignIn: async ( state ) => {
			const result = await request<CrmSignIn | { pending: true }>( 'GET', '~/crm/googlesheets/connect/' + state );
			return 'pending' in result ? null : result;
		},
		createSpreadsheet: ( ref, title ) => request( 'POST', '~/crm/connections/' + ref + '/spreadsheets', { title } ),
		importSources: () => request( 'GET', '~/admin/import/sources' ),
		importFile: ( file, name ) => {
			const body = new FormData();
			body.append( 'file', file, name );
			return request( 'POST', '~/admin/import/file', body );
		},
		importSite: ( source, ids, again ) => request( 'POST', '~/admin/import/site', { source, ids, again } ),
	};
}

/** How the mapping stores a field of the contact step, as Funnelforms 3 did. */
export function contactToken( key: string ): string {
	return '[' + key + ']';
}

/** The key inside "[key]"; null for anything else. */
export function contactKey( value: unknown ): string | null {
	const match = 'string' === typeof value ? /^\[(.+)\]$/.exec( value ) : null;
	return match?.[ 1 ] ?? null;
}

/** The fields of the contact steps an action can send; of one step when the action is limited to it. */
export function contactFields( doc: FormDocument, node?: string ): ContactField[] {
	const out: ContactField[] = [];
	for ( const n of doc.nodes ) {
		if ( 'contact' === n.type && ( ! node || n.id === node ) ) {
			out.push( ...n.fields.filter( ( f ) => 'captcha' !== f.type && 'html' !== f.type && 'consent' !== f.type ) );
		}
	}
	return out;
}

function textOf( text: Text | undefined, locale: string ): string {
	return ( text?.[ locale ] ?? Object.values( text ?? {} )[ 0 ] ?? '' ).trim();
}

export function contactFieldName( field: ContactField, locale: string ): string {
	return textOf( field.label, locale ) || field.key;
}

/** Whether a value is set: texts and choices must not be blank. */
function filled( value: unknown ): boolean {
	return 'string' === typeof value && '' !== value.trim();
}

/** Names of the required values the mapping still lacks. */
export function mappingGaps( provider: CrmProvider, mapping: Record<string, unknown> ): string[] {
	return provider.mapping.filter( ( f ) => f.required && ! filled( mapping[ f.name ] ) ).map( ( f ) => f.name );
}

/** Choices of a mapping value: null when the account offers none (or they are not read yet). */
export function choicesFor( field: CrmMappingField, options: CrmOptions | null, mapping: Record<string, unknown> ): CrmChoice[] | null {
	const given = options?.options[ field.name ];
	if ( ! given ) {
		return null;
	}
	if ( Array.isArray( given ) ) {
		return given;
	}
	// Dependent values: the choices of the value chosen above.
	const parent = field.dependsOn ? mapping[ field.dependsOn ] : undefined;
	return 'string' === typeof parent && given[ parent ] ? given[ parent ] : [];
}

/**
 * Contact fields that suit the contact values of a provider, by type and key: the first match
 * wins, and no field is used twice.
 */
export function suggestMapping( provider: CrmProvider, fields: ContactField[] ): Record<string, string> {
	const out: Record<string, string> = {};
	const used = new Set<string>();
	const first = /^(first|vor)/i;
	const last = /^(last|nach|name$)/i;
	const rules: Array<[ RegExp, ( f: ContactField ) => boolean ]> = [
		[ /^(mail|email)$/, ( f ) => 'email' === f.type ],
		[ /^(telefon|phone|phone_office|mobile|phone_private)$/, ( f ) => 'phone' === f.type ],
		[ /^(anrede|salutation)$/, ( f ) => 'salutation' === f.type ],
		[ /^(vorname|firstname|first_name)$/, ( f ) => first.test( f.key ) ],
		[ /^(name|lastname|last_name)$/, ( f ) => last.test( f.key ) || 'name' === f.type ],
		[ /^(firma|company|organisation)$/, ( f ) => /company|firma|organi/i.test( f.key ) ],
		[ /^website$/, ( f ) => /web|url/i.test( f.key ) ],
		[ /^strasse$/, ( f ) => /stra|street/i.test( f.key ) ],
		[ /^plz$/, ( f ) => /plz|zip|post/i.test( f.key ) ],
		[ /^stadt$/, ( f ) => /stadt|city|ort/i.test( f.key ) ],
	];
	for ( const item of provider.mapping ) {
		if ( 'contact' !== item.kind ) {
			continue;
		}
		const rule = rules.find( ( [ name ] ) => name.test( item.name ) );
		const match = rule ? fields.find( ( f ) => ! used.has( f.id ) && rule[ 1 ]( f ) ) : undefined;
		if ( match ) {
			used.add( match.id );
			out[ item.name ] = contactToken( match.key );
		}
	}
	return out;
}

/** Size limit of an import file when the page does not name one (FormEditor::MAX_IMPORT_BYTES). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Names of the tools for lists where the catalog is not at hand; brand names, so they are not translated. */
export const CRM_NAMES: Record<string, string> = {
	activecampaign: 'ActiveCampaign',
	brevo: 'Brevo',
	cleverreach: 'CleverReach',
	dealsnprojects: 'Deals & Projects',
	fincrm: 'finCRM',
	getresponse: 'GetResponse',
	googlesheets: 'Google Sheets',
	hellohq: 'HelloHQ',
	hubspot: 'HubSpot',
	klicktipp: 'KlickTipp',
	mailchimp: 'Mailchimp',
	pipedrive: 'Pipedrive',
};
