/**
 * Text of a mail with formatting: bold, italic, underline, headings, lists, links, images from the
 * media library and placeholders at the cursor, or the HTML itself. Formatting goes through the
 * browser's editing commands, so undo inside the box works as in any editor.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { fromVisual, safeUrl, textToHtml, toVisual } from '../mailHtml';
import { useEnv } from './context';
import { __ } from './i18n';
import { Button } from './ui';

type Command = [ command: string, label: string, glyph: string, argument?: string ];

const COMMANDS: Command[] = [
	[ 'bold', 'Bold', 'B' ],
	[ 'italic', 'Italic', 'I' ],
	[ 'underline', 'Underline', 'U' ],
	[ 'formatBlock', 'Heading', 'H', 'h2' ],
	[ 'formatBlock', 'Paragraph', '¶', 'p' ],
	[ 'insertUnorderedList', 'Bulleted list', '•', undefined ],
	[ 'insertOrderedList', 'Numbered list', '1.', undefined ],
	[ 'removeFormat', 'Remove formatting', '⌫', undefined ],
];

function label( key: string ): string {
	switch ( key ) {
		case 'Bold':
			return __( 'Bold', 'funnelforms-pro' );
		case 'Italic':
			return __( 'Italic', 'funnelforms-pro' );
		case 'Underline':
			return __( 'Underline', 'funnelforms-pro' );
		case 'Heading':
			return __( 'Heading', 'funnelforms-pro' );
		case 'Paragraph':
			return __( 'Paragraph', 'funnelforms-pro' );
		case 'Bulleted list':
			return __( 'Bulleted list', 'funnelforms-pro' );
		case 'Numbered list':
			return __( 'Numbered list', 'funnelforms-pro' );
	}
	return __( 'Remove formatting', 'funnelforms-pro' );
}

export function MailEditor( { label: title, value, nl2br, onChange, placeholders }: { label: string; value: string; nl2br: boolean; onChange: ( value: string ) => void; placeholders: ( insert: ( token: string ) => void ) => React.ReactNode } ) {
	const { api, readOnly } = useEnv();
	const id = useId();
	const box = useRef<HTMLDivElement>( null );
	const range = useRef<Range | null>( null );
	const [ source, setSource ] = useState( false );
	const [ link, setLink ] = useState<string | null>( null );
	const [ image, setImage ] = useState<string | null>( null );

	// The box keeps its own content while it is edited; outside changes (undo, another language) replace it.
	useEffect( () => {
		const el = box.current;
		if ( el && ! source && fromVisual( el.innerHTML, nl2br ) !== value ) {
			el.innerHTML = toVisual( value, nl2br );
		}
	}, [ value, nl2br, source ] );

	const save = (): void => {
		const el = box.current;
		if ( el ) {
			onChange( fromVisual( el.innerHTML, nl2br ) );
		}
	};
	const remember = (): void => {
		const selection = document.getSelection();
		if ( selection && selection.rangeCount && box.current?.contains( selection.anchorNode ) ) {
			range.current = selection.getRangeAt( 0 ).cloneRange();
		}
	};
	const restore = (): void => {
		box.current?.focus();
		const selection = document.getSelection();
		if ( selection && range.current ) {
			selection.removeAllRanges();
			selection.addRange( range.current );
		}
	};
	// Missing in tests and in browsers that dropped it; then formatting does nothing.
	const exec = ( command: string, argument?: string ): boolean => 'function' === typeof document.execCommand && document.execCommand( command, false, argument );
	const run = ( command: string, argument?: string ): void => {
		restore();
		exec( command, argument );
		save();
		remember();
	};
	const insertHtml = ( html: string ): void => {
		restore();
		if ( ! exec( 'insertHTML', html ) && box.current ) {
			// Without editing commands the HTML replaces the selection, or goes to the end.
			const at = range.current;
			if ( at && box.current.contains( at.commonAncestorContainer ) ) {
				at.deleteContents();
				const fragment = at.createContextualFragment( html );
				const last = fragment.lastChild;
				at.insertNode( fragment );
				if ( last ) {
					at.setStartAfter( last );
					at.collapse( true );
				}
			} else {
				box.current.insertAdjacentHTML( 'beforeend', html );
			}
		}
		save();
		remember();
	};
	const insert = ( token: string ): void => {
		if ( source ) {
			onChange( value + ( value && ! /\s$/.test( value ) ? ' ' : '' ) + token );
			return;
		}
		insertHtml( textToHtml( token ) );
	};
	const pickImage = api.pickImage?.bind( api );
	const escape = ( text: string ): string => textToHtml( text ).replace( /"/g, '&quot;' );

	return (
		<div className="ffxb-field ffxb-mail-editor">
			<span className="ffxb-field__label" id={ id }>
				{ title }
			</span>
			<div className="ffxb-mail-editor__bar" role="toolbar" aria-labelledby={ id }>
				{ source
					? null
					: COMMANDS.map( ( [ command, key, glyph, argument ] ) => (
							<button key={ key } type="button" className={ `ffxb-mail-editor__tool ffxb-mail-editor__tool--${ key.toLowerCase().replace( / /g, '-' ) }` } aria-label={ label( key ) } title={ label( key ) } disabled={ readOnly } onMouseDown={ ( e ) => e.preventDefault() } onClick={ () => run( command, argument ? `<${ argument }>` : undefined ) }>
								{ glyph }
							</button>
						) ) }
				{ source ? null : (
					<>
						<button type="button" className="ffxb-mail-editor__tool" aria-label={ __( 'Link', 'funnelforms-pro' ) } title={ __( 'Link', 'funnelforms-pro' ) } disabled={ readOnly } onMouseDown={ ( e ) => e.preventDefault() } onClick={ () => setLink( 'https://' ) }>
							🔗
						</button>
						<button
							type="button"
							className="ffxb-mail-editor__tool"
							aria-label={ __( 'Image', 'funnelforms-pro' ) }
							title={ __( 'Image', 'funnelforms-pro' ) }
							disabled={ readOnly }
							onMouseDown={ ( e ) => e.preventDefault() }
							onClick={ async () => {
								if ( ! pickImage ) {
									setImage( 'https://' );
									return;
								}
								const chosen = await pickImage();
								if ( chosen ) {
									insertHtml( `<img src="${ escape( chosen.url ) }" alt="${ escape( chosen.alt ) }" style="max-width:100%;height:auto">` );
								}
							} }
						>
							🖼
						</button>
					</>
				) }
				<button type="button" className={ `ffxb-mail-editor__tool ffxb-mail-editor__source${ source ? ' is-active' : '' }` } aria-pressed={ source } onClick={ () => setSource( ! source ) }>
					{ __( 'HTML', 'funnelforms-pro' ) }
				</button>
			</div>
			{ null !== link || null !== image ? (
				<div className="ffxb-mail-editor__ask">
					<input
						className="ffxb-input"
						type="url"
						aria-label={ null !== link ? __( 'Address of the link', 'funnelforms-pro' ) : __( 'Address of the image', 'funnelforms-pro' ) }
						value={ link ?? image ?? '' }
						onChange={ ( e ) => ( null !== link ? setLink( e.target.value ) : setImage( e.target.value ) ) }
					/>
					<Button
						size="sm"
						variant="primary"
						onClick={ () => {
							const url = ( link ?? image ?? '' ).trim();
							if ( url && 'https://' !== url && safeUrl( url ) ) {
								if ( null !== link ) {
									run( 'createLink', url );
								} else {
									insertHtml( `<img src="${ escape( url ) }" alt="" style="max-width:100%;height:auto">` );
								}
							}
							setLink( null );
							setImage( null );
						} }
					>
						{ __( 'Insert', 'funnelforms-pro' ) }
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={ () => {
							setLink( null );
							setImage( null );
						} }
					>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
				</div>
			) : null }
			{ source ? (
				<textarea className="ffxb-input ffxb-mail-editor__source-text" aria-labelledby={ id } rows={ 10 } value={ value } readOnly={ readOnly } onChange={ ( e ) => onChange( e.target.value ) } />
			) : (
				<div
					ref={ box }
					className="ffxb-input ffxb-mail-editor__box"
					role="textbox"
					aria-multiline="true"
					aria-labelledby={ id }
					contentEditable={ ! readOnly }
					suppressContentEditableWarning
					onInput={ save }
					onKeyUp={ remember }
					onMouseUp={ remember }
					onBlur={ remember }
					onPaste={ ( e ) => {
						// Pasted text comes without the formatting of its source (Word, websites).
						e.preventDefault();
						insertHtml( textToHtml( e.clipboardData.getData( 'text/plain' ) ) );
					} }
				/>
			) }
			{ placeholders( insert ) }
		</div>
	);
}
