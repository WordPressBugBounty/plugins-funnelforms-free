/**
 * The embed workspace, a page like the settings: the ways to show the form (in a page, on its own
 * page, as a popup, as a button in a corner, on another website) in the list at the side, and a card
 * with the settings and the code of the chosen one, a copy button, the steps to use it and a sketch
 * of where the form appears.
 */
import React, { useEffect, useState } from 'react';
import { DEFAULT_FRAME, DEFAULT_POPUP, DEFAULT_WIDGET, type EmbedConfig, type FrameSettings, type PopupSettings, type WidgetSettings } from '../embed';
import { useBuilder, useEnv } from './context';
import { CodeBox, Steps, type EmbedMethod } from './EmbedParts';
import { EmbedProPanel } from './EmbedPro';
import { __, sprintf } from './i18n';
import { addressOf, cleanSlug, PageAddressHint } from './Settings';
import { Button, Notice, ProBadge, ProList, TextInput } from './ui';

type InlineTarget = 'shortcode' | 'block' | 'elementor';

const METHOD_ICONS: Record<EmbedMethod, React.ReactNode> = {
	inline: <Line d="m8 7-5 5 5 5M16 7l5 5-5 5" />,
	link: <Line d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
	external: <Line d="M3 12h18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z" />,
	popup: <Line d="M4 5h16v11H9l-5 4zM9 9.5h6" />,
	widget: <Line d="M14 4h6v6M20 4l-8 8M18 14v5H5V6h5" />,
};

function Line( { d }: { d: string } ) {
	return (
		<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d={ d } />
		</svg>
	);
}

/** The ways to embed, in the order of the list; pro marks those Funnelforms Free names only. */
function methods(): Array<{ id: EmbedMethod; title: string; text: string; pro: boolean }> {
	return [
		{ id: 'inline', title: __( 'Inline embedding', 'funnelforms-pro' ), text: __( 'Show the form inside a page or post of this website.', 'funnelforms-pro' ), pro: false },
		{ id: 'link', title: __( 'Direct link', 'funnelforms-pro' ), text: __( 'Share a link to the form on a page of its own.', 'funnelforms-pro' ), pro: false },
		{ id: 'popup', title: __( 'Popup', 'funnelforms-pro' ), text: __( 'Show the form in a popup when it is triggered.', 'funnelforms-pro' ), pro: true },
		{ id: 'widget', title: __( 'Widget', 'funnelforms-pro' ), text: __( 'Add a floating button that opens the form on a click.', 'funnelforms-pro' ), pro: true },
		{ id: 'external', title: __( 'Other website', 'funnelforms-pro' ), text: __( 'Embed the form on a website outside WordPress.', 'funnelforms-pro' ), pro: true },
	];
}

export function EmbedWorkspace( { config }: { config?: EmbedConfig | null } ) {
	const form = useBuilder( ( s ) => s.form );
	const [ method, setMethod ] = useState<EmbedMethod>( 'inline' );
	const [ popup, setPopup ] = useState<PopupSettings>( DEFAULT_POPUP );
	const [ widget, setWidget ] = useState<WidgetSettings>( DEFAULT_WIDGET );
	const [ frame, setFrame ] = useState<FrameSettings>( DEFAULT_FRAME );
	if ( ! form ) {
		return null;
	}
	const free = 'free' === process.env.FUNNELFORMS_EDITION;
	const list = methods();
	const chosen = list.find( ( m ) => m.id === method ) ?? { title: '', text: '', pro: false };
	let body: React.ReactNode;
	if ( 'inline' === method ) {
		body = <InlinePanel />;
	} else if ( 'link' === method ) {
		body = <LinkPanel />;
	} else {
		body =
			'free' === process.env.FUNNELFORMS_EDITION ? (
				<ProList items={ proItems( method ) } />
			) : (
				<EmbedProPanel method={ method } config={ config ?? null } popup={ popup } onPopup={ setPopup } widget={ widget } onWidget={ setWidget } frame={ frame } onFrame={ setFrame } />
			);
	}
	// The same page as the settings: the ways as the list at the side, the chosen one as a card.
	return (
		<div className="ffxb-workspace ffxb-workspace--sheet ffxb-workspace--embed">
			<nav className="ffxb-sheet__nav" aria-label={ __( 'Ways to embed', 'funnelforms-pro' ) }>
				{ list.map( ( m ) => (
					<button key={ m.id } type="button" className={ 'ffxb-sheet__link' + ( m.id === method ? ' is-active' : '' ) } aria-pressed={ m.id === method } data-method={ m.id } onClick={ () => setMethod( m.id ) }>
						{ METHOD_ICONS[ m.id ] }
						<span className="ffxb-sheet__link-text">{ m.title }</span>
						{ free && m.pro ? <ProBadge /> : null }
					</button>
				) ) }
			</nav>
			<div className="ffxb-sheet">
				<div className="ffxb-sheet__card">
					<section className="ffxb-section ffxb-embed" aria-labelledby="ffxb-embed-title">
						<header className="ffxb-section__head">
							<h2 id="ffxb-embed-title" className="ffxb-section__title">
								{ chosen.title }
							</h2>
							{ free && chosen.pro ? <ProBadge /> : null }
						</header>
						<p className="ffxb-hint ffxb-embed__lead">{ chosen.text }</p>
						{ null === form.currentRevision ? <Notice tone="info">{ __( 'The form is not published yet. The code shows it once you publish it.', 'funnelforms-pro' ) }</Notice> : null }
						<div className="ffxb-embed__layout">
							<div className="ffxb-embed__main">{ body }</div>
							<figure className="ffxb-embed__preview">
								<h3 className="ffxb-embed__label">{ __( 'Preview', 'funnelforms-pro' ) }</h3>
								<EmbedSketch method={ method } widget={ widget } frame={ frame } url={ form.publicUrl ?? '' } />
								<figcaption className="ffxb-hint">{ sketchText( method, frame ) }</figcaption>
							</figure>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}

/** What Funnelforms Free names for the Pro ways. */
function proItems( method: EmbedMethod ): string[] {
	switch ( method ) {
		case 'popup':
			return [ __( 'Popup after a delay', 'funnelforms-pro' ), __( 'Popup on a click', 'funnelforms-pro' ), __( 'Popup after scrolling', 'funnelforms-pro' ), __( 'Popup when the visitor is about to leave', 'funnelforms-pro' ) ];
		case 'widget':
			return [ __( 'Button in a corner of the page', 'funnelforms-pro' ), __( 'Text, colour and animation of the button', 'funnelforms-pro' ) ];
		default:
			return [ __( 'Embed code for websites outside WordPress', 'funnelforms-pro' ), __( 'Width, height and automatic height', 'funnelforms-pro' ) ];
	}
}

function sketchText( method: EmbedMethod, frame: FrameSettings ): string {
	switch ( method ) {
		case 'inline':
			return __( 'The form takes the width of the content area and grows with each step.', 'funnelforms-pro' );
		case 'link':
			return __( 'The form alone on a page, without the menu and footer of your theme.', 'funnelforms-pro' );
		case 'popup':
			return __( 'The form opens above the page; visitors close it with the cross or the Escape key.', 'funnelforms-pro' );
		case 'widget':
			return __( 'The button stays in its corner while visitors scroll; a click opens the form.', 'funnelforms-pro' );
		default:
			return frame.autoHeight ? __( 'The frame grows and shrinks with each step of the form.', 'funnelforms-pro' ) : __( 'The frame keeps its height; longer steps scroll inside it.', 'funnelforms-pro' );
	}
}

/* ------------------------------------------------------------------ inline */

function InlinePanel() {
	const form = useBuilder( ( s ) => s.form );
	const [ target, setTarget ] = useState<InlineTarget>( 'shortcode' );
	if ( ! form ) {
		return null;
	}
	const targets: Array<[ InlineTarget, string ]> = [
		[ 'shortcode', __( 'Shortcode', 'funnelforms-pro' ) ],
		[ 'block', __( 'Block editor', 'funnelforms-pro' ) ],
		[ 'elementor', 'Elementor' ],
	];
	const steps: Record<InlineTarget, React.ReactNode[]> = {
		shortcode: [
			__( 'Copy the shortcode.', 'funnelforms-pro' ),
			__( 'Open the page or post in WordPress where the form should appear.', 'funnelforms-pro' ),
			__( 'Paste the shortcode there, in the block editor into a Shortcode block.', 'funnelforms-pro' ),
			__( 'Save the page. The form appears in its place.', 'funnelforms-pro' ),
		],
		block: [
			__( 'Open the page or post in the block editor.', 'funnelforms-pro' ),
			__( 'Add the block "Funnelforms" where the form should appear.', 'funnelforms-pro' ),
			sprintf( __( 'Choose "%s" in the settings of the block.', 'funnelforms-pro' ), form.title ),
			'free' === process.env.FUNNELFORMS_EDITION ? __( 'Save the page. The form appears in its place.', 'funnelforms-pro' ) : __( 'Save the page. Under Display the block also shows the form as a popup or a button.', 'funnelforms-pro' ),
		],
		elementor: [
			__( 'Open the page with Elementor.', 'funnelforms-pro' ),
			__( 'Drag the widget "Funnelforms" to where the form should appear.', 'funnelforms-pro' ),
			sprintf( __( 'Choose "%s" in the settings of the widget.', 'funnelforms-pro' ), form.title ),
			'free' === process.env.FUNNELFORMS_EDITION ? __( 'Save the page. The form appears in its place.', 'funnelforms-pro' ) : __( 'Publish the page. Under Display the widget also shows the form as a popup or a button.', 'funnelforms-pro' ),
		],
	};
	return (
		<>
			<div className="ffxb-embed__settings">
				<div className="ffxb-segmented" role="group" aria-label={ __( 'Where do you build your pages?', 'funnelforms-pro' ) }>
					{ targets.map( ( [ id, label ] ) => (
						<button key={ id } type="button" className="ffxb-segmented__item" aria-pressed={ target === id } onClick={ () => setTarget( id ) }>
							<span>{ label }</span>
						</button>
					) ) }
				</div>
				<p className="ffxb-hint">{ __( 'The shortcode works in every editor, also in widgets and theme builders.', 'funnelforms-pro' ) }</p>
			</div>
			<CodeBox label={ __( 'Shortcode', 'funnelforms-pro' ) } code={ form.shortcode } />
			<Steps steps={ steps[ target ] } />
		</>
	);
}

/* ------------------------------------------------------------------ direct link */

function LinkPanel() {
	const { api, store, readOnly } = useEnv();
	const form = useBuilder( ( s ) => s.form );
	const saved = form?.publicSlug ?? '';
	const [ slug, setSlug ] = useState( saved );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	useEffect( () => setSlug( saved ), [ saved ] );
	if ( ! form ) {
		return null;
	}
	const cleaned = cleanSlug( slug );
	const save = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const detail = await api.update( form.id, { publicSlug: cleaned } );
			const latest = store.getState().form;
			if ( latest ) {
				store.setState( { form: { ...latest, publicSlug: detail.publicSlug ?? '', publicUrl: detail.publicUrl ?? null, publicFallback: detail.publicFallback ?? null } } );
			}
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	return (
		<>
			<div className="ffxb-embed__settings">
				{ error ? <Notice tone="danger">{ error }</Notice> : null }
				{ 'legacy' === form.renderer ? <Notice tone="warning">{ __( 'This form still runs on Funnelforms 3. Its own page appears once it uses the new renderer.', 'funnelforms-pro' ) }</Notice> : null }
				<div className="ffxb-inline ffxb-own-page">
					<TextInput label={ __( 'Address', 'funnelforms-pro' ) } value={ slug } placeholder="angebot" onChange={ setSlug } hint={ cleaned ? addressOf( form, cleaned ) : __( 'Letters, digits and dashes.', 'funnelforms-pro' ) } />
					<Button size="sm" variant="primary" disabled={ readOnly || busy || '' === cleaned || cleaned === saved } onClick={ () => void save() }>
						{ __( 'Save', 'funnelforms-pro' ) }
					</Button>
				</div>
			</div>
			{ form.publicUrl ? (
				<>
					<CodeBox label={ __( 'Link', 'funnelforms-pro' ) } code={ form.publicUrl } />
					<p>
						<a className="ffxb-link" href={ form.publicUrl } target="_blank" rel="noopener noreferrer">
							{ __( 'Open the page', 'funnelforms-pro' ) }
						</a>
					</p>
					<PageAddressHint form={ form } />
				</>
			) : (
				<p className="ffxb-hint">{ __( 'Choose an address for the page first; the link appears here.', 'funnelforms-pro' ) }</p>
			) }
			<Steps
				steps={ [
					// An address that exists already (also one taken over from Funnelforms 3) needs no saving.
					...( saved ? [] : [ __( 'Choose an address and save it.', 'funnelforms-pro' ) ] ),
					__( 'Copy the link.', 'funnelforms-pro' ),
					__( 'Use it in ads, e-mails, social media posts or a QR code.', 'funnelforms-pro' ),
				] }
			/>
		</>
	);
}

/* ------------------------------------------------------------------ sketch */

/** A small browser window that shows where the form appears. */
export function EmbedSketch( { method, widget, frame, url }: { method: EmbedMethod; widget: WidgetSettings; frame: FrameSettings; url: string } ) {
	const corner = 'widget' === method ? widget.position : 'bottom-right';
	const page = 'link' !== method;
	return (
		<div className={ `ffxb-sketch ffxb-sketch--${ method }` } aria-hidden="true">
			<div className="ffxb-sketch__bar">
				<span className="ffxb-sketch__dots">
					<i />
					<i />
					<i />
				</span>
				<span className="ffxb-sketch__address">{ 'link' === method && url ? url.replace( /^https?:\/\//, '' ) : '' }</span>
			</div>
			<div className="ffxb-sketch__page">
				{ page ? <span className="ffxb-sketch__line ffxb-sketch__line--head" /> : null }
				{ page ? <span className="ffxb-sketch__line" /> : null }
				{ page ? <span className="ffxb-sketch__line ffxb-sketch__line--short" /> : null }
				{ 'inline' === method || 'external' === method || 'link' === method ? (
					<div className={ 'ffxb-sketch__slot' + ( 'link' === method ? ' ffxb-sketch__slot--page' : '' ) }>
						<SketchForm />
						{ 'external' === method ? <span className="ffxb-sketch__size">{ `${ frame.width || DEFAULT_FRAME.width } × ${ frame.autoHeight ? __( 'auto', 'funnelforms-pro' ) : frame.height || DEFAULT_FRAME.height }` }</span> : null }
						{ 'inline' === method ? <span className="ffxb-sketch__size">{ __( 'Full width', 'funnelforms-pro' ) }</span> : null }
					</div>
				) : null }
				{ page ? <span className="ffxb-sketch__line" /> : null }
				{ page ? <span className="ffxb-sketch__line ffxb-sketch__line--short" /> : null }
				{ 'popup' === method ? (
					<div className="ffxb-sketch__overlay">
						<div className="ffxb-sketch__modal">
							<span className="ffxb-sketch__close">×</span>
							<SketchForm />
						</div>
					</div>
				) : null }
				{ 'widget' === method ? (
					<span className={ `ffxb-sketch__button ffxb-sketch__button--${ corner }` } style={ /^#[0-9a-f]{6}$/i.test( widget.color ) ? { background: widget.color } : undefined }>
						{ widget.text.trim() || __( 'Get in touch', 'funnelforms-pro' ) }
					</span>
				) : null }
			</div>
		</div>
	);
}

function SketchForm() {
	return (
		<div className="ffxb-sketch__form">
			<span className="ffxb-sketch__question" />
			<span className="ffxb-sketch__answers">
				<i className="is-chosen" />
				<i />
				<i />
			</span>
			<span className="ffxb-sketch__progress">
				<i />
			</span>
		</div>
	);
}
