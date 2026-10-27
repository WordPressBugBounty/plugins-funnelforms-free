// Builds the builder into the plugin (plugin/assets/builder). React comes from WordPress
// (the scripts "react" and "react-dom"), so it is not bundled; everything else is.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname( fileURLToPath( import.meta.url ) );
// FUNNELFORMS_ASSETS: another assets folder, such as the one of the Free package (tools/build-free.sh).
const out = join( process.env.FUNNELFORMS_ASSETS ?? join( here, '../../plugin/assets' ), 'builder' );
// FUNNELFORMS_EDITION=free builds Funnelforms Free: the code of Pro features is left out (src/edition.ts).
const edition = JSON.stringify( 'free' === process.env.FUNNELFORMS_EDITION ? 'free' : 'pro' );

// Imports of React resolve to the globals WordPress provides. react/jsx-runtime (used by
// @xyflow/react) is mapped onto createElement, which WordPress 6.5 has without the runtime.
const globals = {
	react: 'module.exports = window.React;',
	'react-dom': 'module.exports = window.ReactDOM;',
	'react-dom/client': 'module.exports = window.ReactDOM;',
	'react/jsx-runtime': [
		'var React = window.React;',
		'function jsx( type, props, key ) { return React.createElement( type, undefined === key ? props : Object.assign( {}, props, { key: key } ) ); }',
		'module.exports = { jsx: jsx, jsxs: jsx, Fragment: React.Fragment };',
	].join( '\n' ),
};

const wordpressReact = {
	name: 'wordpress-react',
	setup( b ) {
		b.onResolve( { filter: /^(react|react-dom|react-dom\/client|react\/jsx-runtime)$/ }, ( args ) => ( { path: args.path, namespace: 'wp-global' } ) );
		b.onLoad( { filter: /.*/, namespace: 'wp-global' }, ( args ) => ( { contents: globals[ args.path ], loader: 'js' } ) );
	},
};

mkdirSync( out, { recursive: true } );
await build( {
	entryPoints: [ join( here, 'src/admin.tsx' ) ],
	outfile: join( out, 'builder.js' ),
	bundle: true,
	minify: true,
	format: 'iife',
	target: [ 'es2019' ],
	jsx: 'transform',
	legalComments: 'none',
	define: { 'process.env.NODE_ENV': '"production"', 'process.env.FUNNELFORMS_EDITION': edition },
	plugins: [ wordpressReact ],
	banner: { js: '/*! Funnelforms builder | GPL-2.0-or-later | includes @xyflow/react (MIT), zustand (MIT), immer (MIT) */' },
} );
await build( {
	entryPoints: [ join( here, '"free"' === edition ? 'src/builder-free.css' : 'src/builder.css' ) ],
	outfile: join( out, 'builder.css' ),
	bundle: true,
	minify: true,
	external: [ '*.woff2' ],
	target: [ 'chrome90', 'firefox90', 'safari14' ],
} );

for ( const file of [ 'builder.js', 'builder.css' ] ) {
	const size = gzipSync( readFileSync( join( out, file ) ) ).length;
	console.log( `${ file }: ${ ( size / 1024 ).toFixed( 1 ) } KB gzip` );
}
writeFileSync( join( out, 'index.php' ), '<?php\n/**\n * Silence is golden.\n *\n * @package Funnelforms\n */\n' );
