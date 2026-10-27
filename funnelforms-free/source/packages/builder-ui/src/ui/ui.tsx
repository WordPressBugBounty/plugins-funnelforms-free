/**
 * Small building blocks of the builder screens: one look for buttons, inputs, notices, empty
 * and loading states. Colours, spacing and radii come from the tokens in builder.css.
 */
import React, { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { proUrl } from '../edition';
import { __ } from './i18n';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
	size?: 'sm' | 'md';
	icon?: ReactNode;
};

export function Button( { variant = 'secondary', size = 'md', icon, className = '', children, ...rest }: ButtonProps ) {
	return (
		<button type="button" className={ `ffxb-button ffxb-button--${ variant } ffxb-button--${ size } ${ className }` } { ...rest }>
			{ icon }
			{ children }
		</button>
	);
}

export function Field( { label, hint, children }: { label: string; hint?: string; children: ( id: string ) => ReactNode } ) {
	const id = useId();
	return (
		<div className="ffxb-field">
			<label className="ffxb-field__label" htmlFor={ id }>
				{ label }
			</label>
			{ children( id ) }
			{ hint ? <p className="ffxb-field__hint">{ hint }</p> : null }
		</div>
	);
}

export function TextInput( { label, value, onChange, hint, multiline = false, placeholder, type = 'text' }: { label: string; value: string; onChange: ( value: string ) => void; hint?: string; multiline?: boolean; placeholder?: string; type?: string } ) {
	return (
		<Field label={ label } hint={ hint }>
			{ ( id ) =>
				multiline ? (
					<textarea id={ id } className="ffxb-input" value={ value } placeholder={ placeholder } rows={ 4 } onChange={ ( e ) => onChange( e.target.value ) } />
				) : (
					<input id={ id } className="ffxb-input" type={ type } value={ value } placeholder={ placeholder } onChange={ ( e ) => onChange( e.target.value ) } />
				)
			}
		</Field>
	);
}

export function NumberInput( { label, value, onChange, min, max, step, hint, disabled }: { label: string; value: number | undefined; onChange: ( value: number | undefined ) => void; min?: number; max?: number; step?: number; hint?: string; disabled?: boolean } ) {
	return (
		<Field label={ label } hint={ hint }>
			{ ( id ) => (
				<input
					id={ id }
					className="ffxb-input"
					type="number"
					value={ undefined === value ? '' : value }
					min={ min }
					max={ max }
					step={ step }
					disabled={ disabled }
					onChange={ ( e ) => onChange( '' === e.target.value ? undefined : Number( e.target.value ) ) }
				/>
			) }
		</Field>
	);
}

export function Select<T extends string>( { label, value, options, onChange, hint, disabled }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: ( value: T ) => void; hint?: string; disabled?: boolean } ) {
	return (
		<Field label={ label } hint={ hint }>
			{ ( id ) => (
				<select id={ id } className="ffxb-input" value={ value } disabled={ disabled } onChange={ ( e ) => onChange( e.target.value as T ) }>
					{ options.map( ( o ) => (
						<option key={ o.value } value={ o.value }>
							{ o.label }
						</option>
					) ) }
				</select>
			) }
		</Field>
	);
}

/** A colour: picker for plain colours, text for anything CSS accepts (rgba, inherit, transparent). */
export function ColorInput( { label, value, onChange, hex }: { label: string; value: string; onChange: ( value: string ) => void; hex: string | null } ) {
	return (
		<Field label={ label }>
			{ ( id ) => (
				<div className="ffxb-color">
					<input className="ffxb-color__swatch" type="color" aria-label={ label } value={ hex ?? '#000000' } onChange={ ( e ) => onChange( e.target.value ) } />
					<input id={ id } className="ffxb-input" type="text" value={ value } spellCheck={ false } onChange={ ( e ) => onChange( e.target.value ) } />
				</div>
			) }
		</Field>
	);
}

export function Range( { label, value, onChange, min, max, unit, step }: { label: string; value: number; onChange: ( value: number ) => void; min: number; max: number; unit?: string; step?: number } ) {
	return (
		<Field label={ label }>
			{ ( id ) => (
				<div className="ffxb-range">
					<input id={ id } type="range" min={ min } max={ max } step={ step } value={ value } onChange={ ( e ) => onChange( Number( e.target.value ) ) } />
					<output htmlFor={ id }>{ `${ value }${ unit ?? '' }` }</output>
				</div>
			) }
		</Field>
	);
}

export function Toggle( { label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: ( checked: boolean ) => void; hint?: string; disabled?: boolean } ) {
	const id = useId();
	return (
		<div className="ffxb-toggle">
			<input id={ id } type="checkbox" role="switch" checked={ checked } disabled={ disabled } onChange={ ( e ) => onChange( e.target.checked ) } />
			<label htmlFor={ id }>{ label }</label>
			{ hint ? <p className="ffxb-field__hint">{ hint }</p> : null }
		</div>
	);
}

/**
 * A choice of a few options as tiles, each with a small picture of what it does: radio buttons
 * underneath, so the keyboard and screen readers work as with any group of options.
 */
export function ChoiceTiles<T extends string>( { label, value, options, onChange, columns = 3, disabled }: { label: string; value: T; options: Array<{ value: T; label: string; icon: ReactNode }>; onChange: ( value: T ) => void; columns?: number; disabled?: boolean } ) {
	const name = useId();
	return (
		<fieldset className="ffxb-tiles" disabled={ disabled }>
			<legend className="ffxb-field__label">{ label }</legend>
			<div className="ffxb-tiles__grid" style={ { gridTemplateColumns: `repeat(${ columns }, minmax(0, 1fr))` } }>
				{ options.map( ( o ) => (
					<label key={ o.value } className={ 'ffxb-tiles__item' + ( value === o.value ? ' is-active' : '' ) }>
						<input type="radio" name={ name } value={ o.value } checked={ value === o.value } onChange={ () => onChange( o.value ) } />
						<span className="ffxb-tiles__icon" aria-hidden="true">
							{ o.icon }
						</span>
						<span className="ffxb-tiles__label">{ o.label }</span>
					</label>
				) ) }
			</div>
		</fieldset>
	);
}

/** A small drawing for a tile (ChoiceTiles): 48 by 32, in the colours of the builder. */
export function Sketch( { children }: { children: ReactNode } ) {
	return (
		<svg viewBox="0 0 48 32" width="48" height="32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
			{ children }
		</svg>
	);
}

/** A titled part of a section of the properties panel, such as the answers or their look. */
export function Group( { title, children }: { title: string; children: ReactNode } ) {
	return (
		<div className="ffxb-propgroup">
			<h3 className="ffxb-propgroup__title">{ title }</h3>
			{ children }
		</div>
	);
}

export function Badge( { tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand'; children: ReactNode } ) {
	return <span className={ `ffxb-badge ffxb-badge--${ tone }` }>{ children }</span>;
}

export function Notice( { tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children?: ReactNode; action?: ReactNode } ) {
	return (
		<div className={ `ffxb-notice ffxb-notice--${ tone }` } role={ 'danger' === tone ? 'alert' : 'status' }>
			<div className="ffxb-notice__body">
				{ title ? <strong className="ffxb-notice__title">{ title }</strong> : null }
				{ children }
			</div>
			{ action ? <div className="ffxb-notice__action">{ action }</div> : null }
		</div>
	);
}

export function Spinner( { label }: { label: string } ) {
	return (
		<div className="ffxb-loading" role="status">
			<span className="ffxb-spinner" aria-hidden="true" />
			<span>{ label }</span>
		</div>
	);
}

export function Empty( { title, children, action }: { title: string; children?: ReactNode; action?: ReactNode } ) {
	return (
		<div className="ffxb-empty">
			<div className="ffxb-empty__mark" aria-hidden="true" />
			<h2 className="ffxb-empty__title">{ title }</h2>
			{ children ? <p className="ffxb-empty__text">{ children }</p> : null }
			{ action }
		</div>
	);
}

/** A modal dialog on the native dialog element (focus trap and Escape come with it). */
export function Dialog( { title, open, onClose, children, actions, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean } ) {
	const ref = useRef<HTMLDialogElement>( null );
	useEffect( () => {
		const dialog = ref.current;
		if ( ! dialog ) {
			return;
		}
		if ( open && ! dialog.open ) {
			dialog.showModal?.();
		} else if ( ! open && dialog.open ) {
			dialog.close();
		}
	}, [ open ] );
	return (
		<dialog ref={ ref } className={ 'ffxb-dialog' + ( wide ? ' ffxb-dialog--wide' : '' ) } onClose={ onClose } aria-label={ title }>
			<h2 className="ffxb-dialog__title">{ title }</h2>
			<div className="ffxb-dialog__body">{ children }</div>
			{ actions ? <div className="ffxb-dialog__actions">{ actions }</div> : null }
		</dialog>
	);
}

/** Line icons (24px grid, currentColor). */
export const icons = {
	plus: <Svg d="M12 5v14M5 12h14" />,
	undo: <Svg d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
	redo: <Svg d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
	back: <Svg d="M15 18l-6-6 6-6" />,
	copy: <Svg d="M9 9h10v10H9zM5 15V5h10" />,
	trash: <Svg d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />,
	history: <Svg d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3" />,
	upload: <Svg d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
	download: <Svg d="M12 4v12M7 11l5 5 5-5M5 20h14" />,
	start: <Svg d="M6 4l14 8-14 8z" />,
	check: <Svg d="M5 12l5 5 9-10" />,
	close: <Svg d="M6 6l12 12M18 6 6 18" />,
	desktop: <Svg d="M3 5h18v11H3zM8 20h8M12 16v4" />,
	tablet: <Svg d="M6 3h12v18H6zM11 18h2" />,
	mobile: <Svg d="M8 3h8v18H8zM11 18h2" />,
	eye: <Svg d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
	reload: <Svg d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
	chart: <Svg d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
	image: <Svg d="M4 4h16v16H4zM4 16l5-5 4 4 2-2 5 5M15 9.5a1.5 1.5 0 1 0 0-.01" />,
	globe: <Svg d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" />,
	lock: <Svg d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" />,
	sparkles: <Svg d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0zM20 3v4M22 5h-4M4 17v2M5 18H3" />,
};

function Svg( { d }: { d: string } ) {
	return (
		<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d={ d } />
		</svg>
	);
}

/** A titled part of the properties panel. */
export function Section( { title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode } ) {
	return (
		<section className="ffxb-section">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ title }</h2>
				{ actions ? <div className="ffxb-section__actions">{ actions }</div> : null }
			</header>
			{ children }
		</section>
	);
}

/** A small button with only an icon; the label is its accessible name and tooltip. */
export function IconButton( { label, icon, onClick, disabled, danger }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean } ) {
	return <Button size="sm" variant={ danger ? 'danger' : 'ghost' } icon={ icon } aria-label={ label } title={ label } onClick={ onClick } disabled={ disabled } />;
}

/* ------------------------------------------------------------------ Funnelforms Free */

/** The badge of Pro features in Funnelforms Free. Only the Free build uses these. */
export function ProBadge() {
	return <Badge tone="brand">{ __( 'Pro', 'funnelforms-pro' ) }</Badge>;
}

/** Link to the page about Funnelforms Pro. */
export function ProLink() {
	const url = proUrl();
	return url ? (
		<a className="ffxb-pro__link" href={ url }>
			{ __( 'More about Funnelforms Pro', 'funnelforms-pro' ) }
		</a>
	) : null;
}

/** The Pro parts of a workspace, by name. */
export function ProCard( { title, items }: { title: string; items: string[] } ) {
	return (
		<section className="ffxb-section ffxb-pro">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ title }</h2>
				<ProBadge />
			</header>
			<ProList items={ items } />
		</section>
	);
}

/** The Pro parts by name, each with the Pro badge, and the link to Funnelforms Pro, for a card that has its own title. */
export function ProList( { items }: { items: string[] } ) {
	return (
		<>
			<p className="ffxb-hint">{ __( 'These come with Funnelforms Pro:', 'funnelforms-pro' ) }</p>
			<ul className="ffxb-pro__list">
				{ items.map( ( item ) => (
					<li key={ item }>
						<ProBadge />
						<span>{ item }</span>
					</li>
				) ) }
			</ul>
			<ProLink />
		</>
	);
}

/** A Pro feature in Funnelforms Free: what it is and what it brings. */
export interface ProFeature {
	id: string;
	title: string;
	text: string;
	icon: React.ReactNode;
}

/** The Pro features of a workspace as cards with an icon and what each brings, for Funnelforms Free. */
export function ProFeatures( { title, lead, features }: { title: string; lead: string; features: ProFeature[] } ) {
	return (
		<section className="ffxb-section ffxb-pro">
			<header className="ffxb-section__head">
				<h2 className="ffxb-section__title">{ title }</h2>
				<ProBadge />
			</header>
			<p className="ffxb-hint">{ lead }</p>
			<ul className="ffxb-pro__features">
				{ features.map( ( f ) => (
					<li key={ f.id } className="ffxb-pro__feature" data-feature={ f.id }>
						<span className="ffxb-pro__feature-icon" aria-hidden="true">
							{ f.icon }
						</span>
						<span className="ffxb-pro__feature-body">
							<strong className="ffxb-pro__feature-title">{ f.title }</strong>
							<span className="ffxb-pro__feature-text">{ f.text }</span>
						</span>
						<ProBadge />
					</li>
				) ) }
			</ul>
			<ProLink />
		</section>
	);
}
