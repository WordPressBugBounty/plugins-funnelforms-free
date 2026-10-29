// The web server of the test site: PHP's built-in server answers one request at a time and hangs
// on the idle connections browsers open ahead, so this proxy holds the browser's connections and
// hands each whole request to one of several PHP servers that is free.
// Usage: node server.mjs <port> <document root> [PHP servers, default 4]
import { spawn } from 'node:child_process';
import http from 'node:http';

const [ port, root, count = '4' ] = process.argv.slice( 2 );
const backends = Array.from( { length: Number( count ) }, ( _, i ) => ( { port: Number( port ) + 1 + i, busy: false } ) );
const children = backends.map( ( backend ) => spawn( 'php', [ '-S', `127.0.0.1:${ backend.port }`, '-t', root ], { stdio: [ 'ignore', 'inherit', 'inherit' ] } ) );
const waiting = [];

function release( backend ) {
	backend.busy = false;
	const next = waiting.shift();
	if ( next ) {
		next( backend );
	}
}

function acquire() {
	const free = backends.find( ( backend ) => ! backend.busy );
	if ( free ) {
		free.busy = true;
		return Promise.resolve( free );
	}
	return new Promise( ( resolve ) => waiting.push( ( backend ) => {
		backend.busy = true;
		resolve( backend );
	} ) );
}

const open = new Map();

const server = http.createServer( async ( request, response ) => {
	const started = Date.now();
	const backend = await acquire();
	open.set( request, `${ request.method } ${ request.url } on ${ backend.port }` );
	response.on( 'close', () => {
		open.delete( request );
		// Slow answers are worth a look after a failed run.
		if ( Date.now() - started > 5000 ) {
			console.log( `slow (${ Date.now() - started } ms): ${ request.method } ${ request.url }` );
		}
	} );
	const forward = http.request(
		{ host: '127.0.0.1', port: backend.port, method: request.method, path: request.url, headers: { ...request.headers, connection: 'close' } },
		( answer ) => {
			response.writeHead( answer.statusCode ?? 502, answer.headers );
			answer.pipe( response );
			answer.on( 'end', () => release( backend ) );
		}
	);
	forward.on( 'error', ( error ) => {
		release( backend );
		response.writeHead( 502 );
		response.end( String( error ) );
	} );
	request.pipe( forward );
} );
server.listen( Number( port ), '127.0.0.1' );

for ( const signal of [ 'SIGINT', 'SIGTERM' ] ) {
	process.on( signal, () => {
		open.forEach( ( line ) => console.log( `open at the end: ${ line }` ) );
		children.forEach( ( child ) => child.kill() );
		process.exit( 0 );
	} );
}
