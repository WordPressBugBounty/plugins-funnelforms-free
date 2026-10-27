import type { Experiment, FormDocument } from '@funnelforms/form-schema';

/** Variant by experiment id, for one page view. */
export type Variants = Record<string, string>;

/** The variant everyone gets once an experiment is stopped: the winner, otherwise the first. */
export function settledVariant( experiment: Experiment ): string {
	return experiment.winner ?? experiment.variants[ 0 ]?.id ?? '';
}

/**
 * Variants of a page view. Running experiments draw one by weight (`random` answers [0, 1)),
 * stopped ones give the settled variant. `forced` (a preview link) wins where it names a variant
 * of a running experiment. Mirrors Experiments::resolve() in the plugin, which checks what the
 * browser sends.
 */
export function assignVariants( doc: Pick<FormDocument, 'experiments'>, random: () => number, forced: Variants = {} ): Variants {
	const out: Variants = {};
	for ( const experiment of doc.experiments ?? [] ) {
		const wanted = forced[ experiment.id ];
		if ( experiment.status !== 'running' ) {
			out[ experiment.id ] = settledVariant( experiment );
		} else if ( wanted !== undefined && experiment.variants.some( ( v ) => v.id === wanted ) ) {
			out[ experiment.id ] = wanted;
		} else {
			out[ experiment.id ] = draw( experiment, random() );
		}
	}
	return out;
}

function draw( experiment: Experiment, r: number ): string {
	const total = experiment.variants.reduce( ( sum, v ) => sum + Math.max( 0, v.weight ), 0 );
	let point = r * total;
	for ( const variant of experiment.variants ) {
		if ( variant.weight > 0 && point < variant.weight ) {
			return variant.id;
		}
		point -= Math.max( 0, variant.weight );
	}
	return settledVariant( experiment );
}

/**
 * The node the form starts at: the start of a variant shown (tests of whole funnels), otherwise
 * the document's. Mirrors Experiments::start() in the plugin.
 */
export function startNode( doc: Pick<FormDocument, 'start' | 'experiments'>, variants: Variants ): string {
	for ( const experiment of doc.experiments ?? [] ) {
		const start = experiment.variants.find( ( v ) => v.id === variants[ experiment.id ] )?.start;
		if ( start !== undefined ) {
			return start;
		}
	}
	return doc.start;
}
