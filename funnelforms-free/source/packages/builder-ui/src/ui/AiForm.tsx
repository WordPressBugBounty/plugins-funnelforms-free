/**
 * The AI form builder (Funnelforms Pro): a new form from a description of the business and the
 * goal (a step of the new-form dialog), and changes to the open form by an instruction (the AI bar
 * above the workspace, applied as one change that can be undone). The bar is one way in for every
 * change: questions and answers, paths, calculations, quizzes, texts and the design. Calculations,
 * the quiz and the selected step open it with a start of the instruction (AiAsk). The plugin sends
 * the text through the Funnelforms server to the AI and checks what comes back; nothing is
 * published by itself.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AiConfig, FormsApi } from '../api';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';
import { languageLabel } from './Languages';
import { Button, Field, IconButton, icons, Notice } from './ui';

/** Longest description or instruction the plugin takes (AiForms::MAX_PROMPT). */
export const AI_MAX_PROMPT = 2000;
const AI_MIN_PROMPT = 3;

function createExamples(): string[] {
	return [
		__( 'Quote requests for a roofing company: kind of roof, size, timeline and a callback', 'funnelforms-pro' ),
		__( 'Price calculator for window cleaning by number of windows and floors', 'funnelforms-pro' ),
		__( 'Free first consultation for a tax advisor, with a choice of topics', 'funnelforms-pro' ),
		__( 'Job application for nurses with preferred shifts and a CV upload', 'funnelforms-pro' ),
		__( 'Product finder quiz for an online shop that sells mattresses', 'funnelforms-pro' ),
	];
}

/** The topics of the AI bar, each with an example instruction. */
function barTopics(): Array<{ label: string; example: string }> {
	return [
		{ label: __( 'Questions and answers', 'funnelforms-pro' ), example: __( 'Ask for the budget after the second question and add the answer "Not sure yet"', 'funnelforms-pro' ) },
		{ label: __( 'Paths', 'funnelforms-pro' ), example: __( 'Visitors who choose "Rent" skip the question about the budget', 'funnelforms-pro' ) },
		{ label: __( 'Calculation', 'funnelforms-pro' ), example: __( 'Calculate a price: 50 euros per square metre plus 200 euros for the visit, shown before the contact step', 'funnelforms-pro' ) },
		{ label: __( 'Quiz', 'funnelforms-pro' ), example: __( 'Turn the form into a quiz: each right answer scores one point, with three results', 'funnelforms-pro' ) },
		{ label: __( 'Design', 'funnelforms-pro' ), example: __( 'Make the buttons blue and the corners rounder', 'funnelforms-pro' ) },
		{ label: __( 'Texts', 'funnelforms-pro' ), example: __( 'Write all texts in a friendlier tone', 'funnelforms-pro' ) },
	];
}

function progressTexts(): string[] {
	return [ __( 'Reading your description…', 'funnelforms-pro' ), __( 'Planning the questions and paths…', 'funnelforms-pro' ), __( 'Writing the texts…', 'funnelforms-pro' ), __( 'Checking the form…', 'funnelforms-pro' ) ];
}

/** Where the text goes; shown before it is sent. */
export function aiPrivacyText(): string {
	return __( 'Your text is sent to the Funnelforms server and to Anthropic, which writes the form. It is not stored.', 'funnelforms-pro' );
}

function message( e: unknown ): string {
	return e instanceof Error ? e.message : String( e );
}

/** The text of the request with example chips, the note on privacy and the progress while the AI works. */
function PromptBox( { label, placeholder, value, onChange, examples, busy, onSubmit }: { label: string; placeholder: string; value: string; onChange: ( value: string ) => void; examples: string[]; busy: boolean; onSubmit: () => void } ) {
	const texts = progressTexts();
	const [ phase, setPhase ] = useState( 0 );
	useEffect( () => {
		if ( ! busy ) {
			setPhase( 0 );
			return undefined;
		}
		const timer = setInterval( () => setPhase( ( p ) => Math.min( p + 1, texts.length - 1 ) ), 8000 );
		return () => clearInterval( timer );
	}, [ busy, texts.length ] );
	return (
		<div className="ffxb-ai__box">
			<Field label={ label }>
				{ ( id ) => (
					<textarea
						id={ id }
						className="ffxb-input ffxb-ai__prompt"
						value={ value }
						placeholder={ placeholder }
						rows={ 5 }
						maxLength={ AI_MAX_PROMPT }
						disabled={ busy }
						onChange={ ( e ) => onChange( e.target.value ) }
						onKeyDown={ ( e ) => {
							if ( 'Enter' === e.key && ( e.ctrlKey || e.metaKey ) ) {
								e.preventDefault();
								onSubmit();
							}
						} }
					/>
				) }
			</Field>
			<p className="ffxb-ai__examples-label">{ __( 'Examples', 'funnelforms-pro' ) }</p>
			<ul className="ffxb-ai__examples">
				{ examples.map( ( example ) => (
					<li key={ example }>
						<button type="button" className="ffxb-ai__example" disabled={ busy } onClick={ () => onChange( example ) }>
							{ example }
						</button>
					</li>
				) ) }
			</ul>
			<p className="ffxb-ai__privacy">{ aiPrivacyText() }</p>
			{ busy ? (
				<div className="ffxb-ai__progress" role="status">
					<span className="ffxb-spinner" aria-hidden="true" />
					<span>
						<strong>{ texts[ phase ] }</strong>
						<span>{ __( 'This can take up to a minute.', 'funnelforms-pro' ) }</span>
					</span>
				</div>
			) : null }
		</div>
	);
}

/** Without a connected license that includes the AI form builder: where to connect it. */
function NotReady( { ai }: { ai: AiConfig } ) {
	return (
		<Notice
			tone="warning"
			title={ __( 'Connect your license', 'funnelforms-pro' ) }
			action={
				ai.accountUrl ? (
					<a className="ffxb-button ffxb-button--secondary ffxb-button--md" href={ ai.accountUrl }>
						{ __( 'Connect license', 'funnelforms-pro' ) }
					</a>
				) : undefined
			}
		>
			{ __( 'The AI form builder needs a connected Funnelforms Pro license that includes it.', 'funnelforms-pro' ) }
		</Notice>
	);
}

/** The step of the new-form dialog: a description in, a new draft form out, opened in the editor. */
export function AiCreateStep( { api, ai, locale, onCreated, onBack }: { api: FormsApi; ai: AiConfig; locale: string; onCreated: ( id: number ) => void; onBack: () => void } ) {
	const [ prompt, setPrompt ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const ready = prompt.trim().length >= AI_MIN_PROMPT && ! busy && ai.ready && undefined !== api.aiCreate;
	const submit = async (): Promise<void> => {
		if ( ! ready || ! api.aiCreate ) {
			return;
		}
		setBusy( true );
		setError( null );
		try {
			onCreated( ( await api.aiCreate( prompt.trim() ) ).id );
		} catch ( e ) {
			setError( message( e ) );
			setBusy( false );
		}
	};
	return (
		<form
			className="ffxb-gallery__blank ffxb-ai"
			aria-busy={ busy }
			onSubmit={ ( e ) => {
				e.preventDefault();
				void submit();
			} }
		>
			<span className="ffxb-gallery__blank-icon" aria-hidden="true">
				{ icons.sparkles }
			</span>
			<h3>{ __( 'Create with AI', 'funnelforms-pro' ) }</h3>
			<p>
				{ locale
					? sprintf( /* translators: %s: name of the language, e.g. German */ __( 'Describe your business and the goal of the form. The AI writes questions, paths and emails in %s; you check and change everything before publishing.', 'funnelforms-pro' ), languageLabel( locale ) )
					: __( 'Describe your business and the goal of the form. The AI writes questions, paths and emails; you check and change everything before publishing.', 'funnelforms-pro' ) }
			</p>
			{ ai.ready ? null : <NotReady ai={ ai } /> }
			<PromptBox
				label={ __( 'Describe your business and what the form should achieve', 'funnelforms-pro' ) }
				placeholder={ __( 'e.g. We install heat pumps in houses. The form should qualify leads by house type, heating and budget and ask for a callback.', 'funnelforms-pro' ) }
				value={ prompt }
				onChange={ setPrompt }
				examples={ createExamples() }
				busy={ busy }
				onSubmit={ () => void submit() }
			/>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<div className="ffxb-gallery__blank-actions">
				<Button variant="ghost" icon={ icons.back } disabled={ busy } onClick={ onBack }>
					{ __( 'Back to the templates', 'funnelforms-pro' ) }
				</Button>
				<Button variant="primary" type="submit" icon={ icons.sparkles } disabled={ ! ready }>
					{ __( 'Create draft', 'funnelforms-pro' ) }
				</Button>
			</div>
		</form>
	);
}

/** The card of the AI form builder at the start of the template gallery. */
export function AiCreateCard( { onOpen, badge }: { onOpen: () => void; badge?: React.ReactNode } ) {
	return (
		<li className="ffxb-tcard ffxb-tcard--blank ffxb-tcard--ai">
			<button type="button" className="ffxb-tcard__blank" onClick={ onOpen }>
				<span className="ffxb-tcard__blank-icon" aria-hidden="true">
					{ icons.sparkles }
				</span>
				<strong>
					{ __( 'Create with AI', 'funnelforms-pro' ) } { badge }
				</strong>
				<span>{ __( 'Describe your business and goal; the AI writes a draft for you to check.', 'funnelforms-pro' ) }</span>
			</button>
		</li>
	);
}

/**
 * Opens the AI bar with the start of an instruction, e.g. "Create a calculation: "; null where the
 * AI form builder is not offered (Funnelforms Free, no license connection in the page).
 */
export const AiAsk = createContext<( ( start: string ) => void ) | null>( null );

export function useAiAsk(): ( ( start: string ) => void ) | null {
	return useContext( AiAsk );
}

/**
 * The AI bar above the workspace: one instruction for the whole form, with topics that show what
 * it can do. The workspaces below it reach it through AiAsk.
 */
export function AiBar( { api, ai, formId, show, children }: { api: FormsApi; ai: AiConfig; formId: number; show: boolean; children: React.ReactNode } ) {
	const { store, readOnly } = useEnv();
	const doc = useBuilder( ( s ) => s.doc );
	const [ prompt, setPrompt ] = useState( '' );
	const [ open, setOpen ] = useState( false );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const input = useRef<HTMLTextAreaElement>( null );
	const texts = progressTexts();
	const [ phase, setPhase ] = useState( 0 );
	useEffect( () => {
		if ( ! busy ) {
			setPhase( 0 );
			return undefined;
		}
		const timer = setInterval( () => setPhase( ( p ) => Math.min( p + 1, texts.length - 1 ) ), 8000 );
		return () => clearInterval( timer );
	}, [ busy, texts.length ] );
	const ask = useRef( ( start: string ): void => {
		setPrompt( start );
		setOpen( true );
		setError( null );
		// After the bar is drawn with the text: the cursor at its end.
		setTimeout( () => {
			const el = input.current;
			if ( el ) {
				el.focus();
				el.setSelectionRange( el.value.length, el.value.length );
			}
		}, 0 );
	} ).current;
	if ( ! api.aiEdit ) {
		return <>{ children }</>;
	}
	const ready = prompt.trim().length >= AI_MIN_PROMPT && ! busy && ai.ready && null !== doc && ! readOnly;
	const submit = async (): Promise<void> => {
		if ( ! ready || ! doc || ! api.aiEdit ) {
			return;
		}
		setBusy( true );
		setError( null );
		try {
			const change = await api.aiEdit( formId, prompt.trim(), doc );
			// One step of the history: undo brings the form back as it was.
			store.getState().replace( change.document );
			store.getState().notify( change.summary || __( 'The form was changed.', 'funnelforms-pro' ) );
			setPrompt( '' );
			setOpen( false );
		} catch ( e ) {
			setError( message( e ) );
		} finally {
			setBusy( false );
		}
	};
	return (
		<AiAsk.Provider value={ ask }>
			{ show ? (
				<div className={ 'ffxb-aibar' + ( open ? ' is-open' : '' ) } aria-busy={ busy }>
					<form
						className="ffxb-aibar__row"
						onSubmit={ ( e ) => {
							e.preventDefault();
							void submit();
						} }
					>
						<span className="ffxb-aibar__icon" aria-hidden="true">
							{ icons.sparkles }
						</span>
						<textarea
							ref={ input }
							className="ffxb-aibar__input"
							rows={ 1 }
							value={ prompt }
							maxLength={ AI_MAX_PROMPT }
							disabled={ busy || readOnly }
							aria-label={ __( 'Change the form with AI', 'funnelforms-pro' ) }
							placeholder={ __( 'Edit with AI: questions, answers, calculations, quizzes, texts or the design', 'funnelforms-pro' ) }
							onFocus={ () => setOpen( true ) }
							onChange={ ( e ) => setPrompt( e.target.value ) }
							onKeyDown={ ( e ) => {
								if ( 'Enter' === e.key && ! e.shiftKey ) {
									e.preventDefault();
									void submit();
								} else if ( 'Escape' === e.key && ! busy ) {
									setOpen( false );
									e.currentTarget.blur();
								}
							} }
						/>
						<Button variant="primary" type="submit" className="ffxb-aibar__go" icon={ icons.sparkles } disabled={ ! ready }>
							{ __( 'Change', 'funnelforms-pro' ) }
						</Button>
						{ open && ! busy ? <IconButton label={ __( 'Close', 'funnelforms-pro' ) } icon={ icons.close } onClick={ () => setOpen( false ) } /> : null }
					</form>
					{ open ? (
						<div className="ffxb-aibar__panel">
							{ ai.ready ? null : <NotReady ai={ ai } /> }
							<p className="ffxb-aibar__lead">{ __( 'Say what should change in the whole form. You see the result at once and can undo it in one step; nothing is published.', 'funnelforms-pro' ) }</p>
							<ul className="ffxb-aibar__topics" aria-label={ __( 'Examples', 'funnelforms-pro' ) }>
								{ barTopics().map( ( topic ) => (
									<li key={ topic.label }>
										<button type="button" className="ffxb-aibar__topic" title={ topic.example } disabled={ busy } onClick={ () => ask( topic.example ) }>
											<strong>{ topic.label }</strong>
											<span>{ topic.example }</span>
										</button>
									</li>
								) ) }
							</ul>
							<p className="ffxb-ai__privacy">{ aiPrivacyText() }</p>
							{ busy ? (
								<div className="ffxb-ai__progress" role="status">
									<span className="ffxb-spinner" aria-hidden="true" />
									<span>
										<strong>{ texts[ phase ] }</strong>
										<span>{ __( 'This can take up to a minute.', 'funnelforms-pro' ) }</span>
									</span>
								</div>
							) : null }
							{ error ? <Notice tone="danger">{ error }</Notice> : null }
						</div>
					) : null }
				</div>
			) : null }
			{ children }
		</AiAsk.Provider>
	);
}

/** A button that opens the AI bar with the start of an instruction; nothing where the AI is not offered. */
export function AskAiButton( { start, label }: { start: string; label: string } ) {
	const ask = useAiAsk();
	const { readOnly } = useEnv();
	if ( ! ask ) {
		return null;
	}
	return (
		<Button size="sm" variant="ghost" className="ffxb-ask-ai" icon={ icons.sparkles } disabled={ readOnly } onClick={ () => ask( start ) }>
			{ label }
		</Button>
	);
}
