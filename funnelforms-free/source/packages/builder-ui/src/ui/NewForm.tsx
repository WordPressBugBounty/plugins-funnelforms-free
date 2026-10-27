/**
 * Start of a new form: a gallery of templates by goal and industry (both at once), recommended
 * ones first, starting with the site's industry, with a search through texts and synonyms (of all
 * industries, unless the owner chose one), a
 * thumbnail of the first question, what the template does for leads, a live preview and the
 * language of the form, an empty form by name, or a draft the AI writes from a description
 * (Funnelforms Pro). Funnelforms Free shows the templates of Pro locked; they lead to the page
 * about Pro. Ends in the editor with the new draft.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiConfig, FormsApi, FormTemplate, IconElements, TemplateCatalog, TemplateCategory, TemplateFeature, TemplateGoal } from '../api';
import type { Device } from '../store';
import { __, sprintf } from './i18n';
import { LucideIcon } from './IconPicker';
import { languageLabel } from './Languages';
import { PreviewDialog } from './Preview';
import { findTheme, themeStyle } from '../themes';
import { AiCreateCard, AiCreateStep } from './AiForm';
import { sampleVars } from './ThemeSample';
import { Button, icons, Notice, ProBadge, ProCard, Spinner, TextInput } from './ui';
import { proUrl } from '../edition';

/** The goal and the industry chosen; null: any. */
type Filter = { goal: TemplateGoal | null; category: TemplateCategory | null };

const ALL: Filter = { goal: null, category: null };

/** What the dialog shows: the gallery, the empty form by name, or the AI form builder. */
type Step = 'gallery' | 'blank' | 'ai';

export function goalLabel( goal: TemplateGoal ): string {
	switch ( goal ) {
		case 'quote':
			return __( 'Quote requests', 'funnelforms-pro' );
		case 'calculator':
			return __( 'Price calculators', 'funnelforms-pro' );
		case 'consultation':
			return __( 'Consultations', 'funnelforms-pro' );
		case 'booking':
			return __( 'Appointments', 'funnelforms-pro' );
		case 'application':
			return __( 'Applications', 'funnelforms-pro' );
		case 'quiz':
			return __( 'Quizzes and product finders', 'funnelforms-pro' );
		case 'registration':
			return __( 'Registrations', 'funnelforms-pro' );
		case 'feedback':
			return __( 'Feedback and surveys', 'funnelforms-pro' );
		case 'leadmagnet':
			return __( 'Lead magnets', 'funnelforms-pro' );
	}
	return goal;
}

export function categoryLabel( category: TemplateCategory ): string {
	const labels: Record<TemplateCategory, string> = {
		craft: __( 'Trades and construction', 'funnelforms-pro' ),
		energy: __( 'Energy and heating', 'funnelforms-pro' ),
		realestate: __( 'Real estate', 'funnelforms-pro' ),
		finance: __( 'Finance and insurance', 'funnelforms-pro' ),
		hr: __( 'Recruiting', 'funnelforms-pro' ),
		health: __( 'Health and care', 'funnelforms-pro' ),
		legal: __( 'Law and tax', 'funnelforms-pro' ),
		home: __( 'Home services', 'funnelforms-pro' ),
		auto: __( 'Cars and mobility', 'funnelforms-pro' ),
		beauty: __( 'Beauty and wellness', 'funnelforms-pro' ),
		education: __( 'Education and courses', 'funnelforms-pro' ),
		coaching: __( 'Coaching and advice', 'funnelforms-pro' ),
		b2b: __( 'B2B, SaaS and IT', 'funnelforms-pro' ),
		agency: __( 'Agencies and creatives', 'funnelforms-pro' ),
		events: __( 'Events, catering and weddings', 'funnelforms-pro' ),
		ecommerce: __( 'Online shops', 'funnelforms-pro' ),
		general: __( 'For every business', 'funnelforms-pro' ),
	};
	return labels[ category ] ?? category;
}

export function featureLabel( feature: TemplateFeature ): string {
	switch ( feature ) {
		case 'quiz':
			return __( 'Quiz', 'funnelforms-pro' );
		case 'logic':
			return __( 'Logic', 'funnelforms-pro' );
		case 'calculation':
			return __( 'Calculation', 'funnelforms-pro' );
		case 'booking':
			return __( 'Booking', 'funnelforms-pro' );
		case 'upload':
			return __( 'File upload', 'funnelforms-pro' );
		case 'address':
			return __( 'Address', 'funnelforms-pro' );
		case 'rating':
			return __( 'Rating', 'funnelforms-pro' );
		case 'signature':
			return __( 'Signature', 'funnelforms-pro' );
		case 'price':
			return __( 'Shows a price', 'funnelforms-pro' );
		case 'result':
			return __( 'Shows a result', 'funnelforms-pro' );
		case 'score':
			return __( 'Lead score', 'funnelforms-pro' );
	}
	return feature;
}

/** What a card says a template does for leads: the result it shows, the lead score and booking. */
const CONVERSION: TemplateFeature[] = [ 'price', 'result', 'score', 'booking' ];

/** A template of Funnelforms Pro shown locked in Funnelforms Free. */
function locked( template: FormTemplate ): boolean {
	return 'free' === process.env.FUNNELFORMS_EDITION && true === template.pro;
}

/** Lower case without accents, so "Gebaude" finds "Gebäude". */
function fold( text: string ): string {
	return text
		.normalize( 'NFD' )
		.replace( /[̀-ͯ]/g, '' )
		.toLowerCase();
}

function matches( template: FormTemplate, words: string[] ): boolean {
	if ( 0 === words.length ) {
		return true;
	}
	const haystack = fold(
		[
			template.title,
			template.description,
			template.firstQuestion,
			goalLabel( template.goal ),
			categoryLabel( template.category ),
			...template.features.map( featureLabel ),
			...template.sample.options.map( ( o ) => o.label ),
			...( template.keywords ?? [] ),
		].join( ' ' )
	);
	return words.every( ( word ) => haystack.includes( word ) );
}

function shows( template: FormTemplate, filter: Filter ): boolean {
	return ( null === filter.goal || template.goal === filter.goal ) && ( null === filter.category || template.category === filter.category );
}

/** Templates to use before locked ones, recommended ones (rank) first, otherwise in the order of the catalog. */
function ranked( templates: FormTemplate[] ): FormTemplate[] {
	const key = ( t: FormTemplate ): number => ( locked( t ) ? 1e6 : 0 ) + ( t.rank ?? 1e5 );
	return templates
		.map( ( t, i ) => ( { t, i } ) )
		.sort( ( a, b ) => key( a.t ) - key( b.t ) || a.i - b.i )
		.map( ( x ) => x.t );
}

/**
 * ai: the AI form builder of the page (Funnelforms Pro; without it that way is not offered).
 * Funnelforms Free shows it with the Pro badge.
 */
export function NewFormDialog( { api, category, ai, onCreated, onClose }: { api: FormsApi; category?: string; ai?: AiConfig | null; onCreated: ( id: number ) => void; onClose: () => void } ) {
	const ref = useRef<HTMLDialogElement>( null );
	const [ catalog, setCatalog ] = useState<TemplateCatalog | null>( null );
	const [ loading, setLoading ] = useState( true );
	const [ locale, setLocale ] = useState( '' );
	const [ chosen, setFilter ] = useState<Filter>( ALL );
	// The site's industry is chosen once, when the templates first arrive.
	const preset = useRef( false );
	// The industry is still the one of the site, not one the owner clicked: a search looks through all industries.
	const [ auto, setAuto ] = useState( false );
	const [ search, setSearch ] = useState( '' );
	const [ step, setStep ] = useState<Step>( 'gallery' );
	const [ title, setTitle ] = useState( '' );
	const [ error, setError ] = useState<string | null>( null );
	const [ busy, setBusy ] = useState( false );
	const [ previewing, setPreviewing ] = useState<FormTemplate | null>( null );
	const [ device, setDevice ] = useState<Device>( 'desktop' );

	useEffect( () => {
		ref.current?.showModal?.();
	}, [] );

	useEffect( () => {
		let current = true;
		setLoading( true );
		api.templates( locale || undefined ).then(
			( result ) => {
				if ( current ) {
					setCatalog( result );
					setLoading( false );
					const industry = result.industry;
					if ( ! preset.current && industry && result.templates.some( ( t ) => t.category === industry ) ) {
						setFilter( { goal: null, category: industry } );
						setAuto( true );
					}
					preset.current = true;
				}
			},
			() => {
				// Without templates the empty form still works.
				if ( current ) {
					setCatalog( ( c ) => c ?? { goals: [], categories: [], languages: [], locale: '', templates: [], icons: {} } );
					setLoading( false );
				}
			}
		);
		return () => {
			current = false;
		};
	}, [ api, locale ] );

	const words = useMemo( () => fold( search ).split( /\s+/ ).filter( Boolean ), [ search ] );
	const filter: Filter = auto && words.length > 0 ? { ...chosen, category: null } : chosen;
	/** An industry or all templates chosen by the owner, which a search keeps. */
	const choose = ( f: Filter ): void => {
		setAuto( false );
		setFilter( f );
	};
	const found = useMemo( () => ( catalog?.templates ?? [] ).filter( ( t ) => matches( t, words ) ), [ catalog, words ] );
	const shown = ranked( found.filter( ( t ) => shows( t, filter ) ) );
	const filtered = null !== filter.goal || null !== filter.category;
	// The AI form builder and the empty form, on the unfiltered gallery and whenever no template fits.
	const starts = null !== catalog && ( ( ! filtered && 0 === words.length ) || 0 === shown.length );
	const goals = ( catalog?.goals ?? [] ).filter( ( g ) => ( catalog?.templates ?? [] ).some( ( t ) => t.goal === g ) );
	const categories = ( catalog?.categories ?? [] ).filter( ( c ) => ( catalog?.templates ?? [] ).some( ( t ) => t.category === c ) );
	// A goal counts within the chosen industry and an industry within the chosen goal.
	const count = ( f: Filter ): number => found.filter( ( t ) => shows( t, f ) ).length;
	const iconSet = catalog?.icons ?? {};

	const run = async ( work: () => Promise<number> ): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			onCreated( await work() );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
			setBusy( false );
		}
	};
	const use = ( template: FormTemplate ): Promise<void> => run( async () => ( await api.fromTemplate( template.id, locale || undefined ) ).id );
	const blank = (): Promise<void> => run( async () => ( await api.create( title.trim(), category ?? '' ) ).id );
	const fetchPage = useCallback( () => api.templatePreview( previewing?.id ?? '', locale || undefined ), [ api, previewing, locale ] );

	const heading = [ filter.goal ? goalLabel( filter.goal ) : '', filter.category ? categoryLabel( filter.category ) : '' ].filter( Boolean ).join( ' · ' ) || __( 'All templates', 'funnelforms-pro' );
	/** A filter button: all templates, or a goal or an industry that is chosen or let go by a click. */
	const facet = ( key: string, active: boolean, n: number, label: string, choose: () => void ) => (
		<li key={ key }>
			<button type="button" className="ffxb-gallery__facet" aria-pressed={ active } disabled={ 0 === n && ! active } onClick={ choose }>
				<span className="ffxb-gallery__facet-label">{ label }</span>
				<span className="ffxb-gallery__facet-count">{ n }</span>
			</button>
		</li>
	);

	const withAi = 'free' === process.env.FUNNELFORMS_EDITION || ( !! ai && undefined !== api.aiCreate );
	let main: React.ReactNode;
	if ( 'ai' === step && 'free' === process.env.FUNNELFORMS_EDITION ) {
		main = (
			<div className="ffxb-gallery__blank ffxb-ai">
				<ProCard
					title={ __( 'Create with AI', 'funnelforms-pro' ) }
					items={ [ __( 'A complete draft form from a description of your business and goal', 'funnelforms-pro' ), __( 'Changes to a form by an instruction, such as "also ask for the budget"', 'funnelforms-pro' ) ] }
				/>
				<div className="ffxb-gallery__blank-actions">
					<Button variant="ghost" icon={ icons.back } onClick={ () => setStep( 'gallery' ) }>
						{ __( 'Back to the templates', 'funnelforms-pro' ) }
					</Button>
				</div>
			</div>
		);
	} else if ( 'ai' === step && 'free' !== process.env.FUNNELFORMS_EDITION && ai ) {
		main = <AiCreateStep api={ api } ai={ ai } locale={ catalog?.locale ?? '' } onCreated={ onCreated } onBack={ () => setStep( 'gallery' ) } />;
	} else if ( 'blank' === step ) {
		main = (
			<form
				className="ffxb-gallery__blank"
				onSubmit={ ( e ) => {
					e.preventDefault();
					if ( title.trim() ) {
						void blank();
					}
				} }
			>
				<span className="ffxb-gallery__blank-icon" aria-hidden="true">
					{ icons.plus }
				</span>
				<h3>{ __( 'Start from scratch', 'funnelforms-pro' ) }</h3>
				<p>{ __( 'An empty form with a contact step. Add your own questions in the editor.', 'funnelforms-pro' ) }</p>
				<TextInput label={ __( 'Name of the form', 'funnelforms-pro' ) } value={ title } onChange={ setTitle } hint={ __( 'Only you see the name; visitors see the questions.', 'funnelforms-pro' ) } />
				<div className="ffxb-gallery__blank-actions">
					<Button variant="ghost" icon={ icons.back } onClick={ () => setStep( 'gallery' ) }>
						{ __( 'Back to the templates', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" type="submit" disabled={ busy || ! title.trim() }>
						{ __( 'Create', 'funnelforms-pro' ) }
					</Button>
				</div>
			</form>
		);
	} else {
		main = (
			<div className="ffxb-gallery__main">
				<nav className="ffxb-gallery__nav" aria-label={ __( 'Filter templates', 'funnelforms-pro' ) }>
					<ul className="ffxb-gallery__facets">{ facet( 'all', ! filtered, found.length, __( 'All templates', 'funnelforms-pro' ), () => choose( ALL ) ) }</ul>
					<p className="ffxb-gallery__group">{ __( 'Goal', 'funnelforms-pro' ) }</p>
					<ul className="ffxb-gallery__facets">
						{ goals.map( ( g ) =>
							facet( 'goal-' + g, g === filter.goal, count( { ...filter, goal: g } ), goalLabel( g ), () => setFilter( ( f ) => ( { ...f, goal: f.goal === g ? null : g } ) ) )
						) }
					</ul>
					<p className="ffxb-gallery__group">{ __( 'Industry', 'funnelforms-pro' ) }</p>
					<ul className="ffxb-gallery__facets">
						{ categories.map( ( c ) =>
							facet( 'category-' + c, c === filter.category, count( { ...filter, category: c } ), categoryLabel( c ), () => choose( { ...filter, category: filter.category === c ? null : c } ) )
						) }
					</ul>
				</nav>
				<section className="ffxb-gallery__results" aria-labelledby="ffxb-gallery-heading" aria-busy={ loading }>
					<div className="ffxb-gallery__results-head">
						<h3 id="ffxb-gallery-heading">{ heading }</h3>
						<span className="ffxb-gallery__total">{ null === catalog ? '' : shown.length }</span>
						{ loading && null !== catalog ? <span className="ffxb-spinner" aria-hidden="true" /> : null }
					</div>
					{ null === catalog ? <Spinner label={ __( 'Loading templates…', 'funnelforms-pro' ) } /> : null }
					{ null !== catalog && 0 === shown.length && ( words.length > 0 || filtered ) ? (
						<div className="ffxb-gallery__empty">
							<strong>{ __( 'No template matches your search.', 'funnelforms-pro' ) }</strong>
							<span>{ __( 'Try another word or start with an empty form.', 'funnelforms-pro' ) }</span>
							<div>
								<Button
									variant="secondary"
									onClick={ () => {
										setSearch( '' );
										choose( ALL );
									} }
								>
									{ __( 'Show all templates', 'funnelforms-pro' ) }
								</Button>
							</div>
						</div>
					) : null }
					<ul className="ffxb-gallery__grid">
						{ withAi && starts ? <AiCreateCard onOpen={ () => setStep( 'ai' ) } badge={ 'free' === process.env.FUNNELFORMS_EDITION ? <ProBadge /> : undefined } /> : null }
						{ starts ? (
							<li className="ffxb-tcard ffxb-tcard--blank">
								<button type="button" className="ffxb-tcard__blank" onClick={ () => setStep( 'blank' ) }>
									<span className="ffxb-tcard__blank-icon" aria-hidden="true">
										{ icons.plus }
									</span>
									<strong>{ __( 'Start from scratch', 'funnelforms-pro' ) }</strong>
									<span>{ __( 'An empty form with a contact step.', 'funnelforms-pro' ) }</span>
								</button>
							</li>
						) : null }
						{ shown.map( ( t ) => (
							<TemplateCard key={ t.id } template={ t } icons={ iconSet } lang={ ( catalog?.locale ?? '' ).split( '_' ).slice( 0, 2 ).join( '-' ) } busy={ busy } onPreview={ () => setPreviewing( t ) } onUse={ () => void use( t ) } />
						) ) }
					</ul>
				</section>
			</div>
		);
	}

	const languages = catalog?.languages ?? [];
	return (
		<dialog
			ref={ ref }
			className="ffxb-gallery"
			aria-labelledby="ffxb-gallery-title"
			onClose={ ( e ) => {
				// The preview is a dialog inside this one; its close reaches here through React.
				if ( e.target === e.currentTarget ) {
					onClose();
				}
			} }
		>
			<header className="ffxb-gallery__head">
				<div>
					<h2 id="ffxb-gallery-title" className="ffxb-gallery__title">
						{ __( 'New form', 'funnelforms-pro' ) }
					</h2>
					<p className="ffxb-gallery__lead">{ __( 'Pick a template made for your industry and goal. Every question, text and calculation can be changed later.', 'funnelforms-pro' ) }</p>
				</div>
				<button type="button" className="ffxb-gallery__close" aria-label={ __( 'Close', 'funnelforms-pro' ) } onClick={ onClose }>
					{ icons.close }
				</button>
			</header>
			{ 'gallery' !== step ? null : (
				<div className="ffxb-gallery__toolbar">
					<label className="ffxb-gallery__search">
						<span className="ffxb-sr">{ __( 'Search templates', 'funnelforms-pro' ) }</span>
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
							<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
						</svg>
						<input type="search" value={ search } placeholder={ 'free' === process.env.FUNNELFORMS_EDITION ? __( 'Search, e.g. contact, callback or webinar', 'funnelforms-pro' ) : __( 'Search, e.g. solar, quiz or booking', 'funnelforms-pro' ) } onChange={ ( e ) => setSearch( e.target.value ) } />
					</label>
					{ languages.length > 1 ? (
						<label className="ffxb-gallery__language">
							<span>{ __( 'Language of the form', 'funnelforms-pro' ) }</span>
							<select value={ locale || catalog?.locale || '' } onChange={ ( e ) => setLocale( e.target.value ) }>
								{ languages.map( ( l ) => (
									<option key={ l } value={ l }>
										{ languageLabel( l ) }
									</option>
								) ) }
							</select>
						</label>
					) : null }
				</div>
			) }
			{ error ? (
				<div className="ffxb-gallery__error">
					<Notice tone="danger">{ error }</Notice>
				</div>
			) : null }
			{ main }
			{ previewing ? (
				<PreviewDialog
					title={ previewing.title }
					fetchPage={ fetchPage }
					device={ device }
					onDevice={ setDevice }
					onClose={ () => setPreviewing( null ) }
					actions={
						<Button variant="primary" disabled={ busy } onClick={ () => void use( previewing ) }>
							{ __( 'Use template', 'funnelforms-pro' ) }
						</Button>
					}
				/>
			) : null }
		</dialog>
	);
}

function TemplateCard( { template: t, icons: set, lang, busy, onPreview, onUse }: { template: FormTemplate; icons: Record<string, IconElements>; lang: string; busy: boolean; onPreview: () => void; onUse: () => void } ) {
	const icon = set[ t.icon ];
	const lock = locked( t );
	// Locked: a teaser that leads to the page about Funnelforms Pro (Free has no document to preview or use).
	const upgrade = (): void => {
		window.location.assign( proUrl() );
	};
	const conversion = CONVERSION.filter( ( f ) => t.features.includes( f ) && ! ( 'result' === f && t.features.includes( 'price' ) ) );
	const questions = t.questions ?? t.steps;
	return (
		<li className={ 'ffxb-tcard ffxb-tcard--' + t.category + ( lock ? ' ffxb-tcard--locked' : '' ) }>
			<button
				type="button"
				className="ffxb-tcard__thumb"
				onClick={ lock ? upgrade : onPreview }
				aria-label={
					lock
						? sprintf( /* translators: %s: name of the template */ __( '%s is part of Funnelforms Pro', 'funnelforms-pro' ), t.title )
						: sprintf( /* translators: %s: name of the template */ __( 'Preview of %s', 'funnelforms-pro' ), t.title )
				}
			>
				<Thumbnail template={ t } icons={ set } lang={ lang } />
				<span className="ffxb-tcard__peek" aria-hidden="true">
					{ lock ? icons.lock : icons.eye }
					{ lock ? __( 'Funnelforms Pro', 'funnelforms-pro' ) : __( 'Preview', 'funnelforms-pro' ) }
				</span>
			</button>
			<div className="ffxb-tcard__body">
				<div className="ffxb-tcard__head">
					<span className="ffxb-tcard__icon" aria-hidden="true">
						{ icon ? <LucideIcon elements={ icon } size={ 18 } /> : null }
					</span>
					<h4 className="ffxb-tcard__title">{ t.title }</h4>
					{ lock ? <ProBadge /> : null }
				</div>
				<p className="ffxb-tcard__text">{ t.description }</p>
				<ul className="ffxb-tcard__tags">
					<li className="ffxb-tcard__tag ffxb-tcard__tag--goal">{ goalLabel( t.goal ) }</li>
					{ conversion.map( ( f ) => (
						<li key={ f } className="ffxb-tcard__tag ffxb-tcard__tag--win">
							{ featureLabel( f ) }
						</li>
					) ) }
					<li className="ffxb-tcard__tag">
						{ 1 === questions ? __( '1 question', 'funnelforms-pro' ) : sprintf( /* translators: %d: number of questions the visitor answers */ __( '%d questions', 'funnelforms-pro' ), questions ) }
					</li>
				</ul>
			</div>
			<div className="ffxb-tcard__actions">
				{ lock ? (
					<Button size="sm" variant="primary" icon={ icons.lock } onClick={ upgrade }>
						{ __( 'Unlock with Pro', 'funnelforms-pro' ) }
					</Button>
				) : (
					<>
						<Button size="sm" variant="ghost" icon={ icons.eye } onClick={ onPreview }>
							{ __( 'Preview', 'funnelforms-pro' ) }
						</Button>
						<Button size="sm" variant="primary" disabled={ busy } onClick={ onUse }>
							{ __( 'Use template', 'funnelforms-pro' ) }
						</Button>
					</>
				) }
			</div>
		</li>
	);
}

/** A small drawing of the first step in the template's theme: the question with its answers, rating, slider or text, in the language of the form. */
function Thumbnail( { template: t, icons: set, lang }: { template: FormTemplate; icons: Record<string, IconElements>; lang: string } ) {
	const { sample } = t;
	const theme = findTheme( t.theme );
	let answers: React.ReactNode;
	if ( 'choice' === sample.kind && sample.options.length > 0 ) {
		const withIcons = sample.options.every( ( o ) => o.icon && set[ o.icon ] );
		// Tiles are narrow: long words (Einfamilienhaus) go into rows instead.
		const tiles = withIcons && sample.options.slice( 0, 3 ).every( ( o ) => o.label.length <= 22 && o.label.split( /[\s-]+/ ).every( ( word ) => word.length <= 11 ) );
		answers = (
			<span className={ 'ffxb-thumb__options' + ( tiles ? '' : ' ffxb-thumb__options--list' ) }>
				{ sample.options.map( ( o, i ) => {
					const elements = set[ o.icon ];
					return (
						<span key={ i } className="ffxb-thumb__option">
							{ withIcons && elements ? <LucideIcon elements={ elements } size={ 18 } /> : null }
							<span className="ffxb-thumb__label">{ o.label }</span>
						</span>
					);
				} ) }
			</span>
		);
	} else if ( 'rating' === sample.kind ) {
		const points = 'numbers' === sample.style ? Array.from( { length: Math.min( 11, sample.max + 1 ) }, ( _, i ) => i ) : Array.from( { length: Math.min( 5, sample.max ) }, ( _, i ) => i + 1 );
		answers = (
			<span className={ 'ffxb-thumb__rating ffxb-thumb__rating--' + sample.style }>
				{ points.map( ( p ) => (
					<span key={ p } className="ffxb-thumb__point">
						{ 'numbers' === sample.style ? p : '' }
					</span>
				) ) }
			</span>
		);
	} else if ( 'slider' === sample.kind ) {
		answers = (
			<span className="ffxb-thumb__slider">
				<span className="ffxb-thumb__track">
					<span className="ffxb-thumb__fill" />
				</span>
			</span>
		);
	} else if ( 'content' === sample.kind ) {
		answers = (
			<span className="ffxb-thumb__content">
				<span className="ffxb-thumb__line" />
				<span className="ffxb-thumb__line ffxb-thumb__line--short" />
				<span className="ffxb-thumb__button" />
			</span>
		);
	} else {
		answers = <span className="ffxb-thumb__input" />;
	}
	return (
		<span className="ffxb-thumb" aria-hidden="true" lang={ lang || undefined }>
			<span className={ 'ffxb-thumb__card' + ( theme ? ' ffxb-thumb__card--themed' : '' ) } style={ theme ? sampleVars( themeStyle( theme ) ) : undefined }>
				<span className="ffxb-thumb__question">{ t.firstQuestion }</span>
				{ answers }
				<span className="ffxb-thumb__foot">
					<span className="ffxb-thumb__progress">
						<span />
					</span>
					<span className="ffxb-thumb__next" />
				</span>
			</span>
		</span>
	);
}
