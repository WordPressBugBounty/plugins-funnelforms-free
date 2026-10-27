/**
 * Texts of the form in the builder: the language being edited, with the default text as hint.
 */
import React, { useState } from 'react';
import type { Text } from '@funnelforms/form-schema';
import { text } from '../document';
import { editText, setText } from '../languages';
import { useEnv } from './context';
import { TextInput } from './ui';

/** A text of the form in the language being edited; a translation shows the default text as placeholder. */
export function TextProp( { label, value, onChange, multiline, hint }: { label: string; value: Text | undefined; onChange: ( value: string ) => void; multiline?: boolean; hint?: string } ) {
	const { ctx, lang } = useEnv();
	return <TextInput label={ label } value={ editText( value, lang, ctx.locale ) } placeholder={ lang !== ctx.locale ? text( value, ctx.locale ) : undefined } onChange={ onChange } multiline={ multiline } hint={ hint } />;
}

/** Writes a text in `lang` into an object, creating the text when missing. */
export function put<T extends object>( target: T, key: keyof T, lang: string, value: string, defaultLocale: string ): void {
	const record = target as Record<string, unknown>;
	const current = record[ key as string ];
	if ( current && 'object' === typeof current ) {
		setText( current as Text, lang, value, defaultLocale );
	} else if ( '' !== value || lang === defaultLocale ) {
		record[ key as string ] = { [ lang ]: value };
	}
}


/**
 * Texts one per line. What is typed stays as it is (empty lines too) until `resetKey` changes,
 * e.g. when another field or language is shown; `onLines` gets the non-empty lines.
 */
export function LinesInput( { label, hint, lines, resetKey, onLines }: { label: string; hint?: string; lines: string[]; resetKey: string; onLines: ( lines: string[] ) => void } ) {
	const stored = lines.join( '\n' );
	const [ draft, setDraft ] = useState( stored );
	const [ shown, setShown ] = useState( resetKey );
	if ( shown !== resetKey ) {
		setShown( resetKey );
		setDraft( stored );
	}
	return (
		<TextInput
			label={ label }
			value={ draft }
			multiline
			hint={ hint }
			onChange={ ( v ) => {
				setDraft( v );
				onLines( v.split( '\n' ).map( ( line ) => line.trim() ).filter( Boolean ) );
			} }
		/>
	);
}
