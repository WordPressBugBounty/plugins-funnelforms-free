/**
 * Icons of the field types, the contact step and the end, for the palette and the canvas.
 */
import React from 'react';

const PATHS: Record<string, string> = {
	choice: 'M4 5h5v5H4zM5.5 7.5l1 1 2-2M13 7.5h7M4 14h5v5H4zM13 16.5h7',
	dropdown: 'M3 7h18v10H3zM15 11l2 2 2-2M6 12h5',
	text: 'M5 7V5h14v2M12 5v14M9 19h6',
	textarea: 'M4 6h16M4 10h16M4 14h16M4 18h10',
	email: 'M3 6h18v12H3zM3 7l9 6 9-6',
	phone: 'M8 3h8v18H8zM11 18h2',
	url: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
	number: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
	date: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
	time: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
	slider: 'M4 12h7M17 12h3M14 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
	rating: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
	content: 'M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15 9.5a1.5 1.5 0 1 0 0-.01',
	file: 'M14 3H6v18h12V7zM14 3v4h4M12 11v6M9 14l3-3 3 3',
	address: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
	signature: 'M3 17c3-4 5-9 7-9s-1 9 1 9 3-4 4-4 1 3 3 3 2-1 3-1M3 21h18',
	repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
	booking: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4',
	result: 'M5 3h14v18H5zM8 7h8v3H8zM8 14h2M14 14h2M8 17h2M14 17h2',
	contact: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
	end: 'M5 21V4M5 4h11l-2 4 2 4H5',
	salutation: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
	name: 'M3 5h18v14H3zM9 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 16a3 3 0 0 1 6 0M14 10h4M14 14h3',
	select: 'M3 7h18v10H3zM15 11l2 2 2-2M6 12h5',
	checkbox: 'M4 4h16v16H4zM8 12l3 3 5-6',
	consent: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
	html: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
	captcha: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
};

/** The icon of a type; a plain square for types without one. */
export function TypeIcon( { type, size = 18 }: { type: string; size?: number } ) {
	return (
		<svg className="ffxb-icon ffxb-type-icon" viewBox="0 0 24 24" width={ size } height={ size } fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d={ PATHS[ type ] ?? 'M4 4h16v16H4z' } />
		</svg>
	);
}
