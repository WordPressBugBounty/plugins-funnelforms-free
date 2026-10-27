import { describe, expect, it } from 'vitest';
import { validateDocument } from '@funnelforms/form-schema';
import { addAction } from '../src/actions';
import { addLanguage, editText, forEachText, missingTranslations, removeLanguage, setText, withText } from '../src/languages';
import { blank } from './blank';

describe( 'languages', () => {
	it( 'find every text of the form and count what is not translated', () => {
		const doc = blank();
		addAction( doc, 'autoresponder', { replySubject: 'Danke', replyBody: 'Danke!' } );
		const texts: string[] = [];
		forEachText( doc, ( t ) => texts.push( t.de_DE ?? '' ) );
		expect( texts ).toContain( 'Deine Kontaktdaten' );
		expect( texts ).toContain( 'Danke' );
		// A variable of a formula or an edge is no text.
		expect( texts ).not.toContain( 'contact' );

		addLanguage( doc, 'en_US' );
		addLanguage( doc, 'en_US' );
		expect( doc.locales.available ).toEqual( [ 'de_DE', 'en_US' ] );
		const before = missingTranslations( doc, 'en_US' );
		// Empty texts and empty HTML need no translation.
		expect( before ).toBe( texts.filter( ( t ) => '' !== t.replace( /<[^>]*>/g, '' ).trim() ).length );
		const contact = doc.nodes[ 0 ];
		if ( contact && 'contact' === contact.type && contact.title ) {
			setText( contact.title, 'en_US', 'Your contact details', 'de_DE' );
		}
		expect( missingTranslations( doc, 'en_US' ) ).toBe( before - 1 );
		expect( validateDocument( doc ).errors ).toEqual( [] );
	} );

	it( 'drop an empty translation, so visitors see the default text', () => {
		const text = { de_DE: 'Hallo', en_US: 'Hello' };
		setText( text, 'en_US', '', 'de_DE' );
		expect( text ).toEqual( { de_DE: 'Hallo' } );
		setText( text, 'de_DE', '', 'de_DE' );
		expect( text ).toEqual( { de_DE: '' } );
		expect( withText( undefined, 'en_US', 'Hi', 'de_DE' ) ).toEqual( { en_US: 'Hi' } );
		// A translation's input shows only the translation; the default one falls back to any text.
		expect( editText( { de_DE: 'Hallo' }, 'en_US', 'de_DE' ) ).toBe( '' );
		expect( editText( { fr_FR: 'Salut' }, 'de_DE', 'de_DE' ) ).toBe( 'Salut' );
	} );

	it( 'remove a language with its translations, never the default one', () => {
		const doc = blank();
		addLanguage( doc, 'en_US' );
		doc.settings.languageSwitch = true;
		forEachText( doc, ( t ) => ( t.en_US = 'x' ) );
		removeLanguage( doc, 'de_DE' );
		expect( doc.locales.available ).toEqual( [ 'de_DE', 'en_US' ] );
		removeLanguage( doc, 'en_US' );
		expect( doc.locales.available ).toEqual( [ 'de_DE' ] );
		expect( doc.settings.languageSwitch ).toBeUndefined();
		expect( JSON.stringify( doc ) ).not.toContain( 'en_US' );
	} );
} );
