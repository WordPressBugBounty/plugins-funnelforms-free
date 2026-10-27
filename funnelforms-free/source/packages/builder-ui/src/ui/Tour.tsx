/**
 * A short tour through the builder: where questions come from, the canvas, the properties, the
 * preview and publishing. It starts by itself the first time someone opens the builder in this
 * browser and again from the "?" in the top bar. Each stop marks its part of the screen.
 */
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { __, sprintf } from './i18n';
import { Button } from './ui';

const SEEN = 'ffxb-tour-seen';
const WIDTH = 320;

interface Stop {
	target: string;
	title: string;
	text: string;
}

function stops(): Stop[] {
	return [
		{
			target: '.ffxb-palette',
			title: __( 'Questions and content', 'funnelforms-pro' ),
			text: __( 'Click a question type or drag it onto the canvas. Contact details, texts, images and appointments are here too.', 'funnelforms-pro' ),
		},
		{
			target: '.ffxb-canvas',
			title: __( 'The funnel', 'funnelforms-pro' ),
			text: __( 'Each card is a step. Draw a line from the dot on the right of a step to the next one; answers can lead to different steps.', 'funnelforms-pro' ),
		},
		{
			target: '.ffxb-inspector',
			title: __( 'Properties', 'funnelforms-pro' ),
			text: __( 'Click a step to change its texts, answers and conditions. With nothing selected you set the design, what happens after sending and the settings of the form.', 'funnelforms-pro' ),
		},
		{
			target: '[data-tour="preview"]',
			title: __( 'Preview', 'funnelforms-pro' ),
			text: __( 'Try the form as visitors see it, on a computer, tablet or phone. Nothing is stored.', 'funnelforms-pro' ),
		},
		{
			target: '[data-tour="publish"]',
			title: __( 'Publish', 'funnelforms-pro' ),
			text: __( 'Changes are saved as a draft as you work. Visitors see them once you publish; then embed the form with the shortcode, the block, the Elementor widget or its own page.', 'funnelforms-pro' ),
		},
	];
}

/** Whether the tour was shown in this browser; storage that cannot be used counts as seen. */
export function tourSeen(): boolean {
	try {
		return '1' === window.localStorage.getItem( SEEN );
	} catch {
		return true;
	}
}

function markSeen(): void {
	try {
		window.localStorage.setItem( SEEN, '1' );
	} catch {
		// Shown again next time; nothing else depends on it.
	}
}

/** Where the box goes next to its part of the screen, inside the window. */
export function placement( rect: { top: number; left: number; right: number; bottom: number; width: number; height: number }, view: { width: number; height: number } ): { top: number; left: number } {
	const clampLeft = ( x: number ): number => Math.max( 12, Math.min( x, view.width - WIDTH - 12 ) );
	const clampTop = ( y: number ): number => Math.max( 12, Math.min( y, view.height - 260 ) );
	if ( rect.height < 80 ) {
		// A button: below it, ending at its right edge.
		return { top: clampTop( rect.bottom + 10 ), left: clampLeft( rect.right - WIDTH ) };
	}
	if ( rect.right + 12 + WIDTH <= view.width ) {
		return { top: clampTop( rect.top + 24 ), left: rect.right + 12 };
	}
	if ( rect.left - 12 - WIDTH >= 0 ) {
		return { top: clampTop( rect.top + 24 ), left: rect.left - 12 - WIDTH };
	}
	return { top: clampTop( rect.top + 24 ), left: clampLeft( rect.left + rect.width / 2 - WIDTH / 2 ) };
}

export function Tour( { onClose }: { onClose: () => void } ) {
	const all = stops();
	const [ index, setIndex ] = useState( 0 );
	const [ at, setAt ] = useState<{ top: number; left: number } | null>( null );
	const stop = all[ index ] as Stop;

	useLayoutEffect( () => {
		const element = document.querySelector<HTMLElement>( stop.target );
		const place = (): void => {
			if ( element ) {
				setAt( placement( element.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight } ) );
			}
		};
		element?.classList.add( 'ffxb-tour-target' );
		place();
		window.addEventListener( 'resize', place );
		return () => {
			element?.classList.remove( 'ffxb-tour-target' );
			window.removeEventListener( 'resize', place );
		};
	}, [ stop.target ] );

	const close = (): void => {
		markSeen();
		onClose();
	};

	useEffect( () => {
		const key = ( e: KeyboardEvent ): void => {
			if ( 'Escape' === e.key ) {
				close();
			}
		};
		window.addEventListener( 'keydown', key );
		return () => window.removeEventListener( 'keydown', key );
	} );

	const last = index === all.length - 1;
	return (
		<div className="ffxb-tour" role="dialog" aria-modal="false" aria-labelledby="ffxb-tour-title" style={ at ? { top: at.top, left: at.left } : { top: 80, left: 24 } }>
			<p className="ffxb-tour__count">{ sprintf( __( '%1$d of %2$d', 'funnelforms-pro' ), index + 1, all.length ) }</p>
			<h2 id="ffxb-tour-title" className="ffxb-tour__title">
				{ stop.title }
			</h2>
			<p className="ffxb-tour__text">{ stop.text }</p>
			<div className="ffxb-tour__actions">
				<Button size="sm" variant="ghost" onClick={ close }>
					{ __( 'Skip tour', 'funnelforms-pro' ) }
				</Button>
				{ index > 0 ? (
					<Button size="sm" onClick={ () => setIndex( index - 1 ) }>
						{ __( 'Back', 'funnelforms-pro' ) }
					</Button>
				) : null }
				<Button size="sm" variant="primary" onClick={ () => ( last ? close() : setIndex( index + 1 ) ) }>
					{ last ? __( 'Done', 'funnelforms-pro' ) : __( 'Next', 'funnelforms-pro' ) }
				</Button>
			</div>
		</div>
	);
}

/** The "?" of the top bar that starts the tour again. */
export function TourIcon() {
	return (
		<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
		</svg>
	);
}
