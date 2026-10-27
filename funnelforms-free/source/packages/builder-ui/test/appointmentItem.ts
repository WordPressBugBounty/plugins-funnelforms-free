import type { AppointmentItem } from '../src/appointments';

/** Monday, 19 October 2026, 14:00 in Berlin. */
export const NOW = Date.parse( '2026-10-19T12:00:00Z' );

export function item( id: number, start: string, changes: Partial<AppointmentItem> = {} ): AppointmentItem {
	const duration = changes.duration ?? 30;
	return {
		id,
		entryId: 100 + id,
		status: 'confirmed',
		outcome: null,
		start,
		end: new Date( Date.parse( start ) + duration * 60000 ).toISOString().replace( '.000', '' ),
		duration,
		timezone: 'Europe/Berlin',
		type: { ref: 'bt:1', title: 'Erstgespräch', kind: 'personal', location: 'Hauptstraße 1' },
		people: [ { id: 7, name: 'Mia' } ],
		visitor: { name: 'Ada', email: 'ada@example.org', phone: '' },
		form: { id: 3, title: 'Termin' },
		changedBy: null,
		message: null,
		changeable: Date.parse( start ) > NOW,
		markable: Date.parse( start ) <= NOW,
		...changes,
	};
}
