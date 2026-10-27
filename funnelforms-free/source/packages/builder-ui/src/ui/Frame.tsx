/**
 * The frame every Funnelforms admin page shares (plugin/src/Admin/Ui.php, assets/admin/admin.css):
 * a top bar with the brand, the page's name and its actions, then the page with its title and
 * one-line lead. The lists of forms and entries render it with the same markup and classes, so
 * they look like the pages the plugin prints; the parts below (key figures, badges, icons) do
 * the same.
 */
import React from 'react';
import type { ReactNode } from 'react';
import { __ } from './i18n';

/** Address of the overview, relative to wp-admin (every admin page sits there). */
const OVERVIEW = 'admin.php?page=funnelforms';

export function Frame( { title, lead, actions, children }: { title: string; lead?: string; actions?: ReactNode; children: ReactNode } ) {
	return (
		<div className="ffx-frame">
			<header className="ffx-top">
				<a className="ffx-top__brand" href={ OVERVIEW }>
					<span className="ffx-top__mark">
						<svg viewBox="0 0 303.1 262.42" aria-hidden="true" focusable="false">
							<polygon fill="currentColor" points="303.1 0 0 0 32.93 56.99 55.38 95.86 88.41 153.16 151.55 262.42 184.68 205.12 154.67 153.16 214.69 153.16 247.72 95.86 121.54 95.86 99.19 56.99 270.17 56.99 303.1 0" />
						</svg>
					</span>
					<span>Funnelforms</span>
				</a>
				<span className="ffx-top__sep" aria-hidden="true" />
				<span className="ffx-top__title">{ title }</span>
				{ actions ? <div className="ffx-top__actions">{ actions }</div> : null }
			</header>
			<main className="ffx-page">
				<div className="ffx-page__head">
					<div>
						<h1 className="ffx-page__title">{ title }</h1>
						{ lead ? <p className="ffx-page__lead">{ lead }</p> : null }
					</div>
				</div>
				{ children }
			</main>
		</div>
	);
}

/** Line icons (Lucide, ISC licence), the set of the plugin's pages and a few more. */
const PATHS = {
	search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
	filter: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
	close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	table: '<path d="M3 9h18"/><path d="M9 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
	board: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
	mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
	phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
	inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
	unread: '<path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
	calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
	trend: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
	trophy: '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>',
	user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
	clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
	down: '<path d="m6 9 6 6 6-6"/>',
	left: '<path d="m15 18-6-6 6-6"/>',
	right: '<path d="m9 18 6-6-6-6"/>',
	archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
	shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
	trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
	tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
	upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	stats: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
	chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
	copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
	edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
	form: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10"/><path d="M7 12h10"/><path d="M7 17h6"/>',
	file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
	eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
	activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
	external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
	undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
	sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon( { name, size }: { name: IconName; size?: number } ) {
	return (
		<svg
			className="ffx-icon"
			viewBox="0 0 24 24"
			width={ size }
			height={ size }
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			// Static paths of this file, nothing from outside.
			dangerouslySetInnerHTML={ { __html: PATHS[ name ] } }
		/>
	);
}

/** A key figure as on the overview and the statistics: icon and label, value, a line below. */
export function Kpi( props: { icon: IconName; label: string; value: string | null; hint?: ReactNode; tone?: 'up' | 'down' | ''; pressed?: boolean; onClick?: () => void; title?: string } ) {
	const body = (
		<>
			<span className="ffx-kpi__label">
				<span className="ffx-kpi__icon">
					<Icon name={ props.icon } />
				</span>
				{ props.label }
			</span>
			{ null === props.value ? <span className="ffx-kpi__value is-loading" aria-label={ __( 'Loading…', 'funnelforms-pro' ) } /> : <span className="ffx-kpi__value">{ props.value }</span> }
			<span className={ 'ffx-kpi__hint' + ( props.tone ? ' is-' + props.tone : '' ) }>{ props.hint ?? ' ' }</span>
		</>
	);
	return props.onClick ? (
		<button type="button" className="ffx-card ffx-kpi ffx-kpi--action" aria-pressed={ !! props.pressed } onClick={ props.onClick } title={ props.title }>
			{ body }
		</button>
	) : (
		<div className="ffx-card ffx-kpi">{ body }</div>
	);
}

export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** A status as the plugin's pages show it (Ui::badge()). */
export function Pill( { tone = 'neutral', children }: { tone?: PillTone; children: ReactNode } ) {
	return <span className={ 'ffx-badge' + ( 'neutral' === tone ? '' : ' ffx-badge--' + tone ) }>{ children }</span>;
}

/** A link or button in the look of the plugin's pages (Ui::button()). */
export function FrameButton( { icon, variant = 'secondary', size, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' } ) {
	const className = 'ffx-btn' + ( 'secondary' === variant ? '' : ' ffx-btn--' + variant ) + ( size ? ' ffx-btn--' + size : '' ) + ( rest.className ? ' ' + rest.className : '' );
	return (
		<button type="button" { ...rest } className={ className }>
			{ icon ? <Icon name={ icon } /> : null }
			{ children ? <span>{ children }</span> : null }
		</button>
	);
}

/** An empty state as on the overview: the brand mark with an icon, a heading, a line, an action. */
export function EmptyState( { icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode } ) {
	return (
		<div className="ffx-empty">
			<span className="ffx-empty__mark">
				<Icon name={ icon } />
			</span>
			<h2 className="ffx-empty__title">{ title }</h2>
			{ children ? <p className="ffx-empty__text">{ children }</p> : null }
			{ action ? <div className="ffx-empty__action">{ action }</div> : null }
		</div>
	);
}

/** Entries per day as small bars (the forms table of the statistics page draws the same). */
export function Spark( { series, label }: { series: number[]; label: string } ) {
	const max = Math.max( 1, ...series );
	const width = 4;
	const gap = 2;
	return (
		<svg className="ffx-spark" viewBox={ `0 0 ${ series.length * ( width + gap ) } 24` } preserveAspectRatio="none" role="img" aria-label={ label }>
			{ series.map( ( n, i ) => {
				const h = n > 0 ? Math.max( 2, Math.round( ( 22 * n ) / max ) ) : 2;
				return <rect key={ i } x={ i * ( width + gap ) } y={ 24 - h } width={ width } height={ h } rx="1" className={ n > 0 ? undefined : 'is-zero' } />;
			} ) }
		</svg>
	);
}
