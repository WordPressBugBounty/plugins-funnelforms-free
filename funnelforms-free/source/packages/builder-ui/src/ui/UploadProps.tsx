/**
 * Settings of file and signature fields.
 */
import React, { useState } from 'react';
import type { FileField, SignatureField } from '@funnelforms/form-schema';
import type { Edit } from './Answers';
import { __ } from './i18n';
import { TextProp } from './texts';
import { NumberInput, TextInput, Toggle } from './ui';

/** "pdf, .JPG docx" as extensions: lower case, without dots, each once. */
export function parseExtensions( text: string ): string[] {
	return [ ...new Set( text.toLowerCase().split( /[\s,;|]+/ ).map( ( e ) => e.replace( /^\*?\./, '' ) ).filter( ( e ) => /^[a-z0-9]{1,10}$/.test( e ) ) ) ].slice( 0, 50 );
}

export function FileProps( { field, edit, propText }: { field: FileField; edit: Edit; propText: ( key: string ) => ( value: string ) => void } ) {
	const p = field.props;
	const props = ( recipe: ( props: FileField[ 'props' ] ) => void, key: string ): void => edit( ( f ) => recipe( ( f as FileField ).props ), 'props.' + key );
	const stored = ( p.allowedExtensions ?? [] ).join( ', ' );
	// What is typed stays (a trailing comma too) until another field is shown.
	const [ draft, setDraft ] = useState( stored );
	const [ shown, setShown ] = useState( field.id );
	if ( shown !== field.id ) {
		setShown( field.id );
		setDraft( stored );
	}
	return (
		<>
			<TextProp label={ __( 'Text in the upload area', 'funnelforms-pro' ) } value={ p.dropzoneText } onChange={ propText( 'dropzoneText' ) } />
			<TextProp label={ __( 'Text below it', 'funnelforms-pro' ) } value={ p.hint } onChange={ propText( 'hint' ) } hint={ __( 'For example which files fit.', 'funnelforms-pro' ) } />
			<div className="ffxb-pair">
				<NumberInput label={ __( 'Largest file (MB)', 'funnelforms-pro' ) } value={ p.maxSizeMb } min={ 1 } onChange={ ( v ) => undefined !== v && props( ( x ) => void ( x.maxSizeMb = v ), 'maxSizeMb' ) } />
				<NumberInput label={ __( 'Most files', 'funnelforms-pro' ) } value={ p.maxFiles } min={ 1 } max={ 20 } onChange={ ( v ) => undefined !== v && props( ( x ) => void ( x.maxFiles = v ), 'maxFiles' ) } />
			</div>
			<TextInput
				label={ __( 'Only these file types', 'funnelforms-pro' ) }
				value={ draft }
				placeholder="pdf, jpg, png"
				hint={ __( 'File extensions, separated by commas. Empty: every type WordPress allows.', 'funnelforms-pro' ) }
				onChange={ ( v ) => {
					setDraft( v );
					const list = parseExtensions( v );
					props( ( x ) => {
						if ( list.length ) {
							x.allowedExtensions = list;
						} else {
							delete x.allowedExtensions;
						}
					}, 'allowedExtensions' );
				} }
			/>
			<Toggle
				label={ __( 'Show small pictures of chosen images', 'funnelforms-pro' ) }
				checked={ true === p.preview }
				onChange={ ( v ) =>
					props( ( x ) => {
						if ( v ) {
							x.preview = true;
						} else {
							delete x.preview;
						}
					}, 'preview' )
				}
			/>
		</>
	);
}

export function SignatureProps( { field, edit }: { field: SignatureField; edit: Edit } ) {
	const p = field.props;
	const props = ( recipe: ( props: SignatureField[ 'props' ] ) => void, key: string ): void => edit( ( f ) => recipe( ( f as SignatureField ).props ), 'props.' + key );
	return (
		<>
			<Toggle
				label={ __( 'Visitors may upload a picture of their signature', 'funnelforms-pro' ) }
				checked={ true === p.upload }
				onChange={ ( v ) =>
					props( ( x ) => {
						if ( v ) {
							x.upload = true;
						} else {
							delete x.upload;
						}
					}, 'upload' )
				}
			/>
			<Toggle
				label={ __( 'Own ink colour', 'funnelforms-pro' ) }
				hint={ __( 'Otherwise the text colour of the form.', 'funnelforms-pro' ) }
				checked={ undefined !== p.penColor }
				onChange={ ( v ) =>
					props( ( x ) => {
						if ( v ) {
							x.penColor = '#1d3a8a';
						} else {
							delete x.penColor;
						}
					}, 'penColor' )
				}
			/>
			{ undefined !== p.penColor ? <TextInput label={ __( 'Ink colour', 'funnelforms-pro' ) } type="color" value={ p.penColor } onChange={ ( v ) => /^#[0-9a-f]{6}$/i.test( v ) && props( ( x ) => void ( x.penColor = v ), 'penColor' ) } /> : null }
		</>
	);
}
