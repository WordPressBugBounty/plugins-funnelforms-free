import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IconLibrary } from '../src/api';
import { iconGroups } from '../src/ui/iconGroups';
import { GERMAN_ICON_WORDS } from '../src/ui/iconWords';
import { searchIcons, suggestIcons } from '../src/ui/IconPicker';

const library: IconLibrary = {
	version: '1',
	icons: { house: [], 'house-plus': [], truck: [], car: [], 'car-taxi-front': [], heart: [], 'map-pin': [], warehouse: [] },
	tags: { truck: 'delivery van shipping haulage lorry', warehouse: 'storage logistics building', 'map-pin': 'location waypoint marker drop' },
};

describe( 'searchIcons', () => {
	it( 'ranks the name, its start, parts of names and then tags', () => {
		expect( searchIcons( library, 'house' ) ).toEqual( [ 'house', 'house-plus', 'warehouse' ] );
		expect( searchIcons( library, 'storage' ) ).toEqual( [ 'warehouse' ] );
		expect( searchIcons( library, '' ) ).toHaveLength( 8 );
	} );

	it( 'finds icons by German words and their starts', () => {
		expect( searchIcons( library, 'Haus' ) ).toEqual( [ 'house', 'house-plus', 'warehouse' ] );
		expect( searchIcons( library, 'Umzug' ) ).toEqual( [ 'truck' ] );
		expect( searchIcons( library, 'Adre' ) ).toEqual( [ 'map-pin' ] );
		expect( searchIcons( library, 'Garage' ) ).toEqual( [ 'warehouse' ] );
		expect( searchIcons( library, 'Taxi' ) ).toEqual( [ 'car-taxi-front' ] );
	} );

	it( 'lists the German words in lowercase, with umlauts also written out', () => {
		const words = Object.keys( GERMAN_ICON_WORDS );
		expect( words.every( ( w ) => w === w.toLowerCase() ) ).toBe( true );
		expect( GERMAN_ICON_WORDS[ 'schlüssel' ] ).toBe( GERMAN_ICON_WORDS.schluessel );
		expect( GERMAN_ICON_WORDS[ 'küche' ] ).toBe( GERMAN_ICON_WORDS.kueche );
	} );
} );

describe( 'suggestIcons', () => {
	it( 'suggests icons for the words of an answer, a German compound also by its last part', () => {
		expect( suggestIcons( library, 'Einfamilienhaus' ) ).toEqual( [ 'house', 'house-plus', 'warehouse' ] );
		expect( suggestIcons( library, 'Umzug mit Auto' ) ).toEqual( [ 'truck', 'car', 'car-taxi-front' ] );
		expect( suggestIcons( library, 'Ja' ) ).toEqual( [] );
	} );
} );

describe( 'iconGroups', () => {
	it( 'names only icons of the Lucide set the plugin ships, each once per group', () => {
		const shipped = JSON.parse( readFileSync( join( __dirname, '../../../plugin/assets/icons/lucide.json' ), 'utf8' ) ) as IconLibrary;
		const groups = iconGroups();
		expect( groups.length ).toBeGreaterThanOrEqual( 10 );
		for ( const g of groups ) {
			expect( g.icons.filter( ( name ) => ! ( name in shipped.icons ) ), g.id ).toEqual( [] );
			expect( new Set( g.icons ).size, g.id ).toBe( g.icons.length );
		}
	} );
} );
