import type { AddressField } from '@funnelforms/form-schema';
import { loadWithConsent } from './consent';
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

interface MapsPlace {
	addressComponents?: Component[];
	location?: unknown;
	fetchFields( options: { fields: string[] } ): Promise<unknown>;
}

interface MapsApi {
	importLibrary( name: string ): Promise<Record<string, unknown>>;
	Marker?: new ( options: Record<string, unknown> ) => { setMap( map: unknown ): void };
}

declare global {
	interface Window {
		google?: { maps?: MapsApi };
		ffxMapsReady?: () => void;
	}
}

let maps: Promise<MapsApi> | null = null;

/** Loads the Maps JavaScript API once, with the site's key. */
function loadMaps( key: string ): Promise<MapsApi> {
	maps ??= new Promise( ( resolve, reject ) => {
		window.ffxMapsReady = () => ( window.google?.maps ? resolve( window.google.maps ) : reject( new Error( 'maps' ) ) );
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
const COMPONENTS: Record<string, string> = { route: 'street', street_number: 'number', postal_code: 'zip', locality: 'city', country: 'country' };

/**
 * Address field (chunk runtime-address.js): inputs for the parts (or one line), as in 3.x. With a
 * Maps key and suggestions on, a search box above them fills the parts and a map shows the place.
 * Without Google the inputs still work on their own. Fills the group the core rendered (fields.ts
 * later()).
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
	if ( field.props.placesAutocomplete && ctx.mapsKey ) {
		const search = h( 'div', { class: 'ffx-address-search' } );
		const map = h( 'div', { class: 'ffx-address-map' } );
		// The browser asks the visitor before it tells the position; nothing happens before the click.
		const locate = field.props.locate && 'geolocation' in navigator ? h( 'button', { type: 'button', class: 'ffx-address-locate', hidden: true }, ctx.t( 'use_location' ) ) : null;
		grid.before( search );
		if ( locate ) {
			search.after( locate );
		}
		grid.after( map );
		const failed = (): void => {
			error.textContent = ctx.t( 'location_failed' );
			error.hidden = false;
		};
		const key = ctx.mapsKey;
		// Google loads only with consent; the inputs work without it.
		const ask = loadWithConsent( ctx.t( 'load_maps' ), () => void showGoogle( field, key, search, map, locate, failed, ( parts ) => {
			for ( const key of Object.keys( inputs ) ) {
				const text = key === 'address' ? [ `${ parts.street ?? '' } ${ parts.number ?? '' }`.trim(), `${ parts.zip ?? '' } ${ parts.city ?? '' }`.trim() ].filter( Boolean ).join( ', ' ) : parts[ key ] ?? '';
				value[ key ] = text;
				( inputs[ key ] as HTMLInputElement ).value = text;
			}
			error.hidden = true;
			ctx.set( field.id, { ...value } );
		} ).catch( () => {
			search.remove();
			map.remove();
			locate?.remove();
		} ), search );
		if ( ask ) {
			search.replaceWith( ask );
		}
	}
	r.focus = Object.values( inputs )[ 0 ] ?? null;
}

interface Component {
	longText?: string;
	long_name?: string;
	types: string[];
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

async function showGoogle( field: AddressField, key: string, search: HTMLElement, mapBox: HTMLElement, locate: HTMLButtonElement | null, failed: () => void, fill: ( parts: AddressValue ) => void ): Promise<void> {
	const api = await loadMaps( key );
	const [ places, mapsLib ] = await Promise.all( [ api.importLibrary( 'places' ), api.importLibrary( 'maps' ) ] );
	const Search = places.PlaceAutocompleteElement as new ( options: Record<string, unknown> ) => HTMLElement;
	const GoogleMap = mapsLib.Map as new ( el: HTMLElement, options: Record<string, unknown> ) => { setCenter( p: unknown ): void; setZoom( z: number ): void };
	const map = new GoogleMap( mapBox, { center: { lat: field.props.start.lat, lng: field.props.start.lng }, zoom: field.props.zoom, disableDefaultUI: true, zoomControl: true } );
	const box = new Search( {} );
	search.append( box );
	let marker: { setMap( map: unknown ): void } | null = null;
	const show = ( location: unknown ): void => {
		marker?.setMap( null );
		marker = api.Marker ? new api.Marker( { map, position: location } ) : null;
		map.setCenter( location );
		map.setZoom( 16 );
	};

	const chosen = async ( place: MapsPlace | undefined ): Promise<void> => {
		if ( ! place ) {
			return;
		}
		await place.fetchFields( { fields: [ 'addressComponents', 'location' ] } );
		fill( partsOf( place.addressComponents ?? [] ) );
		if ( place.location ) {
			show( place.location );
		}
	};

	if ( locate ) {
		locate.hidden = false;
		locate.addEventListener( 'click', () => {
			locate.disabled = true;
			navigator.geolocation.getCurrentPosition(
				async ( position ) => {
					try {
						const geocoding = await api.importLibrary( 'geocoding' );
						const Geocoder = geocoding.Geocoder as new () => { geocode( request: Record<string, unknown> ): Promise<{ results: Array<{ address_components: Component[] }> }> };
						const location = { lat: position.coords.latitude, lng: position.coords.longitude };
						const { results } = await new Geocoder().geocode( { location } );
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
	// Event names of the current and the earlier version of the element.
	box.addEventListener( 'gmp-select', ( event ) => void chosen( ( event as Event & { placePrediction?: { toPlace(): MapsPlace } } ).placePrediction?.toPlace() ) );
	box.addEventListener( 'gmp-placeselect', ( event ) => void chosen( ( event as Event & { place?: MapsPlace } ).place ) );
}
