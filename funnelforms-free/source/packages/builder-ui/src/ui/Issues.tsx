/**
 * The issues of the open form (issues.ts) on screen: a card per issue with what is wrong, where,
 * how to solve it, "Show" (brings the place into view and marks it) and, where possible, a button
 * that fixes it; the check in the top bar that lists them all from every workspace.
 */
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Selection } from '../store';
import { currentProblems, formIssues, problemIssues, type Issue } from './formCheck';
import { logicHints, type LogicHint } from '../logic';
import { useBuilder, useEnv, ViewContext } from './context';
import { __, sprintf } from './i18n';
import { Button } from './ui';

/** The hints about the logic of the open document, worked out again when it changes. */
export function useHints(): LogicHint[] {
	const doc = useBuilder( ( s ) => s.doc );
	return useMemo( () => ( doc ? logicHints( doc ) : [] ), [ doc ] );
}

/** Every issue of the open form, worked out again when it changes. */
export function useIssues(): Issue[] {
	const { ctx } = useEnv();
	const doc = useBuilder( ( s ) => s.doc );
	const problems = useBuilder( ( s ) => s.problems );
	const hints = useHints();
	return useMemo( () => ( doc ? formIssues( doc, currentProblems( doc, problems ), hints, ctx.locale ) : [] ), [ doc, problems, hints, ctx.locale ] );
}

/** Brings the place of an issue into view: its workspace, or the canvas with it selected and marked. */
export function useShowIssue(): ( issue: Issue ) => void {
	const { store } = useEnv();
	const open = useContext( ViewContext );
	return ( issue ) => {
		const target = issue.target;
		if ( ! target ) {
			return;
		}
		if ( target.view ) {
			open( target.view );
			return;
		}
		open( 'build' );
		const selection: Selection = target.edge ? { edge: target.edge } : { node: target.node, field: target.field };
		store.getState().reveal( selection, target.panel ?? ( target.field ? undefined : 'content' ) );
	};
}

/** Runs the fix of an issue as one step to undo, and says so. */
export function useFixIssue(): ( issue: Issue ) => void {
	const { store, ctx } = useEnv();
	return ( issue ) => {
		const fix = issue.fix;
		if ( ! fix ) {
			return;
		}
		const state = store.getState();
		let next: Selection | null = null;
		state.change( ( d ) => {
			next = fix.run( d, ctx );
		} );
		const after = next as Selection | null;
		if ( after ) {
			state.reveal( after );
		}
		state.notify( sprintf( /* translators: %s: what was wrong, e.g. Two fields have the same ID */ __( 'Fixed: %s', 'funnelforms-pro' ), issue.title ) );
	};
}

function IssueIcon( { tone }: { tone: Issue[ 'tone' ] } ) {
	return (
		<span className="ffxb-issue__icon" aria-hidden="true">
			{ 'error' === tone ? (
				<svg viewBox="0 0 16 16" width="16" height="16">
					<circle cx="8" cy="8" r="7" fill="currentColor" />
					<path d="M8 4.5v4.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
					<circle cx="8" cy="11.3" r="1" fill="#fff" />
				</svg>
			) : (
				<svg viewBox="0 0 16 16" width="16" height="16">
					<path d="M8 1.5 15 14H1z" fill="currentColor" strokeLinejoin="round" />
					<path d="M8 6v3.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
					<circle cx="8" cy="11.6" r=".9" fill="#fff" />
				</svg>
			) }
		</span>
	);
}

/**
 * One issue. `compact`: inside the properties of the place itself, so without the place and
 * without "Show". `onShow` runs before the place is shown (a dialog closes).
 */
export function IssueCard( { issue, compact = false, onShow }: { issue: Issue; compact?: boolean; onShow?: () => void } ) {
	const { readOnly } = useEnv();
	const show = useShowIssue();
	const fix = useFixIssue();
	const label = issue.blocking ? __( 'Blocks publishing', 'funnelforms-pro' ) : 'error' === issue.tone ? __( 'Visitors get stuck', 'funnelforms-pro' ) : __( 'Worth a look', 'funnelforms-pro' );
	return (
		<li className={ `ffxb-issue ffxb-issue--${ issue.tone }` + ( compact ? ' ffxb-issue--compact' : '' ) } data-issue={ issue.key }>
			<IssueIcon tone={ issue.tone } />
			<div className="ffxb-issue__body">
				<div className="ffxb-issue__head">
					<strong className="ffxb-issue__title">{ issue.title }</strong>
					{ compact ? null : <span className="ffxb-issue__tag">{ label }</span> }
				</div>
				{ ! compact && issue.place ? (
					<span className="ffxb-issue__place">
						<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
							<path d="M8 14.5s4.5-4.2 4.5-7.7A4.5 4.5 0 0 0 3.5 6.8c0 3.5 4.5 7.7 4.5 7.7z" fill="none" stroke="currentColor" strokeWidth="1.4" />
							<circle cx="8" cy="6.8" r="1.6" fill="currentColor" />
						</svg>
						<span>{ issue.place }</span>
					</span>
				) : null }
				{ issue.help ? <p className="ffxb-issue__help">{ issue.help }</p> : null }
				{ issue.fix || ( ! compact && issue.target ) ? (
					<div className="ffxb-issue__actions">
						{ issue.fix ? (
							<Button
								size="sm"
								variant={ 'error' === issue.tone ? 'primary' : 'secondary' }
								className="ffxb-issue__fix"
								disabled={ readOnly }
								onClick={ () => {
									onShow?.();
									fix( issue );
								} }
							>
								{ issue.fix.label }
							</Button>
						) : null }
						{ ! compact && issue.target ? (
							<button
								type="button"
								className="ffxb-issue__show"
								onClick={ () => {
									onShow?.();
									show( issue );
								} }
							>
								{ __( 'Show', 'funnelforms-pro' ) }
								<span aria-hidden="true"> →</span>
							</button>
						) : null }
					</div>
				) : null }
			</div>
		</li>
	);
}

export function IssueList( { issues, compact = false, onShow }: { issues: Issue[]; compact?: boolean; onShow?: () => void } ) {
	if ( ! issues.length ) {
		return null;
	}
	return (
		<ul className={ 'ffxb-issues' + ( compact ? ' ffxb-issues--compact' : '' ) }>
			{ issues.map( ( i ) => (
				<IssueCard key={ i.key } issue={ i } compact={ compact } onShow={ onShow } />
			) ) }
		</ul>
	);
}

/** "2 problems · 3 hints", or that all is well. */
export function issueCounts( issues: Issue[] ): { errors: number; warnings: number; text: string } {
	const errors = issues.filter( ( i ) => 'error' === i.tone ).length;
	const warnings = issues.length - errors;
	const parts = [
		errors ? sprintf( /* translators: %d: number of problems */ __( 'Problems: %d', 'funnelforms-pro' ), errors ) : '',
		warnings ? sprintf( /* translators: %d: number of hints */ __( 'Hints: %d', 'funnelforms-pro' ), warnings ) : '',
	].filter( Boolean );
	return { errors, warnings, text: parts.join( ' · ' ) };
}

/** All issues of the form with a summary at the top, or that everything is in order. */
export function IssueOverview( { issues, onShow }: { issues: Issue[]; onShow?: () => void } ) {
	if ( ! issues.length ) {
		return <p className="ffxb-check-ok">{ __( 'Everything is in order: every step leads on and the form can be published.', 'funnelforms-pro' ) }</p>;
	}
	const blocking = issues.filter( ( i ) => i.blocking ).length;
	return (
		<>
			<p className={ 'ffxb-issues-summary' + ( blocking ? ' is-blocked' : '' ) }>
				{ blocking
					? sprintf( /* translators: %d: number of problems */ __( 'Problems that keep the form from being published: %d', 'funnelforms-pro' ), blocking )
					: __( 'The form can be published. These points are worth a look.', 'funnelforms-pro' ) }
			</p>
			<IssueList issues={ issues } onShow={ onShow } />
		</>
	);
}

/** The check in the top bar: its count, and the list of issues in a panel below it. */
export function CheckButton() {
	const issues = useIssues();
	const [ open, setOpen ] = useState( false );
	const ref = useRef<HTMLDivElement>( null );
	const { errors, text } = issueCounts( issues );

	useEffect( () => {
		if ( ! open ) {
			return undefined;
		}
		const away = ( e: MouseEvent ): void => {
			if ( ref.current && ! ref.current.contains( e.target as Node ) ) {
				setOpen( false );
			}
		};
		const key = ( e: KeyboardEvent ): void => {
			if ( 'Escape' === e.key ) {
				setOpen( false );
			}
		};
		document.addEventListener( 'mousedown', away );
		document.addEventListener( 'keydown', key );
		return () => {
			document.removeEventListener( 'mousedown', away );
			document.removeEventListener( 'keydown', key );
		};
	}, [ open ] );

	const tone = errors ? 'error' : issues.length ? 'warning' : 'ok';
	return (
		<div className="ffxb-check" ref={ ref }>
			<button
				type="button"
				className={ `ffxb-check__button is-${ tone }` }
				aria-expanded={ open }
				aria-haspopup="dialog"
				title={ text || __( 'Everything is in order', 'funnelforms-pro' ) }
				onClick={ () => setOpen( ! open ) }
			>
				<span className="ffxb-check__dot" aria-hidden="true">
					{ 'ok' === tone ? '✓' : issues.length }
				</span>
				<span>{ __( 'Check', 'funnelforms-pro' ) }</span>
			</button>
			{ open ? (
				<div className="ffxb-check__panel" role="dialog" aria-label={ __( 'Check of the form', 'funnelforms-pro' ) }>
					<div className="ffxb-check__head">
						<strong>{ __( 'Check of the form', 'funnelforms-pro' ) }</strong>
						{ text ? <span>{ text }</span> : null }
					</div>
					<div className="ffxb-check__list">
						<IssueOverview issues={ issues } onShow={ () => setOpen( false ) } />
					</div>
				</div>
			) : null }
		</div>
	);
}

/** Problems the plugin answered (preview, publishing), as issues with their places. */
export function ProblemIssues( { problems, onShow }: { problems: string[]; onShow?: () => void } ) {
	const { ctx } = useEnv();
	const doc = useBuilder( ( s ) => s.doc );
	const issues = useMemo( () => ( doc ? problemIssues( doc, problems, ctx.locale ) : [] ), [ doc, problems, ctx.locale ] );
	return <IssueList issues={ issues } onShow={ onShow } />;
}
