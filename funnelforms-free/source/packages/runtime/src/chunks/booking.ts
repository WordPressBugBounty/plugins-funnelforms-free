/**
 * Chunk runtime-booking.js: appointment fields with their month view and free times (Funnelforms
 * Pro). The core renders the group and checks the answer (fields.ts later(), booking.ts isBooking()).
 */
import { bookingField } from '../booking';
import { fill } from './later';

if ( typeof window !== 'undefined' ) {
	fill( 'booking', bookingField );
}
