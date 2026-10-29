/**
 * The design of a form (with nothing selected on the canvas): themes, saved styles, colours,
 * steps and progress, fonts, sizes, borders, background and the form's own CSS. Almost every value
 * is a style token (FormDocument.style.tokens), which the plugin turns into CSS variables
 * (Frontend\\StyleTokens); steps and progress also set a few form settings.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import type { FontFile, GoogleFont, MediaImage, SavedStyle } from '../api';
import type { Recipe } from '../store';
import { applySavedStyle, changedFromTheme, contrastProblems, effectiveTokens, setStyleToken, splitAlpha, toHex, withAlpha, type ContrastProblem, type ThemeToken } from '../themes';
import { FONT_STACKS } from '../fonts';
import { BrandingImport } from './BrandingImport';
import { ColorField, ContrastChip, ImageColorDialog, type ColorTarget } from './ColorPick';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';
import { SiteDesignButton } from './SiteDesign';
import { ThemeGallery, themeName } from './ThemeGallery';
import { Button, ChoiceTiles, ColorInput, Dialog, Field as FieldRow, IconButton, icons, Notice, Range, Section, Select, Sketch, TextInput, Toggle } from './ui';

type SetToken = ( key: string, value: string | null ) => void;

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

function contrastText( problem: ContrastProblem ): string {
	const ratio = problem.ratio.toFixed( 1 );
	switch ( problem.pair ) {
		case 'button':
			return sprintf( __( 'Button text is hard to read on the button colour (%s:1).', 'funnelforms-pro' ), ratio );
		case 'back':
			return sprintf( __( 'The text of the back button is hard to read on its colour (%s:1).', 'funnelforms-pro' ), ratio );
		case 'heading':
			return sprintf( __( 'Questions are hard to read on the background (%s:1).', 'funnelforms-pro' ), ratio );
		case 'muted':
			return sprintf( __( 'Hints are hard to read on the background (%s:1).', 'funnelforms-pro' ), ratio );
		default:
			return sprintf( __( 'Text is hard to read on the background (%s:1).', 'funnelforms-pro' ), ratio );
	}
}

/** Fonts the builder offers: bundled with the plugin or present on every device. */
const FONTS = [ 'inherit', 'Montserrat', 'Poppins', 'system-ui', ...Object.keys( FONT_STACKS ), 'serif', 'monospace' ];

function fontName( value: string ): string {
	const names: Record<string, string> = {
		inherit: __( 'Font of the website', 'funnelforms-pro' ),
		'system-ui': __( 'System font', 'funnelforms-pro' ),
		serif: __( 'Serif', 'funnelforms-pro' ),
		monospace: __( 'Monospace', 'funnelforms-pro' ),
		'serif-classic': __( 'Classic serif', 'funnelforms-pro' ),
		'serif-modern': __( 'Modern serif', 'funnelforms-pro' ),
		'sans-humanist': __( 'Humanist sans serif', 'funnelforms-pro' ),
		'sans-geometric': __( 'Geometric sans serif', 'funnelforms-pro' ),
		rounded: __( 'Rounded', 'funnelforms-pro' ),
		slab: __( 'Slab serif', 'funnelforms-pro' ),
		condensed: __( 'Condensed', 'funnelforms-pro' ),
		'mono-code': __( 'Code', 'funnelforms-pro' ),
	};
	return names[ value ] ?? value;
}

/** Fonts of the site: uploaded files and the Google Fonts it can download (with those it has). */
interface SiteFonts {
	uploaded: FontFile[];
	google: GoogleFont[];
	addUploaded: ( font: FontFile ) => void;
	addGoogle: ( font: GoogleFont ) => void;
}

/**
 * A font: bundled, generic, uploaded or downloaded from Google Fonts to the site, and adding
 * one. With `sameAs` the first choice is "same as" another font (an empty value, the token is
 * removed).
 */
function FontPicker( { label, font, onChange, sameAs, fonts }: { label: string; font: string; onChange: ( value: string ) => void; sameAs?: string; fonts: SiteFonts } ) {
	const { api, readOnly } = useEnv();
	const fileInput = useRef<HTMLInputElement>( null );
	const [ busy, setBusy ] = useState( false );
	const [ browse, setBrowse ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );

	const options = [
		...( undefined !== sameAs ? [ { value: '', label: sameAs } ] : [] ),
		...FONTS.map( ( f ) => ( { value: f, label: fontName( f ) } ) ),
		...fonts.uploaded.map( ( f ) => ( { value: f.file, label: f.family } ) ),
		...fonts.google.filter( ( f ) => f.installed ).map( ( f ) => ( { value: f.family, label: f.family } ) ),
	];
	if ( ! options.some( ( o ) => o.value === font ) ) {
		options.push( { value: font, label: font } );
	}
	const upload = async ( file: File ): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const added = await api.uploadFont( file, file.name );
			fonts.addUploaded( added );
			onChange( added.file );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	return (
		<div className="ffxb-font-picker">
			<Select label={ label } value={ font } options={ options } onChange={ onChange } />
			<div className="ffxb-font-picker__actions">
				{ api.installGoogleFont && fonts.google.length ? (
					<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly } onClick={ () => setBrowse( true ) }>
						{ __( 'Google Fonts', 'funnelforms-pro' ) }
					</Button>
				) : null }
				<Button size="sm" variant="ghost" icon={ icons.upload } disabled={ readOnly || busy } onClick={ () => fileInput.current?.click() }>
					{ busy ? __( 'Uploading…', 'funnelforms-pro' ) : __( 'Upload font', 'funnelforms-pro' ) }
				</Button>
			</div>
			<input
				ref={ fileInput }
				type="file"
				accept=".ttf,.otf,.woff,.woff2"
				hidden
				onChange={ ( e ) => {
					const file = e.target.files?.[ 0 ];
					e.target.value = '';
					if ( file ) {
						void upload( file );
					}
				} }
			/>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ browse ? (
				<GoogleFontsDialog
					fonts={ fonts }
					current={ font }
					onClose={ () => setBrowse( false ) }
					onPick={ ( family ) => {
						onChange( family );
						setBrowse( false );
					} }
				/>
			) : null }
		</div>
	);
}

const CATEGORIES: GoogleFont[ 'category' ][] = [ 'sans-serif', 'serif', 'display', 'handwriting', 'monospace' ];

function categoryName( category: string ): string {
	const names: Record<string, string> = {
		'': __( 'All styles', 'funnelforms-pro' ),
		'sans-serif': __( 'Sans serif', 'funnelforms-pro' ),
		serif: __( 'Serif', 'funnelforms-pro' ),
		display: __( 'Display', 'funnelforms-pro' ),
		handwriting: __( 'Handwriting', 'funnelforms-pro' ),
		monospace: __( 'Monospace', 'funnelforms-pro' ),
	};
	return names[ category ] ?? category;
}

/**
 * The Google Fonts of the catalogue, searchable. Picking one the site does not have yet
 * downloads it to the site first; the form then names it like any other font.
 */
function GoogleFontsDialog( { fonts, current, onClose, onPick }: { fonts: SiteFonts; current: string; onClose: () => void; onPick: ( family: string ) => void } ) {
	const { api } = useEnv();
	const [ query, setQuery ] = useState( '' );
	const [ category, setCategory ] = useState( '' );
	const [ busy, setBusy ] = useState<string | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const needle = query.trim().toLowerCase();
	const list = fonts.google.filter( ( f ) => ( '' === category || f.category === category ) && ( '' === needle || f.family.toLowerCase().includes( needle ) ) );

	const pick = async ( font: GoogleFont ): Promise<void> => {
		if ( font.installed || ! api.installGoogleFont ) {
			onPick( font.family );
			return;
		}
		setBusy( font.family );
		setError( null );
		try {
			fonts.addGoogle( await api.installGoogleFont( font.family ) );
			onPick( font.family );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( null );
	};
	return (
		<Dialog title={ __( 'Google Fonts', 'funnelforms-pro' ) } open onClose={ onClose } wide actions={ <Button variant="secondary" onClick={ onClose }>{ __( 'Close', 'funnelforms-pro' ) }</Button> }>
			<p className="ffxb-hint">{ __( 'A font you pick is downloaded once to your site. Visitors load it from there and nothing from Google.', 'funnelforms-pro' ) }</p>
			<div className="ffxb-google-fonts__filter">
				<TextInput label={ __( 'Search', 'funnelforms-pro' ) } type="search" value={ query } onChange={ setQuery } />
				<Select<string> label={ __( 'Style', 'funnelforms-pro' ) } value={ category } options={ [ '', ...CATEGORIES ].map( ( c ) => ( { value: c, label: categoryName( c ) } ) ) } onChange={ setCategory } />
			</div>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<ul className="ffxb-google-fonts" aria-label={ __( 'Google Fonts', 'funnelforms-pro' ) }>
				{ list.map( ( f ) => (
					<li key={ f.family }>
						<button type="button" className="ffxb-google-font" aria-pressed={ f.family === current } disabled={ null !== busy } onClick={ () => void pick( f ) }>
							<span className="ffxb-google-font__name">{ f.family }</span>
							<span className="ffxb-google-font__meta">
								{ busy === f.family ? __( 'Downloading…', 'funnelforms-pro' ) : f.installed ? __( 'On your site', 'funnelforms-pro' ) : categoryName( f.category ) }
							</span>
						</button>
					</li>
				) ) }
			</ul>
			{ list.length ? null : <p className="ffxb-hint">{ __( 'No font matches.', 'funnelforms-pro' ) }</p> }
		</Dialog>
	);
}

/** Fonts of the site, loaded once for all font pickers. */
function useSiteFonts(): SiteFonts {
	const { api } = useEnv();
	const [ uploaded, setUploaded ] = useState<FontFile[]>( [] );
	const [ google, setGoogle ] = useState<GoogleFont[]>( [] );
	useEffect( () => {
		let live = true;
		api.fonts().then(
			( list ) => live && setUploaded( list ),
			() => undefined
		);
		api.googleFonts?.().then(
			( list ) => live && setGoogle( list ),
			() => undefined
		);
		return () => {
			live = false;
		};
	}, [ api ] );
	return {
		uploaded,
		google,
		addUploaded: ( font ) => setUploaded( ( list ) => [ ...list.filter( ( f ) => f.file !== font.file ), font ] ),
		addGoogle: ( font ) => setGoogle( ( list ) => list.map( ( f ) => ( f.family === font.family ? { ...f, installed: true } : f ) ) ),
	};
}

/** Themes and the global styles of the form: colours, fonts, sizes, borders and background. */
export function DesignInspector( { doc }: { doc: FormDocument } ) {
	const change = useChange();
	const { api, readOnly } = useEnv();
	const tokens = effectiveTokens( doc.style.tokens );
	const token: SetToken = ( key, value ) => change( ( d ) => setStyleToken( d, key, value ), 'style:' + key );
	const font = doc.style.tokens[ 'font.family' ] ?? 'inherit';
	const card = Number.parseInt( tokens[ 'radius.card' ], 10 );
	const problems = contrastProblems( doc.style.tokens );
	const fonts = useSiteFonts();
	const [ picking, setPicking ] = useState<'logo' | 'image' | null>( null );
	const buttonText = tokens[ 'color.onButton' ] ?? tokens[ 'color.onPrimary' ];
	const buttonColor = tokens[ 'color.button' ] ?? tokens[ 'color.primary' ];
	const colors: Array<[ ThemeToken, string, React.ReactNode ]> = [
		[ 'color.primary', __( 'Accent colour', 'funnelforms-pro' ), <ContrastChip key="c" label={ __( 'Button text', 'funnelforms-pro' ) } text={ buttonText } background={ buttonColor } /> ],
		[ 'color.text', __( 'Text', 'funnelforms-pro' ), <ContrastChip key="c" label={ __( 'On the background', 'funnelforms-pro' ) } text={ tokens[ 'color.text' ] } background={ tokens[ 'color.background' ] } /> ],
		[ 'color.background', __( 'Background', 'funnelforms-pro' ), null ],
		[ 'color.border', __( 'Borders', 'funnelforms-pro' ), null ],
	];
	// The colours of the form at a glance, as visitors see them.
	const palette: Array<[ string, string ]> = [
		[ buttonColor, __( 'Next and send button', 'funnelforms-pro' ) ],
		[ tokens[ 'color.primary' ], __( 'Accent colour', 'funnelforms-pro' ) ],
		[ tokens[ 'color.text' ], __( 'Text', 'funnelforms-pro' ) ],
		[ tokens[ 'color.background' ], __( 'Background', 'funnelforms-pro' ) ],
		[ tokens[ 'color.border' ], __( 'Borders', 'funnelforms-pro' ) ],
	];
	const targets: ColorTarget[] = [
		...colors.map( ( [ key, label ] ) => ( { token: key, label } ) ),
		{ token: 'color.button', label: __( 'Next and send button', 'funnelforms-pro' ) },
		{ token: 'color.heading', label: __( 'Questions and headings', 'funnelforms-pro' ) },
	];
	return (
		<Section title={ __( 'Design', 'funnelforms-pro' ) }>
			{ /* Reading the site's design is Funnelforms Pro, like the import from a website. */ }
			{ 'free' === process.env.FUNNELFORMS_EDITION ? null : <SiteDesignButton doc={ doc } /> }
			<ThemeGallery doc={ doc } />
			<div className="ffxb-design-sources">
				{ 'free' === process.env.FUNNELFORMS_EDITION ? null : <SavedStyles doc={ doc } /> }
				{ 'free' === process.env.FUNNELFORMS_EDITION ? null : <BrandingImport doc={ doc } /> }
			</div>
			<div className="ffxb-design-group">
				<div className="ffxb-design-group__head">
					<h3 className="ffxb-design-group__title">{ __( 'Colours', 'funnelforms-pro' ) }</h3>
					<ul className="ffxb-swatch-row" aria-hidden="true">
						{ palette.map( ( [ color, label ] ) => (
							<li key={ label } title={ `${ label }: ${ color }` } style={ { background: color } } />
						) ) }
					</ul>
				</div>
				{ changedFromTheme( doc ) ? <p className="ffxb-hint">{ sprintf( __( 'Based on %s, with your changes.', 'funnelforms-pro' ), themeName( doc.style.theme ?? '' ) ) }</p> : null }
				<div className="ffxb-design-group__actions">
					{ api.siteLogo ? (
						<Button size="sm" variant="secondary" icon={ icons.image } disabled={ readOnly } onClick={ () => setPicking( 'logo' ) }>
							{ __( 'From your logo', 'funnelforms-pro' ) }
						</Button>
					) : null }
					<Button size="sm" variant="ghost" icon={ icons.upload } disabled={ readOnly } onClick={ () => setPicking( 'image' ) }>
						{ __( 'From an image', 'funnelforms-pro' ) }
					</Button>
				</div>
				{ colors.map( ( [ key, label, note ] ) => (
					<ColorField key={ key } label={ label } value={ doc.style.tokens[ key ] ?? '' } hex={ toHex( tokens[ key ] ) } onChange={ ( v ) => token( key, v ) } note={ note } />
				) ) }
				{ picking ? (
					<ImageColorDialog
						targets={ targets }
						logo={ 'logo' === picking }
						onClose={ () => setPicking( null ) }
						onPick={ ( hex, key ) => {
							token( key, hex );
							setPicking( null );
						} }
					/>
				) : null }
			</div>
			{ problems.length ? (
				<Notice tone="warning" title={ __( 'Hard to read', 'funnelforms-pro' ) }>
					<ul>
						{ problems.map( ( p ) => (
							<li key={ p.pair }>{ contrastText( p ) }</li>
						) ) }
					</ul>
					{ __( 'Aim for at least 4.5:1 so everyone can read the form.', 'funnelforms-pro' ) }
				</Notice>
			) : null }
			<StepsAndProgress doc={ doc } token={ token } />
			<FontPicker label={ __( 'Font', 'funnelforms-pro' ) } font={ font } onChange={ ( v ) => token( 'font.family', v ) } fonts={ fonts } />
			<p className="ffxb-hint">{ __( 'Fonts are hosted on your site, so visitors load nothing from other servers. Check that the font\'s license allows use on websites.', 'funnelforms-pro' ) }</p>
			<Range
				label={ __( 'Corners', 'funnelforms-pro' ) }
				min={ 0 }
				max={ 24 }
				unit=" px"
				value={ Number.isFinite( card ) ? card : 12 }
				onChange={ ( v ) =>
					change( ( d ) => {
						setStyleToken( d, 'radius.card', String( v ) );
						setStyleToken( d, 'radius.input', String( Math.round( ( v * 2 ) / 3 ) ) );
					}, 'style:radius' )
				}
			/>
			<FormWidth doc={ doc } token={ token } />
			<MoreColors doc={ doc } token={ token } />
			<Typography doc={ doc } token={ token } fonts={ fonts } />
			<Spacing doc={ doc } token={ token } />
			<BordersAndShadow doc={ doc } token={ token } />
			<Background doc={ doc } token={ token } />
			{ /* Custom CSS is Funnelforms Pro: Free shows it only to remove it. */ }
			{ 'free' !== process.env.FUNNELFORMS_EDITION || doc.style.css ? <CustomCss doc={ doc } /> : null }
		</Section>
	);
}

/** A whole number of a token, or the fallback. */
function num( doc: FormDocument, key: string, fallback: number ): number {
	const n = Number.parseFloat( doc.style.tokens[ key ] ?? '' );
	return Number.isFinite( n ) ? n : fallback;
}

/** A colour token that can be left to its default (empty). */
function OptionalColor( { doc, token, name, label, fallback, note }: { doc: FormDocument; token: SetToken; name: string; label: string; fallback: string; note?: React.ReactNode } ) {
	const value = doc.style.tokens[ name ] ?? '';
	return <ColorField label={ label } value={ value } hex={ toHex( '' !== value ? value : fallback ) } onChange={ ( v ) => token( name, v ) } note={ note } />;
}

function MoreColors( { doc, token }: { doc: FormDocument; token: SetToken } ) {
	const t = effectiveTokens( doc.style.tokens );
	const primary = t[ 'color.primary' ];
	const readable = __( 'On the background', 'funnelforms-pro' );
	const chip = ( text: string | undefined, background: string | undefined, label = readable ): React.ReactNode => <ContrastChip label={ label } text={ text ?? '' } background={ background ?? '' } />;
	return (
		<details className="ffxb-advanced">
			<summary>{ __( 'More colours', 'funnelforms-pro' ) }</summary>
			<p className="ffxb-hint">{ __( 'Empty fields follow the colours above.', 'funnelforms-pro' ) }</p>
			<OptionalColor doc={ doc } token={ token } name="color.heading" label={ __( 'Questions and headings', 'funnelforms-pro' ) } fallback={ t[ 'color.text' ] } note={ chip( t[ 'color.heading' ] ?? t[ 'color.text' ], t[ 'color.background' ] ) } />
			<OptionalColor doc={ doc } token={ token } name="color.muted" label={ __( 'Descriptions and hints', 'funnelforms-pro' ) } fallback={ t[ 'color.muted' ] } note={ chip( t[ 'color.muted' ], t[ 'color.background' ] ) } />
			<OptionalColor doc={ doc } token={ token } name="color.button" label={ __( 'Next and send button', 'funnelforms-pro' ) } fallback={ primary } />
			<OptionalColor doc={ doc } token={ token } name="color.onButton" label={ __( 'Text on that button', 'funnelforms-pro' ) } fallback={ t[ 'color.onPrimary' ] } note={ chip( t[ 'color.onButton' ] ?? t[ 'color.onPrimary' ], t[ 'color.button' ] ?? primary, __( 'On the button', 'funnelforms-pro' ) ) } />
			<OptionalColor doc={ doc } token={ token } name="color.back" label={ __( 'Back button', 'funnelforms-pro' ) } fallback={ t[ 'color.background' ] } />
			<OptionalColor doc={ doc } token={ token } name="color.onBack" label={ __( 'Text on the back button', 'funnelforms-pro' ) } fallback={ t[ 'color.text' ] } note={ chip( t[ 'color.onBack' ] ?? t[ 'color.text' ], t[ 'color.back' ] ?? t[ 'color.background' ], __( 'On the button', 'funnelforms-pro' ) ) } />
			<OptionalColor doc={ doc } token={ token } name="color.option" label={ __( 'Answers', 'funnelforms-pro' ) } fallback={ t[ 'color.background' ] } />
			<OptionalColor doc={ doc } token={ token } name="color.optionSelected" label={ __( 'Chosen answer', 'funnelforms-pro' ) } fallback={ t[ 'color.background' ] } />
			<OptionalColor doc={ doc } token={ token } name="color.icon" label={ __( 'Icons of answers', 'funnelforms-pro' ) } fallback={ primary } />
			<OptionalColor doc={ doc } token={ token } name="color.progress" label={ __( 'Progress bar', 'funnelforms-pro' ) } fallback={ primary } />
			<OptionalColor doc={ doc } token={ token } name="color.progressTrack" label={ __( 'Progress bar background', 'funnelforms-pro' ) } fallback={ t[ 'color.border' ] } />
		</details>
	);
}

function Typography( { doc, token, fonts }: { doc: FormDocument; token: SetToken; fonts: SiteFonts } ) {
	const size = num( doc, 'font.size', 16 );
	const heading = num( doc, 'font.size.heading', Math.round( size * 1.25 ) );
	const field = num( doc, 'font.size.field', size );
	const same = __( 'Same as the text', 'funnelforms-pro' );
	return (
		<details className="ffxb-advanced">
			<summary>{ __( 'Fonts and sizes', 'funnelforms-pro' ) }</summary>
			<FontPicker label={ __( 'Font of questions and headings', 'funnelforms-pro' ) } font={ doc.style.tokens[ 'font.heading' ] ?? '' } sameAs={ same } onChange={ ( v ) => token( 'font.heading', v ) } fonts={ fonts } />
			<FontPicker label={ __( 'Font of answers and inputs', 'funnelforms-pro' ) } font={ doc.style.tokens[ 'font.field' ] ?? '' } sameAs={ same } onChange={ ( v ) => token( 'font.field', v ) } fonts={ fonts } />
			<Select
				label={ __( 'Weight of questions', 'funnelforms-pro' ) }
				value={ doc.style.tokens[ 'font.weight.heading' ] ?? 'semibold' }
				options={ [
					{ value: 'normal', label: __( 'Normal', 'funnelforms-pro' ) },
					{ value: 'medium', label: __( 'Medium', 'funnelforms-pro' ) },
					{ value: 'semibold', label: __( 'Semibold', 'funnelforms-pro' ) },
					{ value: 'bold', label: __( 'Bold', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => token( 'font.weight.heading', 'semibold' === v ? null : v ) }
			/>
			<Toggle label={ __( 'Questions in capitals', 'funnelforms-pro' ) } checked={ 'upper' === doc.style.tokens[ 'heading.case' ] } onChange={ ( on ) => token( 'heading.case', on ? 'upper' : null ) } />
			<Range label={ __( 'Text size', 'funnelforms-pro' ) } min={ 12 } max={ 24 } unit=" px" value={ size } onChange={ ( v ) => token( 'font.size', String( v ) ) } />
			<Range label={ __( 'Text size on phones', 'funnelforms-pro' ) } min={ 12 } max={ 24 } unit=" px" value={ num( doc, 'font.size.mobile', size ) } onChange={ ( v ) => token( 'font.size.mobile', String( v ) ) } />
			<Range label={ __( 'Size of questions', 'funnelforms-pro' ) } min={ 14 } max={ 48 } unit=" px" value={ heading } onChange={ ( v ) => token( 'font.size.heading', String( v ) ) } />
			<Range label={ __( 'Size of questions on phones', 'funnelforms-pro' ) } min={ 14 } max={ 40 } unit=" px" value={ num( doc, 'font.size.heading.mobile', heading ) } onChange={ ( v ) => token( 'font.size.heading.mobile', String( v ) ) } />
			<Range label={ __( 'Size of answers and inputs', 'funnelforms-pro' ) } min={ 10 } max={ 24 } unit=" px" value={ field } onChange={ ( v ) => token( 'font.size.field', String( v ) ) } />
			<Range label={ __( 'Size of answers and inputs on phones', 'funnelforms-pro' ) } min={ 10 } max={ 24 } unit=" px" value={ num( doc, 'font.size.field.mobile', field ) } onChange={ ( v ) => token( 'font.size.field.mobile', String( v ) ) } />
			<Range label={ __( 'Line height of questions', 'funnelforms-pro' ) } min={ 1 } max={ 2.5 } step={ 0.1 } value={ num( doc, 'line.heading', 1.3 ) } onChange={ ( v ) => token( 'line.heading', v.toFixed( 1 ) ) } />
			<Range label={ __( 'Line height of text', 'funnelforms-pro' ) } min={ 1 } max={ 2.5 } step={ 0.1 } value={ num( doc, 'line.body', 1.5 ) } onChange={ ( v ) => token( 'line.body', v.toFixed( 1 ) ) } />
		</details>
	);
}

/**
 * How wide the whole form gets (token form.width): a slider for the widest it gets, or the full
 * width of the place it sits in. Narrow screens make it narrower either way.
 */
function FormWidth( { doc, token }: { doc: FormDocument; token: SetToken } ) {
	const raw = doc.style.tokens[ 'form.width' ] ?? '';
	const full = 'full' === raw;
	const width = Math.max( 360, Math.min( 1400, num( doc, 'form.width', 960 ) ) );
	return (
		<>
			<ChoiceTiles
				label={ __( 'Width of the form', 'funnelforms-pro' ) }
				value={ full ? 'full' : 'fixed' }
				columns={ 2 }
				options={ [
					{ value: 'fixed', label: __( 'Fixed width', 'funnelforms-pro' ), icon: <Sketch><rect x="2" y="6" width="44" height="20" rx="3" strokeDasharray="3 3" /><rect x="13" y="9" width="22" height="14" rx="2" fill="currentColor" /></Sketch> },
					{ value: 'full', label: __( 'Full width', 'funnelforms-pro' ), icon: <Sketch><rect x="2" y="6" width="44" height="20" rx="3" strokeDasharray="3 3" /><rect x="5" y="9" width="38" height="14" rx="2" fill="currentColor" /></Sketch> },
				] }
				onChange={ ( v ) => token( 'form.width', 'full' === v ? 'full' : null ) }
			/>
			{ full ? (
				<p className="ffxb-hint">{ __( 'The form fills the space it is placed in, for example the content area of your page.', 'funnelforms-pro' ) }</p>
			) : (
				<Range label={ __( 'Maximum width', 'funnelforms-pro' ) } min={ 360 } max={ 1400 } step={ 10 } unit=" px" value={ width } onChange={ ( v ) => token( 'form.width', 960 === v ? null : String( v ) ) } />
			) }
		</>
	);
}

function Spacing( { doc, token }: { doc: FormDocument; token: SetToken } ) {
	const icon = num( doc, 'size.icon', 64 );
	return (
		<details className="ffxb-advanced">
			<summary>{ __( 'Spacing and sizes', 'funnelforms-pro' ) }</summary>
			<Range label={ __( 'Space between answers', 'funnelforms-pro' ) } min={ 4 } max={ 32 } unit=" px" value={ num( doc, 'space.gap', 12 ) } onChange={ ( v ) => token( 'space.gap', String( v ) ) } />
			<Range label={ __( 'Inner spacing', 'funnelforms-pro' ) } min={ 0 } max={ 64 } unit=" px" value={ num( doc, 'space.padding', 24 ) } onChange={ ( v ) => token( 'space.padding', String( v ) ) } />
			<Range label={ __( 'Height of buttons', 'funnelforms-pro' ) } min={ 4 } max={ 24 } unit=" px" value={ num( doc, 'space.button', 10 ) } onChange={ ( v ) => token( 'space.button', String( v ) ) } />
			<Range label={ __( 'Corners of buttons', 'funnelforms-pro' ) } min={ 0 } max={ 32 } unit=" px" value={ num( doc, 'radius.button', num( doc, 'radius.input', 8 ) ) } onChange={ ( v ) => token( 'radius.button', String( v ) ) } />
			<Range label={ __( 'Size of icons and images in answers', 'funnelforms-pro' ) } min={ 24 } max={ 200 } unit=" px" value={ icon } onChange={ ( v ) => token( 'size.icon', String( v ) ) } />
			<Range label={ __( 'Size of icons and images on phones', 'funnelforms-pro' ) } min={ 24 } max={ 200 } unit=" px" value={ num( doc, 'size.icon.mobile', icon ) } onChange={ ( v ) => token( 'size.icon.mobile', String( v ) ) } />
		</details>
	);
}

function BordersAndShadow( { doc, token }: { doc: FormDocument; token: SetToken } ) {
	const shadow = doc.style.tokens.shadow ?? 'none';
	const shadowColor = doc.style.tokens[ 'shadow.color' ] ?? '';
	return (
		<details className="ffxb-advanced">
			<summary>{ __( 'Borders and shadow', 'funnelforms-pro' ) }</summary>
			<Range label={ __( 'Border width', 'funnelforms-pro' ) } min={ 0 } max={ 6 } unit=" px" value={ num( doc, 'border.width', 2 ) } onChange={ ( v ) => token( 'border.width', String( v ) ) } />
			<Select
				label={ __( 'Border style', 'funnelforms-pro' ) }
				value={ doc.style.tokens[ 'border.style' ] ?? 'solid' }
				options={ [
					{ value: 'solid', label: __( 'Solid', 'funnelforms-pro' ) },
					{ value: 'dashed', label: __( 'Dashed', 'funnelforms-pro' ) },
					{ value: 'dotted', label: __( 'Dotted', 'funnelforms-pro' ) },
					{ value: 'none', label: __( 'None', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => token( 'border.style', 'solid' === v ? null : v ) }
			/>
			<Toggle label={ __( 'Border around the whole form', 'funnelforms-pro' ) } checked={ 'on' === doc.style.tokens[ 'border.container' ] } onChange={ ( on ) => token( 'border.container', on ? 'on' : null ) } />
			<Select
				label={ __( 'Shadow', 'funnelforms-pro' ) }
				value={ shadow }
				options={ [
					{ value: 'none', label: __( 'None', 'funnelforms-pro' ) },
					{ value: 'soft', label: __( 'Soft', 'funnelforms-pro' ) },
					{ value: 'medium', label: __( 'Medium', 'funnelforms-pro' ) },
					{ value: 'strong', label: __( 'Strong', 'funnelforms-pro' ) },
					{ value: 'custom', label: __( 'Custom', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => token( 'shadow', 'none' === v ? null : v ) }
			/>
			<Select
				label={ __( 'Shadow of answers', 'funnelforms-pro' ) }
				value={ doc.style.tokens[ 'tile.shadow' ] ?? 'soft' }
				options={ [
					{ value: 'none', label: __( 'None', 'funnelforms-pro' ) },
					{ value: 'soft', label: __( 'Soft', 'funnelforms-pro' ) },
					{ value: 'lifted', label: __( 'Lifted', 'funnelforms-pro' ) },
					{ value: 'hard', label: __( 'Hard edge', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => token( 'tile.shadow', 'soft' === v ? null : v ) }
			/>
			<Select
				label={ __( 'Shadow of the next and send button', 'funnelforms-pro' ) }
				value={ doc.style.tokens[ 'button.shadow' ] ?? '' }
				options={ [
					{ value: '', label: __( 'Standard', 'funnelforms-pro' ) },
					{ value: 'none', label: __( 'None', 'funnelforms-pro' ) },
					{ value: 'glow', label: __( 'Glow', 'funnelforms-pro' ) },
					{ value: 'hard', label: __( 'Hard edge', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => token( 'button.shadow', v || null ) }
			/>
			{ 'custom' === shadow ? (
				<>
					<Range label={ __( 'Shadow to the side', 'funnelforms-pro' ) } min={ -40 } max={ 40 } unit=" px" value={ num( doc, 'shadow.x', 0 ) } onChange={ ( v ) => token( 'shadow.x', String( v ) ) } />
					<Range label={ __( 'Shadow downwards', 'funnelforms-pro' ) } min={ -40 } max={ 40 } unit=" px" value={ num( doc, 'shadow.y', 8 ) } onChange={ ( v ) => token( 'shadow.y', String( v ) ) } />
					<Range label={ __( 'Blur', 'funnelforms-pro' ) } min={ 0 } max={ 80 } unit=" px" value={ num( doc, 'shadow.blur', 24 ) } onChange={ ( v ) => token( 'shadow.blur', String( v ) ) } />
					<Range label={ __( 'Spread', 'funnelforms-pro' ) } min={ -40 } max={ 40 } unit=" px" value={ num( doc, 'shadow.spread', 0 ) } onChange={ ( v ) => token( 'shadow.spread', String( v ) ) } />
					<AlphaColor label={ __( 'Shadow colour', 'funnelforms-pro' ) } value={ shadowColor } fallback="rgba(16,24,40,0.12)" onChange={ ( v ) => token( 'shadow.color', v ) } />
					<Toggle label={ __( 'Shadow inside', 'funnelforms-pro' ) } checked={ '1' === doc.style.tokens[ 'shadow.inset' ] } onChange={ ( on ) => token( 'shadow.inset', on ? '1' : null ) } />
				</>
			) : null }
		</details>
	);
}

/** A colour with a slider for its opacity. */
function AlphaColor( { label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: ( value: string | null ) => void } ) {
	const parts = splitAlpha( '' !== value ? value : fallback ) ?? { hex: '#000000', percent: 50 };
	return (
		<>
			<ColorInput label={ label } value={ value } hex={ parts.hex } onChange={ ( v ) => onChange( withAlpha( v, parts.percent ) ?? v ) } />
			<Range label={ sprintf( __( '%s: opacity', 'funnelforms-pro' ), label ) } min={ 0 } max={ 100 } unit=" %" value={ parts.percent } onChange={ ( v ) => onChange( withAlpha( parts.hex, v ) ) } />
		</>
	);
}

/** Gradient directions in degrees, as the CSS angle of linear-gradient(). */
const ANGLES = [ 0, 45, 90, 135, 160, 180, 225, 270, 315 ];

/** Two-colour gradients to start from. */
const GRADIENTS: Array<[ string, string, string ]> = [
	[ 'sunset', '#fde68a', '#fca5a5' ],
	[ 'lavender', '#ede9fe', '#fbcfe8' ],
	[ 'sky', '#e0f2fe', '#dbeafe' ],
	[ 'mint', '#dcfce7', '#cffafe' ],
	[ 'night', '#1e1b4b', '#0f172a' ],
	[ 'royal', '#4c1d95', '#1e3a8a' ],
	[ 'peach', '#fff7ed', '#ffe4e6' ],
	[ 'sand', '#fefce8', '#f5f5f4' ],
];

function Background( { doc, token }: { doc: FormDocument; token: SetToken } ) {
	const { api, readOnly } = useEnv();
	const change = useChange();
	const end = doc.style.tokens[ 'color.backgroundEnd' ] ?? '';
	const imageId = Number.parseInt( doc.style.tokens[ 'background.image' ] ?? '', 10 );
	const [ image, setImage ] = useState<MediaImage | null>( null );
	useEffect( () => {
		let live = true;
		if ( Number.isFinite( imageId ) && api.image ) {
			api.image( imageId ).then(
				( found ) => live && setImage( found ),
				() => undefined
			);
		} else {
			setImage( null );
		}
		return () => {
			live = false;
		};
	}, [ api, imageId ] );
	const pick = async (): Promise<void> => {
		const chosen = await api.pickImage?.( Number.isFinite( imageId ) ? imageId : undefined );
		if ( chosen ) {
			setImage( chosen );
			token( 'background.image', String( chosen.id ) );
		}
	};
	return (
		<details className="ffxb-advanced">
			<summary>{ __( 'Background', 'funnelforms-pro' ) }</summary>
			<Toggle label={ __( 'Background as gradient', 'funnelforms-pro' ) } checked={ '' !== end } onChange={ ( on ) => token( 'color.backgroundEnd', on ? '#efe9ff' : null ) } />
			{ '' !== end ? (
				<>
					<div className="ffxb-gradients" role="group" aria-label={ __( 'Gradients', 'funnelforms-pro' ) }>
						{ GRADIENTS.map( ( [ id, from, to ] ) => (
							<button
								key={ id }
								type="button"
								className="ffxb-gradient"
								title={ id }
								aria-label={ sprintf( __( 'Gradient %s', 'funnelforms-pro' ), id ) }
								disabled={ readOnly }
								style={ { background: `linear-gradient(135deg, ${ from }, ${ to })` } }
								onClick={ () =>
									change( ( d ) => {
										setStyleToken( d, 'color.background', from );
										setStyleToken( d, 'color.backgroundEnd', to );
									}, 'style:gradient' )
								}
							/>
						) ) }
					</div>
					<ColorField label={ __( 'Second background colour', 'funnelforms-pro' ) } value={ end } hex={ toHex( end ) } onChange={ ( v ) => token( 'color.backgroundEnd', v ) } />
					<Select
						label={ __( 'Direction', 'funnelforms-pro' ) }
						value={ String( num( doc, 'background.angle', 160 ) ) }
						options={ ANGLES.map( ( a ) => ( { value: String( a ), label: `${ a }°` } ) ) }
						onChange={ ( v ) => token( 'background.angle', '160' === v ? null : v ) }
					/>
				</>
			) : null }
			{ api.pickImage ? (
				<FieldRow label={ __( 'Background image', 'funnelforms-pro' ) }>
					{ () => (
						<div className="ffxb-image-pick">
							{ image ? <img src={ image.url } alt="" className="ffxb-image-pick__preview" /> : null }
							<Button size="sm" variant="secondary" icon={ icons.upload } disabled={ readOnly } onClick={ () => void pick() }>
								{ Number.isFinite( imageId ) ? __( 'Change image', 'funnelforms-pro' ) : __( 'Choose image', 'funnelforms-pro' ) }
							</Button>
							{ Number.isFinite( imageId ) ? (
								<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => token( 'background.image', null ) }>
									{ __( 'Remove', 'funnelforms-pro' ) }
								</Button>
							) : null }
						</div>
					) }
				</FieldRow>
			) : null }
			{ Number.isFinite( imageId ) ? (
				<>
					<AlphaColor label={ __( 'Colour over the image', 'funnelforms-pro' ) } value={ doc.style.tokens[ 'color.overlay' ] ?? '' } fallback="rgba(0,0,0,0)" onChange={ ( v ) => token( 'color.overlay', v ) } />
					<Select
						label={ __( 'Image size', 'funnelforms-pro' ) }
						value={ doc.style.tokens[ 'background.size' ] ?? 'cover' }
						options={ [
							{ value: 'cover', label: __( 'Fill the form', 'funnelforms-pro' ) },
							{ value: 'contain', label: __( 'Show whole image', 'funnelforms-pro' ) },
							{ value: 'auto', label: __( 'Original size', 'funnelforms-pro' ) },
						] }
						onChange={ ( v ) => token( 'background.size', 'cover' === v ? null : v ) }
					/>
					<Select
						label={ __( 'Image position', 'funnelforms-pro' ) }
						value={ doc.style.tokens[ 'background.position' ] ?? 'center' }
						options={ [
							{ value: 'top', label: __( 'Top', 'funnelforms-pro' ) },
							{ value: 'center', label: __( 'Centre', 'funnelforms-pro' ) },
							{ value: 'bottom', label: __( 'Bottom', 'funnelforms-pro' ) },
						] }
						onChange={ ( v ) => token( 'background.position', 'center' === v ? null : v ) }
					/>
					<p className="ffxb-hint">{ __( 'Check that text stays readable on the image; a colour over it helps.', 'funnelforms-pro' ) }</p>
				</>
			) : null }
		</details>
	);
}

function stepAnimations(): Array<{ value: string; label: string }> {
	return [
		{ value: 'none', label: __( 'None', 'funnelforms-pro' ) },
		{ value: 'fade', label: __( 'Fade in', 'funnelforms-pro' ) },
		{ value: 'slide', label: __( 'Slide in', 'funnelforms-pro' ) },
		{ value: 'fadeRight', label: __( 'Fade in from the left', 'funnelforms-pro' ) },
		{ value: 'backInRight', label: __( 'Swing in from the right', 'funnelforms-pro' ) },
		{ value: 'up', label: __( 'Rise up', 'funnelforms-pro' ) },
		{ value: 'zoom', label: __( 'Zoom in', 'funnelforms-pro' ) },
	];
}

/**
 * How visitors move through the form, in one place high up in the design: progress bar, the
 * height of the steps, scrolling, alignment, buttons and the transition between steps. The
 * progress settings are form settings (settings.progressBar, autoHeight, scrollToTop); the rest
 * are style tokens.
 */
function StepsAndProgress( { doc, token }: { doc: FormDocument; token: SetToken } ) {
	const change = useChange();
	const settings = doc.settings;
	const bar = settings.progressBar;
	const progress = ! bar.show ? 'none' : bar.percent ? 'percent' : 'bar';
	const animation = doc.style.tokens.animation ?? 'none';
	return (
		<div className="ffxb-design-group ffxb-flow">
			<div className="ffxb-design-group__head">
				<h3 className="ffxb-design-group__title">{ __( 'Steps and progress', 'funnelforms-pro' ) }</h3>
			</div>
			<ChoiceTiles
				label={ __( 'Progress', 'funnelforms-pro' ) }
				value={ progress }
				options={ [
					{
						value: 'none',
						label: __( 'None', 'funnelforms-pro' ),
						icon: (
							<Sketch>
								<rect x="6" y="9" width="36" height="14" rx="3" strokeDasharray="3 3" />
							</Sketch>
						),
					},
					{
						value: 'bar',
						label: __( 'Progress bar', 'funnelforms-pro' ),
						icon: (
							<Sketch>
								<rect x="6" y="13" width="36" height="6" rx="3" />
								<rect x="6" y="13" width="20" height="6" rx="3" fill="currentColor" />
							</Sketch>
						),
					},
					{
						value: 'percent',
						label: __( 'With percentage', 'funnelforms-pro' ),
						icon: (
							<Sketch>
								<rect x="4" y="13" width="26" height="6" rx="3" />
								<rect x="4" y="13" width="15" height="6" rx="3" fill="currentColor" />
								<text x="34" y="20" fontSize="10" fontWeight="600" fill="currentColor" stroke="none">
									%
								</text>
							</Sketch>
						),
					},
				] }
				onChange={ ( v ) =>
					change( ( d ) => {
						d.settings.progressBar.show = 'none' !== v;
						if ( 'percent' === v ) {
							d.settings.progressBar.percent = true;
						} else {
							delete d.settings.progressBar.percent;
						}
					}, 'settings:progress' )
				}
			/>
			<ChoiceTiles
				label={ __( 'Transition between steps', 'funnelforms-pro' ) }
				value={ animation }
				columns={ 4 }
				options={ stepAnimations().map( ( a ) => ( {
					value: a.value,
					label: a.label,
					icon: (
						<span className="ffxb-motion" data-motion={ a.value }>
							<span className="ffxb-motion__card" />
						</span>
					),
				} ) ) }
				onChange={ ( v ) => token( 'animation', 'none' === v ? null : v ) }
			/>
			<p className="ffxb-hint">{ __( 'Visitors who turned off animations on their device see no transition.', 'funnelforms-pro' ) }</p>
			<ChoiceTiles
				label={ __( 'Alignment of questions', 'funnelforms-pro' ) }
				value={ doc.style.tokens[ 'align.text' ] ?? 'center' }
				options={ [
					{ value: 'left', label: __( 'Left', 'funnelforms-pro' ), icon: <Sketch><path d="M8 9h32M8 16h20M8 23h26" /></Sketch> },
					{ value: 'center', label: __( 'Centre', 'funnelforms-pro' ), icon: <Sketch><path d="M8 9h32M14 16h20M11 23h26" /></Sketch> },
					{ value: 'right', label: __( 'Right', 'funnelforms-pro' ), icon: <Sketch><path d="M8 9h32M20 16h20M14 23h26" /></Sketch> },
				] }
				onChange={ ( v ) => token( 'align.text', 'center' === v ? null : v ) }
			/>
			<ChoiceTiles
				label={ __( 'Buttons', 'funnelforms-pro' ) }
				value={ doc.style.tokens[ 'button.align' ] ?? 'apart' }
				columns={ 2 }
				options={ [
					{ value: 'apart', label: __( 'Back left, next right', 'funnelforms-pro' ), icon: <Sketch><rect x="4" y="11" width="12" height="10" rx="3" /><rect x="30" y="11" width="14" height="10" rx="3" fill="currentColor" /></Sketch> },
					{ value: 'center', label: __( 'Centred', 'funnelforms-pro' ), icon: <Sketch><rect x="9" y="11" width="12" height="10" rx="3" /><rect x="25" y="11" width="14" height="10" rx="3" fill="currentColor" /></Sketch> },
					{ value: 'end', label: __( 'Both right', 'funnelforms-pro' ), icon: <Sketch><rect x="14" y="11" width="12" height="10" rx="3" /><rect x="30" y="11" width="14" height="10" rx="3" fill="currentColor" /></Sketch> },
					{ value: 'full', label: __( 'Full width', 'funnelforms-pro' ), icon: <Sketch><rect x="4" y="6" width="40" height="9" rx="3" fill="currentColor" /><rect x="4" y="18" width="40" height="9" rx="3" /></Sketch> },
				] }
				onChange={ ( v ) => token( 'button.align', 'apart' === v ? null : v ) }
			/>
			<Toggle label={ __( 'Adjust height to each step', 'funnelforms-pro' ) } checked={ settings.autoHeight } onChange={ ( v ) => change( ( d ) => void ( d.settings.autoHeight = v ) ) } />
			<Toggle
				label={ __( 'Scroll to the form on each step (mobile)', 'funnelforms-pro' ) }
				checked={ settings.scrollToTop.mobile }
				onChange={ ( v ) => change( ( d ) => void ( d.settings.scrollToTop.mobile = v ) ) }
			/>
		</div>
	);
}

function CustomCss( { doc }: { doc: FormDocument } ) {
	const change = useChange();
	const uid = useBuilder( ( s ) => s.form?.uid ) ?? '';
	return (
		<details className="ffxb-advanced">
			<summary>{ __( 'Custom CSS', 'funnelforms-pro' ) }</summary>
			<FieldRow label={ __( 'Custom CSS', 'funnelforms-pro' ) } hint={ sprintf( __( 'Applies to the whole page; start selectors with %s to style only this form. Publishing it needs the right to use unfiltered HTML.', 'funnelforms-pro' ), `[data-ffx-form="${ uid }"]` ) }>
				{ ( id ) => (
					<textarea
						id={ id }
						className="ffxb-input ffxb-input--code"
						rows={ 6 }
						spellCheck={ false }
						value={ doc.style.css ?? '' }
						onChange={ ( e ) => {
							const css = e.target.value;
							change( ( d ) => {
								if ( '' === css.trim() ) {
									delete d.style.css;
								} else {
									d.style.css = css;
								}
							}, 'style:css' );
						} }
					/>
				) }
			</FieldRow>
		</details>
	);
}

/** Styles saved on the site: apply one, save the form's style, delete one. */
function SavedStyles( { doc }: { doc: FormDocument } ) {
	const { api, readOnly } = useEnv();
	const change = useChange();
	const [ styles, setStyles ] = useState<SavedStyle[] | null>( null );
	const [ naming, setNaming ] = useState( false );
	const [ name, setName ] = useState( '' );
	const [ error, setError ] = useState<string | null>( null );

	useEffect( () => {
		let live = true;
		api.styles().then(
			( list ) => live && setStyles( list ),
			() => live && setStyles( [] )
		);
		return () => {
			live = false;
		};
	}, [ api ] );

	const run = async ( work: () => Promise<void> ): Promise<void> => {
		setError( null );
		try {
			await work();
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
	};
	const save = (): Promise<void> =>
		run( async () => {
			const style = await api.saveStyle( name.trim(), doc.style.tokens );
			setStyles( ( list ) => [ style, ...( list ?? [] ) ] );
			setNaming( false );
			setName( '' );
		} );
	const remove = ( style: SavedStyle ): Promise<void> =>
		run( async () => {
			await api.deleteStyle( style.id );
			setStyles( ( list ) => ( list ?? [] ).filter( ( s ) => s.id !== style.id ) );
		} );

	return (
		<div className="ffxb-saved-styles">
			{ styles?.length ? (
				<>
					<p className="ffxb-field__label">{ __( 'Your styles', 'funnelforms-pro' ) }</p>
					<ul className="ffxb-saved-styles__list">
						{ styles.map( ( style ) => (
							<li key={ style.id } className="ffxb-saved-style">
								<button type="button" className="ffxb-saved-style__apply" disabled={ readOnly } title={ __( 'Apply', 'funnelforms-pro' ) } onClick={ () => change( ( d ) => applySavedStyle( d, style.tokens ) ) }>
									<span className="ffxb-saved-style__swatch" aria-hidden="true" style={ { background: style.tokens[ 'color.primary' ] ?? '#6a30f5' } } />
									{ style.name }
								</button>
								<IconButton label={ sprintf( __( 'Delete style %s', 'funnelforms-pro' ), style.name ) } icon={ icons.close } onClick={ () => void remove( style ) } />
							</li>
						) ) }
					</ul>
				</>
			) : null }
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ naming ? (
				<form
					className="ffxb-saved-styles__form"
					onSubmit={ ( e ) => {
						e.preventDefault();
						if ( name.trim() ) {
							void save();
						}
					} }
				>
					<TextInput label={ __( 'Name of the style', 'funnelforms-pro' ) } value={ name } onChange={ setName } hint={ __( 'Colours, font and sizes of this form, for your other forms. Custom CSS stays with the form.', 'funnelforms-pro' ) } />
					<div className="ffxb-saved-styles__actions">
						<Button size="sm" variant="ghost" onClick={ () => setNaming( false ) }>
							{ __( 'Cancel', 'funnelforms-pro' ) }
						</Button>
						<Button size="sm" variant="primary" type="submit" disabled={ ! name.trim() }>
							{ __( 'Save style', 'funnelforms-pro' ) }
						</Button>
					</div>
				</form>
			) : (
				<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly } onClick={ () => setNaming( true ) }>
					{ __( 'Save as style', 'funnelforms-pro' ) }
				</Button>
			) }
		</div>
	);
}
