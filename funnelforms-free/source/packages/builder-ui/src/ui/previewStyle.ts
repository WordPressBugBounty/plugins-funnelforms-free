/**
 * The style the live preview shows for a moment: the tokens of a theme while the pointer rests on
 * it in the gallery. Null shows the form's own tokens.
 */
import { useSyncExternalStore } from 'react';
import type { StyleTokens } from '../themes';

let shown: StyleTokens | null = null;
const listeners = new Set<() => void>();

/** Shows these tokens in the live preview; null goes back to the form's. */
export function showStyle( tokens: StyleTokens | null ): void {
	if ( tokens !== shown ) {
		shown = tokens;
		listeners.forEach( ( l ) => l() );
	}
}

export function useShownStyle(): StyleTokens | null {
	return useSyncExternalStore(
		( listener ) => {
			listeners.add( listener );
			return () => void listeners.delete( listener );
		},
		() => shown
	);
}
