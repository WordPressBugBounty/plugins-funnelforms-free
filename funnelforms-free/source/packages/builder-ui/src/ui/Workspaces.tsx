/**
 * The workspaces of the editor beside the canvas: the design with a live preview, the settings
 * of the whole form, what happens after sending, and the figures of the form.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import { ApiError, type FormsApi } from '../api';
import type { Device } from '../store';
import { styleClasses, styleCss } from '../styleCss';
import { ActionsSection } from './Actions';
import { CalculationsSection } from './Calculations';
import { problemTexts } from './catalog';
import { useBuilder, useEnv } from './context';
import { DesignInspector } from './Design';
import { ExperimentsSection } from './Experiments';
import { __ } from './i18n';
import { FormSettings } from './Inspector';
import { LanguagesSection } from './Languages';
import { DesignModeBar, DesignPartPanel, useLiveDesign } from './LiveDesign';
import { DEVICE_WIDTH, Stage } from './Preview';
import { useShownStyle } from './previewStyle';
import { QuizSection } from './Quiz';
import { AbandonSection, AccessSection, DoubleOptInSection, OwnPageSection, PaymentSection, SpamSection } from './Settings';
import { Button, icons, Notice, ProBadge, ProFeatures, Spinner, type ProFeature } from './ui';

/* ------------------------------------------------------------------ design */

export function DesignWorkspace( { api, formId }: { api: FormsApi; formId: number } ) {
	const doc = useBuilder( ( s ) => s.doc );
	if ( ! doc ) {
		return null;
	}
	return (
		<div className="ffxb-workspace ffxb-workspace--design">
			<aside className="ffxb-design-panel" aria-label={ __( 'Design', 'funnelforms-pro' ) }>
				<DesignInspector doc={ doc } />
			</aside>
			<LivePreview api={ api } formId={ formId } />
		</div>
	);
}

type Live = { state: 'loading' } | { state: 'ready'; html: string } | { state: 'failed'; message: string; problems: string[] };

/**
 * The saved draft as visitors see it. Changes of the design show at once (style message); fonts,
 * the background image, custom CSS and the progress settings after a moment, when the page is
 * loaded again. In the design
 * mode a click in the preview picks a part of the form and shows its tokens (LiveDesign.tsx).
 */
function LivePreview( { api, formId }: { api: FormsApi; formId: number } ) {
	const { store, ctx, lang } = useEnv();
	const device = useBuilder( ( s ) => s.device );
	const style = useBuilder( ( s ) => s.doc?.style );
	// The progress bar and the height of the steps are built by the runtime, not by the style.
	const progress = useBuilder( ( s ) => JSON.stringify( [ s.doc?.settings.progressBar, s.doc?.settings.autoHeight ] ) );
	const locale = lang !== ctx.locale ? lang : undefined;
	// The look shows at once: a theme the pointer rests on, otherwise the form's own tokens before
	// they are saved; the page follows after a moment with fonts and the background image.
	const shown = useShownStyle();
	const message = useMemo( () => {
		const tokens = shown ?? style?.tokens ?? {};
		return { type: 'ffx-preview-style', css: styleCss( tokens ), classes: styleClasses( tokens ) };
	}, [ shown, style ] );
	// The page is loaded again only for what the message cannot show: fonts of the site, the
	// background image, the form's own CSS (styleCss.ts) and the progress settings.
	const reload = useMemo( () => {
		const t = style?.tokens ?? {};
		return JSON.stringify( [ t[ 'font.family' ], t[ 'font.heading' ], t[ 'font.field' ], t[ 'background.image' ], style?.css, progress ] );
	}, [ style, progress ] );
	const [ live, setLive ] = useState<Live>( { state: 'loading' } );
	const [ busy, setBusy ] = useState( true );
	const [ run, setRun ] = useState( 0 );
	const first = useRef( true );
	const frame = useRef<HTMLIFrameElement | null>( null );
	const chooser = useRef<HTMLSelectElement | null>( null );
	const doc = useBuilder( ( s ) => s.doc );
	// The preview opens to try the form; a click on Edit design makes its parts pickable.
	const [ designing, setDesigning ] = useState( false );
	const design = useLiveDesign( frame, designing && 'ready' === live.state );
	const closePart = (): void => {
		design.choose( null );
		chooser.current?.focus();
	};

	useEffect( () => {
		let cancelled = false;
		// The first load right away; changes wait until the user pauses.
		const timer = window.setTimeout(
			async () => {
				setBusy( true );
				try {
					await store.getState().saveNow();
					const { html } = locale ? await api.preview( formId, locale ) : await api.preview( formId );
					if ( ! cancelled ) {
						setLive( { state: 'ready', html } );
					}
				} catch ( e ) {
					if ( ! cancelled ) {
						const problems = e instanceof ApiError && Array.isArray( e.data.problems ) ? ( e.data.problems as string[] ) : [];
						setLive( { state: 'failed', message: e instanceof Error ? e.message : String( e ), problems } );
					}
				} finally {
					if ( ! cancelled ) {
						setBusy( false );
					}
				}
			},
			first.current ? 0 : 800
		);
		first.current = false;
		return () => {
			cancelled = true;
			window.clearTimeout( timer );
		};
	}, [ api, formId, store, locale, reload, run ] );

	const devices: Array<[ Device, string ]> = [
		[ 'desktop', __( 'Desktop', 'funnelforms-pro' ) ],
		[ 'tablet', __( 'Tablet', 'funnelforms-pro' ) ],
		[ 'mobile', __( 'Mobile', 'funnelforms-pro' ) ],
	];

	return (
		<section className="ffxb-live" aria-label={ __( 'Live preview', 'funnelforms-pro' ) }>
			<div className="ffxb-live__bar">
				<strong className="ffxb-live__title">
					<span className={ 'ffxb-live__dot' + ( busy ? ' is-busy' : '' ) } aria-hidden="true" />
					{ busy ? __( 'Updating…', 'funnelforms-pro' ) : __( 'Live preview', 'funnelforms-pro' ) }
				</strong>
				<div className="ffxb-segmented" role="group" aria-label={ __( 'Screen size', 'funnelforms-pro' ) }>
					{ devices.map( ( [ id, label ] ) => (
						<button key={ id } type="button" className="ffxb-segmented__item" aria-pressed={ device === id } title={ `${ label } (${ DEVICE_WIDTH[ id ] } px)` } onClick={ () => store.getState().setDevice( id ) }>
							{ icons[ id ] }
							<span>{ label }</span>
						</button>
					) ) }
				</div>
				<Button variant="ghost" size="sm" icon={ icons.reload } disabled={ busy } onClick={ () => setRun( ( n ) => n + 1 ) }>
					{ __( 'Start over', 'funnelforms-pro' ) }
				</Button>
			</div>
			{ 'loading' === live.state ? <Spinner label={ __( 'Loading preview…', 'funnelforms-pro' ) } /> : null }
			{ 'failed' === live.state ? (
				<div className="ffxb-live__error">
					<Notice tone="danger" title={ live.problems.length ? __( 'Fix these to see the preview', 'funnelforms-pro' ) : __( 'The preview could not be loaded.', 'funnelforms-pro' ) }>
						{ live.problems.length ? (
							<ul>
								{ problemTexts( live.problems ).map( ( p ) => (
									<li key={ p }>{ p }</li>
								) ) }
							</ul>
						) : (
							live.message
						) }
					</Notice>
				</div>
			) : null }
			{ 'ready' === live.state ? <DesignModeBar on={ designing } onToggle={ setDesigning } picked={ design.picked?.part ?? null } onChoose={ design.choose } chooser={ chooser } /> : null }
			{ 'ready' === live.state ? <Stage html={ live.html } width={ DEVICE_WIDTH[ device ] } device={ device } message={ message } frameRef={ frame } /> : null }
			{ 'ready' === live.state && designing && design.picked && doc ? <DesignPartPanel doc={ doc } part={ design.picked.part } rect={ design.picked.rect } frame={ frame.current } onClose={ closePart } /> : null }
		</section>
	);
}

/* ------------------------------------------------------------------ settings */

/** A page of cards with a list of them at the side. */
function Sheet( { label, parts }: { label: string; parts: Array<{ id: string; title: string; body: React.ReactNode; pro?: boolean }> } ) {
	const [ active, setActive ] = useState( parts[ 0 ]?.id ?? '' );
	const ref = useRef<HTMLDivElement>( null );
	const jump = ( id: string ): void => {
		setActive( id );
		document.getElementById( 'ffxb-part-' + id )?.scrollIntoView?.( { behavior: 'smooth', block: 'start' } );
	};
	// The list marks the card at the top of the scrolled sheet.
	const follow = (): void => {
		const box = ref.current;
		if ( ! box ) {
			return;
		}
		const top = box.getBoundingClientRect().top + 80;
		let current = parts[ 0 ]?.id ?? '';
		for ( const p of parts ) {
			const card = document.getElementById( 'ffxb-part-' + p.id );
			if ( card && card.getBoundingClientRect().top <= top ) {
				current = p.id;
			}
		}
		setActive( current );
	};
	return (
		<div ref={ ref } className="ffxb-workspace ffxb-workspace--sheet" onScroll={ parts.length > 1 ? follow : undefined }>
			{ parts.length > 1 ? (
				<nav className="ffxb-sheet__nav" aria-label={ label }>
					{ parts.map( ( p ) => (
						<button key={ p.id } type="button" className={ 'ffxb-sheet__link' + ( active === p.id ? ' is-active' : '' ) } onClick={ () => jump( p.id ) }>
							<span className="ffxb-sheet__link-text">{ p.title }</span>
							{ p.pro ? <ProBadge /> : null }
						</button>
					) ) }
				</nav>
			) : null }
			<div className="ffxb-sheet">
				{ parts.map( ( p ) => (
					<div key={ p.id } id={ 'ffxb-part-' + p.id } className="ffxb-sheet__card">
						{ p.body }
					</div>
				) ) }
			</div>
		</div>
	);
}

/**
 * The editors of the Pro settings a form already uses, for Funnelforms Free: there they are only
 * shown to switch them off, so a form made with Pro can be published again.
 */
function usedProParts( doc: FormDocument ): Array<{ id: string; title: string; body: React.ReactNode }> {
	const s = doc.settings;
	const parts = [
		{ used: doc.locales.available.length > 1 || true === s.languageSwitch, id: 'languages', title: __( 'Languages', 'funnelforms-pro' ), body: <LanguagesSection doc={ doc } /> },
		{ used: doc.calculations.length > 0 || undefined !== s.scoreCalculation, id: 'calculations', title: __( 'Calculations', 'funnelforms-pro' ), body: <CalculationsSection doc={ doc } /> },
		{ used: undefined !== s.quiz, id: 'quiz', title: __( 'Quiz', 'funnelforms-pro' ), body: <QuizSection doc={ doc } /> },
		{ used: ( doc.experiments ?? [] ).length > 0, id: 'experiments', title: __( 'A/B tests', 'funnelforms-pro' ), body: <ExperimentsSection doc={ doc } /> },
		{ used: undefined !== s.payment, id: 'payment', title: __( 'Payment', 'funnelforms-pro' ), body: <PaymentSection doc={ doc } /> },
		{ used: undefined !== s.doubleOptIn, id: 'optin', title: __( 'Confirm e-mail address', 'funnelforms-pro' ), body: <DoubleOptInSection doc={ doc } /> },
		{ used: undefined !== s.abandonment, id: 'abandon', title: __( 'Win back visitors who leave', 'funnelforms-pro' ), body: <AbandonSection doc={ doc } /> },
		{ used: undefined !== s.access || undefined !== s.timeLimit, id: 'access', title: __( 'Access', 'funnelforms-pro' ), body: <AccessSection doc={ doc } /> },
	];
	return parts.filter( ( p ) => p.used ).map( ( { id, title, body } ) => ( { id, title, body, pro: true } ) );
}

/** Small line icons of the Pro settings. */
function FeatureIcon( { d }: { d: string } ) {
	return (
		<svg className="ffxb-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d={ d } />
		</svg>
	);
}

/** The settings that come with Funnelforms Pro, with what each brings. */
function proSettings(): ProFeature[] {
	return [
		{ id: 'languages', title: __( 'Languages', 'funnelforms-pro' ), text: __( 'One form in several languages, with a switch for visitors.', 'funnelforms-pro' ), icon: icons.globe },
		{ id: 'calculations', title: __( 'Calculations', 'funnelforms-pro' ), text: __( 'Prices, budgets and scores worked out from the answers.', 'funnelforms-pro' ), icon: <FeatureIcon d="M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01M9 18h6" /> },
		{ id: 'quiz', title: __( 'Quiz', 'funnelforms-pro' ), text: __( 'Right answers, points and a result for each score.', 'funnelforms-pro' ), icon: <FeatureIcon d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4v4h-4z" /> },
		{ id: 'experiments', title: __( 'A/B tests', 'funnelforms-pro' ), text: __( 'Try variants of a step against each other and keep the better one.', 'funnelforms-pro' ), icon: <FeatureIcon d="M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" /> },
		{ id: 'payment', title: __( 'Payment', 'funnelforms-pro' ), text: __( 'Payments through Stripe, PayPal or Mollie when the form is sent.', 'funnelforms-pro' ), icon: <FeatureIcon d="M3 6h18v12H3zM3 10h18M7 15h4" /> },
		{ id: 'optin', title: __( 'Confirm e-mail address', 'funnelforms-pro' ), text: __( 'Entries count once visitors confirm their address by e-mail.', 'funnelforms-pro' ), icon: <FeatureIcon d="M3 6h18v8M3 6v12h9M3 7l9 6 9-6M15 18l2 2 4-4" /> },
		{ id: 'abandon', title: __( 'Win back visitors who leave', 'funnelforms-pro' ), text: __( 'Reminder mails to visitors who stopped halfway.', 'funnelforms-pro' ), icon: <FeatureIcon d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3" /> },
		{ id: 'access', title: __( 'Access', 'funnelforms-pro' ), text: __( 'A password, a time window or a limit of entries.', 'funnelforms-pro' ), icon: icons.lock },
	];
}

export function SettingsWorkspace( { doc }: { doc: FormDocument } ) {
	return 'free' === process.env.FUNNELFORMS_EDITION ? (
		<Sheet
			label={ __( 'Settings', 'funnelforms-pro' ) }
			parts={ [
				{ id: 'general', title: __( 'General', 'funnelforms-pro' ), body: <FormSettings doc={ doc } /> },
				{ id: 'spam', title: __( 'Spam protection', 'funnelforms-pro' ), body: <SpamSection doc={ doc } /> },
				{ id: 'page', title: __( 'Own page', 'funnelforms-pro' ), body: <OwnPageSection /> },
				...usedProParts( doc ),
				{
					id: 'pro',
					title: __( 'More settings', 'funnelforms-pro' ),
					pro: true,
					body: <ProFeatures title={ __( 'More settings', 'funnelforms-pro' ) } lead={ __( 'These settings come with Funnelforms Pro:', 'funnelforms-pro' ) } features={ proSettings() } />,
				},
			] }
		/>
	) : (
		<Sheet
			label={ __( 'Settings', 'funnelforms-pro' ) }
			parts={ [
				{ id: 'general', title: __( 'General', 'funnelforms-pro' ), body: <FormSettings doc={ doc } /> },
				{ id: 'languages', title: __( 'Languages', 'funnelforms-pro' ), body: <LanguagesSection doc={ doc } /> },
				{ id: 'calculations', title: __( 'Calculations', 'funnelforms-pro' ), body: <CalculationsSection doc={ doc } /> },
				{ id: 'quiz', title: __( 'Quiz', 'funnelforms-pro' ), body: <QuizSection doc={ doc } /> },
				{ id: 'experiments', title: __( 'A/B tests', 'funnelforms-pro' ), body: <ExperimentsSection doc={ doc } /> },
				{ id: 'payment', title: __( 'Payment', 'funnelforms-pro' ), body: <PaymentSection doc={ doc } /> },
				{ id: 'optin', title: __( 'Confirm e-mail address', 'funnelforms-pro' ), body: <DoubleOptInSection doc={ doc } /> },
				{ id: 'abandon', title: __( 'Win back visitors who leave', 'funnelforms-pro' ), body: <AbandonSection doc={ doc } /> },
				{ id: 'access', title: __( 'Access', 'funnelforms-pro' ), body: <AccessSection doc={ doc } /> },
				{ id: 'spam', title: __( 'Spam protection', 'funnelforms-pro' ), body: <SpamSection doc={ doc } /> },
				{ id: 'page', title: __( 'Own page', 'funnelforms-pro' ), body: <OwnPageSection /> },
			] }
		/>
	);
}

/** Actions of a form without a contact step: they are edited at the contact step otherwise. */
export function ActionsWorkspace( { doc }: { doc: FormDocument } ) {
	const body = (
		<>
			<Notice tone="warning">{ __( 'This form has no contact step, so nothing is sent and these actions never run. Add a contact step on the canvas; its properties then show what happens after sending.', 'funnelforms-pro' ) }</Notice>
			<ActionsSection doc={ doc } />
		</>
	);
	return <Sheet label={ __( 'After sending', 'funnelforms-pro' ) } parts={ [ { id: 'actions', title: __( 'After sending', 'funnelforms-pro' ), body } ] } />;
}
