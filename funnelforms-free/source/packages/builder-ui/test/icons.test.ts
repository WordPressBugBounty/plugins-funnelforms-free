import { describe, expect, it } from 'vitest';
import type { IconLibrary } from '../src/api';
import { GERMAN_ICON_WORDS } from '../src/ui/iconWords';
import { searchIcons } from '../src/ui/IconPicker';

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
