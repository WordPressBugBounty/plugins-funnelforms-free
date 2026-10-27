/**
 * Settings of an end, what visitors see: a thank-you message (heading, text, picture, animation,
 * the visitor's answers, downloads, a button), a redirect to a page of the site or any address
 * with answers passed along, or the message first and the redirect after a wait.
 */
import React, { useEffect, useState } from 'react';
import type { EndSuccess, FormNode, Text } from '@funnelforms/form-schema';
import type { SitePage } from '../api';
import { findNode, text } from '../document';
import { editText, setText } from '../languages';
import { AnswerInsert } from './AnswerInsert';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { TextProp } from './texts';
import { Button, Dialog, IconButton, icons, Notice, NumberInput, ProBadge, Select, TextInput, Toggle } from './ui';

type EndNode = Extract<FormNode, { type: 'end' }>;

type Mode = 'message' | 'redirect' | 'both';

export function EndProps( { node }: { node: EndNode } ) {
	const { api, ctx, lang, readOnly, store } = useEnv();
	const [ picking, setPicking ] = useState( false );
	const end = ( recipe: ( n: EndNode ) => void, key?: string ): void =>
		store.getState().change( ( d ) => {
			const n = findNode( d, node.id );
			if ( n && 'end' === n.type ) {
				recipe( n );
			}
		}, key );
	const success = ( recipe: ( s: EndSuccess ) => void, key?: string ): void =>
		end( ( n ) => {
			if ( n.success ) {
				recipe( n.success );
			}
		}, key );
	/** Writes the edited language of a text, creating the text first. */
	const write = ( get: ( s: EndSuccess ) => Text | undefined, create: ( s: EndSuccess ) => Text, key: string ) => ( value: string ): void =>
		success( ( s ) => setText( get( s ) ?? create( s ), lang, value, ctx.locale ), `${ node.id }:${ key }` );
	const s = node.success;
	const pickFile = api.pickFile?.bind( api );
	const pickImage = api.pickImage?.bind( api );
	const mode: Mode | null = s?.show ? ( node.redirect ? 'both' : 'message' ) : node.redirect ? 'redirect' : null;
	const setMode = ( next: Mode ): void =>
		end( ( n ) => {
			const show = 'redirect' !== next;
			n.success = n.success ? { ...n.success, show } : { show, text: { [ ctx.locale ]: '' } };
			if ( 'message' === next ) {
				n.redirect = null;
				return;
			}
			if ( ! n.redirect ) {
				n.redirect = { url: { [ ctx.locale ]: '' }, newTab: false, delayMs: 0, params: [] };
			}
			if ( 'both' === next && n.redirect.delayMs < 1000 ) {
				// Time to read the message, with the seconds shown and a link to go on at once.
				n.redirect.delayMs = 5000;
				n.redirect.countdown = true;
			}
			if ( 'redirect' === next ) {
				n.redirect.delayMs = 0;
				delete n.redirect.countdown;
			}
		} );
	const modes: Array<[ Mode, string ]> = [
		[ 'message', __( 'Message', 'funnelforms-pro' ) ],
		[ 'redirect', __( 'Redirect', 'funnelforms-pro' ) ],
		[ 'both', __( 'Both', 'funnelforms-pro' ) ],
	];
	return (
		<>
			<div className="ffxb-group">
				<p className="ffxb-field__label" id={ `ffxb-end-mode-${ node.id }` }>
					{ __( 'What visitors see', 'funnelforms-pro' ) }
				</p>
				<div className="ffxb-segmented ffxb-segmented--full" role="group" aria-labelledby={ `ffxb-end-mode-${ node.id }` }>
					{ modes.map( ( [ id, label ] ) => (
						<button key={ id } type="button" className="ffxb-segmented__item" aria-pressed={ mode === id } disabled={ readOnly } onClick={ () => setMode( id ) }>
							{ label }
						</button>
					) ) }
				</div>
				<p className="ffxb-hint">
					{ 'both' === mode
						? __( 'The message first, then the page after the wait set below.', 'funnelforms-pro' )
						: 'redirect' === mode
						? __( 'Visitors go straight to the page.', 'funnelforms-pro' )
						: 'message' === mode
						? __( 'A thank-you message in place of the form.', 'funnelforms-pro' )
						: __( 'Choose what visitors see at this end.', 'funnelforms-pro' ) }
				</p>
			</div>
			{ s?.show ? (
				<>
					<TextProp label={ __( 'Heading', 'funnelforms-pro' ) } value={ s.heading } onChange={ write( ( x ) => x.heading, ( x ) => ( x.heading = {} ), 'heading' ) } />
					<TextProp
						label={ __( 'Message', 'funnelforms-pro' ) }
						value={ s.text }
						multiline
						hint={ __( 'Placeholders such as {{field:email}} are filled in with the answers.', 'funnelforms-pro' ) }
						onChange={ write( ( x ) => x.text, ( x ) => ( x.text = {} ), 'success' ) }
					/>
					<AnswerInsert fieldId="" onInsert={ ( token ) => write( ( x ) => x.text, ( x ) => ( x.text = {} ), 'success' )( `${ editText( s.text, lang, ctx.locale ) } ${ token }`.trim() ) } />
					<div className="ffxb-group">
						<p className="ffxb-field__label">{ __( 'Picture', 'funnelforms-pro' ) }</p>
						{ s.image ? <img className="ffxb-end-image" src={ s.image } alt="" /> : null }
						<div className="ffxb-group__buttons">
							{ pickImage ? (
								<Button
									size="sm"
									disabled={ readOnly }
									onClick={ async () => {
										const chosen = await pickImage();
										if ( chosen ) {
											success( ( x ) => void ( x.image = chosen.url ) );
										}
									} }
								>
									{ s.image ? __( 'Change picture', 'funnelforms-pro' ) : __( 'Choose a picture', 'funnelforms-pro' ) }
								</Button>
							) : null }
							{ s.image ? (
								<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => success( ( x ) => void delete x.image ) }>
									{ __( 'Remove picture', 'funnelforms-pro' ) }
								</Button>
							) : null }
						</div>
						{ pickImage ? null : <TextInput label={ __( 'Address of the picture', 'funnelforms-pro' ) } value={ s.image ?? '' } placeholder="https://" onChange={ ( v ) => success( ( x ) => {
							if ( v.trim() ) {
								x.image = v.trim();
							} else {
								delete x.image;
							}
						}, `${ node.id }:image` ) } /> }
					</div>
					<Select
						label={ __( 'Animation', 'funnelforms-pro' ) }
						value={ s.animation ?? '' }
						options={ [
							{ value: '', label: __( 'None', 'funnelforms-pro' ) },
							{ value: 'check', label: __( 'Check mark', 'funnelforms-pro' ) },
							{ value: 'confetti', label: __( 'Confetti', 'funnelforms-pro' ) },
						] }
						onChange={ ( v ) =>
							success( ( x ) => {
								if ( v ) {
									x.animation = v;
								} else {
									delete x.animation;
								}
							} )
						}
					/>
					<Toggle
						label={ __( 'List the visitor\'s answers', 'funnelforms-pro' ) }
						checked={ true === s.showAnswers }
						onChange={ ( v ) =>
							success( ( x ) => {
								if ( v ) {
									x.showAnswers = true;
								} else {
									delete x.showAnswers;
								}
							} )
						}
					/>
					<div className="ffxb-group">
						<p className="ffxb-field__label">{ __( 'Files to download', 'funnelforms-pro' ) }</p>
						{ ( s.downloads ?? [] ).map( ( d, i ) => (
							<div key={ i } className="ffxb-download">
								<TextProp
									label={ __( 'Name of the file', 'funnelforms-pro' ) }
									value={ d.label }
									onChange={ write( ( x ) => x.downloads?.[ i ]?.label, () => ( {} ), `download.${ i }` ) }
								/>
								<TextInput
									label={ __( 'Address of the file', 'funnelforms-pro' ) }
									value={ d.url }
									placeholder="https://"
									onChange={ ( v ) =>
										success( ( x ) => {
											const item = x.downloads?.[ i ];
											if ( item ) {
												item.url = v.trim();
											}
										}, `${ node.id }:download-url.${ i }` )
									}
								/>
								<IconButton
									label={ __( 'Remove file', 'funnelforms-pro' ) }
									icon={ icons.trash }
									disabled={ readOnly }
									onClick={ () =>
										success( ( x ) => {
											x.downloads?.splice( i, 1 );
											if ( ! x.downloads?.length ) {
												delete x.downloads;
											}
										} )
									}
								/>
							</div>
						) ) }
						{ ( s.downloads ?? [] ).length < 10 ? (
							<div className="ffxb-group__buttons">
								{ pickFile ? (
									<Button
										disabled={ readOnly }
										onClick={ async () => {
											const file = await pickFile();
											if ( file ) {
												success( ( x ) => {
													x.downloads = [ ...( x.downloads ?? [] ), { label: file.title ? { [ ctx.locale ]: file.title } : {}, url: file.url } ];
												} );
											}
										} }
									>
										{ __( 'Choose from the media library', 'funnelforms-pro' ) }
									</Button>
								) : null }
								<Button disabled={ readOnly } onClick={ () => success( ( x ) => void ( x.downloads = [ ...( x.downloads ?? [] ), { label: {}, url: '' } ] ) ) }>
									{ __( 'Add an address', 'funnelforms-pro' ) }
								</Button>
							</div>
						) : null }
					</div>
					<Toggle
						label={ __( 'Button to a page', 'funnelforms-pro' ) }
						checked={ undefined !== s.button }
						onChange={ ( v ) =>
							success( ( x ) => {
								if ( v ) {
									x.button = { label: { [ ctx.locale ]: __( 'Continue', 'funnelforms-pro' ) }, url: { [ ctx.locale ]: '' } };
								} else {
									delete x.button;
								}
							} )
						}
					/>
					{ s.button ? (
						<>
							<TextProp label={ __( 'Button text', 'funnelforms-pro' ) } value={ s.button.label } onChange={ write( ( x ) => x.button?.label, () => ( {} ), 'button.label' ) } />
							<TextProp label={ __( 'Button address', 'funnelforms-pro' ) } value={ s.button.url } onChange={ write( ( x ) => x.button?.url, () => ( {} ), 'button.url' ) } />
							<Toggle
								label={ __( 'Open the button in a new tab', 'funnelforms-pro' ) }
								checked={ true === s.button.newTab }
								onChange={ ( v ) =>
									success( ( x ) => {
										if ( x.button ) {
											x.button.newTab = v;
										}
									} )
								}
							/>
						</>
					) : null }
				</>
			) : null }
			{ node.redirect ? (
				<>
					<div className="ffxb-group">
						<TextProp
							label={ __( 'Page or address', 'funnelforms-pro' ) }
							value={ node.redirect.url }
							hint={ 'free' === process.env.FUNNELFORMS_EDITION ? __( 'A page of your site or any address with https://.', 'funnelforms-pro' ) : __( 'A page of your site or any address with https://. Placeholders such as {{field:email}} are filled in.', 'funnelforms-pro' ) }
							onChange={ ( v ) =>
								end( ( n ) => {
									if ( n.redirect ) {
										setText( n.redirect.url, lang, v, ctx.locale );
									}
								}, `${ node.id }:redirect` )
							}
						/>
						{ api.pages ? (
							<div className="ffxb-group__buttons">
								<Button size="sm" disabled={ readOnly } onClick={ () => setPicking( true ) }>
									{ __( 'Choose a page of the site', 'funnelforms-pro' ) }
								</Button>
							</div>
						) : null }
					</div>
					{ picking ? (
						<PagePicker
							onClose={ () => setPicking( false ) }
							onPick={ ( page ) => {
								end( ( n ) => {
									if ( n.redirect ) {
										setText( n.redirect.url, lang, page.url, ctx.locale );
									}
								} );
								setPicking( false );
							} }
						/>
					) : null }
					<RedirectParams node={ node } />
					<Toggle
						label={ __( 'Open in a new tab', 'funnelforms-pro' ) }
						checked={ node.redirect.newTab }
						onChange={ ( v ) =>
							end( ( n ) => {
								if ( n.redirect ) {
									n.redirect.newTab = v;
								}
							} )
						}
					/>
					<NumberInput
						label={ __( 'Wait before (seconds)', 'funnelforms-pro' ) }
						value={ node.redirect.delayMs / 1000 }
						min={ 0 }
						max={ 60 }
						step={ 0.5 }
						onChange={ ( v ) =>
							end( ( n ) => {
								if ( n.redirect ) {
									n.redirect.delayMs = Math.round( Math.min( 60, Math.max( 0, v ?? 0 ) ) * 1000 );
									if ( n.redirect.delayMs < 1000 ) {
										delete n.redirect.countdown;
									}
								}
							}, `${ node.id }:delay` )
						}
					/>
					{ node.redirect.delayMs >= 1000 ? (
						<Toggle
							label={ __( 'Show a countdown', 'funnelforms-pro' ) }
							hint={ __( 'With a link to go on at once.', 'funnelforms-pro' ) }
							checked={ true === node.redirect.countdown }
							onChange={ ( v ) =>
								end( ( n ) => {
									if ( n.redirect ) {
										if ( v ) {
											n.redirect.countdown = true;
										} else {
											delete n.redirect.countdown;
										}
									}
								} )
							}
						/>
					) : null }
				</>
			) : null }
		</>
	);
}

/**
 * Answers passed to the page as parameters of its address, e.g. ?name={{field:name}}: the page
 * can greet the visitor or prefill a form of its own.
 */
function RedirectParams( { node }: { node: EndNode } ) {
	const { ctx, lang, readOnly, store } = useEnv();
	// In Funnelforms Free the values are fixed; inserting earlier answers is Pro (feature "variables").
	const free = 'free' === process.env.FUNNELFORMS_EDITION;
	const params = node.redirect?.params ?? [];
	const edit = ( recipe: ( list: Array<{ name: string; value: Text }> ) => void, key?: string ): void =>
		store.getState().change( ( d ) => {
			const n = findNode( d, node.id );
			if ( n && 'end' === n.type && n.redirect ) {
				recipe( n.redirect.params );
			}
		}, key );
	const preview = ( () => {
		const url = text( node.redirect?.url, lang ) || text( node.redirect?.url, ctx.locale );
		const query = params.filter( ( p ) => p.name ).map( ( p ) => `${ p.name }=${ text( p.value, lang ) || text( p.value, ctx.locale ) }` );
		return url && query.length ? url + ( url.includes( '?' ) ? '&' : '?' ) + query.join( '&' ) : '';
	} )();
	return (
		<div className="ffxb-group ffxb-params">
			<p className="ffxb-field__label">{ free ? __( 'Parameters of the address', 'funnelforms-pro' ) : __( 'Pass answers to the page', 'funnelforms-pro' ) }</p>
			{ params.length ? null : (
				<p className="ffxb-hint">
					{ free
						? __( 'Add parameters with a fixed value to the address, e.g. a source for your own statistics.', 'funnelforms-pro' )
						: __( 'Add parameters to the address, e.g. the name, so the page can greet the visitor or fill in a form of its own.', 'funnelforms-pro' ) }
				</p>
			) }
			{ params.map( ( p, i ) => (
				<div key={ i } className="ffxb-param">
					<div className="ffxb-param__inputs">
						<TextInput
							label={ __( 'Parameter', 'funnelforms-pro' ) }
							value={ p.name }
							placeholder="name"
							onChange={ ( v ) =>
								edit( ( list ) => {
									const item = list[ i ];
									if ( item ) {
										item.name = v.replace( /[^A-Za-z0-9_.\-[\]]/g, '' );
									}
								}, `${ node.id }:param-name.${ i }` )
							}
						/>
						<TextInput
							label={ __( 'Value', 'funnelforms-pro' ) }
							value={ editText( p.value, lang, ctx.locale ) }
							placeholder={ lang !== ctx.locale ? text( p.value, ctx.locale ) : free ? '' : '{{field:name}}' }
							onChange={ ( v ) =>
								edit( ( list ) => {
									const item = list[ i ];
									if ( item ) {
										setText( item.value, lang, v, ctx.locale );
									}
								}, `${ node.id }:param-value.${ i }` )
							}
						/>
					</div>
					{ free ? (
						Object.values( p.value ).some( ( v ) => v.includes( '{{field:' ) ) ? (
							<p className="ffxb-hint">
								<ProBadge /> { __( 'Inserting earlier answers comes with Funnelforms Pro.', 'funnelforms-pro' ) }
							</p>
						) : null
					) : (
						<AnswerInsert
							fieldId=""
							onInsert={ ( token ) =>
								edit( ( list ) => {
									const item = list[ i ];
									if ( item ) {
										setText( item.value, lang, `${ editText( item.value, lang, ctx.locale ) }${ token }`, ctx.locale );
									}
								} )
							}
						/>
					) }
					<IconButton label={ __( 'Remove parameter', 'funnelforms-pro' ) } icon={ icons.trash } disabled={ readOnly } onClick={ () => edit( ( list ) => void list.splice( i, 1 ) ) } />
				</div>
			) ) }
			<div className="ffxb-group__buttons">
				<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly || params.length >= 20 } onClick={ () => edit( ( list ) => void list.push( { name: '', value: { [ ctx.locale ]: '' } } ) ) }>
					{ __( 'Add parameter', 'funnelforms-pro' ) }
				</Button>
			</div>
			{ preview ? (
				<p className="ffxb-hint">
					{ __( 'Address for example:', 'funnelforms-pro' ) } <code className="ffxb-code ffxb-code--wrap">{ preview }</code>
				</p>
			) : null }
		</div>
	);
}

/** Searches the published pages of the site. */
function PagePicker( { onPick, onClose }: { onPick: ( page: SitePage ) => void; onClose: () => void } ) {
	const { api } = useEnv();
	const [ query, setQuery ] = useState( '' );
	const [ pages, setPages ] = useState<SitePage[] | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	useEffect( () => {
		let live = true;
		const timer = setTimeout( () => {
			api.pages?.( query ).then(
				( list ) => {
					if ( live ) {
						setPages( list );
						setError( null );
					}
				},
				( e: unknown ) => live && setError( e instanceof Error ? e.message : String( e ) )
			);
		}, query ? 250 : 0 );
		return () => {
			live = false;
			clearTimeout( timer );
		};
	}, [ api, query ] );
	return (
		<Dialog
			title={ __( 'Choose a page', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				<Button variant="ghost" onClick={ onClose }>
					{ __( 'Cancel', 'funnelforms-pro' ) }
				</Button>
			}
		>
			<TextInput label={ __( 'Search pages', 'funnelforms-pro' ) } value={ query } onChange={ setQuery } />
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ null === pages && ! error ? <p className="ffxb-hint">{ __( 'Loading…', 'funnelforms-pro' ) }</p> : null }
			{ pages && 0 === pages.length ? <p className="ffxb-hint">{ query ? sprintf( __( 'No page matches “%s”.', 'funnelforms-pro' ), query ) : __( 'The site has no published pages yet.', 'funnelforms-pro' ) }</p> : null }
			{ pages?.length ? (
				<ul className="ffxb-pages">
					{ pages.map( ( page ) => (
						<li key={ page.id }>
							<button type="button" className="ffxb-pages__item" onClick={ () => onPick( page ) }>
								<span className="ffxb-pages__title">{ page.title || __( 'Without a title', 'funnelforms-pro' ) }</span>
								<span className="ffxb-pages__url">{ page.url }</span>
							</button>
						</li>
					) ) }
				</ul>
			) : null }
		</Dialog>
	);
}
