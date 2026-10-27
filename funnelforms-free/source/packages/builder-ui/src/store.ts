/**
 * The builder's state: the document being edited with undo and redo (Immer patches), the
 * selection, autosave of the draft, the edit lock and publishing.
 */
import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from 'immer';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { FormDocument } from '@funnelforms/form-schema';
import { ApiError } from './api';
import type { FormDetail, FormsApi, FormSummary, UserRef } from './api';
import { syncQuiz } from './quiz';
import { takeSchedule } from './experiments';

enablePatches();

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'locked' | 'offline';
export type Device = 'desktop' | 'tablet' | 'mobile';

export interface Selection {
	node?: string;
	field?: string;
	edge?: string;
}

/** What the properties of a step show: its content, or where visitors go and what happens on sending. */
export type Panel = 'content' | 'logic';

export interface BuilderState {
	status: 'loading' | 'ready' | 'failed';
	loadError: string | null;
	form: FormSummary | null;
	doc: FormDocument | null;
	selection: Selection;
	panel: Panel;
	/** A short message after a change, e.g. what deleting a field did to the logic; undo is offered. */
	/** The message about the last change; `undo` offers to undo it. */
	notice: { text: string; id: number; undo: boolean } | null;
	canUndo: boolean;
	canRedo: boolean;
	save: { state: SaveState; savedAt: number | null; error: string | null; lockedBy: UserRef | null };
	/** What publishing would refuse, from the last save. */
	problems: string[];
	/** Rights the user lacks to publish the draft. */
	missingRights: string[];
	publishing: { state: 'idle' | 'publishing' | 'published' | 'failed'; warnings: string[]; error: string | null; code: string | null };
	device: Device;
	/** Language chosen for editing texts; null for the form's default language. */
	lang: string | null;
}

/** Changes the draft in place, or returns a whole new document. */
export type Recipe = ( ( doc: FormDocument ) => void ) | ( ( doc: FormDocument ) => FormDocument );

export interface BuilderActions {
	load(): Promise<void>;
	/** Changes the document; changes with the same key in quick succession are undone together. */
	change( recipe: Recipe, key?: string ): void;
	undo(): void;
	redo(): void;
	/** Selects; with a panel, the properties open on it. */
	select( selection: Selection, panel?: Panel ): void;
	showPanel( panel: Panel ): void;
	/** Shows a message about the last change (null hides it). */
	/** Shows a message about the last change, with undo unless `undoable` is false. */
	notify( text: string | null, undoable?: boolean ): void;
	setDevice( device: Device ): void;
	/** Edits the texts in this language (null: the default language). */
	setLang( lang: string | null ): void;
	/** Saves the draft now (also used before publishing). */
	saveNow(): Promise<boolean>;
	publish( note?: string ): Promise<boolean>;
	/** Takes the edit lock over from someone else. */
	takeOver(): Promise<void>;
	/** Replaces the document, e.g. with a restored revision; the step can be undone. */
	replace( doc: FormDocument, form?: FormSummary ): void;
	/** Starts over from what the server has, e.g. after the draft was dropped; clears undo. */
	reset( detail: FormDetail ): void;
	dispose(): void;
}

export type BuilderStore = StoreApi<BuilderState & BuilderActions>;

export interface Timers {
	setTimeout( fn: () => void, ms: number ): unknown;
	clearTimeout( handle: unknown ): void;
	setInterval( fn: () => void, ms: number ): unknown;
	clearInterval( handle: unknown ): void;
	now(): number;
}

export interface BuilderOptions {
	/** Quiet time after a change before the draft is saved. */
	autosaveMs?: number;
	/** How often the edit lock is renewed; by default a third of the server's lockTtl. */
	heartbeatMs?: number;
	/** Changes with the same key within this time are one undo step. */
	coalesceMs?: number;
	/** Most undo steps kept. */
	historyLimit?: number;
	timers?: Timers;
}

const realTimers: Timers = {
	setTimeout: ( fn, ms ) => setTimeout( fn, ms ),
	clearTimeout: ( handle ) => clearTimeout( handle as ReturnType<typeof setTimeout> ),
	setInterval: ( fn, ms ) => setInterval( fn, ms ),
	clearInterval: ( handle ) => clearInterval( handle as ReturnType<typeof setInterval> ),
	now: () => Date.now(),
};

interface Step {
	patches: Patch[];
	inverse: Patch[];
	key?: string;
	at: number;
}

/** The form row, the document and the lock time of a detail answer. */
function split( detail: FormDetail ): { form: FormSummary; document: FormDocument | null; lockTtl: number } {
	const { document, lockTtl, ...form } = detail;
	return { form, document, lockTtl };
}

export function createBuilderStore( api: FormsApi, formId: number, options: BuilderOptions = {} ): BuilderStore {
	const timers = options.timers ?? realTimers;
	const autosaveMs = options.autosaveMs ?? 1500;
	const coalesceMs = options.coalesceMs ?? 1000;
	const historyLimit = options.historyLimit ?? 200;

	const past: Step[] = [];
	const future: Step[] = [];
	/** Counts changes; a save is current when nothing changed while it ran. */
	let version = 0;
	let savedVersion = 0;
	let autosave: unknown = null;
	let heartbeat: unknown = null;
	let inFlight: Promise<boolean> | null = null;
	let disposed = false;

	return createStore<BuilderState & BuilderActions>()( ( set, get ) => {
		const history = (): Pick<BuilderState, 'canUndo' | 'canRedo'> => ( { canUndo: past.length > 0, canRedo: future.length > 0 } );

		const locked = ( lockedBy: UserRef | null ): void => {
			set( { save: { ...get().save, state: 'locked', lockedBy } } );
		};

		const schedule = (): void => {
			if ( null !== autosave ) {
				timers.clearTimeout( autosave );
			}
			autosave = timers.setTimeout( () => {
				autosave = null;
				void get().saveNow();
			}, autosaveMs );
		};

		const changed = (): void => {
			++version;
			if ( 'locked' !== get().save.state ) {
				set( { save: { ...get().save, state: 'dirty', error: null } } );
				schedule();
			}
		};

		const startHeartbeat = ( ms: number ): void => {
			if ( null !== heartbeat ) {
				timers.clearInterval( heartbeat );
			}
			heartbeat = timers.setInterval( () => {
				if ( 'locked' === get().save.state || disposed ) {
					return;
				}
				api.lock( formId ).catch( ( error: unknown ) => {
					if ( error instanceof ApiError && error.lockedBy ) {
						locked( error.lockedBy );
					}
				} );
			}, ms );
		};

		const save = async (): Promise<boolean> => {
			const { doc } = get();
			if ( ! doc || 'locked' === get().save.state ) {
				return false;
			}
			if ( version === savedVersion ) {
				return true;
			}
			const sending = version;
			set( { save: { ...get().save, state: 'saving' } } );
			try {
				const result = await api.saveDraft( formId, doc );
				savedVersion = Math.max( savedVersion, sending );
				const pending = version !== sending;
				set( {
					form: result.form,
					problems: result.problems,
					missingRights: result.missingRights,
					save: { state: pending ? 'dirty' : 'saved', savedAt: timers.now(), error: null, lockedBy: null },
				} );
				if ( pending ) {
					schedule();
				}
				return ! pending;
			} catch ( error ) {
				if ( error instanceof ApiError && 'locked' === error.code ) {
					locked( error.lockedBy );
				} else {
					const offline = error instanceof ApiError && 'offline' === error.code;
					set( { save: { ...get().save, state: offline ? 'offline' : 'error', error: error instanceof Error ? error.message : String( error ) } } );
					// Try again later; nothing typed is lost while the page stays open.
					schedule();
				}
				return false;
			}
		};

		return {
			status: 'loading',
			loadError: null,
			form: null,
			doc: null,
			selection: {},
			panel: 'content',
			notice: null,
			canUndo: false,
			canRedo: false,
			save: { state: 'saved', savedAt: null, error: null, lockedBy: null },
			problems: [],
			missingRights: [],
			publishing: { state: 'idle', warnings: [], error: null, code: null },
			device: 'desktop',
			lang: null,

			async load() {
				set( { status: 'loading', loadError: null } );
				try {
					const { form, document, lockTtl } = split( await api.get( formId ) );
					if ( ! document ) {
						throw new Error( 'The form has no document.' );
					}
					set( { status: 'ready', form, doc: document } );
					try {
						await api.lock( formId );
					} catch ( error ) {
						if ( error instanceof ApiError && error.lockedBy ) {
							locked( error.lockedBy );
						}
					}
					// Renew well before the lock runs out.
					startHeartbeat( options.heartbeatMs ?? Math.max( 5000, Math.floor( ( lockTtl * 1000 ) / 3 ) ) );
				} catch ( error ) {
					set( { status: 'failed', loadError: error instanceof Error ? error.message : String( error ) } );
				}
			},

			change( recipe, key ) {
				const { doc } = get();
				if ( ! doc || 'locked' === get().save.state ) {
					return;
				}
				// A quiz follows every change of its questions and results (same undo step).
				const [ next, patches, inverse ] = produceWithPatches( doc, ( draft: FormDocument ) => {
					const returned = ( recipe as ( d: FormDocument ) => FormDocument | undefined )( draft );
					syncQuiz( returned ?? draft );
					return returned;
				} );
				if ( 0 === patches.length ) {
					return;
				}
				const now = timers.now();
				const last = past[ past.length - 1 ];
				if ( key && last && last.key === key && now - last.at < coalesceMs ) {
					// One undo step for a run of keystrokes in the same input.
					last.patches = last.patches.concat( patches );
					last.inverse = inverse.concat( last.inverse );
					last.at = now;
				} else {
					past.push( { patches, inverse, key, at: now } );
					if ( past.length > historyLimit ) {
						past.shift();
					}
				}
				future.length = 0;
				set( { doc: next, ...history() } );
				changed();
			},

			undo() {
				const step = past.pop();
				const { doc } = get();
				if ( ! step || ! doc ) {
					return;
				}
				future.push( step );
				set( { doc: applyPatches( doc, step.inverse ), ...history() } );
				changed();
			},

			redo() {
				const step = future.pop();
				const { doc } = get();
				if ( ! step || ! doc ) {
					return;
				}
				past.push( { ...step, key: undefined } );
				set( { doc: applyPatches( doc, step.patches ), ...history() } );
				changed();
			},

			select( selection, panel ) {
				set( panel ? { selection, panel } : { selection } );
			},

			showPanel( panel ) {
				set( { panel } );
			},

			notify( text, undoable = true ) {
				set( { notice: text ? { text, id: ( get().notice?.id ?? 0 ) + 1, undo: undoable } : null } );
			},

			setLang( lang ) {
				set( { lang } );
			},

			setDevice( device ) {
				set( { device } );
			},

			saveNow() {
				if ( null !== autosave ) {
					timers.clearTimeout( autosave );
					autosave = null;
				}
				if ( inFlight ) {
					// Save again once the running save is done, if something changed meanwhile.
					return inFlight.then( () => ( version === savedVersion ? true : get().saveNow() ) );
				}
				inFlight = save().finally( () => {
					inFlight = null;
				} );
				return inFlight;
			},

			async publish( note = '' ) {
				set( { publishing: { state: 'publishing', warnings: [], error: null, code: null } } );
				const saved = await get().saveNow();
				if ( ! saved ) {
					set( { publishing: { state: 'failed', warnings: [], error: get().save.error, code: 'not_saved' } } );
					return false;
				}
				try {
					const result = await api.publish( formId, note );
					set( { form: result.form, problems: [], missingRights: [], publishing: { state: 'published', warnings: result.warnings, error: null, code: null } } );
					// The plugin noted the days of the A/B tests; the next save keeps them.
					const { doc } = get();
					if ( doc && result.experiments && Object.keys( result.experiments ).length ) {
						const schedule = result.experiments;
						set( { doc: produce( doc, ( d ) => void takeSchedule( d, schedule ) ) } );
					}
					return true;
				} catch ( error ) {
					if ( error instanceof ApiError ) {
						const problems = Array.isArray( error.data.problems ) ? ( error.data.problems as string[] ) : get().problems;
						const missingRights = Array.isArray( error.data.missingRights ) ? ( error.data.missingRights as string[] ) : get().missingRights;
						set( { problems, missingRights, publishing: { state: 'failed', warnings: [], error: error.message, code: error.code } } );
						if ( error.lockedBy ) {
							locked( error.lockedBy );
						}
					} else {
						set( { publishing: { state: 'failed', warnings: [], error: String( error ), code: null } } );
					}
					return false;
				}
			},

			async takeOver() {
				await api.lock( formId, true );
				// Someone else may have saved meanwhile: start from their draft.
				get().reset( await api.get( formId ) );
			},

			reset( detail ) {
				const { form, document } = split( detail );
				if ( null !== autosave ) {
					timers.clearTimeout( autosave );
					autosave = null;
				}
				past.length = 0;
				future.length = 0;
				version = savedVersion = 0;
				set( { form, doc: document, selection: {}, ...history(), save: { state: 'saved', savedAt: null, error: null, lockedBy: null } } );
			},

			replace( doc, form ) {
				get().change( () => structuredClone( doc ) );
				if ( form ) {
					set( { form } );
				}
			},

			dispose() {
				disposed = true;
				if ( null !== autosave ) {
					timers.clearTimeout( autosave );
				}
				if ( null !== heartbeat ) {
					timers.clearInterval( heartbeat );
				}
				if ( 'locked' !== get().save.state ) {
					void api.unlock( formId ).catch( () => undefined );
				}
			},
		};
	} );
}
