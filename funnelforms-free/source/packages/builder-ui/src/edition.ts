/**
 * Funnelforms Free or Pro. Code for Free is written as
 * `'free' === process.env.FUNNELFORMS_EDITION && …` at the place it is needed: esbuild replaces the
 * expression (build.mjs, FUNNELFORMS_EDITION=free), so the Pro build drops these branches and the
 * modules only they import, and its output stays the same. What is Pro comes from the server
 * (Edition::catalog() in BuilderPage), which checks again. Only Free branches call this module.
 */

/** The lists of Edition::catalog(), with the names of the Pro features. */
export interface EditionCatalog {
	edition: 'free' | 'pro';
	proStepFields: string[];
	proContactFields: string[];
	proActions: string[];
	freeConditionOps: string[];
	proFeatures: string[];
	labels?: Record<string, string>;
	/** The page about Funnelforms Pro in the admin. */
	proUrl?: string;
}

let catalog: EditionCatalog | undefined;

/** Takes the catalog of the page (funnelformsBuilder.edition). */
export function setEdition( value: EditionCatalog | undefined ): void {
	catalog = value;
}

/** Whether a field type, contact field type or action kind (field:slider, action:crm) is Pro here. */
export function isPro( key: string ): boolean {
	const [ kind, type = '' ] = key.split( ':' );
	const lists: Record<string, string[]> = {
		field: catalog?.proStepFields ?? PRO_STEP_FIELDS,
		contact_field: catalog?.proContactFields ?? PRO_CONTACT_FIELDS,
		action: catalog?.proActions ?? PRO_ACTIONS,
	};
	return ( lists[ kind ?? '' ] ?? [] ).includes( type );
}

/** Whether a path condition with this operator is Pro on this site. */
export function isProCondition( op: string ): boolean {
	return ! ( catalog?.freeConditionOps ?? [ 'selected' ] ).includes( op );
}

/** The name of a Pro feature for people, or the key when the server sent none. */
export function proLabel( key: string ): string {
	return catalog?.labels?.[ key ] ?? key;
}

/** Address of the page about Funnelforms Pro. */
export function proUrl(): string {
	return catalog?.proUrl ?? '';
}

/** Fallbacks while no catalog arrived; they match Edition::PRO_* in the plugin. */
const PRO_STEP_FIELDS = [ 'slider', 'file', 'address', 'signature', 'repeat', 'booking', 'result' ];
const PRO_CONTACT_FIELDS = [ 'phone_verification', 'html' ];
const PRO_ACTIONS = [ 'webhook', 'crm', 'chat', 'sms', 'whatsapp', 'conversion', 'googleAds' ];
