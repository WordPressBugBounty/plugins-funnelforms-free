/**
 * Colours of an image the user picks from (a logo, a screenshot): the colour of one pixel and the
 * main colours, read from the pixels of a canvas (RGBA, four bytes a pixel).
 */
import { toHex } from './themes';

/** The colour of the pixel at x, y as #rrggbb; null outside the image or where it is transparent. */
export function pixelColor( data: Uint8ClampedArray, width: number, x: number, y: number ): string | null {
	const height = data.length / 4 / width;
	if ( x < 0 || y < 0 || x >= width || y >= height ) {
		return null;
	}
	const i = ( Math.floor( y ) * width + Math.floor( x ) ) * 4;
	if ( ( data[ i + 3 ] ?? 0 ) < 128 ) {
		return null;
	}
	return toHex( `rgb(${ data[ i ] ?? 0 },${ data[ i + 1 ] ?? 0 },${ data[ i + 2 ] ?? 0 })` );
}

/** Whether a colour is a colour rather than white, black or grey (as Domain\Form\Branding sees it). */
export function colourful( r: number, g: number, b: number ): boolean {
	const max = Math.max( r, g, b );
	const min = Math.min( r, g, b );
	const lightness = ( max + min ) / 510;
	if ( max === min || lightness < 0.12 || lightness > 0.92 ) {
		return false;
	}
	return ( max - min ) / 255 / ( 1 - Math.abs( 2 * lightness - 1 ) ) > 0.25;
}

/**
 * The main colours of an image, most pixels first, colourful ones before white, black and grey;
 * similar shades (anti-aliased edges) count as one, their average. Specks below 2 % are left out.
 */
export function mainColors( data: Uint8ClampedArray, max = 6 ): string[] {
	const buckets = new Map<string, [ number, number, number, number ]>();
	let total = 0;
	// Every pixel of small images, a grid of about 40 000 of large ones.
	const step = Math.max( 1, Math.floor( data.length / 4 / 40000 ) ) * 4;
	for ( let i = 0; i < data.length; i += step ) {
		if ( ( data[ i + 3 ] ?? 0 ) < 128 ) {
			continue;
		}
		const r = data[ i ] ?? 0;
		const g = data[ i + 1 ] ?? 0;
		const b = data[ i + 2 ] ?? 0;
		const key = `${ r >> 5 }-${ g >> 5 }-${ b >> 5 }`;
		const sum = buckets.get( key ) ?? [ 0, 0, 0, 0 ];
		buckets.set( key, [ sum[ 0 ] + 1, sum[ 1 ] + r, sum[ 2 ] + g, sum[ 3 ] + b ] );
		total++;
	}
	const found = [ ...buckets.values() ]
		.filter( ( [ count ] ) => count * 50 >= total )
		.map( ( [ count, r, g, b ] ) => ( { count, rgb: [ Math.round( r / count ), Math.round( g / count ), Math.round( b / count ) ] as const } ) )
		.sort( ( a, b ) => Number( colourful( ...b.rgb ) ) - Number( colourful( ...a.rgb ) ) || b.count - a.count );
	const out: string[] = [];
	for ( const { rgb } of found ) {
		const near = out.some( ( hex ) => {
			const [ x, y, z ] = [ 1, 3, 5 ].map( ( p ) => parseInt( hex.slice( p, p + 2 ), 16 ) ) as [ number, number, number ];
			return Math.hypot( rgb[ 0 ] - x, rgb[ 1 ] - y, rgb[ 2 ] - z ) < 24;
		} );
		const hex = toHex( `rgb(${ rgb.join( ',' ) })` );
		if ( hex && ! near && out.length < max ) {
			out.push( hex );
		}
	}
	return out;
}
