/**
 * Colours and font from a website: the user enters its address and confirms they may use its
 * branding, the server reads the page once, and the user picks what the form takes. The choices
 * (swatches with where each colour was found, adjusting, the contrast check and a sample) are
 * shared with "Use my website's design" (SiteDesign.tsx).
 */
import React, { useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import type { Branding } from '../api';
import { applyBranding, contrastProblems, effectiveTokens, readableOn, toHex, type BrandingPicks } from '../themes';
import { ContrastChip } from './ColorPick';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { Button, Dialog, icons, Notice, Select, TextInput } from './ui';

export const KEEP: BrandingPicks = { primary: null, text: null, background: null, font: null };

/** The address as entered, with https:// when it has no scheme. */
export function websiteAddress( value: string ): string {
	const v = value.trim();
	return '' === v || /^https?:\/\//i.test( v ) ? v : 'https://' + v;
}

/**
 * What is chosen first: the suggestions, unless the reading is unsure (low confidence), then
 * nothing, so no guess is applied without a look.
 */
export function firstPicks( found: Branding ): BrandingPicks {
	if ( 'low' === found.confidence ) {
		return KEEP;
	}
	return { primary: found.roles.primary ?? null, text: found.roles.text ?? null, background: found.roles.background ?? null, font: found.fonts[ 0 ]?.value ?? null };
}

/** Applies the picks to the form, downloading a Google Font to the site first. */
export function useApplyBranding(): { apply: ( found: Branding, picks: BrandingPicks ) => Promise<boolean>; busy: boolean; error: string | null } {
	const { api, store } = useEnv();
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const apply = async ( found: Branding, picks: BrandingPicks ): Promise<boolean> => {
		const chosen = found.fonts.find( ( f ) => f.value === picks.font );
		setError( null );
		if ( chosen?.google && ! chosen.local && api.installGoogleFont ) {
			// A Google Font is downloaded to the site first, so visitors load it from there.
			setBusy( true );
			try {
				await api.installGoogleFont( chosen.family );
			} catch ( e ) {
				setError( e instanceof Error ? e.message : String( e ) );
				setBusy( false );
				return false;
			}
			setBusy( false );
		}
		store.getState().change( ( d ) => applyBranding( d, picks ) );
		return true;
	};
	return { apply, busy, error };
}

export function nothingPicked( picks: BrandingPicks ): boolean {
	return ! picks.primary && ! picks.text && ! picks.background && ! picks.font;
}

/** "Take from another website": the address of any site, read once with the user's consent. */
export function BrandingImport( { doc }: { doc: FormDocument } ) {
	const { api, readOnly } = useEnv();
	const [ open, setOpen ] = useState( false );
	const [ url, setUrl ] = useState( '' );
	const [ consent, setConsent ] = useState( false );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ found, setFound ] = useState<Branding | null>( null );
	const [ picks, setPicks ] = useState<BrandingPicks>( KEEP );
	const applying = useApplyBranding();

	const close = (): void => {
		setOpen( false );
		setFound( null );
		setError( null );
	};
	const load = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const result = await api.branding( websiteAddress( url ), consent );
			setFound( result );
			setPicks( firstPicks( result ) );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	const empty = found && ! found.colors.length && ! found.fonts.length;

	return (
		<>
			<Button size="sm" variant="ghost" icon={ icons.globe } disabled={ readOnly } onClick={ () => setOpen( true ) }>
				{ __( 'Take from another website', 'funnelforms-pro' ) }
			</Button>
			<Dialog
				title={ __( 'Colours and font from a website', 'funnelforms-pro' ) }
				open={ open }
				onClose={ close }
				actions={
					<>
						<Button variant="ghost" onClick={ found ? () => setFound( null ) : close }>
							{ found ? __( 'Back', 'funnelforms-pro' ) : __( 'Cancel', 'funnelforms-pro' ) }
						</Button>
						{ found ? (
							<Button variant="primary" disabled={ applying.busy || !! empty || nothingPicked( picks ) } onClick={ () => void applying.apply( found, picks ).then( ( done ) => done && close() ) }>
								{ applying.busy ? __( 'Downloading…', 'funnelforms-pro' ) : __( 'Apply', 'funnelforms-pro' ) }
							</Button>
						) : (
							<Button variant="primary" disabled={ busy || ! consent || ! url.trim() } onClick={ () => void load() }>
								{ busy ? __( 'Loading…', 'funnelforms-pro' ) : __( 'Load colours and font', 'funnelforms-pro' ) }
							</Button>
						) }
					</>
				}
			>
				{ found ? (
					<div className="ffxb-branding">
						<p className="ffxb-hint">{ sprintf( __( 'Found on %s.', 'funnelforms-pro' ), found.url ) }</p>
						{ empty ? <Notice tone="warning">{ __( 'No colours or fonts were found on this page. Try the address of the start page.', 'funnelforms-pro' ) }</Notice> : null }
						{ empty ? null : <BrandingChoices doc={ doc } found={ found } picks={ picks } onChange={ setPicks } /> }
						{ applying.error ? <Notice tone="danger">{ applying.error }</Notice> : null }
					</div>
				) : (
					<>
						<TextInput label={ __( 'Address of the website', 'funnelforms-pro' ) } type="url" placeholder="https://" value={ url } onChange={ setUrl } />
						<label className="ffxb-consent">
							<input type="checkbox" checked={ consent } onChange={ ( e ) => setConsent( e.target.checked ) } />
							<span>{ __( 'This is my website, or I may use its colours and fonts.', 'funnelforms-pro' ) }</span>
						</label>
						<p className="ffxb-hint">{ __( 'Your site loads this page once and reads its colours and fonts. Nothing is stored, and nothing about you or your visitors is sent.', 'funnelforms-pro' ) }</p>
						{ error ? <Notice tone="danger">{ error }</Notice> : null }
					</>
				) }
			</Dialog>
		</>
	);
}

/**
 * The colours and the font found, to choose from: a row of swatches per role with where the
 * chosen colour was found and a field to adjust it, how sure the reading is, the contrast of the
 * result and a sample.
 */
export function BrandingChoices( { doc, found, picks, onChange }: { doc: FormDocument; found: Branding; picks: BrandingPicks; onChange: ( picks: BrandingPicks ) => void } ) {
	const { api } = useEnv();
	const current = effectiveTokens( doc.style.tokens );
	const font = found.fonts.find( ( f ) => f.value === picks.font );
	const pick = ( role: keyof BrandingPicks ) => ( value: string | null ) => onChange( { ...picks, [ role ]: value } );
	const tokens = { ...current, ...pickedTokens( picks ) };
	const problems = contrastProblems( { ...doc.style.tokens, ...pickedTokens( picks ) } ).filter( ( p ) => 'text' === p.pair || 'button' === p.pair );
	return (
		<>
			{ 'low' === found.confidence ? (
				<Notice tone="warning" title={ __( 'Not sure about these colours', 'funnelforms-pro' ) }>
					{ __( 'Nothing names a clear accent colour, so nothing is chosen for you. Pick only colours that really belong to the website, or keep the form\'s.', 'funnelforms-pro' ) }
				</Notice>
			) : 'medium' === found.confidence ? (
				<p className="ffxb-hint">{ __( 'Some of these colours are good guesses. Check them in the sample before applying.', 'funnelforms-pro' ) }</p>
			) : null }
			{ found.colors.length ? (
				<>
					<Swatches label={ __( 'Accent colour', 'funnelforms-pro' ) } colors={ found.colors } origins={ found.origins } value={ picks.primary } current={ current[ 'color.primary' ] } onChange={ pick( 'primary' ) } />
					<Swatches label={ __( 'Text', 'funnelforms-pro' ) } colors={ found.colors } origins={ found.origins } value={ picks.text } current={ current[ 'color.text' ] } onChange={ pick( 'text' ) } />
					<Swatches label={ __( 'Background', 'funnelforms-pro' ) } colors={ found.colors } origins={ found.origins } value={ picks.background } current={ current[ 'color.background' ] } onChange={ pick( 'background' ) } />
				</>
			) : null }
			{ found.fonts.length ? (
				<Select<string>
					label={ __( 'Font', 'funnelforms-pro' ) }
					value={ picks.font ?? '' }
					options={ [ { value: '', label: __( 'Keep the current font', 'funnelforms-pro' ) }, ...found.fonts.map( ( f ) => ( { value: f.value, label: f.from ? sprintf( /* translators: 1: name of a font, 2: where it was found, e.g. Astra: font of the text */ __( '%1$s (%2$s)', 'funnelforms-pro' ), f.family, f.from ) : f.family } ) ) ] }
					onChange={ ( v ) => pick( 'font' )( v || null ) }
				/>
			) : null }
			{ font && ! font.local && font.google && api.installGoogleFont ? (
				<p className="ffxb-hint">{ sprintf( __( '%s is a Google Font. Applying downloads it once to your site; visitors load nothing from Google.', 'funnelforms-pro' ), font.family ) }</p>
			) : font && ! font.local ? (
				<p className="ffxb-hint">{ sprintf( __( '%s is not hosted on your site. Visitors see it only on pages that load it; upload the font file in the design settings to show it everywhere.', 'funnelforms-pro' ), font.family ) }</p>
			) : null }
			<Sample tokens={ tokens } />
			<div className="ffxb-branding__contrast">
				<ContrastChip label={ __( 'Text', 'funnelforms-pro' ) } text={ tokens[ 'color.text' ] } background={ tokens[ 'color.background' ] } />
				<ContrastChip label={ __( 'Button', 'funnelforms-pro' ) } text={ tokens[ 'color.onButton' ] ?? tokens[ 'color.onPrimary' ] } background={ tokens[ 'color.button' ] ?? tokens[ 'color.primary' ] } />
			</div>
			{ problems.length ? <p className="ffxb-hint">{ __( 'Some text would be hard to read. Choose another colour or adjust it.', 'funnelforms-pro' ) }</p> : null }
		</>
	);
}

function pickedTokens( picks: BrandingPicks ): Record<string, string> {
	const out: Record<string, string> = {};
	if ( picks.primary ) {
		out[ 'color.primary' ] = picks.primary;
		out[ 'color.onPrimary' ] = readableOn( picks.primary );
	}
	if ( picks.text ) {
		out[ 'color.text' ] = picks.text;
	}
	if ( picks.background ) {
		out[ 'color.background' ] = picks.background;
	}
	return out;
}

/** Choice of a colour found, or keeping the form's; the chosen one can be adjusted. */
function Swatches( { label, colors, origins, value, current, onChange }: { label: string; colors: string[]; origins?: Record<string, string>; value: string | null; current: string; onChange: ( value: string | null ) => void } ) {
	const from = value ? origins?.[ value ] : undefined;
	const own = null !== value && ! colors.includes( value );
	return (
		<div className="ffxb-field">
			<span className="ffxb-field__label">{ label }</span>
			<div className="ffxb-swatches" role="radiogroup" aria-label={ label }>
				<button type="button" role="radio" aria-checked={ null === value } className="ffxb-swatch ffxb-swatch--keep" title={ __( 'Keep', 'funnelforms-pro' ) } onClick={ () => onChange( null ) }>
					<i aria-hidden="true" style={ { background: current } } />
					{ __( 'Keep', 'funnelforms-pro' ) }
				</button>
				{ colors.map( ( c ) => (
					<button key={ c } type="button" role="radio" aria-checked={ value === c } aria-label={ c } title={ origins?.[ c ] ? `${ c } · ${ origins[ c ] }` : c } className="ffxb-swatch" style={ { background: c } } onClick={ () => onChange( c ) } />
				) ) }
				<input
					type="color"
					className={ 'ffxb-swatch ffxb-swatch--adjust' + ( own ? ' is-chosen' : '' ) }
					aria-label={ sprintf( /* translators: %s: role of a colour, e.g. Accent colour */ __( 'Adjust %s', 'funnelforms-pro' ), label ) }
					title={ __( 'Adjust', 'funnelforms-pro' ) }
					value={ toHex( value ?? current ) ?? '#000000' }
					onChange={ ( e ) => onChange( e.target.value ) }
				/>
			</div>
			{ value ? <span className="ffxb-swatches__from">{ from ? sprintf( /* translators: 1: a colour, 2: where it was found, e.g. Astra: buttons */ __( '%1$s, from %2$s', 'funnelforms-pro' ), value, from ) : value }</span> : null }
		</div>
	);
}

/** How the picks look together. */
export function Sample( { tokens }: { tokens: Record<string, string> } ) {
	const css = ( v: string | undefined ): string | undefined => ( ! v || 'inherit' === v || 'transparent' === v ? undefined : v );
	return (
		<div className="ffxb-branding__sample" aria-hidden="true" style={ { background: css( tokens[ 'color.background' ] ), color: css( tokens[ 'color.text' ] ) } }>
			<span>{ __( 'Your question', 'funnelforms-pro' ) }</span>
			<i style={ { background: css( tokens[ 'color.button' ] ?? tokens[ 'color.primary' ] ), color: css( tokens[ 'color.onButton' ] ?? tokens[ 'color.onPrimary' ] ) } }>{ __( 'Next', 'funnelforms-pro' ) }</i>
		</div>
	);
}
