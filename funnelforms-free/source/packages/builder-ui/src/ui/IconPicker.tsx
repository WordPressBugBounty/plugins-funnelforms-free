/**
 * Icons of answers and contact fields: the Lucide set (ISC license) the plugin ships, loaded when
 * the choice opens, with a search over names and tags. The document stores only the name.
 */
import React, { createElement, useEffect, useMemo, useState } from 'react';
import type { FormsApi, IconElements, IconLibrary } from '../api';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { GERMAN_ICON_WORDS } from './iconWords';
import { Button, Dialog } from './ui';

/** Icons shown at once; a search narrows them down. */
const SHOWN = 120;
const ELEMENTS = new Set( [ 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse' ] );
const ATTRIBUTES = new Set( [ 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points', 'fill' ] );

/** Libraries already loaded, so a choice shows its icon at once. */
const loaded = new WeakMap<FormsApi, IconLibrary>();

export function LucideIcon( { elements, size = 20 }: { elements: IconElements; size?: number } ) {
	return (
		<svg className="ffxb-lucide" viewBox="0 0 24 24" width={ size } height={ size } fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			{ elements.map( ( [ tag, attrs ], i ) =>
				ELEMENTS.has( tag ) ? createElement( tag, { key: i, ...Object.fromEntries( Object.entries( attrs ).filter( ( [ name ] ) => ATTRIBUTES.has( name ) ) ) } ) : null
			) }
		</svg>
	);
}

/** A search word with the English words a German one stands for; a start of three letters or more counts too. */
function alternatives( word: string ): string[] {
	const out = [ word ];
	const exact = GERMAN_ICON_WORDS[ word ];
	if ( exact ) {
		out.push( exact.replace( /-/g, ' ' ) );
	}
	if ( word.length >= 3 ) {
		for ( const [ german, english ] of Object.entries( GERMAN_ICON_WORDS ) ) {
			if ( german !== word && german.startsWith( word ) && out.length < 6 ) {
				out.push( english.replace( /-/g, ' ' ) );
			}
		}
	}
	return [ ...new Set( out ) ];
}

/**
 * Names of the icons that fit the search, best first: the name itself, then names starting or
 * containing it, then tags. German words search for their English ones as well.
 */
export function searchIcons( library: IconLibrary, query: string ): string[] {
	const names = Object.keys( library.icons );
	const needle = query.trim().toLowerCase();
	if ( ! needle ) {
		return names;
	}
	const words = needle.split( /\s+/ ).map( alternatives );
	// Whole names to look for: the search, or for one word also what it stands for.
	const wholes = 1 === words.length ? ( words[ 0 ] ?? [] ) : [ needle ];
	const rank = ( name: string ): number => {
		const spaced = name.replace( /-/g, ' ' );
		if ( wholes.some( ( w ) => name === w || spaced === w ) ) {
			return 0;
		}
		if ( wholes.some( ( w ) => name.startsWith( w ) || spaced.startsWith( w ) ) ) {
			return 1;
		}
		if ( words.every( ( alts ) => alts.some( ( w ) => spaced.includes( w ) ) ) ) {
			return 2;
		}
		const all = `${ spaced } ${ library.tags[ name ] ?? '' }`;
		return words.every( ( alts ) => alts.some( ( w ) => all.includes( w ) ) ) ? 3 : -1;
	};
	return names
		.map( ( name ) => [ name, rank( name ) ] as const )
		.filter( ( [ , r ] ) => r >= 0 )
		.sort( ( a, b ) => a[ 1 ] - b[ 1 ] || a[ 0 ].localeCompare( b[ 0 ] ) )
		.map( ( [ name ] ) => name );
}

function useLibrary( load: boolean ): { library: IconLibrary | null; failed: boolean } {
	const { api } = useEnv();
	const [ library, setLibrary ] = useState<IconLibrary | null>( () => loaded.get( api ) ?? null );
	const [ failed, setFailed ] = useState( false );
	useEffect( () => {
		if ( ! load || library || ! api.icons ) {
			return;
		}
		let live = true;
		setFailed( false );
		api.icons().then(
			( result ) => {
				loaded.set( api, result );
				if ( live ) {
					setLibrary( result );
				}
			},
			() => {
				if ( live ) {
					setFailed( true );
				}
			}
		);
		return () => {
			live = false;
		};
	}, [ load, library, api ] );
	return { library, failed };
}

function IconGrid( { library, value, onPick }: { library: IconLibrary; value: string | null; onPick: ( name: string ) => void } ) {
	const [ query, setQuery ] = useState( '' );
	const found = useMemo( () => searchIcons( library, query ), [ library, query ] );
	const shown = found.slice( 0, SHOWN );
	return (
		<div className="ffxb-icon-picker">
			<input
				className="ffxb-input"
				type="search"
				aria-label={ __( 'Search icons', 'funnelforms-pro' ) }
				placeholder={ __( 'Search, e.g. house, car, heart', 'funnelforms-pro' ) }
				value={ query }
				onChange={ ( e ) => setQuery( e.target.value ) }
				autoFocus
			/>
			<p className="ffxb-hint" aria-live="polite">
				{ 0 === found.length
					? __( 'No icon fits the search.', 'funnelforms-pro' )
					: found.length > SHOWN
					? sprintf( __( 'Showing %1$d of %2$d icons. Search to find more.', 'funnelforms-pro' ), SHOWN, found.length )
					: sprintf( __( 'Icons found: %d', 'funnelforms-pro' ), found.length ) }
			</p>
			<ul className="ffxb-icon-picker__grid">
				{ shown.map( ( name ) => (
					<li key={ name }>
						<button type="button" className={ `ffxb-icon-picker__icon${ value === name ? ' is-selected' : '' }` } aria-label={ name } aria-pressed={ value === name } title={ name } onClick={ () => onPick( name ) }>
							<LucideIcon elements={ library.icons[ name ] ?? [] } size={ 24 } />
						</button>
					</li>
				) ) }
			</ul>
			<p className="ffxb-hint">{ sprintf( __( 'Icons: Lucide %s (ISC license)', 'funnelforms-pro' ), library.version ) }</p>
		</div>
	);
}

/**
 * A button showing the chosen icon that opens the choice. `label` names the button for screen
 * readers, `title` the dialog.
 */
export function IconChoice( { value, label, title, onChange, disabled }: { value: string | null; label: string; title: string; onChange: ( name: string | null ) => void; disabled?: boolean } ) {
	const [ open, setOpen ] = useState( false );
	const { library, failed } = useLibrary( open || null !== value );
	const current = value && library ? library.icons[ value ] : undefined;
	return (
		<>
			<button type="button" className={ `ffxb-icon-choice${ value ? ' has-icon' : '' }` } aria-label={ label } title={ value ?? label } disabled={ disabled } onClick={ () => setOpen( true ) }>
				{ current ? <LucideIcon elements={ current } size={ 18 } /> : <ChooseIcon /> }
			</button>
			<Dialog
				title={ title }
				open={ open }
				onClose={ () => setOpen( false ) }
				wide
				actions={
					<>
						{ value ? (
							<Button
								onClick={ () => {
									onChange( null );
									setOpen( false );
								} }
							>
								{ __( 'Remove icon', 'funnelforms-pro' ) }
							</Button>
						) : null }
						<Button onClick={ () => setOpen( false ) }>{ __( 'Close', 'funnelforms-pro' ) }</Button>
					</>
				}
			>
				{ ! open ? null : library ? (
					<IconGrid
						library={ library }
						value={ value }
						onPick={ ( name ) => {
							onChange( name );
							setOpen( false );
						} }
					/>
				) : failed ? (
					<p className="ffxb-hint">{ __( 'The icons could not be loaded.', 'funnelforms-pro' ) }</p>
				) : (
					<p className="ffxb-hint">{ __( 'Loading icons…', 'funnelforms-pro' ) }</p>
				) }
			</Dialog>
		</>
	);
}

function ChooseIcon() {
	return (
		<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
		</svg>
	);
}

/** "Icon in the field" of contact fields with an input: props.icon is "lucide:<name>". */
export function InputIcon( { value, onChange, disabled }: { value: unknown; onChange: ( icon: string | undefined ) => void; disabled?: boolean } ) {
	const name = 'string' === typeof value && value.startsWith( 'lucide:' ) ? value.slice( 7 ) : null;
	return (
		<div className="ffxb-field">
			<span className="ffxb-field__label">{ __( 'Icon in the field', 'funnelforms-pro' ) }</span>
			<div className="ffxb-icon-field">
				<IconChoice
					value={ name }
					label={ name ? __( 'Change the icon in the field', 'funnelforms-pro' ) : __( 'Choose an icon for the field', 'funnelforms-pro' ) }
					title={ __( 'Icon in the field', 'funnelforms-pro' ) }
					disabled={ disabled }
					onChange={ ( picked ) => onChange( picked ? `lucide:${ picked }` : undefined ) }
				/>
				<span className="ffxb-hint">{ name ?? __( 'None', 'funnelforms-pro' ) }</span>
			</div>
		</div>
	);
}
