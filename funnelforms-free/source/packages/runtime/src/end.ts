import { h, textOf, trusted } from './dom';
import type { EndResponse } from './types';

type Success = NonNullable<EndResponse[ 'success' ]>;

const safe = ( url: string ): string | null => {
	try {
		const target = new URL( url, window.location.href );
		return target.protocol === 'https:' || target.protocol === 'http:' ? target.href : null;
	} catch {
		return null;
	}
};

/** A check mark that draws itself in. */
function check(): SVGSVGElement {
	const svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
	svg.setAttribute( 'class', 'ffx-success-check' );
	svg.setAttribute( 'viewBox', '0 0 52 52' );
	svg.setAttribute( 'aria-hidden', 'true' );
	svg.innerHTML = '<circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="M15 27l7 7 15-15"/>';
	return svg;
}

/** Confetti that falls once and removes itself; CSS hides it for visitors who prefer less motion. */
function confetti(): HTMLElement {
	const box = h( 'div', { class: 'ffx-confetti', 'aria-hidden': 'true' } );
	const colors = [ 'var(--ffx-color-primary)', '#f5b301', '#2bb673', '#e84a5f', '#3b82f6', '#a855f7' ];
	for ( let i = 0; i < 60; i++ ) {
		const piece = h( 'i' );
		piece.style.left = `${ Math.random() * 100 }%`;
		piece.style.background = colors[ i % colors.length ] as string;
		piece.style.animationDelay = `${ Math.random() * 0.6 }s`;
		piece.style.animationDuration = `${ 1.8 + Math.random() * 1.4 }s`;
		piece.style.setProperty( '--ffx-spin', `${ Math.round( Math.random() * 720 - 360 ) }deg` );
		piece.style.setProperty( '--ffx-drift', `${ Math.round( Math.random() * 80 - 40 ) }px` );
		box.append( piece );
	}
	setTimeout( () => box.remove(), 4000 );
	return box;
}

/** The thank-you page: animation, image, heading, text, answers, downloads and a button. */
export function successPage( success: Success, t: ( key: string ) => string ): HTMLElement {
	const button = success.button ? safe( success.button.url ) : null;
	const downloads = ( success.downloads ?? [] ).map( ( d ) => ( { label: d.label, url: safe( d.url ) } ) ).filter( ( d ): d is { label: string; url: string } => d.url !== null );
	const answers = success.answers ?? [];
	return h(
		'div',
		{ class: 'ffx-success', tabindex: -1 },
		success.animation === 'confetti' ? confetti() : null,
		success.animation === 'check' ? check() : null,
		success.image ? h( 'img', { class: 'ffx-success-image', src: success.image, alt: '' } ) : null,
		success.heading ? h( 'h2', { class: 'ffx-success-heading' }, success.heading ) : null,
		trusted( 'div', success.html, { class: 'ffx-success-text' } ),
		answers.length
			? h(
				'div',
				{ class: 'ffx-success-answers' },
				h( 'h3', {}, t( 'your_answers' ) ),
				h( 'dl', {}, ...answers.flatMap( ( a ) => [ h( 'dt', {}, textOf( a.title ) ), h( 'dd', {}, a.answer ) ] ) )
			)
			: null,
		downloads.length
			? h( 'ul', { class: 'ffx-success-downloads' }, ...downloads.map( ( d ) => h( 'li', {}, h( 'a', { href: d.url, download: '', target: '_blank', rel: 'noopener' }, d.label ) ) ) )
			: null,
		success.button && button
			? h( 'a', { class: 'ffx-button ffx-button-primary ffx-success-button', href: button, target: success.button.newTab ? '_blank' : null, rel: success.button.newTab ? 'noopener' : null }, success.button.label )
			: null
	);
}

/** "You will be forwarded in 3 seconds." with a link to go now; counts down until the redirect. */
export function countdown( href: string, delayMs: number, t: ( key: string ) => string ): HTMLElement {
	const text = h( 'span', { class: 'ffx-redirect-text' } );
	const note = h( 'p', { class: 'ffx-redirect-note', role: 'status' }, text, ' ', h( 'a', { class: 'ffx-redirect-now', href }, t( 'redirect_now' ) ) );
	const end = Date.now() + delayMs;
	const tick = (): void => {
		const left = Math.max( 0, Math.ceil( ( end - Date.now() ) / 1000 ) );
		text.textContent = t( left === 1 ? 'redirect_countdown_one' : 'redirect_countdown' ).replace( '%d', String( left ) );
		if ( left > 0 ) {
			setTimeout( tick, 1000 );
		}
	};
	tick();
	return note;
}
