/**
 * Chunk runtime-repeat.js: repeat groups with their items (Funnelforms Pro). The core renders the
 * group and lends the chunk its field renderer and checks (fields.ts later()).
 */
import { repeatField } from '../repeat';
import { fill } from './later';

if ( typeof window !== 'undefined' ) {
	fill( 'repeat', repeatField );
}
