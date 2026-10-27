/**
 * The list of forms (Funnelforms → Forms) in the frame of the other admin pages: key figures of
 * the last 30 days, the forms by status with search and category, per form its entries, views
 * and conversion, and the actions per form.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AiConfig, FormFigure, FormFigures, FormList, FormsApi, FormStatus, FormSummary, ImportedForm } from '../api';
import { ApiError } from '../api';
import { change, relativeTime } from '../entries';
import { Badge, Button, icons, Notice, Spinner } from './ui';
import { EmptyState, Frame, FrameButton, Icon, Kpi, Pill, Spark } from './Frame';
import { NewFormDialog } from './NewForm';
import { StatsDialog } from './Stats';
import { __, sprintf } from './i18n';

type Tab = 'all' | FormStatus;

/** A share as the plugin's pages write it: 37.4 %. */
function percent( rate: number ): string {
	return ( Math.round( 1000 * rate ) / 10 ).toLocaleString( undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 } ) + ' %';
}

/**
 * The list of forms. The head offers the two imports by the names the menu gives them: Import
 * Funnelforms (export files of Funnelforms; its page when importOwn is given, else the file
 * picker right here) and Import from other plugins (importUrl).
 */
export function FormsList( { api, onOpen, importUrl, importOwn, ai }: { api: FormsApi; onOpen: ( id: number ) => void; importUrl?: string; importOwn?: string; ai?: AiConfig | null } ) {
	const [ tab, setTab ] = useState<Tab>( 'all' );
	const [ search, setSearch ] = useState( '' );
	const [ category, setCategory ] = useState<string | null>( null );
	const [ page, setPage ] = useState( 1 );
	const [ data, setData ] = useState<FormList | null>( null );
	const [ figures, setFigures ] = useState<FormFigures | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ notice, setNotice ] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>( null );
	const [ creating, setCreating ] = useState( false );
	const [ busy, setBusy ] = useState( false );
	const [ statsFor, setStatsFor ] = useState<FormSummary | null>( null );
	const fileInput = useRef<HTMLInputElement>( null );
	const perPage = 20;

	const reload = useCallback( async () => {
		setError( null );
		try {
			setData(
				await api.list( {
					search,
					status: 'all' === tab ? undefined : tab,
					category: category ?? undefined,
					page,
					perPage,
				} )
			);
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
	}, [ api, search, tab, category, page ] );

	useEffect( () => {
		const timer = setTimeout( () => void reload(), search ? 250 : 0 );
		return () => clearTimeout( timer );
	}, [ reload, search ] );

	const loadFigures = useCallback( async () => {
		if ( ! api.formFigures ) {
			return;
		}
		try {
			setFigures( await api.formFigures() );
		} catch {
			// The list works without them.
		}
	}, [ api ] );
	useEffect( () => {
		void loadFigures();
	}, [ loadFigures ] );

	const act = async ( work: () => Promise<unknown>, done?: string ): Promise<void> => {
		setBusy( true );
		try {
			await work();
			if ( done ) {
				setNotice( { tone: 'success', text: done } );
			}
			await reload();
			void loadFigures();
		} catch ( e ) {
			setNotice( { tone: 'danger', text: e instanceof ApiError || e instanceof Error ? e.message : String( e ) } );
		} finally {
			setBusy( false );
		}
	};

	const download = async ( form: FormSummary ): Promise<void> => {
		const data = await api.exportForm( form.id, 'draft' );
		const url = URL.createObjectURL( new Blob( [ JSON.stringify( data, null, 2 ) ], { type: 'application/json' } ) );
		const link = document.createElement( 'a' );
		link.href = url;
		link.download = ( form.title || 'form' ).replace( /[^\p{L}\p{N}-]+/gu, '-' ) + '.funnelforms.json';
		link.click();
		setTimeout( () => URL.revokeObjectURL( url ), 1000 );
	};

	const upload = async ( file: File ): Promise<void> => {
		setBusy( true );
		try {
			const forms: ImportedForm[] = await api.importFile( file, file.name );
			const ok = forms.filter( ( f ) => null !== f.id ).length;
			const failed = forms.length - ok;
			setNotice(
				failed
					? { tone: 'warning', text: sprintf( __( '%1$d forms imported as drafts, %2$d could not be converted.', 'funnelforms-pro' ), ok, failed ) }
					: { tone: 'success', text: sprintf( __( '%d forms imported as drafts. Check them and publish.', 'funnelforms-pro' ), ok ) }
			);
			setTab( 'draft' );
			await reload();
			void loadFigures();
		} catch ( e ) {
			setNotice( { tone: 'danger', text: e instanceof Error ? e.message : String( e ) } );
		} finally {
			setBusy( false );
			if ( fileInput.current ) {
				fileInput.current.value = '';
			}
		}
	};

	const counts = figures?.forms;
	const tabs: Array<{ id: Tab; label: string; count?: number }> = [
		{ id: 'all', label: __( 'All', 'funnelforms-pro' ), count: counts?.total },
		{ id: 'published', label: __( 'Published', 'funnelforms-pro' ), count: counts?.published },
		{ id: 'draft', label: __( 'Drafts', 'funnelforms-pro' ), count: counts?.draft },
		{ id: 'trashed', label: __( 'Trash', 'funnelforms-pro' ), count: counts?.trashed },
	];
	const f = figures?.figures ?? null;
	const trend = f ? change( f.entries, f.entriesBefore ) : null;
	const measured = null !== f;

	return (
		<Frame
			title={ __( 'Forms', 'funnelforms-pro' ) }
			lead={ __( 'Build your forms, publish them and see how each one performs.', 'funnelforms-pro' ) }
			actions={
				<>
					{ importOwn ? (
						<a className="ffx-btn" href={ importOwn } title={ __( 'Forms exported from Funnelforms 5 or 4 (.json) or Funnelforms 3 (.zip)', 'funnelforms-pro' ) }>
							<Icon name="upload" />
							<span>{ __( 'Import Funnelforms', 'funnelforms-pro' ) }</span>
						</a>
					) : (
						<FrameButton icon="upload" onClick={ () => fileInput.current?.click() } disabled={ busy } title={ __( 'Forms exported from Funnelforms 5 or 4 (.json) or Funnelforms 3 (.zip)', 'funnelforms-pro' ) }>
							{ __( 'Import Funnelforms', 'funnelforms-pro' ) }
						</FrameButton>
					) }
					{ importUrl ? (
						<a className="ffx-btn" href={ importUrl } title={ __( 'Forms of Contact Form 7, WPForms, Gravity Forms and other form plugins', 'funnelforms-pro' ) }>
							<Icon name="download" />
							<span>{ __( 'Import from other plugins', 'funnelforms-pro' ) }</span>
						</a>
					) : null }
					<input
						ref={ fileInput }
						type="file"
						accept=".json,.zip,application/json,application/zip"
						hidden
						onChange={ ( e ) => {
							const file = e.target.files?.[ 0 ];
							if ( file ) {
								void upload( file );
							}
						} }
					/>
					<FrameButton variant="primary" icon="plus" onClick={ () => setCreating( true ) }>
						{ __( 'New form', 'funnelforms-pro' ) }
					</FrameButton>
				</>
			}
		>
			{ notice ? (
				<Notice tone={ notice.tone } action={ <Button variant="ghost" size="sm" aria-label={ __( 'Close', 'funnelforms-pro' ) } icon={ icons.close } onClick={ () => setNotice( null ) } /> }>
					{ notice.text }
				</Notice>
			) : null }

			{ figures ? (
				<section className="ffx-grid ffxb-kpis" aria-label={ __( 'Key figures', 'funnelforms-pro' ) }>
					<Kpi icon="form" label={ __( 'Forms', 'funnelforms-pro' ) } value={ figures.forms.total.toLocaleString() } hint={ sprintf( __( '%s published', 'funnelforms-pro' ), figures.forms.published.toLocaleString() ) } />
					{ f ? (
						<>
							<Kpi icon="eye" label={ __( 'Views', 'funnelforms-pro' ) } value={ f.views.toLocaleString() } hint={ __( 'Last 30 days, once per visit', 'funnelforms-pro' ) } />
							<Kpi
								icon="inbox"
								label={ __( 'Entries', 'funnelforms-pro' ) }
								value={ f.entries.toLocaleString() }
								hint={ null === trend ? __( 'Last 30 days', 'funnelforms-pro' ) : sprintf( __( '%s against the 30 days before', 'funnelforms-pro' ), ( trend > 0 ? '+' : '' ) + trend.toLocaleString() + ' %' ) }
								tone={ null === trend || 0 === trend ? '' : trend > 0 ? 'up' : 'down' }
							/>
							<Kpi icon="chart" label={ __( 'Conversion rate', 'funnelforms-pro' ) } value={ null === f.rate ? '–' : percent( f.rate ) } hint={ __( 'Entries per view, last 30 days', 'funnelforms-pro' ) } />
						</>
					) : null }
				</section>
			) : null }

			<section className="ffx-card ffx-card--flush ffxb-listcard">
				<div className="ffxb-listbar">
					<div className="ffxb-listbar__row">
						<div className="ffx-segment ffxb-scope" role="group" aria-label={ __( 'Status', 'funnelforms-pro' ) }>
							{ tabs.map( ( t ) => (
								<button
									key={ t.id }
									type="button"
									aria-pressed={ tab === t.id }
									onClick={ () => {
										setTab( t.id );
										setPage( 1 );
									} }
								>
									{ t.label }
									{ undefined === t.count ? null : <span className="ffxb-scope__count">{ t.count.toLocaleString() }</span> }
								</button>
							) ) }
						</div>
						<label className="ffxb-search">
							<Icon name="search" />
							<input
								type="search"
								placeholder={ __( 'Search forms', 'funnelforms-pro' ) }
								aria-label={ __( 'Search forms', 'funnelforms-pro' ) }
								value={ search }
								onChange={ ( e ) => {
									setSearch( e.target.value );
									setPage( 1 );
								} }
							/>
						</label>
						{ data && data.categories.length > 0 ? (
							<span className={ 'ffxb-barselect' + ( null === category ? '' : ' is-active' ) }>
								<select aria-label={ __( 'Category', 'funnelforms-pro' ) } value={ category ?? '' } onChange={ ( e ) => setCategory( '' === e.target.value ? null : e.target.value ) }>
									<option value="">{ __( 'All categories', 'funnelforms-pro' ) }</option>
									{ data.categories.map( ( c ) => (
										<option key={ c } value={ c }>
											{ c }
										</option>
									) ) }
								</select>
								<Icon name="down" />
							</span>
						) : null }
					</div>
				</div>

				{ error ? (
					<div className="ffxb-listcard__inner">
						<Notice tone="danger" title={ __( 'The forms could not be loaded.', 'funnelforms-pro' ) } action={ <Button onClick={ () => void reload() }>{ __( 'Try again', 'funnelforms-pro' ) }</Button> }>
							{ error }
						</Notice>
					</div>
				) : null }

				{ ! data && ! error ? <Spinner label={ __( 'Loading forms…', 'funnelforms-pro' ) } /> : null }

				{ data && 0 === data.forms.length ? (
					'trashed' === tab && ! search && ! category ? (
						<EmptyState icon="trash" title={ __( 'The trash is empty', 'funnelforms-pro' ) }>
							{ __( 'Forms you move to the trash wait here until you restore or delete them.', 'funnelforms-pro' ) }
						</EmptyState>
					) : search || category || 'all' !== tab ? (
						<EmptyState icon="search" title={ __( 'No forms found', 'funnelforms-pro' ) }>
							{ __( 'Try another search or status.', 'funnelforms-pro' ) }
						</EmptyState>
					) : (
						<EmptyState
							icon="form"
							title={ __( 'Create your first form', 'funnelforms-pro' ) }
							action={
								<FrameButton variant="primary" icon="plus" onClick={ () => setCreating( true ) }>
									{ __( 'New form', 'funnelforms-pro' ) }
								</FrameButton>
							}
						>
							{ __( 'Pick what the form should do and start from a template, or start from scratch.', 'funnelforms-pro' ) }
						</EmptyState>
					)
				) : null }

				{ data && data.forms.length > 0 ? (
					<div className={ 'ffxb-forms' + ( measured ? '' : ' is-plain' ) } role="table" aria-label={ __( 'Forms', 'funnelforms-pro' ) } aria-busy={ busy }>
						<div className="ffxb-forms__head" role="row">
							<span role="columnheader">{ __( 'Form', 'funnelforms-pro' ) }</span>
							{ measured ? (
								<>
									<span role="columnheader" className="ffxb-forms__num" title={ __( 'Last 30 days', 'funnelforms-pro' ) }>
										{ __( 'Entries', 'funnelforms-pro' ) }
									</span>
									<span role="columnheader" className="ffxb-forms__num" title={ __( 'Last 30 days', 'funnelforms-pro' ) }>
										{ __( 'Views', 'funnelforms-pro' ) }
									</span>
									<span role="columnheader" className="ffxb-forms__num" title={ __( 'Last 30 days', 'funnelforms-pro' ) }>
										{ __( 'Conversion', 'funnelforms-pro' ) }
									</span>
								</>
							) : null }
							<span role="columnheader" className="ffxb-forms__period">
								<span className="screen-reader-text">{ __( 'Actions', 'funnelforms-pro' ) }</span>
							</span>
						</div>
						<ul className="ffxb-list">
							{ data.forms.map( ( form ) => (
								<FormRow
									key={ form.id }
									form={ form }
									figure={ f ? f.forms[ String( form.id ) ] ?? null : undefined }
									onOpen={ () => onOpen( form.id ) }
									onStats={ null !== form.entries && null !== form.currentRevision ? () => setStatsFor( form ) : undefined }
									onDuplicate={ () => void act( () => api.duplicate( form.id ), __( 'Copy created as a draft.', 'funnelforms-pro' ) ) }
									onExport={ () => void act( () => download( form ) ) }
									onTrash={ () => void act( () => api.remove( form.id ), __( 'Moved to the trash.', 'funnelforms-pro' ) ) }
									onRestore={ () => void act( () => api.update( form.id, { status: null === form.currentRevision ? 'draft' : 'published' } ), __( 'Restored.', 'funnelforms-pro' ) ) }
									onDelete={ () => void act( () => api.remove( form.id, true ), __( 'Deleted.', 'funnelforms-pro' ) ) }
								/>
							) ) }
						</ul>
					</div>
				) : null }

				{ data && data.total > perPage ? (
					<footer className="ffxb-listfoot">
						<span />
						<nav className="ffxb-pagination" aria-label={ __( 'Pages', 'funnelforms-pro' ) }>
							<span>{ sprintf( __( 'Page %1$d of %2$d', 'funnelforms-pro' ), page, Math.ceil( data.total / perPage ) ) }</span>
							<FrameButton size="sm" icon="left" aria-label={ __( 'Previous', 'funnelforms-pro' ) } title={ __( 'Previous', 'funnelforms-pro' ) } disabled={ page <= 1 } onClick={ () => setPage( page - 1 ) } />
							<FrameButton size="sm" icon="right" aria-label={ __( 'Next', 'funnelforms-pro' ) } title={ __( 'Next', 'funnelforms-pro' ) } disabled={ page * perPage >= data.total } onClick={ () => setPage( page + 1 ) } />
						</nav>
					</footer>
				) : null }
			</section>

			{ statsFor ? <StatsDialog api={ api } formId={ statsFor.id } title={ statsFor.title } onClose={ () => setStatsFor( null ) } /> : null }

			{ creating ? (
				<NewFormDialog
					api={ api }
					category={ category ?? undefined }
					ai={ ai }
					onClose={ () => setCreating( false ) }
					onCreated={ ( id ) => {
						setCreating( false );
						onOpen( id );
					} }
				/>
			) : null }
		</Frame>
	);
}

/** The time of a form's last change, as people say it. */
function changedAt( form: FormSummary ): string {
	const when = form.draftUpdatedAt ?? form.updatedAt;
	return when ? relativeTime( when.replace( ' ', 'T' ) + ( /[zZ+]/.test( when ) ? '' : 'Z' ) ) : '';
}

/**
 * One form. figure: its figures of the last 30 days, null without any, undefined when the user
 * may not see them.
 */
function FormRow( props: { form: FormSummary; figure?: FormFigure | null; onOpen: () => void; onStats?: () => void; onDuplicate: () => void; onExport: () => void; onTrash: () => void; onRestore: () => void; onDelete: () => void } ) {
	const { form, figure } = props;
	const [ copied, setCopied ] = useState( false );
	const trashed = 'trashed' === form.status;
	const changed = changedAt( form );
	const copy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText( form.shortcode );
			setCopied( true );
			setTimeout( () => setCopied( false ), 1500 );
		} catch {
			// The shortcode stays visible to copy by hand.
		}
	};
	const rate = figure && null !== figure.rate ? percent( figure.rate ) : '–';
	return (
		<li className={ 'ffxb-row ffxb-row--' + form.status } role="row">
			<div className="ffxb-row__form" role="cell">
				<span className="ffxb-row__avatar" aria-hidden="true">
					{ ( form.title.trim()[ 0 ] ?? '?' ).toUpperCase() }
				</span>
				<div className="ffxb-row__main">
					{ trashed ? (
						<span className="ffxb-row__title">{ form.title }</span>
					) : (
						<button type="button" className="ffxb-row__title ffxb-link" onClick={ props.onOpen }>
							{ form.title }
						</button>
					) }
					<div className="ffxb-row__meta">
						<FormStatusPill form={ form } />
						{ form.category ? <span className="ffxb-row__category">{ form.category }</span> : null }
						{ null !== form.entries && undefined === figure ? <span>{ sprintf( __( '%d entries', 'funnelforms-pro' ), form.entries.toLocaleString() ) }</span> : null }
						{ changed ? <span>{ sprintf( __( 'Last change: %s', 'funnelforms-pro' ), changed ) }</span> : null }
						{ form.lockedBy ? <span className="ffxb-row__lock">{ sprintf( __( '%s is editing', 'funnelforms-pro' ), form.lockedBy.name ) }</span> : null }
						<button type="button" className="ffxb-shortcode" onClick={ () => void copy() } title={ __( 'Copy shortcode', 'funnelforms-pro' ) + ': ' + form.shortcode }>
							<code>{ form.shortcode }</code>
							<span className="ffxb-shortcode__state">
								{ copied ? <Icon name="check" /> : <Icon name="copy" /> }
								{ copied ? __( 'Copied', 'funnelforms-pro' ) : __( 'Copy', 'funnelforms-pro' ) }
							</span>
						</button>
					</div>
				</div>
			</div>
			{ undefined === figure ? null : (
				<>
					<div className="ffxb-row__figure" role="cell" data-label={ __( 'Entries', 'funnelforms-pro' ) }>
						<strong>{ figure ? figure.entries.toLocaleString() : '–' }</strong>
						{ figure && figure.series.some( ( n ) => n > 0 ) ? <Spark series={ figure.series } label={ __( 'Entries per day, last 30 days', 'funnelforms-pro' ) } /> : null }
					</div>
					<div className="ffxb-row__figure" role="cell" data-label={ __( 'Views', 'funnelforms-pro' ) }>
						<strong>{ figure && figure.measured ? figure.views.toLocaleString() : '–' }</strong>
					</div>
					<div className="ffxb-row__figure" role="cell" data-label={ __( 'Conversion', 'funnelforms-pro' ) } title={ figure && ! figure.measured ? __( 'Views are measured once the form runs on Funnelforms 5.', 'funnelforms-pro' ) : undefined }>
						<strong>{ rate }</strong>
					</div>
				</>
			) }
			<div className="ffxb-row__actions" role="cell">
				{ trashed ? (
					<>
						<FrameButton size="sm" icon="undo" onClick={ props.onRestore }>
							{ __( 'Restore', 'funnelforms-pro' ) }
						</FrameButton>
						<FrameButton size="sm" variant="danger" onClick={ props.onDelete } disabled={ null !== form.legacyId }>
							{ __( 'Delete permanently', 'funnelforms-pro' ) }
						</FrameButton>
					</>
				) : (
					<>
						<FrameButton size="sm" icon="edit" className="ffxb-row__edit" onClick={ props.onOpen }>
							{ __( 'Edit', 'funnelforms-pro' ) }
						</FrameButton>
						<span className="ffxb-row__tools">
							{ props.onStats ? <FrameButton size="sm" variant="ghost" icon="stats" onClick={ props.onStats } aria-label={ __( 'Statistics', 'funnelforms-pro' ) } title={ __( 'Statistics', 'funnelforms-pro' ) } /> : null }
							<FrameButton size="sm" variant="ghost" icon="copy" onClick={ props.onDuplicate } aria-label={ __( 'Duplicate', 'funnelforms-pro' ) } title={ __( 'Duplicate', 'funnelforms-pro' ) } />
							<FrameButton size="sm" variant="ghost" icon="download" onClick={ props.onExport } aria-label={ __( 'Export', 'funnelforms-pro' ) } title={ __( 'Export', 'funnelforms-pro' ) } />
							<FrameButton size="sm" variant="ghost" icon="trash" onClick={ props.onTrash } aria-label={ __( 'Move to trash', 'funnelforms-pro' ) } title={ __( 'Move to trash', 'funnelforms-pro' ) } />
						</span>
					</>
				) }
			</div>
		</li>
	);
}

/** The status of a form in the list, in the look of the plugin's pages. */
function FormStatusPill( { form }: { form: FormSummary } ) {
	if ( 'trashed' === form.status ) {
		return <Pill tone="danger">{ __( 'In the trash', 'funnelforms-pro' ) }</Pill>;
	}
	if ( 'published' === form.status ) {
		if ( form.hasDraft ) {
			return <Pill tone="warning">{ __( 'Published, with changes', 'funnelforms-pro' ) }</Pill>;
		}
		return 'legacy' === form.renderer ? <Pill tone="info">{ __( 'Live on Funnelforms 3', 'funnelforms-pro' ) }</Pill> : <Pill tone="success">{ __( 'Published', 'funnelforms-pro' ) }</Pill>;
	}
	return <Pill>{ __( 'Draft', 'funnelforms-pro' ) }</Pill>;
}

/** The status of a form, as the editor's top bar shows it. */
export function StatusBadge( { form }: { form: FormSummary } ) {
	if ( 'trashed' === form.status ) {
		return <Badge tone="danger">{ __( 'In the trash', 'funnelforms-pro' ) }</Badge>;
	}
	if ( 'published' === form.status ) {
		return form.hasDraft ? <Badge tone="warning">{ __( 'Published, with changes', 'funnelforms-pro' ) }</Badge> : <Badge tone="success">{ __( 'Published', 'funnelforms-pro' ) }</Badge>;
	}
	return <Badge>{ __( 'Draft', 'funnelforms-pro' ) }</Badge>;
}
