import type { FormDocument } from '@funnelforms/form-schema';

/**
 * Progress of a node between 0 and 1: its depth on the longest path from the start, relative
 * to the deepest contact node (or end node in forms without one). 3.x showed the column of the node in the same way, so
 * long jumps move the bar further.
 */
export function progressMap( doc: Pick<FormDocument, 'start' | 'nodes' | 'edges'> ): Map<string, number> {
	const out = new Map<string, number>();
	const targets = new Map<string, string[]>();
	for ( const edge of doc.edges ) {
		targets.set( edge.from, [ ...( targets.get( edge.from ) ?? [] ), edge.to ] );
	}

	const depth = new Map<string, number>();
	const visit = ( id: string, d: number, path: Set<string> ): void => {
		if ( path.has( id ) || ( depth.get( id ) ?? -1 ) >= d ) {
			return;
		}
		depth.set( id, d );
		path.add( id );
		for ( const to of targets.get( id ) ?? [] ) {
			visit( to, d + 1, path );
		}
		path.delete( id );
	};
	visit( doc.start, 0, new Set() );

	// The contact step is 100 %; forms without one end at their deepest end node.
	const hasContact = doc.nodes.some( ( node ) => node.type === 'contact' );
	let max = 0;
	for ( const node of doc.nodes ) {
		if ( node.type === ( hasContact ? 'contact' : 'end' ) ) {
			max = Math.max( max, depth.get( node.id ) ?? 0 );
		}
	}
	for ( const node of doc.nodes ) {
		const d = depth.get( node.id ) ?? 0;
		out.set( node.id, node.type === 'step' && max > 0 ? Math.min( 1, d / max ) : 1 );
	}
	return out;
}
