/**
 * Live results that wait for the contact step (ResultField reveal "contact"): the plugin shows them
 * only after the contact step, so the thank-you page (or the mail to the visitor) has to show them.
 */
import type { FormDocument, ResultField, ResultLine } from '@funnelforms/form-schema';

/** The placeholders of a line: "{{calc:a}}", or "{{calc:a}} – {{calc:b}}" for a range, or the text of the range. */
export function lineTokens( line: ResultLine ): string {
	if ( line.text ) {
		return `{{calc:${ line.calculation }:text}}`;
	}
	return line.to ? `{{calc:${ line.calculation }}} – {{calc:${ line.to }}}` : `{{calc:${ line.calculation }}}`;
}

/** Whether a thank-you page or a mail to the visitor shows the main result of the field. */
export function revealedLater( doc: FormDocument, field: ResultField ): boolean {
	const main = field.props.lines[ 0 ];
	if ( ! main ) {
		return true;
	}
	const token = `{{calc:${ main.calculation }`;
	return (
		doc.nodes.some( ( n ) => 'end' === n.type && n.success?.show !== false && JSON.stringify( n.success?.text ?? {} ).includes( token ) ) ||
		doc.actions.some( ( a ) => 'autoresponder' === a.kind && JSON.stringify( a.config.body ).includes( token ) )
	);
}

/**
 * Adds the lines of the field to every thank-you page without them, at the end of its text in the
 * given language: "Label: <strong>1.200 € – 1.500 €</strong>". Returns how many pages changed.
 */
export function revealOnEndPages( doc: FormDocument, field: ResultField, locale: string ): number {
	const main = field.props.lines[ 0 ];
	if ( ! main ) {
		return 0;
	}
	const html = field.props.lines
		.map( ( line ) => {
			const label = ( line.label[ locale ] ?? Object.values( line.label )[ 0 ] ?? '' ).replace( /<[^>]*>|[<>&"]/g, '' ).trim();
			return `<p>${ label ? label + ': ' : '' }<strong>${ line.prefix ?? '' }${ lineTokens( line ) }${ line.suffix ?? '' }</strong></p>`;
		} )
		.join( '\n' );
	let changed = 0;
	for ( const node of doc.nodes ) {
		if ( 'end' !== node.type || ( node.redirect && ! node.success ) || JSON.stringify( node.success?.text ?? {} ).includes( `{{calc:${ main.calculation }` ) ) {
			continue;
		}
		const success = { ...( node.success ?? { show: true, text: {} } ), show: true };
		const before = success.text[ locale ]?.trimEnd() ?? '';
		success.text = { ...success.text, [ locale ]: ( before ? before + '\n' : '' ) + html };
		node.success = success;
		changed++;
	}
	return changed;
}
