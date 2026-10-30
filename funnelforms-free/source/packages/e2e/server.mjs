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
	// A backend is free again once its answer is over, also when the browser went away first (a
	// page closed while its last events were on the way); otherwise the request waits for a body
	// that never comes and keeps the backend busy for good, until every backend is stuck.
	let freed = false;
	const free = () => {
		if ( ! freed ) {
			freed = true;
			release( backend );
		}
	};
	open.set( request, `${ request.method } ${ request.url } on ${ backend.port }` );
	const forward = http.request(
		{ host: '127.0.0.1', port: backend.port, method: request.method, path: request.url, headers: { ...request.headers, connection: 'close' } },
		( answer ) => {
			response.writeHead( answer.statusCode ?? 502, answer.headers );
			answer.pipe( response );
			answer.on( 'end', free );
			answer.on( 'close', free );
		}
	);
	forward.setTimeout( 120000, () => forward.destroy( new Error( 'no answer within 120 s' ) ) );
	forward.on( 'error', ( error ) => {
		free();
		if ( ! response.headersSent ) {
			response.writeHead( 502 );
		}
		response.end( String( error ) );
	} );
	forward.on( 'close', free );
	response.on( 'close', () => {
		open.delete( request );
		if ( ! response.writableFinished ) {
			console.log( `closed by the browser after ${ Date.now() - started } ms: ${ request.method } ${ request.url }` );
			forward.destroy();
		}
		// Slow answers are worth a look after a failed run.
		if ( Date.now() - started > 5000 ) {
			console.log( `slow (${ Date.now() - started } ms): ${ request.method } ${ request.url }` );
		}
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
