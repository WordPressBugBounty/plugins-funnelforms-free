import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type FormDetail, type FormsApi, type FormTemplate, type TemplateCatalog } from '../src/api';
import { categoryLabel, goalLabel, NewFormDialog } from '../src/ui/NewForm';
import { setEdition } from '../src/edition';
import { TEMPLATE_CATEGORIES, TEMPLATE_GOALS } from '../src/templateTaxonomy';
import { blank } from './blank';

( globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean } ).IS_REACT_ACT_ENVIRONMENT = true;

const icons = { 'lucide:house': [ [ 'path', { d: 'M3 10l9-7 9 7' } ] ], 'lucide:sun': [ [ 'circle', { cx: '12', cy: '12', r: '4' } ] ] } as TemplateCatalog[ 'icons' ];

function template( id: string, title: string, rest: Partial<FormTemplate> = {} ): FormTemplate {
	return {
		id,
		title,
		description: 'Beschreibung von ' + title,
		goal: 'quote',
		category: 'craft',
		icon: 'lucide:house',
		features: [ 'logic' ],
		steps: 6,
		firstQuestion: 'Worum geht es?',
		sample: { kind: 'choice', options: [ { label: 'Haus', icon: 'lucide:house' }, { label: 'Sonne', icon: 'lucide:sun' } ], max: 0, style: '' },
		...rest,
	};
}

function catalog( locale = 'de_DE', extra: Partial<TemplateCatalog> = {} ): TemplateCatalog {
	const fr = 'fr_FR' === locale;
	return {
		goals: [ 'quote', 'calculator', 'quiz', 'application' ],
		categories: [ 'craft', 'energy', 'ecommerce', 'hr' ],
		languages: [ 'de_DE', 'en_US', 'fr_FR' ],
		locale,
		templates: [
			template( 'roofing', fr ? 'Couvreur' : 'Dachdecker', { features: [ 'logic', 'upload' ], keywords: [ 'Dachrinne', 'gutter' ] } ),
			template( 'solar', 'Photovoltaik-Rechner', { goal: 'calculator', category: 'energy', icon: 'lucide:sun', theme: 'neon', features: [ 'calculation', 'price', 'result', 'score' ], questions: 1, sample: { kind: 'slider', options: [], max: 0, style: '' } } ),
			template( 'productfinder', 'Produktberater', { goal: 'quiz', category: 'ecommerce', description: 'Findet die passende Matratze für Rücken und Schlafposition.', features: [ 'quiz' ], sample: { kind: 'rating', options: [], max: 10, style: 'numbers' } } ),
		],
		icons,
		...extra,
	};
}

function fakeApi( overrides: Partial<FormsApi> = {} ): FormsApi {
	const detail = ( id: number ): FormDetail => ( {
		id,
		uid: 'uid',
		title: 'Neu',
		category: '',
		status: 'draft',
		renderer: 'v5',
		legacyId: null,
		currentRevision: null,
		hasDraft: true,
		draftUpdatedAt: null,
		draftAuthor: null,
		lockedBy: null,
		entries: 0,
		shortcode: '',
		createdAt: null,
		updatedAt: null,
		document: blank(),
		lockTtl: 150,
	} );
	return {
		templates: vi.fn( async ( locale?: string ) => catalog( locale ) ),
		templatePreview: vi.fn( async ( id: string ) => ( { html: '<!doctype html><p>Vorlage ' + id + '</p>' } ) ),
		fromTemplate: vi.fn( async () => detail( 12 ) ),
		create: vi.fn( async () => detail( 13 ) ),
		...overrides,
	} as unknown as FormsApi;
}

let container: HTMLElement;
let root: Root;

beforeEach( () => {
	container = document.createElement( 'div' );
	document.body.appendChild( container );
	root = createRoot( container );
} );

afterEach( () => {
	act( () => root.unmount() );
	container.remove();
	delete process.env.FUNNELFORMS_EDITION;
	setEdition( undefined );
} );

async function settle(): Promise<void> {
	await act( async () => {
		for ( let i = 0; i < 5; i++ ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		}
	} );
}

function button( label: string, scope: ParentNode = container ): HTMLButtonElement {
	const found = [ ...scope.querySelectorAll( 'button' ) ].find( ( b ) => b.textContent?.trim() === label || b.getAttribute( 'aria-label' ) === label );
	if ( ! found ) {
		throw new Error( 'No button ' + label );
	}
	return found;
}

function facet( label: string ): HTMLButtonElement {
	const found = [ ...container.querySelectorAll<HTMLButtonElement>( '.ffxb-gallery__facet' ) ].find( ( b ) => b.querySelector( '.ffxb-gallery__facet-label' )?.textContent === label );
	if ( ! found ) {
		throw new Error( 'No filter ' + label );
	}
	return found;
}

function titles(): string[] {
	return [ ...container.querySelectorAll( '.ffxb-tcard__title' ) ].map( ( t ) => t.textContent ?? '' );
}

async function type( input: HTMLInputElement, value: string ): Promise<void> {
	await act( async () => {
		Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, 'value' )?.set?.call( input, value );
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	} );
}

async function open( api: FormsApi, props: { category?: string; onCreated?: ( id: number ) => void; onClose?: () => void } = {} ): Promise<void> {
	await act( async () => root.render( <NewFormDialog api={ api } category={ props.category } onCreated={ props.onCreated ?? ( () => undefined ) } onClose={ props.onClose ?? ( () => undefined ) } /> ) );
	await settle();
}

describe( 'template gallery', () => {
	it( 'shows every template as a card with thumbnail, description and tags', async () => {
		const api = fakeApi();
		await open( api );
		expect( api.templates ).toHaveBeenCalledWith( undefined );
		expect( titles() ).toEqual( [ 'Dachdecker', 'Photovoltaik-Rechner', 'Produktberater' ] );
		expect( container.querySelector( '.ffxb-tcard--blank' )?.textContent ).toContain( 'Start from scratch' );
		const roofing = container.querySelector( '.ffxb-tcard--craft' ) as HTMLElement;
		expect( roofing.textContent ).toContain( 'Beschreibung von Dachdecker' );
		expect( [ ...roofing.querySelectorAll( '.ffxb-tcard__tag' ) ].map( ( t ) => t.textContent ) ).toEqual( [ 'Quote requests', '6 questions' ] );
		// What a template does for leads, and the questions visitors answer (a price includes the result).
		const solar = container.querySelector( '.ffxb-tcard--energy' ) as HTMLElement;
		expect( [ ...solar.querySelectorAll( '.ffxb-tcard__tag' ) ].map( ( t ) => t.textContent ) ).toEqual( [ 'Price calculators', 'Shows a price', 'Lead score', '1 question' ] );
		expect( solar.querySelectorAll( '.ffxb-tcard__tag--win' ) ).toHaveLength( 2 );
		// The thumbnail draws the first question with its icon answers.
		expect( roofing.querySelector( '.ffxb-thumb__question' )?.textContent ).toBe( 'Worum geht es?' );
		expect( roofing.querySelectorAll( '.ffxb-thumb__option svg' ) ).toHaveLength( 2 );
		expect( container.querySelector( '.ffxb-tcard--energy .ffxb-thumb__slider' ) ).not.toBeNull();
		expect( container.querySelectorAll( '.ffxb-tcard--ecommerce .ffxb-thumb__point' ) ).toHaveLength( 11 );
		// In the template's theme; without one in the builder's colours.
		const neon = container.querySelector<HTMLElement>( '.ffxb-tcard--energy .ffxb-thumb__card' ) as HTMLElement;
		expect( neon.classList.contains( 'ffxb-thumb__card--themed' ) ).toBe( true );
		expect( neon.style.getPropertyValue( '--ffxs-bg' ) ).toContain( '#05060f' );
		expect( roofing.querySelector( '.ffxb-thumb__card--themed' ) ).toBeNull();
	} );

	it( 'filters by goal and industry at once and counts the templates of each filter', async () => {
		await open( fakeApi() );
		expect( facet( 'All templates' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( facet( 'Price calculators' ).textContent ).toContain( '1' );
		// A goal without templates is left out of the filters.
		expect( () => facet( 'Applications' ) ).toThrow();

		await act( async () => facet( 'Price calculators' ).click() );
		expect( titles() ).toEqual( [ 'Photovoltaik-Rechner' ] );
		expect( container.querySelector( '#ffxb-gallery-heading' )?.textContent ).toBe( 'Price calculators' );
		expect( container.querySelector( '.ffxb-tcard--blank' ) ).toBeNull();
		// Industries count within the goal: no calculator for online shops.
		expect( facet( 'Online shops' ).disabled ).toBe( true );
		expect( facet( 'Energy and heating' ).textContent ).toContain( '1' );

		await act( async () => facet( 'Energy and heating' ).click() );
		expect( titles() ).toEqual( [ 'Photovoltaik-Rechner' ] );
		expect( facet( 'Price calculators' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( facet( 'Energy and heating' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( container.querySelector( '#ffxb-gallery-heading' )?.textContent ).toBe( 'Price calculators · Energy and heating' );

		// A second click lets the goal go and keeps the industry.
		await act( async () => facet( 'Price calculators' ).click() );
		expect( facet( 'Price calculators' ).getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		expect( container.querySelector( '#ffxb-gallery-heading' )?.textContent ).toBe( 'Energy and heating' );
		expect( facet( 'Quote requests' ).disabled ).toBe( true );

		await act( async () => facet( 'All templates' ).click() );
		expect( titles() ).toHaveLength( 3 );
		expect( facet( 'Energy and heating' ).getAttribute( 'aria-pressed' ) ).toBe( 'false' );
	} );

	it( 'puts recommended templates first and starts with the industry of the site', async () => {
		const ranked = ( locale?: string ): TemplateCatalog => {
			const c = catalog( locale, { industry: 'energy' } );
			c.templates[ 2 ] = { ...c.templates[ 2 ], rank: 1 } as FormTemplate;
			c.templates[ 1 ] = { ...c.templates[ 1 ], rank: 2 } as FormTemplate;
			return c;
		};
		const api = fakeApi( { templates: vi.fn( async ( locale?: string ) => ranked( locale ) ) } );
		await open( api );
		expect( facet( 'Energy and heating' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( titles() ).toEqual( [ 'Photovoltaik-Rechner' ] );
		await act( async () => facet( 'Energy and heating' ).click() );
		expect( titles() ).toEqual( [ 'Produktberater', 'Photovoltaik-Rechner', 'Dachdecker' ] );

		// Loading another language keeps the filter the person chose.
		const select = container.querySelector( '.ffxb-gallery__language select' ) as HTMLSelectElement;
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( select, 'fr_FR' );
			select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
		await settle();
		expect( titles() ).toHaveLength( 3 );
	} );

	it( 'searches every industry while the industry of the site is preselected', async () => {
		await open( fakeApi( { templates: vi.fn( async () => catalog( 'de_DE', { industry: 'energy' } ) ) } ) );
		expect( titles() ).toEqual( [ 'Photovoltaik-Rechner' ] );
		const search = container.querySelector( '.ffxb-gallery__search input' ) as HTMLInputElement;
		await type( search, 'dachrinne' );
		expect( titles() ).toEqual( [ 'Dachdecker' ] );
		expect( facet( 'All templates' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( facet( 'Energy and heating' ).getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		// Without a search the site's industry is back.
		await type( search, '' );
		expect( titles() ).toEqual( [ 'Photovoltaik-Rechner' ] );
		expect( facet( 'Energy and heating' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );

		// An industry the owner clicks stays while searching.
		await act( async () => facet( 'Online shops' ).click() );
		await type( search, 'dachrinne' );
		expect( titles() ).toEqual( [] );
		expect( facet( 'Online shops' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
	} );

	it( 'keeps the AI form builder and the empty form when no template matches', async () => {
		process.env.FUNNELFORMS_EDITION = 'free';
		setEdition( { edition: 'free', proStepFields: [], proContactFields: [], proActions: [], freeConditionOps: [ 'selected' ], proFeatures: [], proUrl: 'https://example.test/wp-admin/admin.php?page=funnelforms-pro' } );
		await open( fakeApi() );
		expect( container.querySelector( '.ffxb-tcard--ai' ) ).not.toBeNull();
		await type( container.querySelector( '.ffxb-gallery__search input' ) as HTMLInputElement, 'dach' );
		// Templates that match push the two starts away.
		expect( titles() ).toEqual( [ 'Dachdecker' ] );
		expect( container.querySelector( '.ffxb-tcard--ai' ) ).toBeNull();
		await type( container.querySelector( '.ffxb-gallery__search input' ) as HTMLInputElement, 'Schornstein' );
		expect( titles() ).toEqual( [] );
		expect( container.querySelector( '.ffxb-gallery__empty' )?.textContent ).toContain( 'No template matches your search.' );
		expect( container.querySelector( '.ffxb-tcard--ai' ) ).not.toBeNull();
		await act( async () => ( container.querySelector( '.ffxb-tcard--blank:not(.ffxb-tcard--ai) .ffxb-tcard__blank' ) as HTMLButtonElement ).click() );
		expect( container.querySelector( '.ffxb-gallery__blank input' ) ).not.toBeNull();
	} );

	it( 'shows all templates when the industry of the site has none', async () => {
		await open( fakeApi( { templates: vi.fn( async () => catalog( 'de_DE', { industry: 'legal' } ) ) } ) );
		expect( facet( 'All templates' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( titles() ).toHaveLength( 3 );
	} );

	it( 'searches titles, descriptions and answers without minding accents', async () => {
		await open( fakeApi() );
		const search = container.querySelector( '.ffxb-gallery__search input' ) as HTMLInputElement;
		await type( search, 'rucken' );
		expect( titles() ).toEqual( [ 'Produktberater' ] );
		// Counts follow the search, so filters without hits are disabled.
		expect( facet( 'Trades and construction' ).disabled ).toBe( true );

		// Answers of the first question are searched too.
		await type( search, 'sonne' );
		expect( titles() ).toEqual( [ 'Dachdecker' ] );

		// So are the synonyms of a template, in German and English.
		await type( search, 'dachrinne' );
		expect( titles() ).toEqual( [ 'Dachdecker' ] );
		await type( search, 'GUTTER' );
		expect( titles() ).toEqual( [ 'Dachdecker' ] );

		await type( search, 'Schornstein' );
		expect( titles() ).toEqual( [] );
		expect( container.textContent ).toContain( 'No template matches your search.' );
		await act( async () => button( 'Show all templates' ).click() );
		expect( search.value ).toBe( '' );
		expect( titles() ).toHaveLength( 3 );
	} );

	it( 'loads the templates again in the chosen language and creates the form in it', async () => {
		const api = fakeApi();
		const onCreated = vi.fn();
		await open( api, { onCreated } );
		const select = container.querySelector( '.ffxb-gallery__language select' ) as HTMLSelectElement;
		expect( select.value ).toBe( 'de_DE' );
		expect( [ ...select.options ].map( ( o ) => o.value ) ).toEqual( [ 'de_DE', 'en_US', 'fr_FR' ] );
		await act( async () => {
			Object.getOwnPropertyDescriptor( HTMLSelectElement.prototype, 'value' )?.set?.call( select, 'fr_FR' );
			select.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		} );
		await settle();
		expect( api.templates ).toHaveBeenLastCalledWith( 'fr_FR' );
		expect( titles()[ 0 ] ).toBe( 'Couvreur' );

		await act( async () => button( 'Use template', container.querySelector( '.ffxb-tcard--craft' ) as HTMLElement ).click() );
		await settle();
		expect( api.fromTemplate ).toHaveBeenCalledWith( 'roofing', 'fr_FR' );
		expect( onCreated ).toHaveBeenCalledWith( 12 );
	} );

	it( 'previews a template and starts the form from the preview', async () => {
		const api = fakeApi();
		const onCreated = vi.fn();
		const onClose = vi.fn();
		await open( api, { onCreated, onClose } );
		await act( async () => button( 'Preview of Photovoltaik-Rechner' ).click() );
		await settle();
		// Closing the preview (Escape) leaves the gallery open.
		await act( async () => container.querySelector( '.ffxb-preview' )?.dispatchEvent( new Event( 'close' ) ) );
		expect( container.querySelector( '.ffxb-preview' ) ).toBeNull();
		expect( onClose ).not.toHaveBeenCalled();
		await act( async () => container.querySelector( '.ffxb-gallery' )?.dispatchEvent( new Event( 'close' ) ) );
		expect( onClose ).toHaveBeenCalledTimes( 1 );

		await act( async () => button( 'Preview of Photovoltaik-Rechner' ).click() );
		await settle();
		expect( api.templatePreview ).toHaveBeenCalledWith( 'solar', undefined );
		const preview = container.querySelector( '.ffxb-preview' ) as HTMLElement;
		expect( preview.querySelector( '.ffxb-preview__title' )?.textContent ).toBe( 'Photovoltaik-Rechner' );
		expect( preview.querySelector( 'iframe' )?.getAttribute( 'srcdoc' ) ).toContain( 'Vorlage solar' );
		await act( async () => button( 'Use template', preview ).click() );
		await settle();
		expect( api.fromTemplate ).toHaveBeenCalledWith( 'solar', undefined );
		expect( onCreated ).toHaveBeenCalledWith( 12 );
	} );

	it( 'starts an empty form by name in the current category', async () => {
		const api = fakeApi();
		const onCreated = vi.fn();
		await open( api, { category: 'Vertrieb', onCreated } );
		await act( async () => ( container.querySelector( '.ffxb-tcard__blank' ) as HTMLButtonElement ).click() );
		expect( container.querySelector( '.ffxb-gallery__toolbar' ) ).toBeNull();
		expect( button( 'Create' ).disabled ).toBe( true );
		await type( container.querySelector( '.ffxb-gallery__blank input' ) as HTMLInputElement, ' Kontakt ' );
		await act( async () => button( 'Create' ).click() );
		await settle();
		expect( api.create ).toHaveBeenCalledWith( 'Kontakt', 'Vertrieb' );
		expect( onCreated ).toHaveBeenCalledWith( 13 );
	} );

	it( 'goes back from the empty form and shows why a template could not be used', async () => {
		const api = fakeApi( { fromTemplate: vi.fn( async () => Promise.reject( new Error( 'Die Vorlage fehlt.' ) ) ) } );
		const onCreated = vi.fn();
		await open( api, { onCreated } );
		await act( async () => ( container.querySelector( '.ffxb-tcard__blank' ) as HTMLButtonElement ).click() );
		await act( async () => button( 'Back to the templates' ).click() );
		expect( titles() ).toHaveLength( 3 );
		await act( async () => button( 'Use template', container.querySelector( '.ffxb-tcard--craft' ) as HTMLElement ).click() );
		await settle();
		expect( container.querySelector( '.ffxb-gallery__error' )?.textContent ).toContain( 'Die Vorlage fehlt.' );
		expect( onCreated ).not.toHaveBeenCalled();
		expect( button( 'Use template', container.querySelector( '.ffxb-tcard--craft' ) as HTMLElement ).disabled ).toBe( false );
	} );

	it( 'says when a template needs Funnelforms Pro', async () => {
		const message = 'The template “Dachdecker” needs Funnelforms Pro. Upgrade to Funnelforms Pro to use it.';
		const api = fakeApi( { fromTemplate: vi.fn( async () => Promise.reject( new ApiError( 'pro_template', message, 403 ) ) ) } );
		await open( api );
		await act( async () => button( 'Use template', container.querySelector( '.ffxb-tcard--craft' ) as HTMLElement ).click() );
		await settle();
		expect( container.querySelector( '.ffxb-gallery__error' )?.textContent ).toContain( message );
	} );

	it( 'still offers the empty form when the templates cannot be loaded', async () => {
		const onClose = vi.fn();
		await open( fakeApi( { templates: vi.fn( async () => Promise.reject( new Error( 'offline' ) ) ) } ), { onClose } );
		expect( titles() ).toEqual( [] );
		expect( container.querySelector( '.ffxb-tcard--blank' ) ).not.toBeNull();
		expect( container.querySelector( '.ffxb-gallery__language' ) ).toBeNull();
		expect( container.querySelector( '.ffxb-gallery__empty' ) ).toBeNull();
		await act( async () => button( 'Close' ).click() );
		expect( onClose ).toHaveBeenCalled();
	} );

	it( 'shows the templates of Funnelforms Pro locked in Funnelforms Free and leads to Pro', async () => {
		process.env.FUNNELFORMS_EDITION = 'free';
		setEdition( { edition: 'free', proStepFields: [], proContactFields: [], proActions: [], freeConditionOps: [ 'selected' ], proFeatures: [], proUrl: 'https://example.test/wp-admin/admin.php?page=funnelforms-pro' } );
		const pro = ( locale?: string ): TemplateCatalog => {
			const c = catalog( locale );
			c.templates[ 1 ] = { ...c.templates[ 1 ], pro: true, rank: 1 } as FormTemplate;
			return c;
		};
		const api = fakeApi( { templates: vi.fn( async ( locale?: string ) => pro( locale ) ) } );
		const assign = vi.fn();
		const location = window.location;
		Object.defineProperty( window, 'location', { configurable: true, value: { ...location, assign } } );
		try {
			await open( api );
			// Locked templates come after the ones to use, whatever their rank.
			expect( titles() ).toEqual( [ 'Dachdecker', 'Produktberater', 'Photovoltaik-Rechner' ] );
			const solar = container.querySelector( '.ffxb-tcard--energy' ) as HTMLElement;
			expect( solar.classList.contains( 'ffxb-tcard--locked' ) ).toBe( true );
			expect( solar.querySelector( '.ffxb-badge' ) ).not.toBeNull();
			expect( () => button( 'Use template', solar ) ).toThrow();
			expect( () => button( 'Preview of Photovoltaik-Rechner' ) ).toThrow();
			await act( async () => button( 'Unlock with Pro', solar ).click() );
			await act( async () => button( 'Photovoltaik-Rechner is part of Funnelforms Pro' ).click() );
			expect( assign ).toHaveBeenCalledTimes( 2 );
			expect( assign ).toHaveBeenCalledWith( 'https://example.test/wp-admin/admin.php?page=funnelforms-pro' );
			expect( api.templatePreview ).not.toHaveBeenCalled();
			expect( api.fromTemplate ).not.toHaveBeenCalled();
			// The others work as in Pro.
			expect( container.querySelector( '.ffxb-tcard--craft' )?.classList.contains( 'ffxb-tcard--locked' ) ).toBe( false );
			expect( button( 'Use template', container.querySelector( '.ffxb-tcard--craft' ) as HTMLElement ).disabled ).toBe( false );
		} finally {
			Object.defineProperty( window, 'location', { configurable: true, value: location } );
		}
	} );

	it( 'shows Pro templates as usual in Funnelforms Pro', async () => {
		const c = catalog();
		c.templates[ 1 ] = { ...c.templates[ 1 ], pro: true } as FormTemplate;
		await open( fakeApi( { templates: vi.fn( async () => c ) } ) );
		expect( container.querySelector( '.ffxb-tcard--locked' ) ).toBeNull();
		expect( button( 'Use template', container.querySelector( '.ffxb-tcard--energy' ) as HTMLElement ) ).toBeTruthy();
	} );
} );

describe( 'template taxonomy', () => {
	it( 'names every goal and industry', () => {
		for ( const goal of TEMPLATE_GOALS ) {
			expect( goalLabel( goal ) ).not.toBe( goal );
		}
		for ( const category of TEMPLATE_CATEGORIES ) {
			expect( categoryLabel( category ) ).not.toBe( category );
		}
	} );
} );
