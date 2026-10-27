/**
 * Whether the site runs the custom code of forms (TrackingCode in the plugin,
 * funnelformsBuilder.code). The plugin sends the code to visitors only when an administrator
 * allowed it; until then the builder says so next to the code.
 */
export interface CodeSetting {
	allowed: boolean;
	/** Funnelforms → Settings at "Tracking code", for administrators; null for everyone else. */
	settingsUrl: string | null;
}

let setting: CodeSetting = { allowed: true, settingsUrl: null };

/** Takes the setting of the page; without one (tests, older pages) the code counts as allowed. */
export function setCode( value: Partial<CodeSetting> | undefined ): void {
	setting = { allowed: value?.allowed ?? true, settingsUrl: value?.settingsUrl ?? null };
}

export function codeSetting(): CodeSetting {
	return setting;
}
