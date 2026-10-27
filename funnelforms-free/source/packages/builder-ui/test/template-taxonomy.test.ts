/**
 * One list of goals and industries for the template DSL, the plugin and the gallery, and the
 * formulas of the bundled templates read the same way in the builder.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExpressionNode } from '@funnelforms/form-schema';
import { parseFormula, printFormula } from '../src/calculations';
import { TEMPLATE_CATEGORIES, TEMPLATE_GOALS } from '../src/templateTaxonomy';

const plugin = join( __dirname, '../../../plugin' );

function phpList( name: string ): string[] {
	const source = readFileSync( join( plugin, 'src/Application/FormTemplates.php' ), 'utf8' );
	const match = new RegExp( `const ${ name } = array\\(([^)]*)\\)` ).exec( source );
	return [ ...( match?.[ 1 ] ?? '' ).matchAll( /'([a-z0-9_]+)'/g ) ].map( ( m ) => m[ 1 ] as string );
}

const templates = readdirSync( join( plugin, 'templates' ) )
	.filter( ( f ) => f.endsWith( '.json' ) && 'index.json' !== f )
	.map( ( f ) => JSON.parse( readFileSync( join( plugin, 'templates', f ), 'utf8' ) ) as { id: string; calculations?: Array<{ id: string; expression: ExpressionNode }> } );

describe( 'template taxonomy', () => {
	it( 'is the same in the plugin, the builder and the catalog of the templates', () => {
		expect( phpList( 'GOALS' ) ).toEqual( [ ...TEMPLATE_GOALS ] );
		expect( phpList( 'CATEGORIES' ) ).toEqual( [ ...TEMPLATE_CATEGORIES ] );
		const index = JSON.parse( readFileSync( join( plugin, 'templates/index.json' ), 'utf8' ) ) as { goals: string[]; categories: string[]; templates: Array<{ goal: string; category: string }> };
		expect( index.goals ).toEqual( [ ...TEMPLATE_GOALS ] );
		expect( index.categories ).toEqual( [ ...TEMPLATE_CATEGORIES ] );
		for ( const entry of index.templates ) {
			expect( TEMPLATE_GOALS ).toContain( entry.goal );
			expect( TEMPLATE_CATEGORIES ).toContain( entry.category );
		}
	} );

	it( 'gives the builder formulas it reads back unchanged', () => {
		expect( templates.length ).toBeGreaterThan( 40 );
		for ( const template of templates ) {
			for ( const calc of template.calculations ?? [] ) {
				const source = printFormula( calc.expression );
				const read = parseFormula( source );
				expect( read.ok, `${ template.id }.${ calc.id }: ${ source }` ).toBe( true );
				if ( read.ok ) {
					expect( read.expression, `${ template.id }.${ calc.id }` ).toEqual( calc.expression );
				}
			}
		}
	} );
} );
