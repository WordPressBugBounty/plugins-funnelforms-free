/**
 * Settings of "Text and media": the text, an image or video, and how the step goes on
 * (a button, by itself after a wait, or a loading screen).
 */
import React from 'react';
import type { ContentField, ContentMedia } from '@funnelforms/form-schema';
import type { Edit } from './Answers';
import { useEnv } from './context';
import { __ } from './i18n';
import { editText, setText } from '../languages';
import { LinesInput, put, TextProp } from './texts';
import { Button, ChoiceTiles, NumberInput, Sketch, TextInput } from './ui';

type Mode = 'button' | 'auto' | 'loader';
type LoaderStyle = NonNullable<ContentField[ 'props' ][ 'loader' ]>[ 'style' ];

export function ContentProps( { field, edit, propText }: { field: ContentField; edit: Edit; propText: ( key: string ) => ( value: string ) => void } ) {
	const { api, ctx, lang, readOnly } = useEnv();
	const p = field.props;
	const content = ( recipe: ( props: ContentField[ 'props' ] ) => void, key?: string ): void => edit( ( f ) => recipe( ( f as ContentField ).props ), key );
	const media = p.media;
	const setMedia = ( recipe: ( m: ContentMedia ) => void, key: string ): void =>
		content( ( props ) => {
			if ( props.media ) {
				recipe( props.media );
			}
		}, 'media.' + key );
	const mode: Mode = p.loader ? 'loader' : p.button.show ? 'button' : 'auto';
	const pickImage = api.pickImage?.bind( api );
	return (
		<>
			<TextProp label={ __( 'Content (HTML)', 'funnelforms-pro' ) } value={ p.html } onChange={ propText( 'html' ) } multiline hint={ 'free' === process.env.FUNNELFORMS_EDITION ? undefined : __( 'Placeholders such as {{field:email}} are filled in with the answers.', 'funnelforms-pro' ) } />
			<ChoiceTiles
				label={ __( 'Image or video above the text', 'funnelforms-pro' ) }
				value={ media?.kind ?? '' }
				options={ [
					{ value: '', label: __( 'None', 'funnelforms-pro' ), icon: <MediaSketch kind="" /> },
					{ value: 'image', label: __( 'Image', 'funnelforms-pro' ), icon: <MediaSketch kind="image" /> },
					{ value: 'video', label: __( 'Video', 'funnelforms-pro' ), icon: <MediaSketch kind="video" /> },
				] }
				onChange={ ( v ) =>
					content( ( props ) => {
						if ( '' === v ) {
							delete props.media;
						} else {
							props.media = { ...props.media, kind: v, url: v === props.media?.kind ? props.media.url : '' };
						}
					}, 'media.kind' )
				}
			/>
			{ media ? (
				<>
					{ 'image' === media.kind && pickImage ? (
						<Button
							disabled={ readOnly }
							onClick={ async () => {
								const image = await pickImage();
								if ( image ) {
									setMedia( ( m ) => {
										m.url = image.url;
										if ( image.alt && ! editText( m.alt, lang, ctx.locale ) ) {
											m.alt ??= {};
											setText( m.alt, lang, image.alt, ctx.locale );
										}
									}, 'url' );
								}
							} }
						>
							{ __( 'Choose from the media library', 'funnelforms-pro' ) }
						</Button>
					) : null }
					<TextInput
						label={ 'image' === media.kind ? __( 'Address of the image', 'funnelforms-pro' ) : __( 'Address of the video', 'funnelforms-pro' ) }
						type="url"
						value={ media.url }
						hint={ 'video' === media.kind ? __( 'YouTube, Vimeo or a video file. YouTube and Vimeo load only when the visitor clicks.', 'funnelforms-pro' ) : undefined }
						onChange={ ( v ) => setMedia( ( m ) => void ( m.url = v.trim() ), 'url' ) }
					/>
					{ 'image' === media.kind ? (
						<TextProp label={ __( 'Alternative text', 'funnelforms-pro' ) } value={ media.alt } onChange={ ( v ) => setMedia( ( m ) => put( m, 'alt', lang, v, ctx.locale ), 'alt' ) } hint={ __( 'Describes the image for screen readers.', 'funnelforms-pro' ) } />
					) : null }
					<div className="ffxb-pair">
						<TextProp label={ __( 'Caption', 'funnelforms-pro' ) } value={ media.caption } onChange={ ( v ) => setMedia( ( m ) => put( m, 'caption', lang, v, ctx.locale ), 'caption' ) } />
						<NumberInput
							label={ __( 'Width (%)', 'funnelforms-pro' ) }
							value={ media.width ?? 100 }
							min={ 10 }
							max={ 100 }
							onChange={ ( v ) =>
								setMedia( ( m ) => {
									if ( undefined === v || v >= 100 ) {
										delete m.width;
									} else {
										m.width = Math.max( 10, Math.round( v ) );
									}
								}, 'width' )
							}
						/>
					</div>
				</>
			) : null }
			<ChoiceTiles<Mode>
				label={ __( 'How the form goes on', 'funnelforms-pro' ) }
				value={ mode }
				options={ [
					{ value: 'button', label: __( 'With a button', 'funnelforms-pro' ), icon: <GoOnSketch mode="button" /> },
					{ value: 'auto', label: __( 'By itself after a wait', 'funnelforms-pro' ), icon: <GoOnSketch mode="auto" /> },
					{ value: 'loader', label: __( 'Loading screen', 'funnelforms-pro' ), icon: <GoOnSketch mode="loader" /> },
				] }
				onChange={ ( v ) =>
					content( ( props ) => {
						props.button.show = 'button' === v;
						if ( 'button' === v ) {
							delete props.autoAdvanceMs;
						} else {
							props.autoAdvanceMs ||= 3000;
						}
						if ( 'loader' === v ) {
							props.loader ??= { style: 'spinner', messages: [] };
						} else {
							delete props.loader;
						}
					}, 'mode' )
				}
			/>
			{ 'button' === mode ? (
				<TextProp label={ __( 'Button', 'funnelforms-pro' ) } value={ p.button.label } onChange={ ( v ) => content( ( props ) => put( props.button, 'label', lang, v, ctx.locale ), 'button' ) } />
			) : (
				<NumberInput
					label={ __( 'Waiting time (seconds)', 'funnelforms-pro' ) }
					value={ ( p.autoAdvanceMs ?? 0 ) / 1000 }
					min={ 0.5 }
					max={ 60 }
					step={ 0.5 }
					onChange={ ( v ) => undefined !== v && v > 0 && content( ( props ) => void ( props.autoAdvanceMs = Math.round( Math.min( 60, v ) * 1000 ) ), 'autoAdvanceMs' ) }
				/>
			) }
			{ p.loader ? (
				<>
					<ChoiceTiles<LoaderStyle>
						label={ __( 'Animation', 'funnelforms-pro' ) }
						value={ p.loader.style }
						options={ [
							{ value: 'spinner', label: __( 'Spinner', 'funnelforms-pro' ), icon: <LoaderSketch style="spinner" /> },
							{ value: 'dots', label: __( 'Dots', 'funnelforms-pro' ), icon: <LoaderSketch style="dots" /> },
							{ value: 'bar', label: __( 'Progress bar', 'funnelforms-pro' ), icon: <LoaderSketch style="bar" /> },
							{ value: 'circle', label: __( 'Ring with percent', 'funnelforms-pro' ), icon: <LoaderSketch style="circle" /> },
							{ value: 'search', label: __( 'Magnifying glass', 'funnelforms-pro' ), icon: <LoaderSketch style="search" /> },
						] }
						onChange={ ( v ) => content( ( props ) => void ( props.loader && ( props.loader.style = v ) ), 'loader.style' ) }
					/>
					<LinesInput
						label={ __( 'Texts while waiting', 'funnelforms-pro' ) }
						hint={ __( 'One per line; they change evenly over the waiting time.', 'funnelforms-pro' ) }
						lines={ p.loader.messages.map( ( m ) => editText( m, lang, ctx.locale ) ) }
						resetKey={ field.id + lang }
						onLines={ ( lines ) =>
							content( ( props ) => {
								if ( ! props.loader ) {
									return;
								}
								if ( lang !== ctx.locale ) {
									props.loader.messages.forEach( ( m, i ) => setText( m, lang, lines[ i ] ?? '', ctx.locale ) );
								} else {
									props.loader.messages = lines.slice( 0, 10 ).map( ( line, i ) => {
										const known = props.loader?.messages[ i ];
										if ( known ) {
											setText( known, lang, line, ctx.locale );
											return known;
										}
										return { [ lang ]: line };
									} );
								}
							}, 'loader.messages' )
						}
					/>
				</>
			) : null }
		</>
	);
}

/* Small drawings of "Text and media" for the tiles of the properties panel. */

function MediaSketch( { kind }: { kind: '' | ContentMedia[ 'kind' ] } ) {
	return (
		<Sketch>
			{ 'image' === kind ? (
				<>
					<rect x="10" y="3" width="28" height="15" rx="2" />
					<path d="M12 16l7-6 5 4 4-3 8 5" strokeWidth="1.2" />
				</>
			) : null }
			{ 'video' === kind ? (
				<>
					<rect x="10" y="3" width="28" height="15" rx="2" />
					<path d="M22 7.5v6l5-3z" fill="currentColor" />
				</>
			) : null }
			<path d={ '' === kind ? 'M10 10h28M10 16h28M10 22h20' : 'M10 23h28M10 28h20' } />
		</Sketch>
	);
}

function GoOnSketch( { mode }: { mode: Mode } ) {
	return (
		<Sketch>
			<path d="M8 7h32M8 12h24" />
			{ 'button' === mode ? <rect x="16" y="18" width="16" height="8" rx="2.5" fill="currentColor" /> : null }
			{ 'auto' === mode ? (
				<>
					<circle cx="24" cy="22" r="5" />
					<path d="M24 19.5V22l1.8 1.2" strokeWidth="1.2" />
				</>
			) : null }
			{ 'loader' === mode ? (
				<>
					<rect x="10" y="20" width="28" height="4" rx="2" />
					<rect x="10" y="20" width="16" height="4" rx="2" fill="currentColor" />
				</>
			) : null }
		</Sketch>
	);
}

function LoaderSketch( { style }: { style: LoaderStyle } ) {
	return (
		<Sketch>
			{ 'spinner' === style ? <path d="M24 8a8 8 0 1 1-8 8" strokeWidth="2.4" /> : null }
			{ 'dots' === style ? (
				<>
					<circle cx="16" cy="16" r="2.5" fill="currentColor" />
					<circle cx="24" cy="16" r="2.5" fill="currentColor" opacity="0.6" />
					<circle cx="32" cy="16" r="2.5" fill="currentColor" opacity="0.3" />
				</>
			) : null }
			{ 'bar' === style ? (
				<>
					<rect x="8" y="13" width="32" height="6" rx="3" />
					<rect x="8" y="13" width="20" height="6" rx="3" fill="currentColor" />
				</>
			) : null }
			{ 'circle' === style ? (
				<>
					<circle cx="24" cy="16" r="9" opacity="0.35" />
					<path d="M24 7a9 9 0 0 1 8.5 12" strokeWidth="2.4" />
					<text x="24" y="19" textAnchor="middle" fontSize="7" fontWeight="600" fill="currentColor" stroke="none">
						%
					</text>
				</>
			) : null }
			{ 'search' === style ? (
				<>
					<circle cx="22" cy="14" r="6" />
					<path d="M26.5 18.5l5 5" strokeWidth="2.4" />
				</>
			) : null }
		</Sketch>
	);
}
