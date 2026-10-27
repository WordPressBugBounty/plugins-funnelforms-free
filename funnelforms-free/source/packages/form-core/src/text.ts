import type { Text } from '@funnelforms/form-schema';

/** Text for a locale: the locale itself, then the fallback locale, then the first one. */
export function pickText( text: Text | undefined, locale: string, fallback: string ): string {
	if ( ! text ) {
		return '';
	}
	return text[ locale ] ?? text[ fallback ] ?? Object.values( text )[ 0 ] ?? '';
}
