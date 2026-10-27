/**
 * The site's spam protection (funnelformsBuilder.spam, from SpamCheck and Http\Captcha in the
 * plugin): what protects every form, the captcha service if one is set up, and where to set it up.
 * The form only decides whether it uses the captcha (settings.captcha); the server enforces it.
 */
export interface SpamProtection {
	/** Name of the captcha service of the site; null while none is set up. */
	captcha: string | null;
	/** Names of everything that protects the forms now, the captcha included. */
	protection: string[];
	/** Settings → Entries and spam; null for users who may not change settings. */
	settingsUrl: string | null;
}

let site: SpamProtection = { captcha: null, protection: [], settingsUrl: null };

/** Takes the protection of the page. */
export function setSpam( value: Partial<SpamProtection> | undefined ): void {
	site = { captcha: value?.captcha ?? null, protection: value?.protection ?? [], settingsUrl: value?.settingsUrl ?? null };
}

/** The site's spam protection. */
export function spamProtection(): SpamProtection {
	return site;
}

/** What protects a form: the site's protection, without the captcha when the form does without it. */
export function formProtection( captchaOn: boolean, value: SpamProtection = site ): string[] {
	return value.protection.filter( ( name ) => captchaOn || name !== value.captcha );
}
