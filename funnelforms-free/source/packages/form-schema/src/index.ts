import Ajv, { type ErrorObject } from 'ajv';
import schema from '../schema/form.v1.schema.json';
import type { CalcFunction, Condition, ExpressionNode, FormDocument } from './types';

export * from './types';
export { schema };

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

/** Fields that may be shown on the website: no contact details, files or free HTML. Mirrors DocumentChecker. */
const PUBLIC_FIELD_TYPES = [ 'choice', 'dropdown', 'text', 'textarea', 'slider', 'rating', 'number', 'date', 'time' ].map( ( t ) => `step:${ t }` ).concat( [ 'contact:name', 'contact:text' ] );

export function checkReferences( doc: FormDocument ): string[] {
	const errors: string[] = [];
	const nodeIds = new Set<string>();
	const fieldIds = new Map<string, Set<string>>();
	const keys = new Set<string>();
	const types = new Map<string, string>();
	const shownWhen: Array<{ field: string; when: Condition }> = [];

	for ( const node of doc.nodes ) {
		if ( nodeIds.has( node.id ) ) {
			errors.push( `duplicate node id ${ node.id }` );
		}
		nodeIds.add( node.id );
		if ( node.type === 'end' ) {
			continue;
		}
		for ( const field of node.fields ) {
			if ( fieldIds.has( field.id ) ) {
				errors.push( `duplicate field id ${ field.id }` );
			}
			const options = 'options' in field ? field.options.map( ( o ) => o.id ) : [];
			fieldIds.set( field.id, new Set( options ) );
			if ( field.type === 'content' && field.props.loader && ( ! field.props.autoAdvanceMs || field.props.button.show ) ) {
				errors.push( `field ${ field.id } shows a loader but does not move on by itself` );
			}
			const phone = field.props as { country?: { default?: string; allowed?: string[] }; sms?: { connectionRef?: string } };
			if ( phone.country?.default && phone.country.allowed?.length && ! phone.country.allowed.includes( phone.country.default ) ) {
				errors.push( `field ${ field.id } starts with a country it does not allow` );
			}
			if ( node.type === 'contact' && ( field.type === 'phone_verification' || ( field.type === 'phone' && phone.sms ) ) && ! phone.sms?.connectionRef ) {
				errors.push( `field ${ field.id } confirms numbers by text message without an SMS connection` );
			}
			types.set( field.id, `${ node.type }:${ field.type }` );
			keys.add( field.key );
			if ( 'showWhen' in field && field.showWhen ) {
				shownWhen.push( { field: field.id, when: field.showWhen } );
			}
			if ( field.type === 'repeat' ) {
				const itemIds = new Set<string>();
				for ( const item of field.props.fields ) {
					if ( itemIds.has( item.id ) ) {
						errors.push( `duplicate field id ${ item.id } in repeat group ${ field.id }` );
					}
					itemIds.add( item.id );
				}
			}
		}
	}

	if ( ! nodeIds.has( doc.start ) ) {
		errors.push( `start node ${ doc.start } does not exist` );
	}

	/** Checks what a condition of an edge or field ("edge e1", "field q1") refers to. */
	const checkCondition = ( condition: Condition, owner: string ): void => {
		if ( 'all' in condition || 'any' in condition ) {
			const list = 'all' in condition ? condition.all : condition.any;
			list.forEach( ( c ) => checkCondition( c, owner ) );
			return;
		}
		if ( 'calc' in condition ) {
			if ( ! doc.calculations.some( ( c ) => c.id === condition.calc ) ) {
				errors.push( `${ owner } refers to unknown calculation ${ condition.calc }` );
			}
			return;
		}
		if ( 'experiment' in condition ) {
			const experiment = ( doc.experiments ?? [] ).find( ( e ) => e.id === condition.experiment );
			if ( ! experiment ) {
				errors.push( `${ owner } refers to unknown experiment ${ condition.experiment }` );
			} else if ( ! experiment.variants.some( ( v ) => v.id === condition.variant ) ) {
				errors.push( `${ owner } refers to unknown variant ${ condition.variant } of experiment ${ condition.experiment }` );
			}
			return;
		}
		const options = fieldIds.get( condition.field );
		if ( ! options ) {
			errors.push( `${ owner } refers to unknown field ${ condition.field }` );
		} else if ( ( condition.op === 'selected' || condition.op === 'selectedOnly' ) && ! options.has( condition.value ) ) {
			errors.push( `${ owner } refers to unknown option ${ condition.value }` );
		}
	};

	const nodeTypes = new Map( doc.nodes.map( ( n ) => [ n.id, n.type ] ) );
	errors.push( ...checkExperiments( doc, nodeTypes ) );

	// Fields are shown in the browser, which knows the answers but not the calculations.
	for ( const { field, when } of shownWhen ) {
		checkCondition( when, `field ${ field }` );
		if ( usesCalculation( when ) ) {
			errors.push( `field ${ field } is shown by a calculation` );
		}
		if ( conditionFields( when ).includes( field ) ) {
			errors.push( `field ${ field } is shown by its own answer` );
		}
	}

	const edgeIds = new Set<string>();
	for ( const edge of doc.edges ) {
		if ( edgeIds.has( edge.id ) ) {
			errors.push( `duplicate edge id ${ edge.id }` );
		}
		edgeIds.add( edge.id );
		if ( ! nodeIds.has( edge.from ) || ! nodeIds.has( edge.to ) ) {
			errors.push( `edge ${ edge.id } connects unknown nodes` );
		} else if ( nodeTypes.get( edge.from ) === 'end' ) {
			errors.push( `edge ${ edge.id } leaves an end node` );
		}
		if ( edge.when ) {
			checkCondition( edge.when, `edge ${ edge.id }` );
		}
	}

	const calcIds = new Set<string>();
	for ( const calc of doc.calculations ) {
		if ( calcIds.has( calc.id ) ) {
			errors.push( `duplicate calculation id ${ calc.id }` );
		}
		calcIds.add( calc.id );
	}

	const actionIds = new Set<string>();
	for ( const action of doc.actions ) {
		if ( actionIds.has( action.id ) ) {
			errors.push( `duplicate action id ${ action.id }` );
		}
		actionIds.add( action.id );
		if ( action.node !== undefined && ! nodeIds.has( action.node ) ) {
			errors.push( `action ${ action.id } refers to unknown node ${ action.node }` );
		}
		if ( action.when ) {
			checkCondition( action.when, `action ${ action.id }` );
		}
	}

	const used = new Set<string>();
	JSON.stringify( doc, ( _key, value: unknown ) => {
		if ( typeof value === 'string' ) {
			for ( const match of value.matchAll( /\{\{calc:([A-Za-z0-9_-]+)(?::text)?\}\}/g ) ) {
				used.add( match[ 1 ] ?? '' );
			}
		}
		return value;
	} );
	for ( const calcId of used ) {
		if ( ! calcIds.has( calcId ) ) {
			errors.push( `token refers to unknown calculation ${ calcId }` );
		}
	}
	for ( const node of doc.nodes ) {
		for ( const field of node.type === 'step' ? node.fields : [] ) {
			for ( const line of field.type === 'result' ? field.props.lines : [] ) {
				for ( const id of new Set( [ line.calculation, line.to ?? line.calculation ] ) ) {
					if ( ! calcIds.has( id ) ) {
						errors.push( `field ${ field.id } refers to unknown calculation ${ id }` );
					}
				}
			}
		}
	}
	for ( const action of doc.actions ) {
		if ( ( action.kind === 'conversion' || action.kind === 'googleAds' ) && action.config.valueCalculation !== undefined && ! calcIds.has( action.config.valueCalculation ) ) {
			errors.push( `action ${ action.id } refers to unknown calculation ${ action.config.valueCalculation }` );
		}
	}
	const optIn = doc.settings.doubleOptIn?.field;
	if ( optIn !== undefined && types.get( optIn ) !== 'contact:email' ) {
		errors.push( `double opt-in refers to unknown e-mail field ${ optIn }` );
	}
	const abandon = doc.settings.abandonment;
	if ( abandon && types.get( abandon.field ) !== 'contact:email' ) {
		errors.push( `abandonment refers to unknown e-mail field ${ abandon.field }` );
	}
	if ( abandon && ( abandon.consentField !== undefined || abandon.basis === 'consent' ) && ! [ 'contact:consent', 'contact:checkbox' ].includes( types.get( abandon.consentField ?? '' ) ?? '' ) ) {
		errors.push( `abandonment refers to unknown consent field ${ abandon.consentField ?? '' }` );
	}
	const shown = doc.settings.publicEntries;
	for ( const id of shown?.fields ?? [] ) {
		if ( ! PUBLIC_FIELD_TYPES.includes( types.get( id ) ?? '' ) ) {
			errors.push( `public entries show unknown or unsuitable field ${ id }` );
		}
	}
	if ( shown?.consentField !== undefined && types.get( shown.consentField ) !== 'contact:consent' ) {
		errors.push( `public entries refer to unknown consent field ${ shown.consentField }` );
	}
	const score = doc.settings.scoreCalculation;
	if ( score !== undefined && ! calcIds.has( score ) ) {
		errors.push( `score refers to unknown calculation ${ score }` );
	}
	const leadValue = doc.settings.valueCalculation;
	if ( leadValue !== undefined && ! calcIds.has( leadValue ) ) {
		errors.push( `lead value refers to unknown calculation ${ leadValue }` );
	}
	const quiz = doc.settings.quiz;
	if ( quiz && ! calcIds.has( quiz.calculation ) ) {
		errors.push( `quiz refers to unknown calculation ${ quiz.calculation }` );
	}
	for ( const result of quiz?.results ?? [] ) {
		if ( nodeTypes.get( result.node ) !== 'end' ) {
			errors.push( `quiz result is not an end node: ${ result.node }` );
		}
	}
	errors.push( ...checkPayment( doc, calcIds, types, nodeTypes ) );
	errors.push( ...checkFeatures( doc, types ) );

	return errors;
}

/** Whether a condition compares the result of a calculation. */
function usesCalculation( condition: Condition ): boolean {
	return 'all' in condition ? condition.all.some( usesCalculation ) : 'any' in condition ? condition.any.some( usesCalculation ) : 'calc' in condition;
}

/** Ids of the fields a condition asks for. */
function conditionFields( condition: Condition ): string[] {
	return 'all' in condition ? condition.all.flatMap( conditionFields ) : 'any' in condition ? condition.any.flatMap( conditionFields ) : 'field' in condition ? [ condition.field ] : [];
}

/** Payment: what it refers to exists, and the mode has what it needs. Mirrors DocumentChecker. */
function checkPayment( doc: FormDocument, calcIds: Set<string>, types: Map<string, string>, nodeTypes: Map<string, string> ): string[] {
	const errors: string[] = [];
	const payment = doc.settings.payment;
	if ( payment === undefined ) {
		for ( const action of doc.actions ) {
			if ( action.on === 'paid' ) {
				errors.push( `action ${ action.id } waits for a payment but the form takes none` );
			}
		}
		return errors;
	}
	if ( 'calculation' in payment.amount && ! calcIds.has( payment.amount.calculation ) ) {
		errors.push( `payment refers to unknown calculation ${ payment.amount.calculation }` );
	}
	if ( payment.emailField !== undefined && types.get( payment.emailField ) !== 'contact:email' ) {
		errors.push( `payment refers to unknown e-mail field ${ payment.emailField }` );
	}
	if ( payment.node !== undefined && nodeTypes.get( payment.node ) !== 'contact' ) {
		errors.push( `payment refers to unknown contact node ${ payment.node }` );
	}
	if ( payment.mode === 'deposit' && payment.depositPercent === undefined ) {
		errors.push( 'deposit payment needs depositPercent' );
	}
	if ( payment.mode === 'subscription' && payment.interval === undefined ) {
		errors.push( 'subscription payment needs an interval' );
	}
	if ( payment.mode === 'subscription' && ! payment.connection.startsWith( 'stripe:' ) ) {
		errors.push( 'subscription payment needs a Stripe connection' );
	}
	return errors;
}

/** A/B tests: unique ids, existing start nodes and winner, a weight to draw by. Mirrors DocumentChecker. */
function checkExperiments( doc: FormDocument, nodeTypes: Map<string, string> ): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	let starting = '';
	for ( const experiment of doc.experiments ?? [] ) {
		if ( ids.has( experiment.id ) ) {
			errors.push( `duplicate experiment id ${ experiment.id }` );
		}
		ids.add( experiment.id );
		const variantIds = new Set<string>();
		for ( const variant of experiment.variants ) {
			if ( variantIds.has( variant.id ) ) {
				errors.push( `duplicate variant id ${ variant.id } in experiment ${ experiment.id }` );
			}
			variantIds.add( variant.id );
			const type = variant.start === undefined ? null : nodeTypes.get( variant.start );
			if ( variant.start !== undefined && ( type === undefined || type === 'end' ) ) {
				errors.push( `experiment ${ experiment.id } starts variant ${ variant.id } at unknown node ${ variant.start }` );
			}
		}
		if ( experiment.winner !== undefined && ! variantIds.has( experiment.winner ) ) {
			errors.push( `experiment ${ experiment.id } has no variant ${ experiment.winner }` );
		}
		if ( experiment.suggested !== undefined && ! variantIds.has( experiment.suggested ) ) {
			errors.push( `experiment ${ experiment.id } has no variant ${ experiment.suggested }` );
		}
		if ( experiment.status === 'running' && ! experiment.variants.some( ( v ) => v.weight > 0 ) ) {
			errors.push( `experiment ${ experiment.id } has no variant with a weight` );
		}
		if ( experiment.variants.some( ( v ) => v.start !== undefined ) ) {
			if ( starting !== '' ) {
				errors.push( `experiments ${ starting } and ${ experiment.id } both set start nodes` );
			}
			starting ||= experiment.id;
		}
	}
	return errors;
}

/** Arguments the functions of calculations take (at least, at most); Calculator::FUNCTIONS in the plugin. */
const ARITY: Record<CalcFunction, [ number, number ]> = { round: [ 1, 2 ], floor: [ 1, 2 ], ceil: [ 1, 2 ], abs: [ 1, 1 ], sqrt: [ 1, 1 ], not: [ 1, 1 ], if: [ 2, 3 ], min: [ 1, 50 ], max: [ 1, 50 ], sum: [ 1, 50 ], avg: [ 1, 50 ], and: [ 1, 50 ], or: [ 1, 50 ], argmax: [ 1, 50 ], clamp: [ 3, 3 ], lookup: [ 4, 50 ], days: [ 1, 2 ], age: [ 1, 2 ] };

function walkExpression( node: ExpressionNode, visit: ( n: ExpressionNode ) => void ): void {
	visit( node );
	( 'neg' in node ? [ node.neg ] : 'args' in node ? node.args : [] ).forEach( ( c ) => walkExpression( c, visit ) );
}

/** Calculations with functions and results of others, personality quizzes and coupons. Mirrors DocumentChecker::check_features(). */
function checkFeatures( doc: FormDocument, types: Map<string, string> ): string[] {
	const errors: string[] = [];
	const refs = new Map<string, string[]>();
	for ( const calc of doc.calculations ) {
		const list: string[] = [];
		walkExpression( calc.expression, ( n ) => 'ref' in n && list.push( n.ref ) );
		refs.set( calc.id, list );
	}
	for ( const calc of doc.calculations ) {
		for ( const ref of refs.get( calc.id ) ?? [] ) {
			if ( ! refs.has( ref ) ) {
				errors.push( `calculation ${ calc.id } refers to unknown calculation ${ ref }` );
			}
		}
		const seen = new Set<string>();
		const todo = [ ...( refs.get( calc.id ) ?? [] ) ];
		for ( let ref = todo.pop(); ref !== undefined; ref = todo.pop() ) {
			if ( ref === calc.id ) {
				errors.push( `calculation ${ calc.id } uses itself` );
				break;
			}
			if ( ! seen.has( ref ) ) {
				seen.add( ref );
				todo.push( ...( refs.get( ref ) ?? [] ) );
			}
		}
		walkExpression( calc.expression, ( n ) => {
			if ( 'fn' in n ) {
				const [ least, most ] = ARITY[ n.fn ];
				// lookup takes pairs of limit and value between the number and the value for anything above.
				if ( n.args.length < least || n.args.length > most || ( n.fn === 'lookup' && n.args.length % 2 ) ) {
					errors.push( `calculation ${ calc.id } calls ${ n.fn } with ${ n.args.length } arguments` );
				}
			}
		} );
	}
	const quiz = doc.settings.quiz;
	if ( quiz?.kind === 'personality' ) {
		const categories = ( quiz.categories ?? [] ).map( ( c ) => c.id );
		if ( new Set( categories ).size !== categories.length ) {
			errors.push( 'quiz has duplicate categories' );
		}
		for ( const result of quiz.results ) {
			if ( ! categories.includes( result.category ?? '' ) ) {
				errors.push( `quiz result ${ result.node } has no category of the quiz` );
			}
		}
	}
	const payment = doc.settings.payment;
	if ( payment ) {
		if ( payment.couponField !== undefined && ! [ 'step:text', 'contact:text' ].includes( types.get( payment.couponField ) ?? '' ) ) {
			errors.push( `payment refers to unknown coupon field ${ payment.couponField }` );
		}
		const codes = ( payment.coupons ?? [] ).map( ( c ) => c.code.toLowerCase() );
		if ( new Set( codes ).size !== codes.length ) {
			errors.push( 'payment has duplicate coupon codes' );
		}
		for ( const coupon of payment.coupons ?? [] ) {
			if ( ( coupon.percent === undefined ) === ( coupon.amount === undefined ) ) {
				errors.push( `coupon ${ coupon.code } needs either percent or amount` );
			}
		}
	}
	return errors;
}
