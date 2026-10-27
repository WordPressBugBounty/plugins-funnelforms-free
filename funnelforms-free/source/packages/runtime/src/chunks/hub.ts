/**
 * The hand-over between the core and the chunks that follow a form (live results, reminders to
 * visitors who leave). The core pushes the form to window.ffxLive on every new step and answer
 * (FormApp.live()), into a plain list until a chunk is there. The first chunk replaces the list
 * with this hub; every chunk then gets the forms that list its name in data-ffx-chunks, those
 * pushed before it came included. Each chunk bundles this file; the hub it finds works the same.
 */
import type { FormApp } from '../app';

interface Hub {
	push( app: FormApp ): void;
	on: Array<( app: FormApp ) => void>;
	apps: Set<FormApp>;
}

/** Calls fn for every news of a form that loads the chunk name. */
export function take( name: string, fn: ( app: FormApp ) => void ): void {
	let hub = window.ffxLive as Hub | FormApp[] | undefined;
	if ( ! hub || Array.isArray( hub ) ) {
		const apps = new Set( hub ?? [] );
		const on: Hub[ 'on' ] = [];
		hub = { push: ( app: FormApp ) => ( apps.add( app ), on.forEach( ( f ) => f( app ) ) ), on, apps };
		window.ffxLive = hub;
	}
	const mine = ( app: FormApp ): void => {
		if ( ( app.root.dataset.ffxChunks ?? '' ).split( ' ' ).includes( name ) ) {
			fn( app );
		}
	};
	hub.on.push( mine );
	hub.apps.forEach( mine );
}
