import { describe, expect, it } from 'vitest';
import { textOf } from '../src/dom';

describe( 'textOf', () => {
	it( 'reads the text of HTML in an inert template, so nothing in it loads or runs', async () => {
		const seen: string[] = [];
		const original = document.createElement.bind( document );
		const spy = ( tag: string ): HTMLElement => {
			seen.push( tag );
			return original( tag );
		};
		document.createElement = spy as typeof document.createElement;
		try {
			expect( textOf( '<img src=x alt="WFPROOFc3dfdf2a" onerror="window.__ffxText=1">Geschafft, <b>Erika</b>' ) ).toBe( 'Geschafft, Erika' );
		} finally {
			document.createElement = original as typeof document.createElement;
		}
		// A detached <div> would load the image and run onerror; the content of a template is inert.
		expect( seen ).toEqual( [ 'template' ] );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		expect( ( window as unknown as { __ffxText?: number } ).__ffxText ).toBeUndefined();
		expect( textOf( 'Tom &amp; Jerry' ) ).toBe( 'Tom & Jerry' );
	} );
} );
