import type { CalculationFormat, ContactNode, Edge, EndNode, FormDocument, StepNode } from '@funnelforms/form-schema';
import type { IconSet } from './icons';

/** The document the plugin sends to the browser (PublicDocument in the plugin). */
export interface PublicDocument extends Pick<FormDocument, 'schemaVersion' | 'id' | 'locales' | 'start' | 'settings' | 'experiments'> {
	nodes: Array<StepNode | ContactNode | EndNode>;
	edges: Edge[];
	/**
	 * Calculations by id; those of live results with their number format and the keys of the fields
	 * they use (also through other calculations), so the result waits until those are answered.
	 */
	calculations: Array<{ id: string; format?: CalculationFormat; uses?: string[] }>;
	style: { tokens: Record<string, string> };
}

/** Inline configuration written by the plugin (Frontend\Renderer). */
export interface RuntimeConfig {
	uid: string;
	endpoint: string;
	locale: string;
	strings: Record<string, string>;
	document: PublicDocument;
	/** Google Maps key, only for forms with address suggestions (empty when the site has none). */
	mapsKey?: string;
	/** The site's time zone, for forms whose paths compare a date with today. */
	timeZone?: string;
	/** Key from the password prompt, for every request of a protected form. */
	unlock?: string;
	/** The visitor is back from the payment page (Frontend\PaymentReturn): what to show instead of the form. */
	payment?: PaymentReturn;
	/** Elements of the Lucide icons the form uses (answers and contact fields), by name. */
	icons?: IconSet;
	/** The site's privacy mode; without it the EU mode (consent needed) applies. */
	privacy?: 'eu' | 'global' | 'open';
	/** Test run in the builder's preview: nothing is counted or pushed, and redirects are only named. */
	preview?: boolean;
}

/** Back from the payment page: status as the provider reported it, and the end of the funnel once paid. */
export interface PaymentReturn {
	/** Link parameter of the entry, for another attempt. */
	param: string;
	status: 'open' | 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded' | '';
	end: EndResponse | null;
}

/** Answer of a submit that takes a payment: the payment page, or null when it could not be started. */
export interface PaymentStart {
	url: string | null;
	param: string;
}

/** A password-protected form before the password: no document yet. */
export interface LockedConfig extends Pick<RuntimeConfig, 'uid' | 'endpoint' | 'locale' | 'strings' | 'unlock'> {
	locked: true;
}

export interface EndResponse {
	success: {
		show: boolean;
		html: string;
		image: string | null;
		heading?: string;
		animation?: 'check' | 'confetti' | null;
		button?: { label: string; url: string; newTab: boolean } | null;
		downloads?: Array<{ label: string; url: string }>;
		/** The visitor's answers, when the thank-you page lists them. */
		answers?: Array<{ title: string; answer: string }> | null;
	} | null;
	redirect: { url: string; newTab: boolean; delayMs: number; countdown?: boolean } | null;
}
