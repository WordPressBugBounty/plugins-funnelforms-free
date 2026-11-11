/**
 * The action "AI Phone Agent" (aiCall) in the builder: the form only links to an agent of
 * Funnelforms → AI Phone Agent, which brings voice, number, questions and call hours. Here the
 * agent is chosen, the phone and consent fields are found (or the consent field is added), and the
 * form says what the agent learns from it: all answers, chosen ones or none, and what it is about.
 */
import React, { useEffect, useState, type ReactNode } from 'react';
import type { AiCallConfig, FormDocument } from '@funnelforms/form-schema';
import { consentFields, phoneFields, questionFields, type AiAgentSummary } from '../aicall';
import { addField, text } from '../document';
import { setText } from '../languages';
import type { Recipe } from '../store';
import { useEnv } from './context';
import { fieldTitle } from './describe';
import { __, sprintf } from './i18n';
import { Badge, Button, Notice, Select, TextInput } from './ui';

/** Funnelforms → AI Phone Agent, relative to wp-admin where the builder runs. */
export const LEADCALLER_URL = 'admin.php?page=funnelforms-leadcaller';

export function goalName( goal: string ): string {
	const names: Record<string, string> = {
		qualify: __( 'Qualify the lead', 'funnelforms-pro' ),
		appointment: __( 'Make an appointment', 'funnelforms-pro' ),
		confirm: __( 'Confirm the request', 'funnelforms-pro' ),
		followUp: __( 'Follow up on an offer', 'funnelforms-pro' ),
	};
	return names[ goal ] ?? goal;
}

/**
 * A consent box by what the lead reads: its label, else the start of its text, never its key.
 */
export function consentTitle( field: { key: string; label?: Record<string, string>; props?: unknown }, locale: string ): string {
	const label = text( field.label, locale ).replace( /<[^>]+>/g, '' ).trim();
	if ( label ) {
		return label;
	}
	const said = text( ( field.props as { html?: Record<string, string> } | undefined )?.html, locale )
		.replace( /<[^>]+>/g, '' )
		.replace( /\s+/g, ' ' )
		.trim();
	return said ? ( said.length > 70 ? said.slice( 0, 69 ).trimEnd() + '…' : said ) : __( 'Consent', 'funnelforms-pro' );
}

export function AiCallEditor( {
	doc,
	id,
	config,
	change,
	common,
}: {
	doc: FormDocument;
	id: string;
	config: AiCallConfig;
	change: ( recipe: Recipe, key?: string ) => void;
	/** When and for which entries. */
	common: ReactNode;
} ) {
	const { api, rights, readOnly, ctx } = useEnv();
	const locale = doc.locales.default;
	const [ agents, setAgents ] = useState<AiAgentSummary[] | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const phones = phoneFields( doc );
	const consents = consentFields( doc );
	const questions = questionFields( doc );
	const share = config.share ?? 'all';
	const shared = config.fields ?? [];
	const agent = agents?.find( ( a ) => a.id === config.agent );

	const set = ( apply: ( c: AiCallConfig ) => void ): void =>
		change( ( d ) => {
			const a = d.actions.find( ( x ) => x.id === id );
			if ( a && 'aiCall' === a.kind ) {
				apply( a.config );
			}
		} );

	useEffect( () => {
		let live = true;
		if ( api.aiAgents ) {
			api.aiAgents().then(
				( list ) => {
					if ( ! live ) {
						return;
					}
					setAgents( list );
					// One agent: it is the one, so the action is complete right away.
					const only = list[ 0 ];
					if ( 1 === list.length && only && ! config.agent && ! readOnly ) {
						set( ( c ) => {
							c.agent = only.id;
						} );
					}
				},
				( e: unknown ) => live && setError( e instanceof Error ? e.message : String( e ) )
			);
		} else {
			setAgents( [] );
		}
		return () => {
			live = false;
		};
		// Once per opened action.
	}, [ api ] );

	/** Adds a consent box to the contact step with the phone field (or the first) and picks it. */
	const addConsent = (): void =>
		change( ( d ) => {
			const node = d.nodes.find( ( n ) => 'contact' === n.type && n.fields.some( ( f ) => f.id === ( config.phoneField || phones[ 0 ]?.id ) ) ) ?? d.nodes.find( ( n ) => 'contact' === n.type );
			if ( ! node ) {
				return;
			}
			const created = addField( d, node.id, 'consent', ctx );
			const field = 'contact' === node.type ? node.fields.find( ( f ) => f.id === created ) : undefined;
			if ( ! created || ! field ) {
				return;
			}
			const props = ( field.props ?? {} ) as { html?: Record<string, string> };
			props.html = props.html ?? {};
			setText( props.html, locale, __( 'Yes, you may call me about my request, also with an AI assistant.', 'funnelforms-pro' ), locale );
			field.props = props as typeof field.props;
			field.required = false;
			const a = d.actions.find( ( x ) => x.id === id );
			if ( a && 'aiCall' === a.kind ) {
				a.config.consentField = created;
			}
		} );

	const agentOptions = [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) }, ...( agents ?? [] ).map( ( a ) => ( { value: a.id, label: `${ a.name } · ${ goalName( a.goal ) }` } ) ) ];
	if ( config.agent && agents && ! agent ) {
		agentOptions.push( { value: config.agent, label: __( 'Deleted agent', 'funnelforms-pro' ) } );
	}

	return (
		<>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ agents && ! agents.length ? (
				<Notice
					tone="info"
					title={ __( 'Set up an agent first', 'funnelforms-pro' ) }
					action={
						rights.settings ? (
							<a className="ffxb-btn ffxb-btn--primary ffxb-btn--sm" href={ LEADCALLER_URL } target="_blank" rel="noreferrer">
								{ __( 'Open AI Phone Agent', 'funnelforms-pro' ) }
							</a>
						) : undefined
					}
				>
					{ __( 'Under Funnelforms → AI Phone Agent you connect ElevenLabs, pick a number and create an agent: what it asks, its voice and when it calls. Here you only link it.', 'funnelforms-pro' ) }
				</Notice>
			) : (
				<>
					<Select
						label={ __( 'Agent', 'funnelforms-pro' ) }
						value={ config.agent ?? '' }
						options={ agentOptions }
						disabled={ readOnly || null === agents }
						onChange={ ( v ) =>
							set( ( c ) => {
								c.agent = v;
							} )
						}
					/>
					<p className="ffxb-hint">
						{ agent && ! agent.ready ? (
							<>
								<Badge tone="warning">{ __( 'Not ready', 'funnelforms-pro' ) }</Badge>{ ' ' }
							</>
						) : null }
						{ __( 'Voice, number, questions and call hours belong to the agent.', 'funnelforms-pro' ) }{ ' ' }
						{ rights.settings ? (
							<a className="ffxb-link" href={ LEADCALLER_URL } target="_blank" rel="noreferrer">
								{ __( 'Edit agents', 'funnelforms-pro' ) }
							</a>
						) : null }
					</p>
				</>
			) }
			{ phones.length ? (
				<Select
					label={ __( 'Number to call', 'funnelforms-pro' ) }
					value={ config.phoneField || phones[ 0 ]?.id || '' }
					options={ phones.map( ( f ) => ( { value: f.id, label: fieldTitle( f as never, locale ) } ) ) }
					disabled={ readOnly }
					hint={ __( 'The phone field of the form whose number the agent calls.', 'funnelforms-pro' ) }
					onChange={ ( v ) =>
						set( ( c ) => {
							c.phoneField = v;
						} )
					}
				/>
			) : (
				<Notice tone="warning">{ __( 'Add a phone field to the contact step; the agent calls that number.', 'funnelforms-pro' ) }</Notice>
			) }
			{ consents.length ? (
				<Select
					label={ __( 'Consent to the call', 'funnelforms-pro' ) }
					value={ config.consentField }
					options={ [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) }, ...consents.map( ( f ) => ( { value: f.id, label: consentTitle( f, locale ) } ) ) ] }
					disabled={ readOnly }
					hint={ __( 'Only leads who checked this consent field are called, for example “Yes, you may call me about my request, also with an AI assistant.”', 'funnelforms-pro' ) }
					onChange={ ( v ) =>
						set( ( c ) => {
							c.consentField = v;
						} )
					}
				/>
			) : (
				<Notice
					tone="warning"
					title={ __( 'The form needs a consent box', 'funnelforms-pro' ) }
					action={
						readOnly ? undefined : (
							<Button size="sm" variant="primary" onClick={ addConsent }>
								{ __( 'Add consent box', 'funnelforms-pro' ) }
							</Button>
						)
					}
				>
					{ __( 'Only leads who agree are called. One click adds the box “Yes, you may call me about my request, also with an AI assistant.” to the contact step.', 'funnelforms-pro' ) }
				</Notice>
			) }
			<fieldset className="ffxb-field ffxb-lc-share">
				<Select
					label={ __( 'What the agent learns from the form', 'funnelforms-pro' ) }
					value={ share }
					options={ [
						{ value: 'all', label: __( 'All answers', 'funnelforms-pro' ) },
						{ value: 'some', label: __( 'Only the answers I choose', 'funnelforms-pro' ) },
						{ value: 'none', label: __( 'No answers', 'funnelforms-pro' ) },
					] }
					disabled={ readOnly }
					hint={ 'none' === share ? __( 'The agent asks everything itself.', 'funnelforms-pro' ) : __( 'The agent builds on them: it does not ask again what the lead already answered, and asks about it where it helps.', 'funnelforms-pro' ) }
					onChange={ ( v ) =>
						set( ( c ) => {
							c.share = v;
							if ( 'some' === v && ! c.fields ) {
								c.fields = questions.map( ( f ) => f.id );
							}
						} )
					}
				/>
				{ 'some' === share ? (
					questions.length ? (
						<div className="ffxb-lc-share__list" role="group" aria-label={ __( 'Answers the agent gets', 'funnelforms-pro' ) }>
							{ questions.map( ( f ) => (
								<label key={ f.id } className="ffxb-consent">
									<input
										type="checkbox"
										checked={ shared.includes( f.id ) }
										disabled={ readOnly }
										onChange={ ( e ) =>
											set( ( c ) => {
												const now = c.fields ?? [];
												c.fields = e.target.checked ? [ ...now.filter( ( x ) => x !== f.id ), f.id ] : now.filter( ( x ) => x !== f.id );
											} )
										}
									/>
									<span>{ fieldTitle( f, locale ) }</span>
								</label>
							) ) }
						</div>
					) : (
						<p className="ffxb-hint">{ __( 'The form has no questions yet.', 'funnelforms-pro' ) }</p>
					)
				) : null }
				<p className="ffxb-hint">{ __( 'Of the contact details the agent only gets the name, to address the lead. E-mail address, phone number and the rest stay on your website.', 'funnelforms-pro' ) }</p>
			</fieldset>
			{ readOnly ? null : (
				<TextInput
					label={ __( 'About this form', 'funnelforms-pro' ) }
					multiline
					value={ config.context ?? '' }
					placeholder={ __( 'e.g. Requests for a heat pump. Most leads own a house and want to switch this year.', 'funnelforms-pro' ) }
					hint={ __( 'Optional. Tells the agent what the request is about, so one agent can call for several forms.', 'funnelforms-pro' ) }
					onChange={ ( v ) =>
						set( ( c ) => {
							c.context = v.slice( 0, 1000 );
						} )
					}
				/>
			) }
			<p className="ffxb-hint">{ sprintf( /* translators: %s: name of the service, ElevenLabs */ __( 'Calls, voice and transcript are processed by %s for you. Mention it in your privacy policy and conclude its data processing agreement.', 'funnelforms-pro' ), 'ElevenLabs' ) }</p>
			{ common }
		</>
	);
}
