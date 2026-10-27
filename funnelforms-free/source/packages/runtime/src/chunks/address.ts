/**
 * Chunk runtime-address.js: address fields with their inputs and, with consent, suggestions and a
 * map from Google (Funnelforms Pro). The core renders the group and checks the answer (fields.ts
 * later(), address.ts checkAddress()).
 */
import { addressField } from '../address';
import { fill } from './later';

if ( typeof window !== 'undefined' ) {
	fill( 'address', addressField );
}
