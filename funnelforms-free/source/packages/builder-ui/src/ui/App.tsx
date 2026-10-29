/**
 * The builder's admin screen: the list of forms, or one form in the editor (?form=<id> in the
 * address, so the browser's back button and bookmarks work).
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { AiConfig, FormsApi } from '../api';
import type { Labels } from '../document';
import type { EmbedConfig } from '../embed';
import { Builder } from './Builder';
import type { Rights, View } from './context';
import { defaultLabels } from './catalog';
import { FormsList } from './FormsList';

export interface AppConfig {
	/** Language of the site, and the texts of new fields in it (from the plugin's translations). */
	siteLocale?: string;
	siteLabels?: Labels;
	/** Language of the editing user; their translations are loaded for the builder. */
	userLocale?: string;
	rights?: Rights;
	/** The page that imports forms of other form plugins. */
	importUrl?: string;
	/** The page that imports export files of Funnelforms (Import Funnelforms). */
	importOwn?: string;
	/** The embed code for other websites; Funnelforms Pro only. */
	embed?: EmbedConfig | null;
	/** The AI form builder (Funnelforms Pro); null in Funnelforms Free. */
	ai?: AiConfig | null;
}

function formInAddress(): number | null {
	const id = Number( new URL( window.location.href ).searchParams.get( 'form' ) );
	return Number.isInteger( id ) && id > 0 ? id : null;
}

/** Workspace the address opens the form in. */
function viewInAddress(): View | undefined {
	const view = new URL( window.location.href ).searchParams.get( 'view' );
	return 'build' === view || 'design' === view || 'settings' === view || 'predict' === view || 'actions' === view || 'embed' === view ? view : undefined;
}

/** Whether the address asks for the figures on the canvas (statistics page; ?view=stats of older links). */
function figuresInAddress(): boolean {
	const params = new URL( window.location.href ).searchParams;
	return '1' === params.get( 'figures' ) || 'stats' === params.get( 'view' );
}

function go( id: number | null ): void {
	const url = new URL( window.location.href );
	url.searchParams.delete( 'view' );
	url.searchParams.delete( 'figures' );
	if ( null === id ) {
		url.searchParams.delete( 'form' );
	} else {
		url.searchParams.set( 'form', String( id ) );
	}
	window.history.pushState( { form: id }, '', url );
}

export function App( { api, config = {} }: { api: FormsApi; config?: AppConfig } ) {
	const [ form, setForm ] = useState<number | null>( formInAddress );
	const [ view, setView ] = useState( viewInAddress );
	const [ figures, setFigures ] = useState( figuresInAddress );

	useEffect( () => {
		const onPop = (): void => setForm( formInAddress() );
		window.addEventListener( 'popstate', onPop );
		return () => window.removeEventListener( 'popstate', onPop );
	}, [] );

	const open = useCallback( ( id: number | null ): void => {
		go( id );
		setView( undefined );
		setFigures( false );
		setForm( id );
	}, [] );

	// New fields get texts in the form's language: the site's from the plugin, the editor's own,
	// otherwise English.
	const labelsFor = useCallback(
		( locale: string ): Labels | undefined => {
			if ( config.siteLocale === locale && config.siteLabels ) {
				return config.siteLabels;
			}
			return config.userLocale === locale ? defaultLabels() : undefined;
		},
		[ config.siteLocale, config.siteLabels, config.userLocale ]
	);

	return (
		<div className="ffxb">
			{ null === form ? <FormsList api={ api } onOpen={ open } importUrl={ config.importUrl } importOwn={ config.importOwn } ai={ config.ai } /> : <Builder key={ form } api={ api } formId={ form } onBack={ () => open( null ) } labelsFor={ labelsFor } rights={ config.rights } view={ view } figures={ figures } embed={ config.embed } ai={ config.ai } tour /> }
		</div>
	);
}
