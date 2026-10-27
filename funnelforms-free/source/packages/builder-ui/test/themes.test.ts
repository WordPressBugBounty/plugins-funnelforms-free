import { describe, expect, it } from 'vitest';
import { applyBranding, applyTheme, changedFromTheme, contrast, contrastProblems, parseColor, readableOn, setStyleToken, splitAlpha, THEME_LOOK_TOKENS, THEME_TOKENS, themeStyle, THEMES, toHex, withAlpha } from '../src/themes';
import { blank } from './blank';

describe( 'themes', () => {
	it( 'are readable: text, hints and buttons reach WCAG AA', () => {
		expect( THEMES.length ).toBeGreaterThanOrEqual( 24 );
		expect( new Set( THEMES.map( ( t ) => t.id ) ).size ).toBe( THEMES.length );
		for ( const t of THEMES ) {
			expect( Object.keys( t.tokens ).sort(), t.id ).toEqual( [ ...THEME_TOKENS ].sort() );
			for ( const key of Object.keys( t.look ?? {} ) ) {
				expect( THEME_LOOK_TOKENS as readonly string[], `${ t.id }: ${ key }` ).toContain( key );
			}
			const s = themeStyle( t );
			expect( contrastProblems( s ), t.id ).toEqual( [] );
			// Both ends of a gradient, and the answers, carry the text.
			for ( const bg of [ s[ 'color.background' ], s[ 'color.backgroundEnd' ], s[ 'color.option' ], s[ 'color.optionSelected' ] ] ) {
				for ( const fg of [ s[ 'color.text' ], s[ 'color.heading' ], bg === s[ 'color.option' ] || bg === s[ 'color.optionSelected' ] ? undefined : s[ 'color.muted' ] ] ) {
					const ratio = bg && fg ? contrast( fg, bg ) : null;
					expect( null === ratio || ratio >= 4.5, `${ t.id }: ${ fg } on ${ bg }` ).toBe( true );
				}
				// Selected answers and focus rings are drawn in the accent colour.
				const accent = bg ? contrast( s[ 'color.primary' ] ?? '', bg ) : null;
				expect( null === accent || accent >= 3, `${ t.id }: accent on ${ bg }` ).toBe( true );
			}
			// The tick of a chosen answer.
			const tick = contrast( s[ 'color.onPrimary' ] ?? '', s[ 'color.primary' ] ?? '' );
			expect( null === tick || tick >= 4.5, t.id ).toBe( true );
		}
		// Every group of the gallery has themes.
		for ( const group of [ 'light', 'dark', 'colourful' ] ) {
			expect( THEMES.filter( ( t ) => t.group === group ).length, group ).toBeGreaterThanOrEqual( 4 );
		}
		expect( THEMES.filter( ( t ) => t.industry ).length ).toBeGreaterThanOrEqual( 8 );
	} );

	it( 'draw the progress bar in a colour of the look, not in an accent that buttons and tiles do not use', () => {
		for ( const t of THEMES ) {
			const s = themeStyle( t );
			const primary = s[ 'color.primary' ];
			// The runtime draws the bar in color.progress, else in the accent (runtime.css).
			const progress = s[ 'color.progress' ] ?? primary;
			const button = s[ 'color.button' ] ?? primary;
			const icon = s[ 'color.icon' ] ?? primary;
			expect( progress === primary && button !== primary && icon !== primary, `${ t.id }: progress ${ progress }, button ${ button }, icons ${ icon }` ).toBe( false );
		}
	} );

	it( 'replace colours, font and corners and keep their name', () => {
		const doc = blank();
		doc.style.tokens = { 'color.primary': 'rgba(157,65,221,1)', 'custom.token': 'x' };
		applyTheme( doc, 'dark' );
		expect( doc.style.theme ).toBe( 'dark' );
		expect( doc.style.tokens[ 'color.background' ] ).toBe( '#1a1a1a' );
		expect( doc.style.tokens[ 'custom.token' ] ).toBe( 'x' );
		expect( changedFromTheme( doc ) ).toBe( false );

		setStyleToken( doc, 'color.primary', '#fde047' );
		expect( doc.style.tokens[ 'color.onPrimary' ] ).toBe( '#1a1a1a' );
		expect( changedFromTheme( doc ) ).toBe( true );
		setStyleToken( doc, 'color.border', '' );
		expect( 'color.border' in doc.style.tokens ).toBe( false );

		applyTheme( doc, 'nope' );
		expect( doc.style.theme ).toBe( 'dark' );
	} );

	it( 'set their whole look and leave sizes, alignment and the image alone', () => {
		const doc = blank();
		doc.style.tokens = { shadow: 'custom', 'radius.button': '3', 'font.size': '18', 'align.text': 'left', 'background.image': '12' };
		applyTheme( doc, 'brutal' );
		expect( doc.style.tokens ).toMatchObject( { 'tile.shadow': 'hard', 'heading.case': 'upper', 'radius.button': '0', 'font.size': '18', 'align.text': 'left', 'background.image': '12' } );
		expect( 'shadow' in doc.style.tokens ).toBe( false );
		expect( changedFromTheme( doc ) ).toBe( false );
		applyTheme( doc, 'funnelforms' );
		expect( 'tile.shadow' in doc.style.tokens || 'radius.button' in doc.style.tokens ).toBe( false );
		setStyleToken( doc, 'shadow', 'soft' );
		expect( changedFromTheme( doc ) ).toBe( true );
	} );

	it( 'warn about text that is hard to read', () => {
		expect( contrastProblems( { 'color.text': '#999999' } ).map( ( p ) => p.pair ) ).toEqual( [ 'text' ] );
		expect( contrastProblems( { 'color.background': 'transparent', 'color.text': 'inherit' } ) ).toEqual( [] );
		expect( readableOn( '#6a30f5' ) ).toBe( '#ffffff' );
	} );

	it( 'read colours as 3.x stored them', () => {
		expect( parseColor( 'rgba(157,65,221,1)' ) ).toEqual( [ 157, 65, 221 ] );
		expect( parseColor( 'rgba(157,65,221,0.5)' ) ).toBeNull();
		expect( toHex( '#ABC' ) ).toBe( '#aabbcc' );
		expect( toHex( 'inherit' ) ).toBeNull();
	} );

	it( 'take colours and font from a website, keeping what was not picked', () => {
		const doc = blank();
		applyTheme( doc, 'lavender' );
		applyBranding( doc, { primary: '#fde047', text: null, background: '#111111', font: 'Open Sans' } );
		expect( doc.style.tokens ).toMatchObject( { 'color.primary': '#fde047', 'color.onPrimary': '#1a1a1a', 'color.text': '#2d2d2d', 'color.background': '#111111', 'font.family': 'Open Sans' } );
	} );

	it( 'mix colours with opacity and read it back', () => {
		expect( withAlpha( '#336699', 40 ) ).toBe( 'rgba(51,102,153,0.4)' );
		expect( withAlpha( 'inherit', 40 ) ).toBeNull();
		expect( splitAlpha( 'rgba(51,102,153,0.4)' ) ).toEqual( { hex: '#336699', percent: 40 } );
		expect( splitAlpha( '#33669980' ) ).toEqual( { hex: '#336699', percent: 50 } );
		expect( splitAlpha( '#369' ) ).toEqual( { hex: '#336699', percent: 100 } );
		expect( splitAlpha( 'transparent' ) ).toBeNull();
	} );

	it( 'check questions, the button colour and the back button for contrast', () => {
		expect( contrastProblems( { 'color.heading': '#bbbbbb' } ).map( ( p ) => p.pair ) ).toEqual( [ 'heading' ] );
		expect( contrastProblems( { 'color.button': '#fde68a', 'color.onButton': '#ffffff' } ).map( ( p ) => p.pair ) ).toEqual( [ 'button' ] );
		expect( contrastProblems( { 'color.back': '#eeeeee', 'color.onBack': '#ffffff' } ).map( ( p ) => p.pair ) ).toEqual( [ 'back' ] );
		const doc = blank();
		setStyleToken( doc, 'color.back', '#111111' );
		expect( doc.style.tokens[ 'color.onBack' ] ).toBe( '#ffffff' );
	} );
} );
