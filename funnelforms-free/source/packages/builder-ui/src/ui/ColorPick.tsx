/**
 * Colour fields of the design with a pipette: the browser's eye dropper picks any colour on the
 * screen where the browser has one (Chromium); everywhere, a colour can be picked from an image
 * (the site's logo, an uploaded or pasted screenshot) by clicking a pixel or one of its main
 * colours. Nothing leaves the browser: the image is only drawn on a canvas.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { mainColors, pixelColor } from '../imageColors';
import { contrast, toHex } from '../themes';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { Button, Dialog, Field, icons, Notice, Select } from './ui';

interface EyeDropperLike {
	open(): Promise<{ sRGBHex: string }>;
}

/** The browser's eye dropper (Chromium); null where there is none. */
export function eyeDropper(): ( new () => EyeDropperLike ) | null {
	return ( globalThis as { EyeDropper?: new () => EyeDropperLike } ).EyeDropper ?? null;
}

export const pipetteIcon = (
	<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M2 22l1-1h3l9-9M3 21v-3l9-9M14.5 5.5l3-3a2.12 2.12 0 0 1 3 3l-3 3M12 7l5 5" />
	</svg>
);

/** A colour the user can pick with the pipette, for a field or one of several. */
export interface ColorTarget {
	token: string;
	label: string;
}

/**
 * The pipette of a colour field: the eye dropper where the browser has one, else picking from an
 * image.
 */
export function PipetteButton( { label, onPick }: { label: string; onPick: ( hex: string ) => void } ) {
	const { readOnly } = useEnv();
	const [ image, setImage ] = useState( false );
	const pick = async (): Promise<void> => {
		const Dropper = eyeDropper();
		if ( ! Dropper ) {
			setImage( true );
			return;
		}
		try {
			const result = await new Dropper().open();
			const hex = toHex( result.sRGBHex ) ?? result.sRGBHex;
			onPick( hex );
		} catch {
			// Escape or a click elsewhere ends the eye dropper without a colour.
		}
	};
	return (
		<>
			<button
				type="button"
				className="ffxb-pipette"
				aria-label={ sprintf( /* translators: %s: name of a colour, e.g. Accent colour */ __( 'Pick %s with the pipette', 'funnelforms-pro' ), label ) }
				title={ eyeDropper() ? __( 'Pick a colour anywhere on the screen', 'funnelforms-pro' ) : __( 'Pick a colour from an image', 'funnelforms-pro' ) }
				disabled={ readOnly }
				onClick={ () => void pick() }
			>
				{ pipetteIcon }
			</button>
			{ image ? (
				<ImageColorDialog
					targets={ [ { token: '', label } ] }
					onClose={ () => setImage( false ) }
					onPick={ ( hex ) => {
						onPick( hex );
						setImage( false );
					} }
				/>
			) : null }
		</>
	);
}

/** Contrast of a text colour on its background, with WCAG AA (4.5:1) as the bar. */
export function ContrastChip( { label, text, background, min = 4.5 }: { label: string; text: string; background: string; min?: number } ) {
	const ratio = contrast( text, background );
	if ( null === ratio ) {
		return null;
	}
	const ok = ratio >= min;
	return (
		<span className={ 'ffxb-contrast ' + ( ok ? 'is-ok' : 'is-low' ) } title={ sprintf( /* translators: %s: the lowest contrast ratio that reads well, e.g. 4.5 */ __( 'Aim for at least %s:1 so everyone can read it.', 'funnelforms-pro' ), String( min ) ) }>
			<i aria-hidden="true" style={ { background, color: text } }>
				Aa
			</i>
			{ label } { ratio.toFixed( 1 ) }:1
			<b>{ ok ? __( 'readable', 'funnelforms-pro' ) : __( 'hard to read', 'funnelforms-pro' ) }</b>
		</span>
	);
}

/**
 * A colour of the design: picker, the value as text (anything CSS accepts), the pipette and, below,
 * notes such as its contrast.
 */
export function ColorField( { label, value, hex, onChange, note, token }: { label: string; value: string; hex: string | null; onChange: ( value: string ) => void; note?: React.ReactNode; token?: string } ) {
	return (
		<Field label={ label }>
			{ ( id ) => (
				<>
					<div className="ffxb-color">
						<input className="ffxb-color__swatch" type="color" aria-label={ label } value={ hex ?? '#000000' } onChange={ ( e ) => onChange( e.target.value ) } />
						<input id={ id } className="ffxb-input" type="text" value={ value } placeholder={ hex ?? '' } spellCheck={ false } onChange={ ( e ) => onChange( e.target.value ) } />
						<PipetteButton label={ label } onPick={ onChange } />
					</div>
					{ token || note ? (
						<div className="ffxb-color__notes">
							{ token ? <code className="ffxb-token">{ token }</code> : null }
							{ note }
						</div>
					) : null }
				</>
			) }
		</Field>
	);
}

/** Largest size the image is drawn at in the dialog. */
const CANVAS = { width: 520, height: 300 };

/**
 * Picks a colour from an image: the site's logo, a file or a pasted screenshot. A click on a pixel
 * (or the arrow keys and Enter) or one of the main colours chooses it; with several targets the
 * user says which colour of the form it becomes.
 */
export function ImageColorDialog( { targets, initial, onPick, onClose, logo: useLogo = false }: { targets: ColorTarget[]; initial?: string; onPick: ( hex: string, token: string ) => void; onClose: () => void; logo?: boolean } ) {
	const { api } = useEnv();
	const canvas = useRef<HTMLCanvasElement>( null );
	const [ pixels, setPixels ] = useState<{ data: Uint8ClampedArray; width: number; height: number } | null>( null );
	const [ chosen, setChosen ] = useState<string | null>( null );
	const [ hover, setHover ] = useState<string | null>( null );
	const [ cursor, setCursor ] = useState<{ x: number; y: number } | null>( null );
	const [ target, setTarget ] = useState( initial ?? targets[ 0 ]?.token ?? '' );
	const [ error, setError ] = useState<string | null>( null );
	const logo = api.siteLogo ?? null;

	const draw = useCallback( ( image: HTMLImageElement ): void => {
		const el = canvas.current;
		const ctx = el?.getContext?.( '2d', { willReadFrequently: true } );
		if ( ! el || ! ctx ) {
			setError( __( 'This browser cannot read the colours of images.', 'funnelforms-pro' ) );
			return;
		}
		// Small images such as logos are drawn larger, so a colour is easy to hit.
		const scale = Math.min( 4, CANVAS.width / Math.max( 1, image.naturalWidth ), CANVAS.height / Math.max( 1, image.naturalHeight ) );
		el.width = Math.max( 1, Math.round( image.naturalWidth * scale ) );
		el.height = Math.max( 1, Math.round( image.naturalHeight * scale ) );
		ctx.clearRect( 0, 0, el.width, el.height );
		ctx.drawImage( image, 0, 0, el.width, el.height );
		try {
			const data = ctx.getImageData( 0, 0, el.width, el.height ).data;
			setPixels( { data, width: el.width, height: el.height } );
			setCursor( { x: Math.floor( el.width / 2 ), y: Math.floor( el.height / 2 ) } );
			setError( null );
		} catch {
			// An image from another site without permission to read it.
			setError( __( 'The colours of this image cannot be read here. Download it and add it as a file.', 'funnelforms-pro' ) );
		}
	}, [] );

	const load = useCallback(
		( src: string, revoke = false, cors = ! revoke ): void => {
			const image = new Image();
			if ( cors ) {
				// Media on another host (a CDN) can be read only when it allows it.
				image.crossOrigin = 'anonymous';
			}
			image.onload = () => {
				draw( image );
				if ( revoke ) {
					URL.revokeObjectURL( src );
				}
			};
			image.onerror = () => {
				if ( cors ) {
					// Without permission the image still shows; draw() then says its colours cannot be read.
					load( src, revoke, false );
					return;
				}
				setError( __( 'This image could not be loaded.', 'funnelforms-pro' ) );
			};
			image.src = src;
		},
		[ draw ]
	);
	const file = ( blob: Blob | null | undefined ): void => {
		if ( blob && blob.type.startsWith( 'image/' ) ) {
			load( URL.createObjectURL( blob ), true );
		}
	};

	useEffect( () => {
		if ( useLogo && logo ) {
			load( logo );
		}
	}, [ useLogo, logo, load ] );

	const at = ( x: number, y: number ): string | null => ( pixels ? pixelColor( pixels.data, pixels.width, x, y ) : null );
	const point = ( event: React.MouseEvent<HTMLCanvasElement> ): { x: number; y: number } => {
		const rect = event.currentTarget.getBoundingClientRect();
		const el = event.currentTarget;
		return { x: Math.floor( ( ( event.clientX - rect.left ) / Math.max( 1, rect.width ) ) * el.width ), y: Math.floor( ( ( event.clientY - rect.top ) / Math.max( 1, rect.height ) ) * el.height ) };
	};
	const keys = ( event: React.KeyboardEvent<HTMLCanvasElement> ): void => {
		if ( ! pixels || ! cursor ) {
			return;
		}
		const step = event.shiftKey ? 10 : 1;
		const moves: Record<string, [ number, number ]> = { ArrowLeft: [ -step, 0 ], ArrowRight: [ step, 0 ], ArrowUp: [ 0, -step ], ArrowDown: [ 0, step ] };
		const move = moves[ event.key ];
		if ( move ) {
			event.preventDefault();
			const next = { x: Math.max( 0, Math.min( pixels.width - 1, cursor.x + move[ 0 ] ) ), y: Math.max( 0, Math.min( pixels.height - 1, cursor.y + move[ 1 ] ) ) };
			setCursor( next );
			setHover( at( next.x, next.y ) );
		} else if ( 'Enter' === event.key || ' ' === event.key ) {
			event.preventDefault();
			const color = at( cursor.x, cursor.y );
			if ( color ) {
				setChosen( color );
			}
		}
	};
	const main = pixels ? mainColors( pixels.data ) : [];

	return (
		<Dialog
			title={ __( 'Pick a colour from an image', 'funnelforms-pro' ) }
			open
			wide
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ ! chosen } onClick={ () => chosen && onPick( chosen, target ) }>
						{ __( 'Use this colour', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			<div
				className="ffxb-image-color"
				onPaste={ ( e ) => file( [ ...e.clipboardData.items ].find( ( i ) => i.type.startsWith( 'image/' ) )?.getAsFile() ) }
				onDragOver={ ( e ) => e.preventDefault() }
				onDrop={ ( e ) => {
					e.preventDefault();
					file( e.dataTransfer.files[ 0 ] );
				} }
			>
				<div className="ffxb-image-color__sources">
					{ logo ? (
						<Button size="sm" variant="secondary" icon={ icons.image } onClick={ () => load( logo ) }>
							{ __( 'Your logo', 'funnelforms-pro' ) }
						</Button>
					) : null }
					<label className="ffxb-button ffxb-button--secondary ffxb-button--sm ffxb-image-color__file">
						{ icons.upload }
						{ __( 'Choose an image', 'funnelforms-pro' ) }
						<input type="file" accept="image/*" onChange={ ( e ) => file( e.target.files?.[ 0 ] ) } />
					</label>
					<span className="ffxb-hint">{ __( 'or paste a screenshot (Ctrl+V) or drop an image here.', 'funnelforms-pro' ) }</span>
				</div>
				{ error ? <Notice tone="warning">{ error }</Notice> : null }
				<div className={ 'ffxb-image-color__stage' + ( pixels ? '' : ' is-empty' ) }>
					<canvas
						ref={ canvas }
						tabIndex={ pixels ? 0 : -1 }
						role="img"
						aria-label={ __( 'Image to pick a colour from. Move with the arrow keys, pick with Enter.', 'funnelforms-pro' ) }
						onMouseMove={ ( e ) => {
							const p = point( e );
							setHover( at( p.x, p.y ) );
						} }
						onMouseLeave={ () => setHover( null ) }
						onClick={ ( e ) => {
							const p = point( e );
							setCursor( p );
							const color = at( p.x, p.y );
							if ( color ) {
								setChosen( color );
							}
						} }
						onKeyDown={ keys }
					/>
					{ pixels && cursor ? <span className="ffxb-image-color__cursor" aria-hidden="true" style={ { left: `${ ( ( cursor.x + 0.5 ) / pixels.width ) * 100 }%`, top: `${ ( ( cursor.y + 0.5 ) / pixels.height ) * 100 }%` } } /> : null }
					{ pixels ? null : <p className="ffxb-hint">{ __( 'No image yet.', 'funnelforms-pro' ) }</p> }
				</div>
				{ main.length ? (
					<div className="ffxb-field">
						<span className="ffxb-field__label">{ __( 'Main colours of the image', 'funnelforms-pro' ) }</span>
						<div className="ffxb-swatches" role="radiogroup" aria-label={ __( 'Main colours of the image', 'funnelforms-pro' ) }>
							{ main.map( ( c ) => (
								<button key={ c } type="button" role="radio" aria-checked={ chosen === c } aria-label={ c } title={ c } className="ffxb-swatch" style={ { background: c } } onClick={ () => setChosen( c ) } />
							) ) }
						</div>
					</div>
				) : null }
				<div className="ffxb-image-color__result" aria-live="polite">
					<i aria-hidden="true" style={ { background: hover ?? chosen ?? 'transparent' } } />
					{ chosen ? sprintf( /* translators: %s: a colour, e.g. #0e7490 */ __( 'Chosen: %s', 'funnelforms-pro' ), chosen ) : __( 'Click the colour you want.', 'funnelforms-pro' ) }
				</div>
				{ targets.length > 1 ? <Select label={ __( 'Use it for', 'funnelforms-pro' ) } value={ target } options={ targets.map( ( t ) => ( { value: t.token, label: t.label } ) ) } onChange={ setTarget } /> : null }
			</div>
		</Dialog>
	);
}
