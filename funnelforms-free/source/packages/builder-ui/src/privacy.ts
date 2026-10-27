/**
 * The site's privacy mode (PrivacyMode in the plugin, funnelformsBuilder.privacy). In the EU mode
 * every conversion requires consent, in the unrestricted mode none, so the builder shows that
 * setting locked on or off; the server and the runtime enforce it either way.
 */
let mode: 'eu' | 'global' | 'open' = 'eu';

/** Takes the mode of the page; anything but 'global' and 'open' is the EU mode. */
export function setPrivacy( value: string | undefined ): void {
	mode = 'global' === value || 'open' === value ? value : 'eu';
}

/** Whether the unrestricted privacy mode applies (the site owner's own risk). */
export function openPrivacy(): boolean {
	return 'open' === mode;
}

/** Whether the EU privacy mode applies. */
export function euPrivacy(): boolean {
	return 'eu' === mode;
}
