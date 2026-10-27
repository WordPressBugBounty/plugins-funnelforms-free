/**
 * The themes of the Design section as a gallery: a drawing of a form in each theme, filtered by
 * light, dark, colourful and industry themes. Resting the pointer on a theme (or focusing it)
 * shows it in the live preview at once (previewStyle.ts); a click applies it. The form's theme is
 * marked and scrolled into view; the list fades out at the bottom while more themes follow.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import { applyTheme, THEMES, themeStyle, withTheme, type Theme } from '../themes';
import { useEnv } from './context';
import { __ } from './i18n';
import { showStyle } from './previewStyle';
import { ThemeSample } from './ThemeSample';

export function themeName( id: string ): string {
	const names: Record<string, string> = {
		funnelforms: 'Funnelforms',
		website: __( 'Like the website', 'funnelforms-pro' ),
		corporate: __( 'Corporate', 'funnelforms-pro' ),
		dark: __( 'Dark', 'funnelforms-pro' ),
		lavender: __( 'Lavender', 'funnelforms-pro' ),
		green: __( 'Green', 'funnelforms-pro' ),
		orange: __( 'Orange', 'funnelforms-pro' ),
		elegant: __( 'Elegant', 'funnelforms-pro' ),
		pink: __( 'Pink', 'funnelforms-pro' ),
		tech: __( 'Tech', 'funnelforms-pro' ),
		red: __( 'Red', 'funnelforms-pro' ),
		pastel: __( 'Pastel', 'funnelforms-pro' ),
		minimal: __( 'Minimal', 'funnelforms-pro' ),
		midnight: __( 'Midnight', 'funnelforms-pro' ),
		aurora: __( 'Aurora', 'funnelforms-pro' ),
		brutal: __( 'Bold', 'funnelforms-pro' ),
		editorial: __( 'Editorial', 'funnelforms-pro' ),
		playful: __( 'Playful', 'funnelforms-pro' ),
		nature: __( 'Nature', 'funnelforms-pro' ),
		gold: __( 'Luxury', 'funnelforms-pro' ),
		clinic: __( 'Medical', 'funnelforms-pro' ),
		neon: __( 'Neon', 'funnelforms-pro' ),
		estate: __( 'Real estate', 'funnelforms-pro' ),
		craft: __( 'Craft', 'funnelforms-pro' ),
		trust: __( 'Finance', 'funnelforms-pro' ),
		beauty: __( 'Beauty', 'funnelforms-pro' ),
		fitness: __( 'Fitness', 'funnelforms-pro' ),
		bistro: __( 'Restaurant', 'funnelforms-pro' ),
		solar: __( 'Energy', 'funnelforms-pro' ),
	};
	return names[ id ] ?? id;
}

type Filter = 'all' | 'light' | 'dark' | 'colourful' | 'industry';

function shows( t: Theme, filter: Filter ): boolean {
	return 'all' === filter || ( 'industry' === filter ? !! t.industry : t.group === filter );
}

export function ThemeGallery( { doc }: { doc: FormDocument } ) {
	const { store, readOnly } = useEnv();
	const [ filter, setFilter ] = useState<Filter>( 'all' );
	const grid = useRef<HTMLUListElement>( null );
	const [ more, setMore ] = useState( false );
	// The live preview goes back to the form's style when the gallery goes away.
	useEffect( () => () => showStyle( null ), [] );
	// The form's theme is in view when the gallery opens or the filter changes, also where it is far down
	// the list; the list scrolls, not the panel.
	useLayoutEffect( () => {
		const list = grid.current;
		const card = list?.querySelector<HTMLElement>( '.ffxb-theme-card[aria-pressed="true"]' );
		if ( list ) {
			const top = card ? card.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop : 0;
			list.scrollTop = card ? Math.max( 0, top - ( list.clientHeight - card.offsetHeight ) / 2 ) : 0;
			setMore( list.scrollTop + list.clientHeight < list.scrollHeight - 4 );
		}
	}, [ filter ] );
	const filters: Array<[ Filter, string ]> = [
		[ 'all', __( 'All', 'funnelforms-pro' ) ],
		[ 'light', __( 'Light', 'funnelforms-pro' ) ],
		[ 'dark', __( 'Dark', 'funnelforms-pro' ) ],
		[ 'colourful', __( 'Colourful', 'funnelforms-pro' ) ],
		[ 'industry', __( 'Industries', 'funnelforms-pro' ) ],
	];
	const preview = ( t: Theme | null ): void => showStyle( t && ! readOnly ? withTheme( doc.style.tokens, t ) : null );
	return (
		<div className="ffxb-theme-gallery">
			<div className="ffxb-theme-gallery__filter" role="group" aria-label={ __( 'Show themes', 'funnelforms-pro' ) }>
				{ filters.map( ( [ id, label ] ) => (
					<button key={ id } type="button" className="ffxb-theme-gallery__chip" aria-pressed={ filter === id } onClick={ () => setFilter( id ) }>
						{ label }
					</button>
				) ) }
			</div>
			<ul
				ref={ grid }
				className={ 'ffxb-theme-gallery__grid' + ( more ? ' has-more' : '' ) }
				aria-label={ __( 'Theme', 'funnelforms-pro' ) }
				onMouseLeave={ () => preview( null ) }
				onScroll={ ( e ) => setMore( e.currentTarget.scrollTop + e.currentTarget.clientHeight < e.currentTarget.scrollHeight - 4 ) }
			>
				{ THEMES.filter( ( t ) => shows( t, filter ) ).map( ( t ) => {
					const current = doc.style.theme === t.id;
					return (
						<li key={ t.id }>
							<button
								type="button"
								className="ffxb-theme-card"
								aria-pressed={ current }
								disabled={ readOnly }
								onMouseEnter={ () => preview( t ) }
								onFocus={ () => preview( t ) }
								onBlur={ () => preview( null ) }
								onClick={ () => store.getState().change( ( d ) => applyTheme( d, t.id ) ) }
							>
								<ThemeSample tokens={ themeStyle( t ) } />
								<span className="ffxb-theme-card__name">
									{ themeName( t.id ) }
									{ current ? <span className="ffxb-theme-card__current">{ __( 'In use', 'funnelforms-pro' ) }</span> : null }
								</span>
							</button>
						</li>
					);
				} ) }
			</ul>
		</div>
	);
}
