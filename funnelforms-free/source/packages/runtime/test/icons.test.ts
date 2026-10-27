import { describe, expect, it } from 'vitest';
import type { ContactField } from '@funnelforms/form-schema';
import { FormApp } from '../src/app';
import { renderContactField, type ContactContext } from '../src/contact';
import { lucideIcon, type IconSet } from '../src/icons';
import type { RuntimeConfig } from '../src/types';

const de = ( text: string ): Record<string, string> => ( { de_DE: text } );

const icons: IconSet = {
	house: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 10 12 3l9 7"/></svg>',
	mail: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>',
};

describe( 'Lucide icons', () => {
	it( 'puts the icon the plugin built into a span', () => {
		const icon = lucideIcon( icons, 'house', 'x' );
		expect( icon?.className ).toBe( 'x' );
		expect( icon?.firstElementChild?.namespaceURI ).toBe( 'http://www.w3.org/2000/svg' );
		expect( icon?.querySelector( 'path' )?.getAttribute( 'd' ) ).toBe( 'M3 10 12 3l9 7' );
		expect( lucideIcon( icons, 'missing', 'x' ) ).toBeNull();
		expect( lucideIcon( icons, 'constructor', 'x' ) ).toBeNull();
		expect( lucideIcon( undefined, 'house', 'x' ) ).toBeNull();
	} );

	it( 'shows icons of answers and contact fields', () => {
		const config: RuntimeConfig = {
			uid: 'f1',
			endpoint: 'https://example.org/wp-json/funnelforms/v1/forms/f1',
			locale: 'de_DE',
			strings: { next: 'Weiter' },
			icons,
			document: {
				schemaVersion: 1,
				id: 'frm_1',
				locales: { default: 'de_DE', available: [ 'de_DE' ] },
				start: 'n1',
				nodes: [
					{
						id: 'n1',
						type: 'step',
						fields: [
							{
								id: 'q1',
								key: 'q1',
								type: 'choice',
								label: de( 'Wofür?' ),
								description: de( '' ),
								required: true,
								options: [
									{ id: 'o1', label: de( 'Haus' ), value: 'Haus', media: { kind: 'lucide', value: 'house' } },
									{ id: 'o2', label: de( 'Wohnung' ), value: 'Wohnung', media: { kind: 'lucide', value: 'building' } },
									{ id: 'o3', label: de( 'Alt' ), value: 'Alt', media: { kind: 'icon', value: 'fas fa-home' } },
								],
								props: { multiple: false, layout: { desktop: 'grid', mobile: 'grid' }, hideIcons: false },
							},
						],
					},
				],
				edges: [],
				calculations: [],
				style: { tokens: {} },
				settings: { uiLocale: 'de_DE', progressBar: { show: false }, loadingAnimation: false, scrollToTop: { desktop: false, mobile: false }, rtl: false, autoHeight: false, iconFont: false, savePartialEntries: false },
			},
		} as unknown as RuntimeConfig;
		const root = document.createElement( 'div' );
		document.body.append( root );
		new FormApp( root, config, { url: 'https://example.org/', query: '', title: '' } );
		const options = root.querySelectorAll( '.ffx-option' );
		expect( options[ 0 ]?.querySelector( '.ffx-option-icon.ffx-option-svg svg' ) ).not.toBeNull();
		expect( options[ 1 ]?.querySelector( 'svg' ) ).toBeNull();
		expect( options[ 2 ]?.querySelector( 'i' ) ).toBeNull();
		root.remove();

		const ctx: ContactContext = { text: ( v ) => v?.de_DE ?? '', t: ( k ) => k, get: () => '', set: () => undefined, iconFont: false, icons };
		const field = ( icon: string ): ContactField => ( { id: 'c1', key: 'email', type: 'email', label: de( 'E-Mail' ), required: true, props: { icon } } );
		const lucide = renderContactField( field( 'lucide:mail' ), ctx ).el;
		expect( lucide.querySelector( '.ffx-has-icon .ffx-input-icon.ffx-input-svg svg circle' ) ).not.toBeNull();
		expect( renderContactField( field( 'fas fa-envelope' ), ctx ).el.querySelector( '.ffx-input-icon' ) ).toBeNull();
		expect( renderContactField( field( 'fas fa-envelope' ), { ...ctx, iconFont: true } ).el.querySelector( 'i.ffx-input-icon.fa-envelope' ) ).not.toBeNull();
		expect( renderContactField( field( 'lucide:missing' ), ctx ).el.querySelector( '.ffx-has-icon' ) ).toBeNull();
	} );
} );
