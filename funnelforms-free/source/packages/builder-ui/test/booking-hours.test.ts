import { describe, expect, it } from 'vitest';
import type { BookingConfig } from '../src/api';
import { durationFits, durationName, durationsIn } from '../src/ui/BookingTypes';
import { bookingProblems, hoursOf, meetingProblem, nextSpan, noticeMinutes, noticeOf, overlapping, previewSlots, validSpan, weekOf, weekSummary } from '../src/booking-hours';

describe( 'weekly hours', () => {
	it( 'turns rules into one row per weekday and back', () => {
		const rules = [
			{ days: [ 1, 2, 3, 4, 5 ], from: '09:00', to: '12:00' },
			{ days: [ 1, 2, 3, 4, 5 ], from: '13:00', to: '17:00' },
			{ days: [ 6 ], from: '10:00', to: '14:00' },
		];
		const week = weekOf( rules );
		expect( week[ 1 ] ).toEqual( [
			{ from: '09:00', to: '12:00' },
			{ from: '13:00', to: '17:00' },
		] );
		expect( week[ 7 ] ).toEqual( [] );
		expect( hoursOf( week ) ).toEqual( rules );
	} );

	it( 'sorts spans and drops doubles', () => {
		const week = weekOf( [
			{ days: [ 2 ], from: '14:00', to: '16:00' },
			{ days: [ 2 ], from: '08:00', to: '10:00' },
			{ days: [ 2 ], from: '08:00', to: '10:00' },
		] );
		expect( week[ 2 ]?.map( ( s ) => s.from ) ).toEqual( [ '08:00', '14:00' ] );
	} );

	it( 'checks spans and proposes the next one', () => {
		expect( validSpan( { from: '09:00', to: '08:00' } ) ).toBe( false );
		expect( validSpan( { from: '09:00', to: '24:00' } ) ).toBe( true );
		expect( overlapping( [ { from: '09:00', to: '12:00' }, { from: '11:00', to: '13:00' } ] ) ).toBe( true );
		expect( overlapping( [ { from: '09:00', to: '12:00' }, { from: '12:00', to: '13:00' } ] ) ).toBe( false );
		expect( nextSpan( [] ) ).toEqual( { from: '09:00', to: '17:00' } );
		expect( nextSpan( [ { from: '09:00', to: '12:00' } ] ) ).toEqual( { from: '13:00', to: '14:00' } );
		expect( nextSpan( [ { from: '20:00', to: '23:30' } ] ) ).toEqual( { from: '23:00', to: '24:00' } );
	} );

	it( 'writes the notice in the largest unit that fits', () => {
		expect( noticeOf( 0 ) ).toEqual( { amount: 0, unit: 'minutes' } );
		expect( noticeOf( 90 ) ).toEqual( { amount: 90, unit: 'minutes' } );
		expect( noticeOf( 120 ) ).toEqual( { amount: 2, unit: 'hours' } );
		expect( noticeOf( 2880 ) ).toEqual( { amount: 2, unit: 'days' } );
		expect( noticeMinutes( 2, 'days' ) ).toBe( 2880 );
		expect( noticeMinutes( -3, 'hours' ) ).toBe( 0 );
	} );

	it( 'sums the week up in a line', () => {
		const names = [ '', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So' ];
		const day = ( d: number ): string => names[ d ] ?? '';
		expect(
			weekSummary(
				[
					{ days: [ 1, 2, 3, 4, 5 ], from: '09:00', to: '12:00' },
					{ days: [ 1, 2, 3, 4 ], from: '13:00', to: '17:00' },
					{ days: [ 7 ], from: '10:00', to: '12:00' },
				],
				day
			)
		).toBe( 'Mo–Do 09:00–12:00, 13:00–17:00 · Fr 09:00–12:00 · So 10:00–12:00' );
		expect( weekSummary( [], day ) ).toBe( '' );
	} );
} );

function config( change: Partial<BookingConfig> = {} ): BookingConfig {
	return { version: 2, kind: 'personal', location: '', timezone: '', hours: [ { days: [ 1, 2, 3, 4, 5 ], from: '09:00', to: '17:00' } ], durations: [ 30 ], interval: 30, bufferBefore: 0, bufferAfter: 15, notice: 60, horizon: { mode: 'rolling', amount: 2, unit: 'week' }, closed: [], special: [], dailyLimit: 0, staff: [], assignment: 'roundRobin', invitation: true, reminders: [], calendars: { write: '', conflicts: [] }, ...change };
}

describe( 'appointment type editor', () => {
	it( 'finds what keeps a type from being saved', () => {
		expect( bookingProblems( 'Beratung', config() ) ).toEqual( [] );
		expect( bookingProblems( '  ', config( { durations: [], hours: [ { days: [ 1 ], from: '10:00', to: '09:00' } ] } ) ) ).toEqual( [ 'no_title', 'no_durations', 'no_hours', 'invalid_hours' ] );
		expect(
			bookingProblems(
				'Beratung',
				config( {
					kind: 'video',
					location: 'meet.example.test/abc',
					special: [ { date: '', hours: [] } ],
					closed: [ { from: '2026-12-24', to: '2026-12-20' } ],
					horizon: { mode: 'range', from: '2026-11-01', to: '' },
				} )
			)
		).toEqual( [ 'invalid_special', 'invalid_closed', 'invalid_range', 'invalid_video_link' ] );
		expect( bookingProblems( 'Beratung', config( { kind: 'video', location: 'https://meet.example.test/abc', special: [ { date: '2026-12-24', hours: [] } ] } ) ) ).toEqual( [] );
	} );

	it( 'needs the calendar or account a video meeting service is made in, not a fixed link', () => {
		const video = ( change: Partial<BookingConfig> ) => config( { kind: 'video', ...change } );
		expect( bookingProblems( 'Beratung', video( { meeting: 'meet' } ) ) ).toEqual( [ 'meeting_needs_google' ] );
		expect( meetingProblem( video( { meeting: 'meet', calendars: { write: 'google:abc', conflicts: [] } } ) ) ).toBeNull();
		expect( meetingProblem( video( { meeting: 'meet', calendars: { write: 'microsoft:abc', conflicts: [] } } ) ) ).toBe( 'meeting_needs_google' );
		expect( meetingProblem( video( { meeting: 'teams', calendars: { write: 'microsoft:abc', conflicts: [] } } ) ) ).toBeNull();
		expect( meetingProblem( video( { meeting: 'teams', calendars: { write: 'owner', conflicts: [] } } ) ) ).toBeNull();
		expect( meetingProblem( video( { meeting: 'teams' } ) ) ).toBe( 'meeting_needs_microsoft' );
		expect( meetingProblem( video( { meeting: 'zoom' } ) ) ).toBe( 'meeting_needs_zoom' );
		expect( meetingProblem( video( { meeting: 'zoom', meetingAccount: 'owner' } ) ) ).toBeNull();
		// Only video calls make meetings; the stored service of another kind does not count.
		expect( meetingProblem( config( { kind: 'call', meeting: 'zoom' } ) ) ).toBeNull();
	} );

	it( 'previews the first free times from the notice on, without closed days and with special days', () => {
		// Wednesday, 21 October 2026, 10:07: an hour of notice leaves 11:30 as the first start.
		const now = new Date( 2026, 9, 21, 10, 7 );
		const days = previewSlots( config( { closed: [ { from: '2026-10-23', to: '2026-10-23' } ], special: [ { date: '2026-10-24', hours: [ { from: '10:00', to: '11:00' } ] } ] } ), now );
		expect( days ).toEqual( [
			{ date: '2026-10-21', times: [ '11:30', '12:00', '12:30', '13:00', '13:30', '14:00' ], more: 5 },
			{ date: '2026-10-22', times: [ '09:00', '09:30', '10:00', '10:30', '11:00', '11:30' ], more: 10 },
			{ date: '2026-10-24', times: [ '10:00', '10:30' ], more: 0 },
		] );
		// The first duration has to fit before the span ends; starts follow the interval.
		expect( previewSlots( config( { durations: [ 90, 30 ], interval: 60, notice: 0 } ), now, 1 )[ 0 ]?.times ).toEqual( [ '11:00', '12:00', '13:00', '14:00', '15:00' ] );
	} );

	it( 'keeps the preview within the booking window', () => {
		const now = new Date( 2026, 9, 21, 18, 0 );
		expect( previewSlots( config( { horizon: { mode: 'rolling', amount: 1, unit: 'day' } } ), now ).map( ( d ) => d.date ) ).toEqual( [ '2026-10-22' ] );
		expect( previewSlots( config( { horizon: { mode: 'range', from: '2026-11-02', to: '2026-11-03' } } ), now ).map( ( d ) => d.date ) ).toEqual( [ '2026-11-02', '2026-11-03' ] );
		expect( previewSlots( config( { horizon: { mode: 'range', from: '2026-11-02', to: '' } } ), now ) ).toEqual( [] );
		expect( previewSlots( config( { hours: [] } ), now ) ).toEqual( [] );
	} );
} );

describe( 'appointments over whole days', () => {
	it( 'previews one start a day, at the opening, when enough working days follow', () => {
		// Wednesday, 21 October 2026, 07:00; weekdays 9 to 17 (the defaults of these tests).
		const now = new Date( 2026, 9, 21, 7, 0 );
		const days = previewSlots( config( { durationUnit: 'day', durations: [ 5 * 1440 ], notice: 0 } ), now );
		expect( days ).toEqual( [
			{ date: '2026-10-21', times: [ '09:00' ], more: 0 },
			{ date: '2026-10-22', times: [ '09:00' ], more: 0 },
			{ date: '2026-10-23', times: [ '09:00' ], more: 0 },
		] );
		// Only Mondays open: each Monday of the two weeks ahead starts four Mondays in a row.
		const mondays = config( { durationUnit: 'day', durations: [ 4 * 1440 ], hours: [ { days: [ 1 ], from: '08:00', to: '16:00' } ] } );
		expect( previewSlots( mondays, now ).map( ( d ) => d.date + ' ' + d.times.join() ) ).toEqual( [ '2026-10-26 08:00', '2026-11-02 08:00' ] );
		// Without any hours there is no working day to run over.
		expect( previewSlots( config( { durationUnit: 'day', durations: [ 1440 ], hours: [] } ), now ) ).toEqual( [] );
	} );
} );

describe( 'duration units', () => {
	it( 'keeps durations that fit the new unit, else offers its first choice', () => {
		expect( durationsIn( 'hour', [ 30, 120 ] ) ).toEqual( [ 30, 120 ] );
		expect( durationsIn( 'day', [ 30, 120 ] ) ).toEqual( [ 1440 ] );
		expect( durationsIn( 'minute', [ 7200 ] ) ).toEqual( [ 30 ] );
		expect( durationFits( 14 * 1440, 'day' ) ).toBe( true );
		expect( durationFits( 15 * 1440, 'day' ) ).toBe( false );
		expect( durationFits( 2500, 'minute' ) ).toBe( false );
		expect( durationName( 7200 ) ).toBe( '5 days' );
		expect( durationName( 1440 ) ).toBe( '1 day' );
		expect( durationName( 90 ) ).toBe( '1 h 30 min' );
	} );
} );

