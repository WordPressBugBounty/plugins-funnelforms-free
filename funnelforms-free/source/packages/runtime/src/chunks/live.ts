/**
 * Live results (Funnelforms Pro), the script runtime-live.js. Only forms that show calculation
 * results next to their questions load it (data-ffx-chunks, Frontend\Renderer::chunks()); the core
 * tells it of every new step and answer (FormApp.live()).
 *
 * The formulas stay on the server. After the visitor changes an answer, this asks POST calculations
 * (with live: true) once the input rests for DELAY ms, drops the answer of a request that was
 * overtaken, keeps the last results while it waits and counts up to the new numbers. It draws the
 * live result fields (ResultField): a card in the step, or one box that stays from its step on, at
 * the bottom of the screen on phones (above the bottom bar), below the steps on wider screens and
 * beside them where the form is wide enough (runtime-more.css).
 *
 * A result waits with "–" while a required question it uses (PublicDocument: uses) is still open
 * on this step or on a step the visitor can still reach, so nobody sees a price of 0 or one that
 * jumps once the deciding answer comes; questions left behind or skipped count as 0, as on the
 * server, and optional ones count as 0 until answered, so extras add up live. The {{calc:…}} texts
 * of the steps and the end are filled here too (FormApp.fillCalcs() leaves them to this script),
 * in the same request as the boxes; a step that shows the result of the box that stays as text
 * hides the box, so the result shows once.
 *
 * A line with `text` shows the text of the range its result lies in (the plugin answers it for
 * "<id>:text"). A box with reveal "contact" stays locked: blurred placeholders and a teaser, no
 * request at all; the plugin would not answer its numbers before the contact step either.
 */
import type { CalculationFormat, ResultField, ResultLine } from '@funnelforms/form-schema';
import type { FormApp } from '../app';
import { h, trusted } from '../dom';
import { take } from './hub';

/** How long the input rests before the results are asked for, in ms. */
export const DELAY = 250;

/** How long the numbers count up to a new result, in ms. */
const COUNT_MS = 400;

/** What the plugin answers to POST calculations with live: true. */
interface Answer {
	calculations?: Record<string, string>;
	values?: Record<string, number | null>;
}

/** One line of a box: its result, as last shown. */
interface Row {
	line: ResultLine;
	label: HTMLElement;
	value: HTMLElement;
	/** The numbers on screen (one, or two for a range); null before the first result. */
	shown: number[] | null;
	frame: number;
}

interface Box {
	field: ResultField;
	el: HTMLElement;
	rows: Row[];
	/** Read out politely when the result changes. */
	status: HTMLElement;
	/** Shown only after the contact step (reveal "contact"). */
	locked: boolean;
}

/** What a locked box shows instead of a result, blurred. */
const PLACEHOLDER = '•••••';

/** The id to ask the plugin for: the result, or the text of its range. */
const idOf = ( line: ResultLine, id = line.calculation ): string => ( line.text ? id + ':text' : id );

/**
 * A result as the plugin prints it (Calculator::format(), PHP number_format: half away from zero),
 * with the text before and after; the builder has the same (calculations.ts).
 */
export function formatResult( value: number, format: CalculationFormat ): string {
	const decimals = Math.max( 0, Math.min( 10, format.decimals ) );
	const factor = 10 ** decimals;
	const rounded = ( Math.sign( value ) * Math.round( Number( ( Math.abs( value ) * factor ).toPrecision( 15 ) ) ) ) / factor;
	const [ whole = '0', part = '' ] = Math.abs( rounded ).toFixed( decimals ).split( '.' );
	const grouped = whole.replace( /\B(?=(\d{3})+(?!\d))/g, format.thousandsSeparator );
	return ( format.prefix ?? '' ) + ( rounded < 0 ? '-' : '' ) + grouped + ( decimals > 0 ? format.decimalSeparator + part : '' ) + ( format.suffix ?? '' );
}

/** The live results of one form. */
export class Live {
	/** The step element drawn last; a new one means a new step. */
	private step: Element | null = null;
	private boxes: Box[] = [];
	/** The box that stays across steps, and the field it shows. */
	private sticky: Box | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private request: AbortController | null = null;
	/** Results of the answers in `key`: numbers (null: cannot be computed) and the plugin's texts. */
	private key = '';
	private values: Record<string, number | null> = {};
	private texts: Record<string, string> = {};
	/** Keys of the required questions still open: on this step or on a step the visitor can still reach. */
	private open = new Set<string>();

	constructor( private readonly app: FormApp ) {
		// The box that stays sits right above the bottom bar where that stays at the bottom of the screen too.
		const nav = app.root.querySelector<HTMLElement>( '.ffx-nav' );
		if ( nav && typeof ResizeObserver === 'function' ) {
			new ResizeObserver( () => app.root.style.setProperty( '--ffx-nav-height', nav.offsetHeight + 'px' ) ).observe( nav );
		}
	}

	/** A new step (drawn at once) or a changed answer (asked for once the input rests). */
	update(): void {
		clearTimeout( this.timer );
		const step = this.app.card.firstElementChild;
		if ( step !== this.step ) {
			this.step = step;
			this.draw();
			void this.refresh( true );
			return;
		}
		this.timer = setTimeout( () => void this.refresh( true ), DELAY );
	}

	/** Boxes of the current step, and the one that stays from an earlier step. */
	private draw(): void {
		const app = this.app;
		const shown = app.shownFields();
		const done = app.root.classList.contains( 'ffx-done' );
		const node = app.doc.nodes.find( ( n ) => n.id === app.current );
		this.boxes = [];
		this.open = this.openKeys();
		for ( const field of node?.type === 'step' && ! done ? node.fields : [] ) {
			const el = [ ...( this.step?.querySelectorAll<HTMLElement>( '[data-field]' ) ?? [] ) ].find( ( e ) => e.dataset.field === field.id );
			if ( field.type !== 'result' || ! el ) {
				continue;
			}
			// The sticky one is drawn outside the step; its empty place takes no room (runtime-more.css).
			if ( field.props.style === 'card' ) {
				const box = this.box( field, 'div' );
				el.replaceChildren( box.el );
				this.boxes.push( box );
			}
		}
		// The last sticky result on the way so far stays; ends show none.
		let sticky: ResultField | undefined;
		for ( const step of done ? [] : app.pathSteps() ) {
			for ( const field of step.fields ) {
				if ( field.type === 'result' && field.props.style === 'sticky' && shown.has( field.id ) ) {
					sticky = field;
				}
			}
		}
		if ( sticky !== this.sticky?.field ) {
			this.sticky?.el.remove();
			this.sticky = sticky ? this.box( sticky, 'aside' ) : null;
			const nav = app.root.querySelector( '.ffx-shell > .ffx-nav' );
			if ( this.sticky ) {
				nav?.before( this.sticky.el );
			}
		}
		// Forms with a box that stays keep their wide layout from the first step to the end, so the steps do not jump.
		app.root.classList.toggle( 'ffx-has-live', ! done && app.doc.nodes.some( ( n ) => n.type === 'step' && n.fields.some( ( f ) => f.type === 'result' && f.props.style === 'sticky' ) ) );
		if ( this.sticky ) {
			// A step that shows its result as text (a result step) shows it once.
			const main = this.sticky.field.props.lines[ 0 ]?.calculation;
			this.sticky.el.hidden = [ ...( this.step?.querySelectorAll<HTMLElement>( '[data-ffx-calc]' ) ?? [] ) ].some( ( s ) => s.dataset.ffxCalc === main );
			if ( ! this.sticky.el.hidden ) {
				this.boxes.push( this.sticky );
			}
		}
	}

	/** Keys of the required questions not answered yet, on this step (shown) or on a step still ahead; sliders always answer. */
	private openKeys(): Set<string> {
		const app = this.app;
		const answers = app.pathAnswers();
		const shown = app.shownFields();
		const open = new Set<string>();
		const answered = new Set<string>();
		const empty = ( v: unknown ): boolean => v === undefined || v === '' || ( Array.isArray( v ) && ! v.length );
		for ( const step of app.pathSteps() ) {
			for ( const field of step.fields ) {
				if ( ! empty( answers[ field.id ] ) ) {
					answered.add( field.key );
				} else if ( step.id === app.current && field.required && shown.has( field.id ) ) {
					open.add( field.key );
				}
			}
		}
		// The steps the visitor can still reach from here, whatever the conditions of the paths.
		const seen = new Set( [ app.current ] );
		const todo = [ app.current ];
		for ( let id = todo.pop(); id !== undefined; id = todo.pop() ) {
			for ( const edge of app.doc.edges ) {
				if ( edge.from !== id || seen.has( edge.to ) ) {
					continue;
				}
				seen.add( edge.to );
				todo.push( edge.to );
				const node = app.doc.nodes.find( ( n ) => n.id === edge.to );
				for ( const field of node?.type === 'step' ? node.fields : [] ) {
					if ( field.required || field.type === 'slider' ) {
						open.add( field.key );
					}
				}
			}
		}
		answered.forEach( ( key ) => open.delete( key ) );
		return open;
	}

	/** Whether a line waits for an open question (its calculations use one). */
	private waiting( line: ResultLine ): boolean {
		const ids = line.to ? [ line.calculation, line.to ] : [ line.calculation ];
		return ids.some( ( id ) => this.app.doc.calculations.find( ( c ) => c.id === id )?.uses?.some( ( key ) => this.open.has( key ) ) );
	}

	/** A box of a live result field, with the results known so far. */
	private box( field: ResultField, tag: 'div' | 'aside' ): Box {
		const app = this.app;
		const title = app.piped( field.label );
		const titleText = title.replace( /<[^>]*>/g, '' ).trim();
		const locked = field.props.reveal === 'contact';
		const el = h( tag, { class: `ffx-live ffx-live-${ field.props.style }${ locked ? ' ffx-live-locked' : '' }`, 'aria-label': tag === 'aside' ? titleText || null : null } );
		if ( title ) {
			el.append( trusted( 'p', title, { class: 'ffx-live-title' } ) );
		}
		const description = app.piped( field.description );
		if ( description ) {
			el.append( trusted( 'div', description, { class: 'ffx-live-description' } ) );
		}
		const rows = field.props.lines.map( ( line, i ): Row => {
			const value = h( 'span', { class: 'ffx-live-value' } );
			const label = trusted( 'span', app.piped( line.label ), { class: 'ffx-live-label' } );
			el.append( h( 'div', { class: i ? 'ffx-live-line' : 'ffx-live-main' }, label, value ) );
			const row: Row = { line, label, value, shown: null, frame: 0 };
			if ( locked ) {
				value.textContent = PLACEHOLDER;
				value.setAttribute( 'aria-hidden', 'true' );
			} else {
				this.show( row, false );
			}
			return row;
		} );
		if ( locked ) {
			el.append( trusted( 'p', app.piped( field.props.teaser ) || app.t( 'live_locked' ), { class: 'ffx-live-teaser' } ) );
		}
		const disclaimer = app.piped( field.props.disclaimer );
		if ( disclaimer ) {
			el.append( trusted( 'p', disclaimer, { class: 'ffx-live-note' } ) );
		}
		const status = h( 'p', { class: 'ffx-sr-only', role: 'status' } );
		el.append( status );
		return { field, el, rows, status, locked };
	}

	/**
	 * Asks the plugin for the results of the boxes (and, after an answer, of the {{calc:…}} texts),
	 * unless the answers are those of the results shown. A request that is overtaken is dropped.
	 */
	private async refresh( texts: boolean ): Promise<void> {
		const app = this.app;
		const spans = texts ? [ ...app.root.querySelectorAll<HTMLElement>( '[data-ffx-calc]' ) ] : [];
		const ids = new Set( spans.map( ( s ) => s.dataset.ffxCalc ?? '' ) );
		for ( const box of this.boxes ) {
			for ( const row of box.locked ? [] : box.rows ) {
				ids.add( idOf( row.line ) );
				if ( row.line.to && ! row.line.text ) {
					ids.add( row.line.to );
				}
			}
		}
		ids.delete( '' );
		const answers = app.pathAnswers();
		const key = JSON.stringify( answers );
		if ( ! ids.size || ( key === this.key && [ ...ids ].every( ( id ) => id in this.texts || id in this.values ) ) ) {
			this.apply( spans );
			return;
		}
		this.request?.abort();
		const request = ( this.request = new AbortController() );
		this.loading( true );
		try {
			const response = await fetch( app.config.endpoint + '/calculations', {
				method: 'POST',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				body: JSON.stringify( { answers, ids: [ ...ids ], live: true, locale: app.config.locale, ...( app.config.unlock ? { unlock: app.config.unlock } : {} ) } ),
				credentials: 'omit',
				signal: request.signal,
			} );
			const data = ( await response.json() ) as Answer;
			if ( request !== this.request || ! data.calculations ) {
				// Overtaken, or refused (too many requests): the last results stay.
				return;
			}
			if ( key !== this.key ) {
				this.key = key;
				this.values = {};
				this.texts = {};
			}
			Object.assign( this.values, data.values ?? {} );
			Object.assign( this.texts, data.calculations );
			this.apply( spans );
		} catch {
			// Aborted or offline: the last results stay.
		} finally {
			if ( request === this.request ) {
				this.request = null;
				this.loading( false );
			}
		}
	}

	private loading( on: boolean ): void {
		for ( const box of this.boxes.filter( ( b ) => ! b.locked ) ) {
			box.el.classList.toggle( 'is-loading', on );
			if ( on ) {
				box.el.setAttribute( 'aria-busy', 'true' );
			} else {
				box.el.removeAttribute( 'aria-busy' );
			}
		}
	}

	/** Shows the results known: in the boxes, counting up, and in the {{calc:…}} texts. */
	private apply( spans: HTMLElement[] ): void {
		this.open = this.openKeys();
		for ( const span of spans ) {
			span.textContent = this.texts[ span.dataset.ffxCalc ?? '' ] ?? this.app.t( 'calc_error' );
			span.removeAttribute( 'aria-busy' );
		}
		for ( const box of this.boxes ) {
			if ( box.locked ) {
				continue;
			}
			box.rows.forEach( ( row ) => this.show( row, true ) );
			const main = box.rows[ 0 ];
			// Screen readers hear the result once, not every number on the way up.
			const say = main && ! this.waiting( main.line ) ? [ main.label.textContent?.trim(), this.text( main.line, this.numbers( main.line ) ) ].filter( Boolean ).join( ': ' ) : '';
			if ( say !== box.status.textContent ) {
				box.status.textContent = say;
			}
		}
	}

	/** The numbers of a line (two for a range), or null while a result is unknown or cannot be computed. */
	private numbers( line: ResultLine ): number[] | null {
		if ( line.text ) {
			return null;
		}
		const ids = line.to ? [ line.calculation, line.to ] : [ line.calculation ];
		const out = ids.map( ( id ) => this.values[ id ] );
		return out.every( ( n ): n is number => typeof n === 'number' && Number.isFinite( n ) ) ? out : null;
	}

	/** The format of a calculation, when the public document has it. */
	private format( id: string ): CalculationFormat | undefined {
		return this.app.doc.calculations.find( ( c ) => c.id === id )?.format;
	}

	/**
	 * A line's text: its numbers in the calculations' formats ("1.200 – 1.500 €": a range whose ends
	 * share the text before and after takes it once), with the line's own text around and "from".
	 * Without numbers: the plugin's text (e.g. the calculation error), or … while nothing is known.
	 */
	private text( line: ResultLine, numbers: number[] | null ): string {
		if ( line.text ) {
			return this.texts[ idOf( line ) ] ?? '…';
		}
		const ids = line.to ? [ line.calculation, line.to ] : [ line.calculation ];
		const formats = ids.map( ( id ) => this.format( id ) );
		let text: string;
		if ( numbers && formats.every( Boolean ) ) {
			const [ a, b ] = formats as CalculationFormat[];
			const shared = b && a && a.prefix === b.prefix && a.suffix === b.suffix;
			text = numbers.map( ( n, i ) => formatResult( n, { ...( formats[ i ] as CalculationFormat ), ...( shared ? ( i ? { prefix: '' } : { suffix: '' } ) : {} ) } ) ).join( ' – ' );
		} else {
			const known = ids.map( ( id ) => this.texts[ id ] );
			if ( known.some( ( t ) => t === undefined ) ) {
				return '…';
			}
			if ( ! numbers ) {
				return known.find( ( t, i ) => typeof this.values[ ids[ i ] as string ] !== 'number' ) ?? this.app.t( 'calc_error' );
			}
			text = known.join( ' – ' );
		}
		text = ( line.prefix ?? '' ) + text + ( line.suffix ?? '' );
		return line.from ? this.app.t( 'live_from' ).replace( '%s', text ) : text;
	}

	/** Shows a line's result; with `count`, numbers count up from those shown (not for visitors who reduce motion). */
	private show( row: Row, count: boolean ): void {
		cancelAnimationFrame( row.frame );
		if ( this.waiting( row.line ) ) {
			row.value.textContent = '–';
			row.shown = null;
			return;
		}
		const to = this.numbers( row.line );
		const done = this.text( row.line, to );
		const from = row.shown;
		row.shown = to;
		const still = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;
		if ( ! count || still || ! from || ! to || from.length !== to.length || from.every( ( n, i ) => n === to[ i ] ) ) {
			row.value.textContent = done;
			return;
		}
		const start = performance.now();
		const step = ( now: number ): void => {
			const k = Math.min( 1, ( now - start ) / COUNT_MS );
			if ( k >= 1 ) {
				row.value.textContent = done;
				return;
			}
			const ease = 1 - ( 1 - k ) ** 3;
			row.value.textContent = this.text( row.line, to.map( ( n, i ) => ( from[ i ] as number ) + ( n - ( from[ i ] as number ) ) * ease ) );
			row.frame = requestAnimationFrame( step );
		};
		row.frame = requestAnimationFrame( step );
	}
}

const forms = new WeakMap<FormApp, Live>();

/** Takes the news of a form (FormApp.live()). */
export function update( app: FormApp ): void {
	let live = forms.get( app );
	if ( ! live ) {
		live = new Live( app );
		forms.set( app, live );
	}
	live.update();
}

// Forms that started before the script came wait in a list; from now on the script takes them.
if ( typeof window !== 'undefined' ) {
	take( 'live', update );
}
