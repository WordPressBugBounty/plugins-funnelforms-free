// Builds the runtime into the plugin (plugin/assets/runtime) and enforces the size budget of
// the target architecture: under 35 KB gzip for script and style together. The style of field
// types not every form has (runtime-more.css) is loaded only by the forms that use them and has
// a budget of its own, like the field chunks of the target architecture.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname( fileURLToPath( import.meta.url ) );
// FUNNELFORMS_ASSETS: another assets folder, such as the one of the Free package (tools/build-free.sh).
const out = join( process.env.FUNNELFORMS_ASSETS ?? join( here, '../../plugin/assets' ), 'runtime' );
// FUNNELFORMS_EDITION=free builds Funnelforms Free: the code of Pro features is left out (src/edition.ts).
const edition = JSON.stringify( 'free' === process.env.FUNNELFORMS_EDITION ? 'free' : 'pro' );
const budget = 35 * 1024;
const chunkBudget = 15 * 1024;

mkdirSync( out, { recursive: true } );
await build( {
	entryPoints: [ join( here, 'src/index.ts' ) ],
	outfile: join( out, 'runtime.js' ),
	bundle: true,
	minify: true,
	format: 'iife',
	// Browsers older than ES2021 cannot apply runtime.css either (@layer: Chrome 99, Safari 15.4,
	// Firefox 97); writing ?., ?? and ??= out for them only made the script bigger.
	target: [ 'es2021' ],
	legalComments: 'none',
	define: { 'process.env.FUNNELFORMS_EDITION': edition },
	banner: { js: '/*! Funnelforms runtime | GPL-2.0-or-later */' },
} );
// Scripts of features not every form has (src/chunks/<name>.ts → runtime-<name>.js), loaded only
// by the forms that use them (Frontend\Renderer::chunks(), styles.ts addPart()); each has the
// budget of a chunk. Funnelforms Free has only those of its own features. The Pro field types
// address, booking and repeat have chunks of the same name (fields.ts later()).
const chunks = 'free' === process.env.FUNNELFORMS_EDITION ? [ 'phone', 'recaptcha3' ] : [ 'live', 'phone', 'recaptcha3', 'abandon', 'address', 'booking', 'repeat' ];
for ( const name of chunks ) {
	await build( {
		entryPoints: [ join( here, 'src/chunks', name + '.ts' ) ],
		outfile: join( out, `runtime-${ name }.js` ),
		bundle: true,
		minify: true,
		format: 'iife',
		target: [ 'es2021' ],
		legalComments: 'none',
		define: { 'process.env.FUNNELFORMS_EDITION': edition },
		banner: { js: '/*! Funnelforms runtime | GPL-2.0-or-later */' },
	} );
}
for ( const style of [ 'runtime.css', 'runtime-more.css' ] ) {
	await build( {
		entryPoints: [ join( here, 'src', style ) ],
		outfile: join( out, style ),
		bundle: true,
		minify: true,
		target: [ 'chrome90', 'firefox90', 'safari14' ],
	} );
}

let total = 0;
for ( const file of [ 'runtime.js', 'runtime.css' ] ) {
	const size = gzipSync( readFileSync( join( out, file ) ) ).length;
	total += size;
	console.log( `${ file }: ${ ( size / 1024 ).toFixed( 1 ) } KB gzip` );
}
const more = gzipSync( readFileSync( join( out, 'runtime-more.css' ) ) ).length;
console.log( `runtime-more.css: ${ ( more / 1024 ).toFixed( 1 ) } KB gzip, when a form needs it` );
for ( const name of chunks ) {
	const size = gzipSync( readFileSync( join( out, `runtime-${ name }.js` ) ) ).length;
	console.log( `runtime-${ name }.js: ${ ( size / 1024 ).toFixed( 1 ) } KB gzip, when a form needs it` );
	if ( size > chunkBudget ) {
		console.error( `runtime-${ name }.js is ${ ( size / 1024 ).toFixed( 1 ) } KB gzip, over the budget of 15 KB.` );
		process.exit( 1 );
	}
}
writeFileSync( join( out, 'index.php' ), '<?php\n/**\n * Silence is golden.\n *\n * @package Funnelforms\n */\n' );
if ( total > budget ) {
	console.error( `Runtime is ${ ( total / 1024 ).toFixed( 1 ) } KB gzip, over the budget of 35 KB.` );
	process.exit( 1 );
}
if ( more > chunkBudget ) {
	console.error( `runtime-more.css is ${ ( more / 1024 ).toFixed( 1 ) } KB gzip, over the budget of 15 KB.` );
	process.exit( 1 );
}
