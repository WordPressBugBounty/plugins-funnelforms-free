import type { AddressField } from '@funnelforms/form-schema';
import { allowed, BORLABS_SAVED } from './consent';
import { h, uniqueId } from './dom';
import type { FieldContext, RenderedField } from './fields';

/** Value of an address field: the parts the field shows, by key. */
export type AddressValue = Record<string, string>;

/** Keys of the parts a field shows, in order. */
export function addressKeys( field: AddressField ): string[] {
	return field.props.combined ? [ 'address' ] : [ 'street', 'number', 'zip', 'city', ...( field.props.showCountry ? [ 'country' ] : [] ) ];
}

const part = ( value: unknown, key: string ): string => {
	const text = value && typeof value === 'object' ? ( value as AddressValue )[ key ] : '';
	return typeof text === 'string' ? text.trim() : '';
};

/** The address as 3.x wrote it: "Street 1, 12345 City, Country" (AnswerValidator in the plugin). */
export function formatAddress( field: AddressField, value: unknown ): string {
	if ( field.props.combined ) {
		return part( value, 'address' );
	}
	return [
		`${ part( value, 'street' ) } ${ part( value, 'number' ) }`.trim(),
		`${ part( value, 'zip' ) } ${ part( value, 'city' ) }`.trim(),
		field.props.showCountry ? part( value, 'country' ) : '',
	].filter( Boolean ).join( ', ' );
}

/** Same rules as the plugin: required fields need every part they show. */
export function checkAddress( field: AddressField, value: unknown ): string | null {
	const parts = addressKeys( field ).map( ( key ) => part( value, key ) );
	if ( parts.some( ( p ) => [ ...p ].length > 200 ) ) {
		return 'too_long';
	}
	if ( parts.every( ( p ) => p === '' ) ) {
		return field.required ? 'required' : null;
	}
	return field.required && parts.includes( '' ) ? 'incomplete_address' : null;
}

interface Component {
	longText?: string;
	long_name?: string;
	types: string[];
}

interface MapsPlace {
	addressComponents?: Component[];
	location?: unknown;
	fetchFields( options: { fields: string[] } ): Promise<unknown>;
}

/** A suggestion of the Places API (New) (AutocompleteSuggestion.placePrediction). */
interface Prediction {
	text?: { text: string };
	mainText?: { text: string } | null;
	secondaryText?: { text: string } | null;
	toPlace(): MapsPlace;
}

interface MapsApi {
	importLibrary( name: string ): Promise<Record<string, unknown>>;
}

declare global {
	interface Window {
		google?: { maps?: MapsApi };
		ffxMapsReady?: () => void;
		/** Google calls it when it refuses the key (wrong key, site not allowed, Maps JavaScript API off). */
		gm_authFailure?: () => void;
	}
}

let maps: Promise<MapsApi> | null = null;

/** Fields told when Google refuses the key; the refusal comes once per page, so later fields learn it at once. */
const refusedListeners = new Set<() => void>();
let keyRefused = false;

/** Loads the Maps JavaScript API once, with the site's key. */
function loadMaps( key: string ): Promise<MapsApi> {
	maps ??= new Promise( ( resolve, reject ) => {
		window.ffxMapsReady = () => ( window.google?.maps ? resolve( window.google.maps ) : reject( new Error( 'maps' ) ) );
		const before = window.gm_authFailure;
		window.gm_authFailure = () => {
			keyRefused = true;
			refusedListeners.forEach( ( listener ) => listener() );
			before?.();
		};
		const script = document.createElement( 'script' );
		script.src = `https://maps.googleapis.com/maps/api/js?key=${ encodeURIComponent( key ) }&loading=async&callback=ffxMapsReady`;
		script.async = true;
		script.onerror = () => {
			maps = null;
			reject( new Error( 'maps' ) );
		};
		document.head.append( script );
	} );
	return maps;
}

/** Google's address types mapped to the parts of the field. */
const COMPONENTS: Record<string, string> = { route: 'street', street_number: 'number', postal_code: 'zip', locality: 'city', postal_town: 'city', country: 'country' };

/** The APIs a key needs, as the Google Cloud console names them. */
export const MAPS_APIS = { maps: 'Maps JavaScript API', places: 'Places API (New)', geocoding: 'Geocoding API' } as const;

/**
 * Tells the site owner in the browser console which API Google refused. Visitors only lose the
 * suggestions; the inputs keep working. Funnelforms → Settings → General → Address fields checks the
 * key in the admin and names what is missing (assets/admin/maps-check.js).
 */
function refused( api: keyof typeof MAPS_APIS, reason: unknown ): void {
	const said = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
	console.error( `Funnelforms: Google refused the ${ MAPS_APIS[ api ] } for the Google Maps key of this site. Enable it for the key in the Google Cloud console and allow this website in the key's restrictions; Funnelforms → Settings → General → Address fields checks the key.${ said ? ` Google said: ${ said }` : '' }` );
}

/** The house number the visitor typed after the street ("Altenhof 10, Hamburg" → "10"), for places Google knows only as a street. */
export function typedNumber( query: string, street: string ): string {
	const match = /^\s*([^\d,]+?)\s+(\d+\s?[a-zA-Z]?(?:\s?[-/]\s?\d+[a-zA-Z]?)?)(?=\s*(?:,|$))/.exec( query.split( ',' )[ 0 ] ?? '' );
	if ( ! match || ! street ) {
		return '';
	}
	const typed = ( match[ 1 ] ?? '' ).toLowerCase().replace( /\s+/g, ' ' );
	const known = street.toLowerCase();
	return known.startsWith( typed.slice( 0, 4 ) ) || typed.startsWith( known.slice( 0, 4 ) ) ? ( match[ 2 ] ?? '' ).replace( /\s+/g, '' ) : '';
}

/**
 * Address field (chunk runtime-address.js): inputs for the parts (or one line), as in 3.x.
 *
 * With a Maps key and suggestions on, the field gets two columns (one below the other on narrow
 * forms): on the left a search with suggestions from the Places API (New) in the form's own look,
 * then the parts it fills; on the right the map. Combined fields suggest in their one input. Google
 * loads only with consent; until then the map column offers to load it. Without Google, or when
 * Google refuses the key, the inputs work on their own. Fills the group the core rendered (fields.ts
 * later()); the parts keep their classes and keys, so answers and custom CSS of existing forms stay.
 */
export function addressField( field: AddressField, ctx: FieldContext, r: RenderedField ): void {
	const { error } = r;
	const describedBy = r.el.getAttribute( 'aria-describedby' ) ?? '';
	const value: AddressValue = { ...( ( ctx.get( field.id ) as AddressValue | undefined ) ?? {} ) };
	const inputs: Record<string, HTMLInputElement> = {};
	const grid = h( 'div', { class: field.props.combined ? 'ffx-address ffx-address-combined' : 'ffx-address' } );
	const labels: Record<string, string> = { address: 'address', street: 'street', number: 'street_number', zip: 'postcode', city: 'city', country: 'country' };
	const autocomplete: Record<string, string> = { street: 'address-line1', zip: 'postal-code', city: 'address-level2', country: 'country-name', address: 'street-address' };
	for ( const key of addressKeys( field ) ) {
		const id = uniqueId( 'input' );
		const input = h( 'input', { id, type: 'text', class: 'ffx-input', autocomplete: autocomplete[ key ] ?? 'off', required: field.required, 'aria-describedby': describedBy } );
		input.value = value[ key ] ?? '';
		input.addEventListener( 'input', () => {
			value[ key ] = input.value;
			ctx.set( field.id, { ...value } );
		} );
		inputs[ key ] = input;
		grid.append( h( 'div', { class: `ffx-address-part ffx-address-${ key }` }, h( 'label', { class: 'ffx-label', for: id }, ctx.t( labels[ key ] ?? key ) ), input ) );
	}

	error.before( grid );
	r.focus = Object.values( inputs )[ 0 ] ?? null;
	if ( ! field.props.placesAutocomplete || ! ctx.mapsKey ) {
		return;
	}

	const fill = ( parts: AddressValue ): void => {
		for ( const key of Object.keys( inputs ) ) {
			const text = key === 'address' ? [ `${ parts.street ?? '' } ${ parts.number ?? '' }`.trim(), `${ parts.zip ?? '' } ${ parts.city ?? '' }`.trim() ].filter( Boolean ).join( ', ' ) : parts[ key ] ?? '';
			value[ key ] = text;
			( inputs[ key ] as HTMLInputElement ).value = text;
		}
		error.hidden = true;
		ctx.set( field.id, { ...value } );
	};

	// Combined fields search in their one input; the parts get a search above them.
	const combined = inputs.address;
	const query = combined ?? h( 'input', { type: 'text', class: 'ffx-input ffx-address-query', autocomplete: 'off', placeholder: ctx.t( 'search_address' ), 'aria-label': ctx.t( 'search_address' ) } );
	const search = h( 'div', { class: 'ffx-address-search' } );
	const main = h( 'div', { class: 'ffx-address-main' } );
	const mapBox = h( 'div', { class: 'ffx-address-map' } );
	const mapColumn = h( 'div', { class: 'ffx-address-map-column' } );
	const layout = h( 'div', { class: 'ffx-address-layout' }, main, mapColumn );
	const wrap = h( 'div', { class: 'ffx-address-wrap' }, layout );
	grid.replaceWith( wrap );
	main.append( grid );
	// The browser asks the visitor before it tells the position; nothing happens before the click.
	const locate = field.props.locate && 'geolocation' in navigator ? h( 'button', { type: 'button', class: 'ffx-address-locate', hidden: true }, ctx.t( 'use_location' ) ) : null;

	const failed = (): void => {
		error.textContent = ctx.t( 'location_failed' );
		error.hidden = false;
	};
	// Without Google the field is the plain inputs again: one column, no map, no search.
	const fallBack = (): void => {
		wrap.classList.add( 'is-plain' );
		mapColumn.remove();
		locate?.remove();
		if ( ! combined ) {
			search.remove();
		}
	};
	const key = ctx.mapsKey;
	const start = (): void => {
		mapColumn.replaceChildren( mapBox );
		if ( combined ) {
			combined.closest( '.ffx-address-part' )?.append( search );
			search.prepend( combined );
		} else {
			main.prepend( search );
			search.append( query );
		}
		if ( locate ) {
			search.after( locate );
		}
		void showGoogle( field, key, { query, search, mapBox, locate }, ctx, failed, fill, fallBack ).catch( ( reason: unknown ) => {
			refused( 'maps', reason );
			fallBack();
		} );
	};

	// Google loads only with consent (Borlabs Cookie, the WP Consent API or the privacy mode); the inputs work without it.
	if ( allowed( 'marketing' ) ) {
		start();
		return;
	}
	const ask = h( 'button', { type: 'button', class: 'ffx-button ffx-consent-load' }, ctx.t( 'load_maps' ) );
	mapColumn.append( h( 'div', { class: 'ffx-address-map ffx-address-map-idle' }, h( 'span', { class: 'ffx-address-pin', 'aria-hidden': 'true' } ), ask ) );
	const later = (): void => {
		if ( ! ask.isConnected ) {
			window.removeEventListener( BORLABS_SAVED, later );
		} else if ( allowed( 'marketing' ) ) {
			window.removeEventListener( BORLABS_SAVED, later );
			start();
		}
	};
	window.addEventListener( BORLABS_SAVED, later );
	ask.addEventListener( 'click', () => {
		window.removeEventListener( BORLABS_SAVED, later );
		start();
		query.focus();
	} );
}

/** The parts of the field from Google's address components (Places: longText, Geocoder: long_name). */
function partsOf( components: Component[] ): AddressValue {
	const parts: AddressValue = {};
	for ( const component of components ) {
		const target = COMPONENTS[ component.types.find( ( type ) => type in COMPONENTS ) ?? '' ];
		const text = component.longText ?? component.long_name;
		if ( target && text && ! parts[ target ] ) {
			parts[ target ] = text;
		}
	}
	return parts;
}

interface Parts {
	query: HTMLInputElement;
	search: HTMLElement;
	mapBox: HTMLElement;
	locate: HTMLButtonElement | null;
}

async function showGoogle( field: AddressField, key: string, ui: Parts, ctx: FieldContext, failed: () => void, fill: ( parts: AddressValue ) => void, fallBack: () => void ): Promise<void> {
	const { query, search, mapBox, locate } = ui;
	const api = await loadMaps( key );
	const onRefused = (): void => {
		refused( 'maps', '' );
		fallBack();
		close();
		query.removeEventListener( 'input', typed );
	};
	const [ places, mapsLib, markerLib ] = await Promise.all( [ api.importLibrary( 'places' ), api.importLibrary( 'maps' ), api.importLibrary( 'marker' ).catch( () => ( {} as Record<string, unknown> ) ) ] );
	const Suggestions = places.AutocompleteSuggestion as { fetchAutocompleteSuggestions( request: Record<string, unknown> ): Promise<{ suggestions: Array<{ placePrediction?: Prediction | null }> }> } | undefined;
	const Token = places.AutocompleteSessionToken as ( new () => unknown ) | undefined;
	if ( ! Suggestions ) {
		throw new Error( 'AutocompleteSuggestion is missing' );
	}
	const GoogleMap = mapsLib.Map as new ( el: HTMLElement, options: Record<string, unknown> ) => { setCenter( p: unknown ): void; setZoom( z: number ): void };
	const Marker = markerLib.Marker as ( new ( options: Record<string, unknown> ) => { setMap( map: unknown ): void } ) | undefined;
	const center = { lat: field.props.start.lat, lng: field.props.start.lng };
	const map = new GoogleMap( mapBox, { center, zoom: field.props.zoom, disableDefaultUI: true, zoomControl: true, clickableIcons: false } );
	let marker: { setMap( map: unknown ): void } | null = null;
	const show = ( location: unknown ): void => {
		marker?.setMap( null );
		marker = Marker ? new Marker( { map, position: location } ) : null;
		map.setCenter( location );
		map.setZoom( 16 );
	};

	// The suggestions: a list box below the input, keyboard and screen reader friendly (combobox pattern).
	const list = h( 'ul', { class: 'ffx-address-suggestions', role: 'listbox', id: uniqueId( 'suggestions' ), hidden: true } );
	search.append( list );
	query.setAttribute( 'role', 'combobox' );
	query.setAttribute( 'aria-autocomplete', 'list' );
	query.setAttribute( 'aria-expanded', 'false' );
	query.setAttribute( 'aria-controls', list.id );
	let token: unknown = Token ? new Token() : undefined;
	let found: Prediction[] = [];
	let active = -1;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let asked = 0;
	let broken = false;

	function close(): void {
		list.hidden = true;
		list.replaceChildren();
		found = [];
		active = -1;
		query.setAttribute( 'aria-expanded', 'false' );
		query.removeAttribute( 'aria-activedescendant' );
	}
	const highlight = ( index: number ): void => {
		active = index;
		[ ...list.querySelectorAll( '[role="option"]' ) ].forEach( ( option, i ) => option.setAttribute( 'aria-selected', String( i === index ) ) );
		const option = list.querySelector( `[role="option"][data-index="${ index }"]` );
		if ( option ) {
			query.setAttribute( 'aria-activedescendant', option.id );
			option.scrollIntoView?.( { block: 'nearest' } );
		} else {
			query.removeAttribute( 'aria-activedescendant' );
		}
	};
	const choose = async ( prediction: Prediction ): Promise<void> => {
		const typedText = query.value;
		close();
		try {
			const place = prediction.toPlace();
			await place.fetchFields( { fields: [ 'addressComponents', 'location' ] } );
			const parts = partsOf( place.addressComponents ?? [] );
			parts.number ||= typedNumber( typedText, parts.street ?? '' );
			fill( parts );
			if ( ! ui.query.closest( '.ffx-address-combined' ) ) {
				query.value = '';
			}
			if ( place.location ) {
				show( place.location );
			}
		} catch ( reason ) {
			refused( 'places', reason );
		}
		// A new session after each choice, as Google bills a search and its place as one.
		token = Token ? new Token() : undefined;
	};
	const render = (): void => {
		list.replaceChildren(
			...found.map( ( prediction, index ) => {
				const main = prediction.mainText?.text ?? prediction.text?.text ?? '';
				const more = prediction.secondaryText?.text ?? '';
				const option = h( 'li', { class: 'ffx-address-suggestion', role: 'option', id: `${ list.id }-${ index }`, 'data-index': index, 'aria-selected': 'false' }, h( 'span', { class: 'ffx-address-suggestion-main' }, main ), more ? h( 'span', { class: 'ffx-address-suggestion-more' }, more ) : null );
				// mousedown keeps the focus in the input, so the list does not close before the click.
				option.addEventListener( 'mousedown', ( event ) => event.preventDefault() );
				option.addEventListener( 'click', () => void choose( prediction ) );
				return option;
			} ),
			h( 'li', { class: 'ffx-address-attribution', role: 'presentation', 'aria-hidden': 'true' }, 'Google' )
		);
		list.hidden = found.length === 0;
		query.setAttribute( 'aria-expanded', String( found.length > 0 ) );
		active = -1;
	};
	const lookUp = async (): Promise<void> => {
		const input = query.value.trim();
		const turn = ++asked;
		if ( [ ...input ].length < 3 || broken ) {
			close();
			return;
		}
		try {
			const { suggestions } = await Suggestions.fetchAutocompleteSuggestions( { input, sessionToken: token, language: ctx.locale, locationBias: center } );
			if ( turn !== asked ) {
				return;
			}
			found = suggestions.map( ( s ) => s.placePrediction ).filter( ( p ): p is Prediction => Boolean( p ) ).slice( 0, 5 );
			render();
		} catch ( reason ) {
			// The Places API (New) is off for the key, or the key does not allow it: the inputs carry on alone.
			broken = true;
			close();
			refused( 'places', reason );
			// Without suggestions the map has nothing to show: the plain inputs again, in one column.
			fallBack();
		}
	};
	function typed(): void {
		clearTimeout( timer );
		timer = setTimeout( () => void lookUp(), 250 );
	}
	query.addEventListener( 'input', typed );
	query.addEventListener( 'keydown', ( event ) => {
		if ( list.hidden || found.length === 0 ) {
			return;
		}
		if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			highlight( ( active + step + found.length ) % found.length );
		} else if ( event.key === 'Enter' && active >= 0 ) {
			// Enter picks the suggestion instead of going to the next step.
			event.preventDefault();
			event.stopPropagation();
			const prediction = found[ active ];
			if ( prediction ) {
				void choose( prediction );
			}
		} else if ( event.key === 'Escape' ) {
			event.stopPropagation();
			close();
		}
	} );
	query.addEventListener( 'blur', () => setTimeout( close, 150 ) );

	if ( keyRefused ) {
		onRefused();
		return;
	}
	refusedListeners.add( onRefused );

	if ( locate ) {
		locate.hidden = false;
		locate.addEventListener( 'click', () => {
			locate.disabled = true;
			navigator.geolocation.getCurrentPosition(
				async ( position ) => {
					const location = { lat: position.coords.latitude, lng: position.coords.longitude };
					try {
						const geocoding = await api.importLibrary( 'geocoding' );
						const Geocoder = geocoding.Geocoder as new () => { geocode( request: Record<string, unknown> ): Promise<{ results: Array<{ address_components: Component[] }> }> };
						let results: Array<{ address_components: Component[] }>;
						try {
							( { results } = await new Geocoder().geocode( { location } ) );
						} catch ( reason ) {
							refused( 'geocoding', reason );
							throw reason;
						}
						const first = results[ 0 ];
						if ( ! first ) {
							throw new Error( 'no address' );
						}
						fill( partsOf( first.address_components ) );
						show( location );
					} catch {
						failed();
					} finally {
						locate.disabled = false;
					}
				},
				() => {
					locate.disabled = false;
					failed();
				},
				{ timeout: 15000, maximumAge: 60000 }
			);
		} );
	}
}
