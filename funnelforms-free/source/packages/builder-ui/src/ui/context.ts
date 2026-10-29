/**
 * What the builder's components share: the store of the open form and the texts for new fields.
 */
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { FormsApi } from '../api';
import type { Context as DocContext } from '../document';
import type { BuilderState, BuilderActions, BuilderStore } from '../store';

/** What the user may change beyond the form itself; the server checks again. */
export interface Rights {
	/** See entries: needed to change actions and where entries go. */
	entries: boolean;
	/** unfiltered_html: tracking code, scripts, custom CSS. */
	code: boolean;
	/** Change settings: add connections. */
	settings: boolean;
}

export const DEFAULT_RIGHTS: Rights = { entries: true, code: true, settings: false };

export interface BuilderEnv {
	api: FormsApi;
	rights: Rights;
	store: BuilderStore;
	/** Locale and default texts of new fields, in the form's language. */
	ctx: DocContext;
	/** Language the texts are edited in: the form's default (ctx.locale) or a translation. */
	lang: string;
	readOnly: boolean;
}

export const BuilderContext = createContext<BuilderEnv | null>( null );

/** The workspaces of the editor: the steps on the canvas, the design, settings, actions, embedding. */
export type View = 'build' | 'design' | 'settings' | 'predict' | 'actions' | 'embed';

/** Opens a workspace; outside the editor nothing happens. */
export const ViewContext = createContext<( view: View ) => void>( () => undefined );

export function useEnv(): BuilderEnv {
	const env = useContext( BuilderContext );
	if ( ! env ) {
		throw new Error( 'The builder context is missing.' );
	}
	return env;
}

/** A part of the builder state; the component renders again when it changes. */
export function useBuilder<T>( selector: ( state: BuilderState & BuilderActions ) => T ): T {
	return useStore( useEnv().store, selector );
}

/** Event on window that opens the list of keyboard shortcuts. */
export const SHORTCUTS_EVENT = 'ffxb-shortcuts';
