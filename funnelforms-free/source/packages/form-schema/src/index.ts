import Ajv, { type ErrorObject } from 'ajv';
import schema from '../schema/form.v1.schema.json';
import type { FormDocument } from './types';
import { checkReferences } from './references';

export * from './types';
export { schema };
export { checkReferences };

const ajv = new Ajv( { allErrors: true, strict: false } );
const validateSchema = ajv.compile<FormDocument>( schema );

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validates a document against the JSON Schema and checks that every reference resolves:
 * start node, edge ends, condition fields and options, action nodes, calculation tokens and
 * unique ids. Mirrors DocumentChecker (plugin/src/Domain/Form) in the plugin.
 */
export function validateDocument( doc: unknown ): ValidationResult {
	if ( ! validateSchema( doc ) ) {
		return { valid: false, errors: ( validateSchema.errors ?? [] ).map( formatError ) };
	}
	const errors = checkReferences( doc );
	return { valid: errors.length === 0, errors };
}

function formatError( error: ErrorObject ): string {
	return `${ error.instancePath || '/' } ${ error.message ?? 'is invalid' }`;
}

