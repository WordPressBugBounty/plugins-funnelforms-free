/**
 * The two import pages. Import from other plugins (Funnelforms → Import from other plugins): forms
 * of other form plugins found on this website, or an export file, become drafts. Import
 * Funnelforms (Funnelforms → Import Funnelforms): export files of Funnelforms 5 and 3 become
 * drafts. Each imported form is listed with what was not taken over, in plain words, and a link to
 * open it in the editor.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImportedForm } from '../api';
import { IMPORT_MAX_BYTES, type ConnectApi, type ImportItem, type ImportResult, type ImportSource } from '../connect';
import { problemTexts } from './catalog';
import { __, sprintf } from './i18n';
import { Spinner } from './ui';

export interface ImportConfig {
	/** The editor, to open a form: its address plus &form=<id>. */
	builderUrl?: string | null;
	/** Size limit of an export file in bytes. */
	maxBytes?: number;
	/** The other import page: Import from other plugins … */
	importUrl?: string;
	/** … and Import Funnelforms. */
	importOwn?: string;
}

/** Names of the form plugins; brand names, so they are not translated. */
const PLUGINS: Record<string, string> = {
	wpforms: 'WPForms',
	gravityforms: 'Gravity Forms',
	'ninja-forms': 'Ninja Forms',
	'fluent-forms': 'Fluent Forms',
	'contact-form-7': 'Contact Form 7',
	formidable: 'Formidable Forms',
	elementor: 'Elementor Pro',
};

/** A line of the result: an item and the name of the plugin it came from. */
interface Row {
	item: ImportItem;
	plugin: string;
}

function message( e: unknown ): string {
	return e instanceof Error ? e.message : String( e );
}

function megabytes( bytes: number ): string {
	return String( Math.round( bytes / ( 1024 * 1024 ) ) );
}

const key = ( source: string, id: string ): string => source + '|' + id;

function Icon( { path }: { path: string } ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
			<path d={ path } />
		</svg>
	);
}

export function ImportScreen( { api, config = {} }: { api: ConnectApi; config?: ImportConfig } ) {
	const [ sources, setSources ] = useState<ImportSource[] | null>( null );
	const [ loadError, setLoadError ] = useState<string | null>( null );
	const [ selected, setSelected ] = useState<Set<string>>( new Set() );
	const [ again, setAgain ] = useState( false );
	const [ busy, setBusy ] = useState( false );
	const [ rows, setRows ] = useState<Row[] | null>( null );
	const [ errors, setErrors ] = useState<string[]>( [] );
	const [ dragging, setDragging ] = useState( false );
	const picker = useRef<HTMLInputElement>( null );
	const resultHead = useRef<HTMLHeadingElement>( null );
	const maxBytes = config.maxBytes ?? IMPORT_MAX_BYTES;

	const load = useCallback( async (): Promise<void> => {
		setLoadError( null );
		try {
			setSources( await api.importSources() );
		} catch ( e ) {
			setLoadError( message( e ) );
		}
	}, [ api ] );

	useEffect( () => {
		void load();
	}, [ load ] );

	useEffect( () => {
		if ( rows || errors.length ) {
			resultHead.current?.focus();
		}
	}, [ rows, errors ] );

	const base = config.builderUrl ?? '';
	const editUrl = ( id: number ): string => base + ( base.includes( '?' ) ? '&' : '?' ) + 'form=' + id;
	const chosen = useMemo( () => [ ...selected ], [ selected ] );

	const finish = ( found: Row[], failed: string[] ): void => {
		setRows( found );
		setErrors( failed );
		setSelected( new Set() );
		setBusy( false );
		void load();
	};

	const importSelected = async ( list: string[] = chosen, repeat = again ): Promise<void> => {
		setBusy( true );
		const found: Row[] = [];
		const failed: string[] = [];
		const bySource = new Map<string, string[]>();
		for ( const entry of list ) {
			const [ source, ...rest ] = entry.split( '|' );
			bySource.set( source ?? '', [ ...( bySource.get( source ?? '' ) ?? [] ), rest.join( '|' ) ] );
		}
		for ( const [ source, ids ] of bySource ) {
			try {
				const result: ImportResult = await api.importSite( source, ids, repeat );
				found.push( ...result.forms.map( ( item ) => ( { item, plugin: PLUGINS[ source ] ?? source } ) ) );
			} catch ( e ) {
				failed.push( message( e ) );
			}
		}
		finish( found, failed );
	};

	const importFiles = async ( files: File[] ): Promise<void> => {
		setBusy( true );
		const found: Row[] = [];
		const failed: string[] = [];
		for ( const file of files ) {
			if ( file.size > maxBytes ) {
				failed.push( sprintf( __( '%1$s is larger than %2$s MB.', 'funnelforms-pro' ), file.name, megabytes( maxBytes ) ) );
				continue;
			}
			try {
				const result = await api.importFile( file, file.name );
				found.push( ...result.forms.map( ( item ) => ( { item, plugin: PLUGINS[ result.source ] ?? result.source } ) ) );
			} catch ( e ) {
				failed.push( sprintf( __( '%1$s: %2$s', 'funnelforms-pro' ), file.name, message( e ) ) );
			}
		}
		finish( found, failed );
	};

	const toggle = ( id: string ): void =>
		setSelected( ( set ) => {
			const next = new Set( set );
			if ( next.has( id ) ) {
				next.delete( id );
			} else {
				next.add( id );
			}
			return next;
		} );

	const selectable = ( source: ImportSource ): string[] => source.forms.filter( ( f ) => again || null === f.importedAs ).map( ( f ) => key( source.source, f.id ) );

	const toggleAll = ( source: ImportSource ): void => {
		const all = selectable( source );
		const every = all.length > 0 && all.every( ( id ) => selected.has( id ) );
		setSelected( ( set ) => {
			const next = new Set( set );
			all.forEach( ( id ) => ( every ? next.delete( id ) : next.add( id ) ) );
			return next;
		} );
	};

	const anyImported = ( sources ?? [] ).some( ( s ) => s.forms.some( ( f ) => null !== f.importedAs ) );
	const created = ( rows ?? [] ).filter( ( r ) => ! r.item.skipped );
	const skipped = ( rows ?? [] ).filter( ( r ) => r.item.skipped );

	return (
		<div className="ffx-import">
			{ rows || errors.length ? (
				<section className="ffx-card ffx-import__result" aria-labelledby="ffx-import-result">
					<div className="ffx-card__head">
						<div>
							<h2 id="ffx-import-result" ref={ resultHead } tabIndex={ -1 }>
								{ __( 'Result', 'funnelforms-pro' ) }
							</h2>
							<p>
								{ 0 === created.length
									? __( 'No new form was created.', 'funnelforms-pro' )
									: 1 === created.length
									? __( '1 form was imported as a draft. Nothing is live yet: open it, check it and publish it.', 'funnelforms-pro' )
									: sprintf( __( '%d forms were imported as drafts. Nothing is live yet: open each one, check it and publish it.', 'funnelforms-pro' ), created.length ) }
							</p>
						</div>
						<button type="button" className="ffx-btn ffx-btn--sm" onClick={ () => { setRows( null ); setErrors( [] ); } }>
							{ __( 'Close', 'funnelforms-pro' ) }
						</button>
					</div>
					{ errors.map( ( text, i ) => (
						<div key={ i } className="ffx-notice ffx-notice--danger" role="alert">
							<p>{ text }</p>
						</div>
					) ) }
					<ul className="ffx-import__rows">
						{ created.map( ( { item, plugin } ) => {
							const todo = problemTexts( item.problems ?? [] );
							const notes = item.messages ?? [];
							return (
								<li key={ item.source + item.sourceId + ( item.id ?? '' ) } className="ffx-import__row">
									<div className="ffx-import__row-head">
										<div className="ffx-rows__main">
											<span className="ffx-rows__title">{ item.title }</span>
											<span className="ffx-rows__meta">{ plugin }</span>
										</div>
										<span className="ffx-badge ffx-badge--success">{ __( 'Draft created', 'funnelforms-pro' ) }</span>
										{ null !== item.id ? (
											<a className="ffx-btn ffx-btn--primary ffx-btn--sm" href={ editUrl( item.id ) }>
												<span>{ __( 'Open in the editor', 'funnelforms-pro' ) }</span>
												<span className="screen-reader-text">{ ' – ' + ( item.title ?? '' ) }</span>
											</a>
										) : null }
									</div>
									{ 0 === notes.length && 0 === todo.length ? <p className="ffx-import__ok">{ __( 'Everything was taken over.', 'funnelforms-pro' ) }</p> : null }
									{ notes.length > 0 ? (
										<div className="ffx-import__notes">
											<h3>{ __( 'Not taken over, or changed', 'funnelforms-pro' ) }</h3>
											<ul>
												{ notes.map( ( n ) => (
													<li key={ n }>{ n }</li>
												) ) }
											</ul>
										</div>
									) : null }
									{ todo.length > 0 ? (
										<div className="ffx-import__notes ffx-import__notes--todo">
											<h3>{ __( 'To do before you can publish', 'funnelforms-pro' ) }</h3>
											<ul>
												{ todo.map( ( n ) => (
													<li key={ n }>{ n }</li>
												) ) }
											</ul>
										</div>
									) : null }
								</li>
							);
						} ) }
						{ skipped.map( ( { item, plugin } ) => (
							<li key={ 'skip' + item.source + item.sourceId } className="ffx-import__row">
								<div className="ffx-import__row-head">
									<div className="ffx-rows__main">
										<span className="ffx-rows__title">{ sprintf( __( 'Form %s', 'funnelforms-pro' ), item.sourceId ) }</span>
										<span className="ffx-rows__meta">{ plugin }</span>
									</div>
									<span className="ffx-badge ffx-badge--warning">{ __( 'Skipped', 'funnelforms-pro' ) }</span>
									{ 'already_imported' === item.skipped && null !== item.id ? (
										<>
											<a className="ffx-btn ffx-btn--sm" href={ editUrl( item.id ) }>
												{ __( 'Open the form', 'funnelforms-pro' ) }
											</a>
											<button type="button" className="ffx-btn ffx-btn--sm" disabled={ busy } onClick={ () => void importSelected( [ key( item.source, item.sourceId ) ], true ) }>
												{ __( 'Import again', 'funnelforms-pro' ) }
											</button>
										</>
									) : null }
								</div>
								<p className="ffx-import__ok">
									{ 'already_imported' === item.skipped ? __( 'This form was imported before and the draft still exists.', 'funnelforms-pro' ) : null }
									{ 'not_found' === item.skipped ? __( 'This form is no longer there.', 'funnelforms-pro' ) : null }
									{ 'document_too_large' === item.skipped ? __( 'This form is too large to import.', 'funnelforms-pro' ) : null }
								</p>
							</li>
						) ) }
					</ul>
				</section>
			) : null }

			<div className="ffx-split">
				<section className="ffx-card" aria-labelledby="ffx-import-site">
					<div className="ffx-card__head">
						<div>
							<h2 id="ffx-import-site">{ __( 'Forms on this website', 'funnelforms-pro' ) }</h2>
							<p>{ __( 'Form plugins whose forms Funnelforms found here. They are copied; the other plugin and its entries stay as they are.', 'funnelforms-pro' ) }</p>
						</div>
					</div>
					{ loadError ? (
						<div className="ffx-notice ffx-notice--danger" role="alert">
							<p>
								{ loadError } <button type="button" className="ffx-link" onClick={ () => void load() }>{ __( 'Try again', 'funnelforms-pro' ) }</button>
							</p>
						</div>
					) : null }
					{ ! loadError && ! sources ? <Spinner label={ __( 'Looking for forms…', 'funnelforms-pro' ) } /> : null }
					{ sources && 0 === sources.length ? (
						<div className="ffx-empty">
							<span className="ffx-empty__mark" aria-hidden="true">
								<Icon path="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" />
							</span>
							<h2>{ __( 'No forms of other plugins found', 'funnelforms-pro' ) }</h2>
							<p>{ __( 'Funnelforms looked for WPForms, Gravity Forms, Ninja Forms, Fluent Forms, Contact Form 7, Formidable Forms and Elementor Pro. Upload an export file instead.', 'funnelforms-pro' ) }</p>
						</div>
					) : null }
					{ sources?.map( ( source ) => {
						const all = selectable( source );
						const every = all.length > 0 && all.every( ( id ) => selected.has( id ) );
						return (
							<fieldset key={ source.source } className="ffx-import__source">
								<legend>
									<span>{ source.label }</span>
									<span className="ffx-badge ffx-badge--info">{ 1 === source.forms.length ? __( '1 form', 'funnelforms-pro' ) : sprintf( __( '%d forms', 'funnelforms-pro' ), source.forms.length ) }</span>
								</legend>
								<ul className="ffx-import__forms">
									{ source.forms.map( ( form ) => {
										const id = key( source.source, form.id );
										const done = null !== form.importedAs;
										return (
											<li key={ form.id } className={ done ? 'is-done' : '' }>
												<label>
													<input type="checkbox" checked={ selected.has( id ) } disabled={ busy || ( done && ! again ) } onChange={ () => toggle( id ) } />
													<span className="ffx-import__title">{ form.title || sprintf( __( 'Form %s', 'funnelforms-pro' ), form.id ) }</span>
													<span className="ffx-rows__meta">{ 'ID ' + form.id }</span>
												</label>
												{ done && null !== form.importedAs ? (
													<span className="ffx-import__done">
														<span className="ffx-badge ffx-badge--success">{ __( 'Imported', 'funnelforms-pro' ) }</span>
														<a href={ editUrl( form.importedAs ) }>
															{ __( 'Open the form', 'funnelforms-pro' ) }
															<span className="screen-reader-text">{ ' – ' + form.title }</span>
														</a>
													</span>
												) : null }
											</li>
										);
									} ) }
								</ul>
								<button type="button" className="ffx-btn ffx-btn--ghost ffx-btn--sm" disabled={ busy || 0 === all.length } onClick={ () => toggleAll( source ) }>
									{ every ? __( 'Select none', 'funnelforms-pro' ) : __( 'Select all', 'funnelforms-pro' ) }
								</button>
							</fieldset>
						);
					} ) }
					{ sources && sources.length > 0 ? (
						<div className="ffx-import__bar">
							{ anyImported ? (
								<label className="ffx-toggle">
									<input
										type="checkbox"
										checked={ again }
										onChange={ ( e ) => {
											setAgain( e.target.checked );
											if ( ! e.target.checked ) {
												// Forms imported before can only be chosen while this is on.
												setSelected( ( set ) => new Set( [ ...set ].filter( ( id ) => sources.some( ( s ) => s.forms.some( ( f ) => key( s.source, f.id ) === id && null === f.importedAs ) ) ) ) );
											}
										} }
									/>
									<span className="ffx-toggle__text">
										{ __( 'Import again', 'funnelforms-pro' ) }
										<small>{ __( 'Also choose forms that were imported before. They become new drafts; the earlier ones stay.', 'funnelforms-pro' ) }</small>
									</span>
								</label>
							) : (
								<span />
							) }
							<button type="button" className="ffx-btn ffx-btn--primary" disabled={ busy || 0 === chosen.length } onClick={ () => void importSelected() }>
								{ busy ? __( 'Importing…', 'funnelforms-pro' ) : 1 === chosen.length ? __( 'Import 1 form', 'funnelforms-pro' ) : sprintf( __( 'Import %d forms', 'funnelforms-pro' ), chosen.length ) }
							</button>
						</div>
					) : null }
				</section>

				<section className="ffx-card" aria-labelledby="ffx-import-file">
					<div className="ffx-card__head">
						<div>
							<h2 id="ffx-import-file">{ __( 'Upload an export file', 'funnelforms-pro' ) }</h2>
							<p>{ __( 'Export the forms in the other plugin and upload the file here.', 'funnelforms-pro' ) }</p>
							{ config.importOwn ? (
								<p className="ffx-import__other">
									{ __( 'A file exported from Funnelforms?', 'funnelforms-pro' ) }{ ' ' }
									<a href={ config.importOwn }>{ __( 'Import Funnelforms', 'funnelforms-pro' ) }</a>
								</p>
							) : null }
						</div>
					</div>
					<div
						className={ 'ffx-drop' + ( dragging ? ' is-over' : '' ) }
						onDragOver={ ( e ) => {
							e.preventDefault();
							setDragging( true );
						} }
						onDragLeave={ () => setDragging( false ) }
						onDrop={ ( e ) => {
							e.preventDefault();
							setDragging( false );
							const files = [ ...e.dataTransfer.files ];
							if ( files.length && ! busy ) {
								void importFiles( files );
							}
						} }
					>
						<span className="ffx-drop__mark" aria-hidden="true">
							<Icon path="M12 16V4M7 9l5-5 5 5M5 20h14" />
						</span>
						<p className="ffx-drop__title">{ __( 'Drop the file here', 'funnelforms-pro' ) }</p>
						<p className="ffx-drop__or">{ __( 'or', 'funnelforms-pro' ) }</p>
						<button type="button" className="ffx-btn" disabled={ busy } onClick={ () => picker.current?.click() } aria-describedby="ffx-import-limit">
							{ busy ? __( 'Importing…', 'funnelforms-pro' ) : __( 'Choose file', 'funnelforms-pro' ) }
						</button>
						<input
							ref={ picker }
							type="file"
							hidden
							multiple
							accept=".json,.xml,.nff,.txt,application/json,text/xml,application/xml,text/plain"
							onChange={ ( e ) => {
								const files = [ ...( e.target.files ?? [] ) ];
								e.target.value = '';
								if ( files.length ) {
									void importFiles( files );
								}
							} }
						/>
						<p id="ffx-import-limit" className="ffx-small ffx-muted">
							{ sprintf( __( 'Up to %s MB per file.', 'funnelforms-pro' ), megabytes( maxBytes ) ) }
						</p>
					</div>
					<details className="ffx-import__help">
						<summary>{ __( 'Where do I get the file?', 'funnelforms-pro' ) }</summary>
						<ul>
							<li>{ __( 'WPForms: Tools → Export, JSON', 'funnelforms-pro' ) }</li>
							<li>{ __( 'Gravity Forms: Forms → Import/Export, JSON', 'funnelforms-pro' ) }</li>
							<li>{ __( 'Ninja Forms: Import/Export, .nff file', 'funnelforms-pro' ) }</li>
							<li>{ __( 'Fluent Forms: Tools → Export Forms, JSON', 'funnelforms-pro' ) }</li>
							<li>{ __( 'Contact Form 7: WordPress export (XML) of the forms', 'funnelforms-pro' ) }</li>
							<li>{ __( 'Formidable Forms: Import/Export, XML', 'funnelforms-pro' ) }</li>
							<li>{ __( 'Elementor Pro: template export, JSON', 'funnelforms-pro' ) }</li>
						</ul>
					</details>
				</section>
			</div>
		</div>
	);
}

/** A file that could not be imported, or a form of it that could not be converted. */
interface OwnFailure {
	file: string;
	text: string;
}

/**
 * Import Funnelforms: export files of Funnelforms (a form file of 5.0, .json; an export of
 * Funnelforms 4, the online version, .json; an export of Funnelforms 3, .zip) through
 * admin/forms/import. Each form becomes a draft.
 */
export function FunnelformsImport( { api, config = {} }: { api: { importFile( file: Blob, name: string ): Promise<ImportedForm[]> }; config?: ImportConfig } ) {
	const [ busy, setBusy ] = useState( false );
	const [ forms, setForms ] = useState<ImportedForm[] | null>( null );
	const [ failures, setFailures ] = useState<OwnFailure[]>( [] );
	const [ dragging, setDragging ] = useState( false );
	const picker = useRef<HTMLInputElement>( null );
	const resultHead = useRef<HTMLHeadingElement>( null );
	const maxBytes = config.maxBytes ?? IMPORT_MAX_BYTES;
	const base = config.builderUrl ?? '';
	const editUrl = ( id: number ): string => base + ( base.includes( '?' ) ? '&' : '?' ) + 'form=' + id;

	useEffect( () => {
		if ( forms || failures.length ) {
			resultHead.current?.focus();
		}
	}, [ forms, failures ] );

	const importFiles = async ( files: File[] ): Promise<void> => {
		setBusy( true );
		const done: ImportedForm[] = [];
		const failed: OwnFailure[] = [];
		for ( const file of files ) {
			if ( file.size > maxBytes ) {
				failed.push( { file: file.name, text: sprintf( __( '%1$s is larger than %2$s MB.', 'funnelforms-pro' ), file.name, megabytes( maxBytes ) ) } );
				continue;
			}
			try {
				for ( const form of await api.importFile( file, file.name ) ) {
					if ( null === form.id ) {
						failed.push( { file: file.name, text: sprintf( /* translators: 1: file name, 2: reason */ __( '%1$s: a form could not be converted (%2$s).', 'funnelforms-pro' ), file.name, ( form.errors ?? [] ).join( ', ' ) || '?' ) } );
					} else {
						done.push( form );
					}
				}
			} catch ( e ) {
				failed.push( { file: file.name, text: sprintf( __( '%1$s: %2$s', 'funnelforms-pro' ), file.name, message( e ) ) } );
			}
		}
		setForms( done );
		setFailures( failed );
		setBusy( false );
	};

	return (
		<div className="ffx-import">
			{ forms || failures.length ? (
				<section className="ffx-card ffx-import__result" aria-labelledby="ffx-import-result">
					<div className="ffx-card__head">
						<div>
							<h2 id="ffx-import-result" ref={ resultHead } tabIndex={ -1 }>
								{ __( 'Result', 'funnelforms-pro' ) }
							</h2>
							<p>
								{ ! forms?.length
									? __( 'No new form was created.', 'funnelforms-pro' )
									: 1 === forms.length
									? __( '1 form was imported as a draft. Nothing is live yet: open it, check it and publish it.', 'funnelforms-pro' )
									: sprintf( __( '%d forms were imported as drafts. Nothing is live yet: open each one, check it and publish it.', 'funnelforms-pro' ), forms.length ) }
							</p>
						</div>
						<button
							type="button"
							className="ffx-btn ffx-btn--sm"
							onClick={ () => {
								setForms( null );
								setFailures( [] );
							} }
						>
							{ __( 'Close', 'funnelforms-pro' ) }
						</button>
					</div>
					{ failures.map( ( f, i ) => (
						<div key={ i } className="ffx-notice ffx-notice--danger" role="alert">
							<p>{ f.text }</p>
						</div>
					) ) }
					<ul className="ffx-import__rows">
						{ ( forms ?? [] ).map( ( form ) => {
							const todo = problemTexts( form.problems ?? [] );
							const notes = form.messages ?? form.notes ?? [];
							return (
								<li key={ form.id } className="ffx-import__row">
									<div className="ffx-import__row-head">
										<div className="ffx-rows__main">
											<span className="ffx-rows__title">{ form.title }</span>
											<span className="ffx-rows__meta">{ form.legacyId ? __( 'Funnelforms 3', 'funnelforms-pro' ) : 'ff4' === form.source ? __( 'Funnelforms 4', 'funnelforms-pro' ) : 'Funnelforms' }</span>
										</div>
										<span className="ffx-badge ffx-badge--success">{ __( 'Draft created', 'funnelforms-pro' ) }</span>
										{ null !== form.id ? (
											<a className="ffx-btn ffx-btn--primary ffx-btn--sm" href={ editUrl( form.id ) }>
												<span>{ __( 'Open in the editor', 'funnelforms-pro' ) }</span>
												<span className="screen-reader-text">{ ' – ' + ( form.title ?? '' ) }</span>
											</a>
										) : null }
									</div>
									{ 0 === notes.length && 0 === todo.length ? <p className="ffx-import__ok">{ __( 'Everything was taken over.', 'funnelforms-pro' ) }</p> : null }
									{ notes.length > 0 ? (
										<div className="ffx-import__notes">
											<h3>{ __( 'Not taken over, or changed', 'funnelforms-pro' ) }</h3>
											<ul>
												{ notes.map( ( n ) => (
													<li key={ n }>{ n }</li>
												) ) }
											</ul>
										</div>
									) : null }
									{ todo.length > 0 ? (
										<div className="ffx-import__notes ffx-import__notes--todo">
											<h3>{ __( 'To do before you can publish', 'funnelforms-pro' ) }</h3>
											<ul>
												{ todo.map( ( n ) => (
													<li key={ n }>{ n }</li>
												) ) }
											</ul>
										</div>
									) : null }
								</li>
							);
						} ) }
					</ul>
				</section>
			) : null }

			<div className="ffx-split">
				<section className="ffx-card" aria-labelledby="ffx-import-own">
					<div className="ffx-card__head">
						<div>
							<h2 id="ffx-import-own">{ __( 'Upload a Funnelforms file', 'funnelforms-pro' ) }</h2>
							<p>{ __( 'Several files at once are fine. Forms of other plugins have their own import.', 'funnelforms-pro' ) }</p>
						</div>
					</div>
					<div
						className={ 'ffx-drop' + ( dragging ? ' is-over' : '' ) }
						onDragOver={ ( e ) => {
							e.preventDefault();
							setDragging( true );
						} }
						onDragLeave={ () => setDragging( false ) }
						onDrop={ ( e ) => {
							e.preventDefault();
							setDragging( false );
							const files = [ ...e.dataTransfer.files ];
							if ( files.length && ! busy ) {
								void importFiles( files );
							}
						} }
					>
						<span className="ffx-drop__mark" aria-hidden="true">
							<Icon path="M12 16V4M7 9l5-5 5 5M5 20h14" />
						</span>
						<p className="ffx-drop__title">{ __( 'Drop the file here', 'funnelforms-pro' ) }</p>
						<p className="ffx-drop__or">{ __( 'or', 'funnelforms-pro' ) }</p>
						<button type="button" className="ffx-btn ffx-btn--primary" disabled={ busy } onClick={ () => picker.current?.click() } aria-describedby="ffx-import-own-limit">
							{ busy ? __( 'Importing…', 'funnelforms-pro' ) : __( 'Choose file', 'funnelforms-pro' ) }
						</button>
						<input
							ref={ picker }
							type="file"
							hidden
							multiple
							accept=".json,.zip,application/json,application/zip"
							onChange={ ( e ) => {
								const files = [ ...( e.target.files ?? [] ) ];
								e.target.value = '';
								if ( files.length ) {
									void importFiles( files );
								}
							} }
						/>
						<p id="ffx-import-own-limit" className="ffx-small ffx-muted">
							{ sprintf( /* translators: %s: largest file size in MB */ __( '.json or .zip, up to %s MB per file.', 'funnelforms-pro' ), megabytes( maxBytes ) ) }
						</p>
					</div>
				</section>

				<section className="ffx-card" aria-labelledby="ffx-import-own-help">
					<div className="ffx-card__head">
						<div>
							<h2 id="ffx-import-own-help">{ __( 'Which files?', 'funnelforms-pro' ) }</h2>
						</div>
					</div>
					<ul className="ffx-import__kinds">
						<li>
							<strong>{ __( 'Funnelforms 5', 'funnelforms-pro' ) }</strong>
							<span>{ __( 'A form file (.json): under Forms, the export button of a form downloads it.', 'funnelforms-pro' ) }</span>
						</li>
						<li>
							<strong>{ __( 'Funnelforms 4', 'funnelforms-pro' ) }</strong>
							<span>{ __( 'The export of the online version (.json), with logic, contact form, thank-you page, e-mails, webhooks and design. Entries stay in Funnelforms 4.', 'funnelforms-pro' ) }</span>
						</li>
						<li>
							<strong>{ __( 'Funnelforms 3', 'funnelforms-pro' ) }</strong>
							<span>{ __( 'The export of the forms (.zip) from the import and export of Funnelforms 3, with questions and contact forms. Calculations and connections (CRM, SMTP) are not part of it.', 'funnelforms-pro' ) }</span>
						</li>
					</ul>
					{ config.importUrl ? (
						<p className="ffx-import__other">
							{ __( 'Forms of Contact Form 7, WPForms, Gravity Forms or another form plugin?', 'funnelforms-pro' ) }{ ' ' }
							<a href={ config.importUrl }>{ __( 'Import from other plugins', 'funnelforms-pro' ) }</a>
						</p>
					) : null }
				</section>
			</div>
		</div>
	);
}
