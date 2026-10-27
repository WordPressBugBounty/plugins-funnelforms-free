/**
 * Names of field types and default texts of new fields, in the editor's language.
 */
import type { Labels } from '../document';
import { proLabel } from '../edition';
import { __, sprintf } from './i18n';

export function stepFieldName( type: string ): string {
	const names: Record<string, string> = {
		choice: __( 'Choice', 'funnelforms-pro' ),
		dropdown: __( 'Dropdown', 'funnelforms-pro' ),
		text: __( 'Short text', 'funnelforms-pro' ),
		textarea: __( 'Long text', 'funnelforms-pro' ),
		email: __( 'E-mail address', 'funnelforms-pro' ),
		phone: __( 'Phone number', 'funnelforms-pro' ),
		url: __( 'Web address', 'funnelforms-pro' ),
		number: __( 'Number', 'funnelforms-pro' ),
		date: __( 'Date', 'funnelforms-pro' ),
		time: __( 'Time', 'funnelforms-pro' ),
		slider: __( 'Slider', 'funnelforms-pro' ),
		rating: __( 'Rating', 'funnelforms-pro' ),
		content: __( 'Text and media', 'funnelforms-pro' ),
		file: __( 'File upload', 'funnelforms-pro' ),
		address: __( 'Address', 'funnelforms-pro' ),
		signature: __( 'Signature', 'funnelforms-pro' ),
		repeat: __( 'Repeat group', 'funnelforms-pro' ),
		booking: __( 'Appointment', 'funnelforms-pro' ),
		result: __( 'Live result', 'funnelforms-pro' ),
	};
	return names[ type ] ?? type;
}

export function contactFieldName( type: string ): string {
	const names: Record<string, string> = {
		salutation: __( 'Salutation', 'funnelforms-pro' ),
		name: __( 'Name', 'funnelforms-pro' ),
		email: __( 'E-mail address', 'funnelforms-pro' ),
		phone: __( 'Phone number', 'funnelforms-pro' ),
		phone_verification: __( 'Phone verification', 'funnelforms-pro' ),
		text: __( 'Text', 'funnelforms-pro' ),
		textarea: __( 'Long text', 'funnelforms-pro' ),
		select: __( 'List', 'funnelforms-pro' ),
		checkbox: __( 'Checkbox', 'funnelforms-pro' ),
		consent: __( 'Consent', 'funnelforms-pro' ),
		html: __( 'HTML', 'funnelforms-pro' ),
		captcha: __( 'Captcha', 'funnelforms-pro' ),
	};
	return names[ type ] ?? type;
}

/** Texts of new fields. They go into the form, so they should be in the form's language. */
export function defaultLabels(): Labels {
	return {
		question: __( 'New question', 'funnelforms-pro' ),
		option: __( 'Option %d', 'funnelforms-pro' ),
		contactTitle: __( 'Your contact details', 'funnelforms-pro' ),
		send: __( 'Send', 'funnelforms-pro' ),
		thanks: __( 'Thank you! We will get back to you soon.', 'funnelforms-pro' ),
		name: __( 'Name', 'funnelforms-pro' ),
		email: __( 'E-mail address', 'funnelforms-pro' ),
		phone: __( 'Phone number', 'funnelforms-pro' ),
		text: __( 'Your message', 'funnelforms-pro' ),
		consent: __( 'I agree to the privacy policy.', 'funnelforms-pro' ),
		salutation: __( 'Salutation', 'funnelforms-pro' ),
		dropzone: __( 'Drop files here or click to upload.', 'funnelforms-pro' ),
		add: __( 'Add', 'funnelforms-pro' ),
		item: __( 'Item %d', 'funnelforms-pro' ),
		clear: __( 'Clear', 'funnelforms-pro' ),
		typeName: __( 'Type your name instead', 'funnelforms-pro' ),
		next: __( 'Next', 'funnelforms-pro' ),
		quizResult: __( 'Your result', 'funnelforms-pro' ),
		quizPoints: __( 'You scored %1$s of %2$s points.', 'funnelforms-pro' ),
		quizRight: __( 'You answered %1$s of %2$s questions right.', 'funnelforms-pro' ),
		newsletter: __( 'Yes, send me news by e-mail.', 'funnelforms-pro' ),
		liveResult: __( 'Your estimate', 'funnelforms-pro' ),
		liveTotal: __( 'Total', 'funnelforms-pro' ),
	};
}

/** What a problem from the server means, for people. Unknown ones are shown as they are. */
export function problemText( problem: string ): string {
	// Funnelforms Free does not publish or show a form with a Pro feature (Edition::problems()).
	const pro = 'free' === process.env.FUNNELFORMS_EDITION ? /^pro feature (\S+)$/.exec( problem ) : null;
	if ( pro ) {
		return sprintf( /* translators: %s: name of a Pro feature */ __( 'The form uses “%s”, which is part of Funnelforms Pro, so Funnelforms Free cannot publish it.', 'funnelforms-pro' ), proLabel( pro[ 1 ] ?? '' ) );
	}
	const rules: Array<[ RegExp, string ]> = [
		[ /^edge (\S+) connects unknown nodes$/, __( 'A path leads to a step that no longer exists.', 'funnelforms-pro' ) ],
		[ /^start node (\S+) does not exist$/, __( 'The form has no start step.', 'funnelforms-pro' ) ],
		[ /^edge (\S+) refers to unknown field/, __( 'A path asks for a field that no longer exists.', 'funnelforms-pro' ) ],
		[ /^edge (\S+) refers to unknown option/, __( 'A path asks for an answer that no longer exists.', 'funnelforms-pro' ) ],
		[ /shows a loader but does not move on by itself$/, __( 'A loading screen needs a waiting time and no button.', 'funnelforms-pro' ) ],
		[ /^duplicate/, __( 'Two elements have the same ID.', 'funnelforms-pro' ) ],
		[ /^token refers to unknown calculation/, __( 'A text shows a calculation that no longer exists.', 'funnelforms-pro' ) ],
		[ /^edge \S+ refers to unknown calculation/, __( 'A path asks for a calculation that no longer exists.', 'funnelforms-pro' ) ],
		[ /refers to unknown calculation/, __( 'A setting uses a calculation that no longer exists.', 'funnelforms-pro' ) ],
		[ /^\/settings\/payment|^payment |payment needs/, __( 'The payment is incomplete: choose the account and the amount.', 'funnelforms-pro' ) ],
		[ /^\/settings\/doubleOptIn|^double opt-in/, __( 'The double opt-in needs an e-mail field of a contact step.', 'funnelforms-pro' ) ],
		[ /^\/settings\/abandonment|^abandonment/, __( 'The reminder to visitors who leave needs an e-mail field and, if visitors allow it with a box, that box.', 'funnelforms-pro' ) ],
		[ /^\/settings\/access/, __( 'A setting under "Access" is incomplete.', 'funnelforms-pro' ) ],
		[ /^\/calculations\//, __( 'A calculation is incomplete.', 'funnelforms-pro' ) ],
		[ /^\/actions\//, __( 'An action under "After sending" is incomplete.', 'funnelforms-pro' ) ],
		[ /^action:crm/, __( 'A CRM, newsletter or spreadsheet action under "After sending" needs a tool and a connection.', 'funnelforms-pro' ) ],
		[ /^action \S+ refers to unknown node/, __( 'An action belongs to a contact step that no longer exists.', 'funnelforms-pro' ) ],
		[ /^action \S+ waits for a payment/, __( 'An action waits for a payment, but the form takes none.', 'funnelforms-pro' ) ],
		[ /^booking_type_missing$/, __( 'An appointment question has no appointment type.', 'funnelforms-pro' ) ],
		[ /^booking_calendar_reconnect$/, __( 'An appointment type still uses the calendar connected in Funnelforms 3. Connect a calendar for conflicts or save the appointment type again.', 'funnelforms-pro' ) ],
	];
	for ( const [ pattern, message ] of rules ) {
		if ( pattern.test( problem ) ) {
			return message;
		}
	}
	return problem;
}

/** The problems for people, each text once (one incomplete action yields several schema errors). */
export function problemTexts( problems: string[] ): string[] {
	return [ ...new Set( problems.map( problemText ) ) ];
}

export function rightName( capability: string ): string {
	if ( 'unfiltered_html' === capability ) {
		return __( 'Tracking code, scripts and custom CSS need the right to use unfiltered HTML.', 'funnelforms-pro' );
	}
	return __( 'Changes to actions, redirects and entry settings need the right to see entries.', 'funnelforms-pro' );
}
