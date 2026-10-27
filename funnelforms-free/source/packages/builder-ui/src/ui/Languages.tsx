/**
 * Languages of a form: the section in the form's properties (add and remove languages, the
 * visitors' language choice, what is not translated yet) and the choice in the top bar of the
 * language the texts are edited in.
 */
import React from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import { addLanguage, languageName, LANGUAGES, missingTranslations, removeLanguage } from '../languages';
import type { Recipe } from '../store';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';
import { Button, icons, Select, Toggle } from './ui';

/** The language of the admin, for the names of the languages. */
function adminLocale(): string {
	return document.documentElement.lang || 'en';
}

/** The name of a language in the admin's language. */
export function languageLabel( locale: string ): string {
	return name( locale );
}

function name( locale: string ): string {
	return languageName( locale, adminLocale(), __( 'formal', 'funnelforms-pro' ) );
}

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

export function LanguagesSection( { doc }: { doc: FormDocument } ) {
	const { readOnly, store } = useEnv();
	const change = useChange();
	const base = doc.locales.default;
	const others = doc.locales.available.filter( ( l ) => l !== base );
	const addable = LANGUAGES.filter( ( l ) => ! doc.locales.available.includes( l ) && l !== base );
	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ __( 'Languages', 'funnelforms-pro' ) }</h2>
			</header>
			<ul className="ffxb-languages">
				<li className="ffxb-languages__item">
					<span className="ffxb-languages__name">{ name( base ) }</span>
					<span className="ffxb-languages__state">{ __( 'Default language', 'funnelforms-pro' ) }</span>
				</li>
				{ others.map( ( locale ) => {
					const missing = missingTranslations( doc, locale );
					return (
						<li key={ locale } className="ffxb-languages__item">
							<button type="button" className="ffxb-link ffxb-languages__name" onClick={ () => store.getState().setLang( locale ) }>
								{ name( locale ) }
							</button>
							<span className={ 'ffxb-languages__state' + ( missing ? ' is-missing' : '' ) }>
								{ missing ? sprintf( __( 'Not translated: %d', 'funnelforms-pro' ), missing ) : __( 'Translated', 'funnelforms-pro' ) }
							</span>
							<Button
								size="sm"
								variant="ghost"
								icon={ icons.trash }
								aria-label={ sprintf( __( 'Remove %s', 'funnelforms-pro' ), name( locale ) ) }
								title={ sprintf( __( 'Remove %s', 'funnelforms-pro' ), name( locale ) ) }
								disabled={ readOnly }
								onClick={ () => {
									if ( window.confirm( sprintf( __( 'Remove %s and its translations?', 'funnelforms-pro' ), name( locale ) ) ) ) {
										change( ( d ) => removeLanguage( d, locale ) );
									}
								} }
							/>
						</li>
					);
				} ) }
			</ul>
			{ others.length ? (
				<p className="ffxb-hint">{ __( 'Choose the language in the top bar to translate the texts. Where a translation is missing, visitors see the text of the default language.', 'funnelforms-pro' ) }</p>
			) : (
				<p className="ffxb-hint">{ __( 'Add a language to show the form in it: on pages in that language (WPML, Polylang) or by the visitors\' choice.', 'funnelforms-pro' ) }</p>
			) }
			{ readOnly || 'free' === process.env.FUNNELFORMS_EDITION ? null : (
				<Select<string>
					label={ __( 'Add a language', 'funnelforms-pro' ) }
					value=""
					options={ [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) }, ...addable.map( ( l ) => ( { value: l, label: name( l ) } ) ).sort( ( a, b ) => a.label.localeCompare( b.label ) ) ] }
					onChange={ ( locale ) => {
						if ( locale ) {
							change( ( d ) => addLanguage( d, locale ) );
							store.getState().setLang( locale );
						}
					} }
				/>
			) }
			{ /* Pro: Funnelforms Free shows the choice only to switch it off. */ }
			{ ( 'free' === process.env.FUNNELFORMS_EDITION ? true === doc.settings.languageSwitch : others.length > 0 ) ? (
				<Toggle
					label={ __( 'Let visitors choose the language', 'funnelforms-pro' ) }
					hint={ __( 'Shows the languages on the first step. Without it the form follows the language of the page.', 'funnelforms-pro' ) }
					checked={ true === doc.settings.languageSwitch }
					onChange={ ( on ) =>
						change( ( d ) => {
							if ( on ) {
								d.settings.languageSwitch = true;
							} else {
								delete d.settings.languageSwitch;
							}
						} )
					}
				/>
			) : null }
		</section>
	);
}

/** The language the texts are edited in; only for forms in several languages. */
export function LanguagePicker() {
	const { store, lang } = useEnv();
	const locales = useBuilder( ( s ) => s.doc?.locales );
	if ( ! locales || locales.available.filter( ( l ) => l !== locales.default ).length === 0 ) {
		return null;
	}
	const list = [ locales.default, ...locales.available.filter( ( l ) => l !== locales.default ) ];
	return (
		<label className={ 'ffxb-langpick' + ( lang !== locales.default ? ' is-translating' : '' ) }>
			<span className="screen-reader-text">{ __( 'Language of the texts', 'funnelforms-pro' ) }</span>
			<span aria-hidden="true">{ icons.globe }</span>
			<select className="ffxb-input ffxb-input--compact" value={ lang } onChange={ ( e ) => store.getState().setLang( e.target.value === locales.default ? null : e.target.value ) }>
				{ list.map( ( l ) => (
					<option key={ l } value={ l }>
						{ l === locales.default ? sprintf( __( '%s (default)', 'funnelforms-pro' ), name( l ) ) : name( l ) }
					</option>
				) ) }
			</select>
		</label>
	);
}
