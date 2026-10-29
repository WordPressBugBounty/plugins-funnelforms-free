/**
 * Icons of answers and contact fields: the Lucide set (ISC license) the plugin ships, loaded when
 * the choice opens, with a search over names and tags, icons that fit the answer and groups to
 * browse (iconGroups.ts). The document stores only the name.
 */
import React, { createElement, useEffect, useMemo, useState } from 'react';
import type { FormsApi, IconElements, IconLibrary } from '../api';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { iconGroups } from './iconGroups';
import { GERMAN_ICON_WORDS } from './iconWords';
import { Button, Dialog } from './ui';

/** Icons shown at once; a search narrows them down, "Show more icons" adds as many again. */
const SHOWN = 120;
/** Icons suggested for the text of an answer. */
const SUGGESTED = 24;
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

/**
 * Icons that fit a text such as the label of an answer ("Satteldach", "Ich wohne zur Miete"):
 * the best for each of its words, the longest words first; a German compound also by its last
 * part ("Satteldach" by "dach").
 */
export function suggestIcons( library: IconLibrary, text: string ): string[] {
	const words = [ ...new Set( text.toLowerCase().match( /[\p{L}\p{N}]{4,}/gu ) ?? [] ) ].sort( ( a, b ) => b.length - a.length );
	const out = new Set<string>();
	const add = ( word: string ): void => {
		for ( const name of searchIcons( library, word ).slice( 0, 8 ) ) {
			out.add( name );
		}
	};
	for ( const word of words.slice( 0, 6 ) ) {
		add( word );
		const part = Object.keys( GERMAN_ICON_WORDS )
			.filter( ( german ) => german.length >= 4 && german !== word && word.endsWith( german ) )
			.sort( ( a, b ) => b.length - a.length )[ 0 ];
		if ( part ) {
			add( part );
		}
	}
	return [ ...out ].slice( 0, SUGGESTED );
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

function IconGrid( { library, value, hint, onPick }: { library: IconLibrary; value: string | null; hint: string; onPick: ( name: string ) => void } ) {
	const groups = useMemo( () => iconGroups().map( ( g ) => ( { ...g, icons: g.icons.filter( ( name ) => name in library.icons ) } ) ), [ library ] );
	const suggested = useMemo( () => suggestIcons( library, hint ), [ library, hint ] );
	const [ query, setQuery ] = useState( '' );
	const [ group, setGroup ] = useState( () => ( suggested.length ? 'suggested' : groups[ 0 ]?.id ?? 'all' ) );
	const [ limit, setLimit ] = useState( SHOWN );
	const searching = '' !== query.trim();
	const found = useMemo( () => searchIcons( library, query ), [ library, query ] );
	const list = searching || 'all' === group ? found : 'suggested' === group ? suggested : groups.find( ( g ) => g.id === group )?.icons ?? [];
	const listed = searching || 'all' === group;
	const shown = list.slice( 0, limit );
	const choose = ( id: string ): void => {
		setGroup( id );
		setLimit( SHOWN );
	};
	const chip = ( id: string, title: string ) => (
		<button key={ id } type="button" className={ `ffxb-icon-picker__group${ id === group ? ' is-selected' : '' }` } aria-pressed={ id === group } onClick={ () => choose( id ) }>
			{ title }
		</button>
	);
	return (
		<div className="ffxb-icon-picker">
			<input
				className="ffxb-input"
				type="search"
				aria-label={ __( 'Search icons', 'funnelforms-pro' ) }
				placeholder={ __( 'Search, e.g. house, car, heart', 'funnelforms-pro' ) }
				value={ query }
				onChange={ ( e ) => {
					setQuery( e.target.value );
					setLimit( SHOWN );
				} }
				autoFocus
			/>
			{ searching ? null : (
				<div className="ffxb-icon-picker__groups" role="group" aria-label={ __( 'Groups of icons', 'funnelforms-pro' ) }>
					{ suggested.length ? chip( 'suggested', __( 'Fits the answer', 'funnelforms-pro' ) ) : null }
					{ groups.map( ( g ) => chip( g.id, g.title ) ) }
					{ chip( 'all', __( 'All icons', 'funnelforms-pro' ) ) }
				</div>
			) }
			{ listed ? (
				<p className="ffxb-hint" aria-live="polite">
					{ 0 === found.length
						? __( 'No icon fits the search.', 'funnelforms-pro' )
						: found.length > shown.length
						? sprintf( __( 'Showing %1$d of %2$d icons. Search to find more.', 'funnelforms-pro' ), shown.length, found.length )
						: sprintf( __( 'Icons found: %d', 'funnelforms-pro' ), found.length ) }
				</p>
			) : null }
			<ul className="ffxb-icon-picker__grid">
				{ shown.map( ( name ) => (
					<li key={ name }>
						<button type="button" className={ `ffxb-icon-picker__icon${ value === name ? ' is-selected' : '' }` } aria-label={ name } aria-pressed={ value === name } title={ name } onClick={ () => onPick( name ) }>
							<LucideIcon elements={ library.icons[ name ] ?? [] } size={ 24 } />
						</button>
					</li>
				) ) }
			</ul>
			{ list.length > shown.length ? (
				<Button onClick={ () => setLimit( ( n ) => n + SHOWN ) }>{ __( 'Show more icons', 'funnelforms-pro' ) }</Button>
			) : null }
			<p className="ffxb-hint">{ sprintf( __( 'Icons: Lucide %s (ISC license)', 'funnelforms-pro' ), library.version ) }</p>
		</div>
	);
}

/**
 * A button showing the chosen icon that opens the choice. `label` names the button for screen
 * readers, `title` the dialog; `hint` is the text the icon goes with (the answer), for suggestions.
 */
export function IconChoice( { value, label, title, hint = '', onChange, disabled }: { value: string | null; label: string; title: string; hint?: string; onChange: ( name: string | null ) => void; disabled?: boolean } ) {
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
						hint={ hint }
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
