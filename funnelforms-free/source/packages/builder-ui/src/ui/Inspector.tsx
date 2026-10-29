/**
 * Properties of what is selected: a step and its fields, a contact step, an end, a path with
 * its condition, or (nothing selected) the form itself. Texts are edited in the language chosen in
 * the top bar: the form's default language, or a translation.
 */
import React from 'react';
import type { ContactField, Field, FormDocument, FormNode, Text } from '@funnelforms/form-schema';
import {
	duplicateField,
	duplicateNode,
	findNode,
	asksFor,
	keyClash,
	moveField,
	nodeName,
	removeField,
	removeNode,
	setStart,
	text,
} from '../document';
import type { Panel, Recipe } from '../store';
import { BookingTypeField } from './BookingTypes';
import { languageLabel } from './Languages';
import { ChoiceProps, DropdownProps } from './Answers';
import { DateProps, NumberProps, RatingProps, SliderProps, TimeProps } from './RangeProps';
import { RepeatProps } from './RepeatProps';
import { ContactLayoutProps, ContactOptions } from './ContactLook';
import { ContentProps } from './ContentProps';
import { ResultProps } from './ResultProps';
import { FileProps, SignatureProps } from './UploadProps';
import { AddressProps, TextFieldProps } from './TextProps';
import { PhoneCountryProps, PhoneSmsProps } from './PhoneProps';
import { EndProps } from './EndProps';
import { ContactCode, EndCode } from './CustomCode';
import { useAiAsk } from './AiForm';
import { AnswerInsert } from './AnswerInsert';
import { editText } from '../languages';
import { spamProtection } from '../spam';
import { InputIcon } from './IconPicker';
import { contactFieldName, stepFieldName } from './catalog';
import { useBuilder, useEnv, ViewContext, type View } from './context';
import { put, TextProp } from './texts';
import { fieldsOf, removeWithNotice } from './Removal';
import { describeCondition, edgeLabel, fieldIndex } from './describe';
import { ActionsSection, kindName } from './Actions';
import { NodeAnalyticsSection, PathsSection } from './Analytics';
import { PredictionNodeSection, PredictionOverview } from './Prediction';
import { HintList, useHints } from './Hints';
import { EdgeInspector, FieldVisibility, NodeLogic } from './Logic';
import { StepVariants } from './Experiments';
import { __, sprintf } from './i18n';
import { Button, IconButton, icons, Notice, Section, TextInput, Toggle } from './ui';

type AnyField = Field | ContactField;

/** Changes the document; edits with the same key in a row are one undo step. */
function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

function fieldIn( doc: FormDocument, nodeId: string, fieldId: string ): AnyField | undefined {
	const node = findNode( doc, nodeId );
	return node && 'fields' in node ? ( node.fields as AnyField[] ).find( ( f ) => f.id === fieldId ) : undefined;
}

export function Inspector() {
	const doc = useBuilder( ( s ) => s.doc );
	const selection = useBuilder( ( s ) => s.selection );
	if ( ! doc ) {
		return null;
	}
	let body: React.ReactNode;
	const node = selection.node ? findNode( doc, selection.node ) : undefined;
	if ( selection.edge && doc.edges.some( ( e ) => e.id === selection.edge ) ) {
		body = <EdgeInspector doc={ doc } edgeId={ selection.edge } />;
	} else if ( node && selection.field && fieldIn( doc, node.id, selection.field ) ) {
		body = <FieldInspector doc={ doc } node={ node } fieldId={ selection.field } />;
	} else if ( node ) {
		body = <NodeInspector doc={ doc } node={ node } />;
	} else {
		body = <FormOverview doc={ doc } />;
	}
	return (
		<aside className="ffxb-inspector" aria-label={ __( 'Properties', 'funnelforms-pro' ) }>
			<Translating />
			{ 'free' === process.env.FUNNELFORMS_EDITION ? null : node && ! selection.edge ? <NodeAnalyticsSection nodeId={ node.id } /> : selection.node || selection.edge ? null : <PathsSection /> }
			{ 'free' === process.env.FUNNELFORMS_EDITION ? null : node && ! selection.edge ? <PredictionNodeSection nodeId={ node.id } /> : selection.node || selection.edge ? null : <PredictionOverview /> }
			{ body }
		</aside>
	);
}

/** While a translation is edited: which language, and what empty fields mean. */
function Translating() {
	const { ctx, lang } = useEnv();
	if ( lang === ctx.locale ) {
		return null;
	}
	return <p className="ffxb-translating">{ sprintf( __( 'You are translating into %s. Empty fields show the default text to visitors.', 'funnelforms-pro' ), languageLabel( lang ) ) }</p>;
}



/** Where the captcha field of a contact step comes from, and why visitors may not see it. */
function CaptchaHint() {
	const off = useBuilder( ( s ) => false === s.doc?.settings.captcha );
	const site = spamProtection();
	if ( ! site.captcha ) {
		return <Notice tone="warning">{ __( 'No captcha is set up for the website yet, so visitors do not see this field. Add the keys of a captcha service in the settings of Funnelforms, under Entries and spam.', 'funnelforms-pro' ) }</Notice>;
	}
	if ( off ) {
		return <Notice tone="warning">{ __( 'This form does without the captcha (Settings, Spam protection), so visitors do not see this field.', 'funnelforms-pro' ) }</Notice>;
	}
	return <p className="ffxb-hint">{ sprintf( /* translators: %s: name of the captcha service, such as Cloudflare Turnstile */ __( 'Uses the spam protection of the website: %s.', 'funnelforms-pro' ), site.captcha ) }</p>;
}

/** In Funnelforms Free: a question of a Pro field type, which Free does not publish. */
function ProField() {
	return <Notice tone="warning">{ __( 'This field type is part of Funnelforms Pro. Delete the question to publish the form.', 'funnelforms-pro' ) }</Notice>;
}

/* ------------------------------------------------------------------ form */

/** Behaviour of the whole form, in the settings workspace. */
export function FormSettings( { doc }: { doc: FormDocument } ) {
	const change = useChange();
	const open = React.useContext( ViewContext );
	const settings = doc.settings;
	return (
		<Section title={ __( 'General', 'funnelforms-pro' ) }>
			<TextInput label={ __( 'Name of the form', 'funnelforms-pro' ) } value={ doc.title } onChange={ ( v ) => change( ( d ) => void ( d.title = v ), 'title' ) } hint={ __( 'Only you see the name; visitors see the questions.', 'funnelforms-pro' ) } />
			{ /* Pro features: Funnelforms Free shows them only to switch them off. */ }
			{ 'free' !== process.env.FUNNELFORMS_EDITION || settings.savePartialEntries ? (
				<Toggle
					label={ __( 'Save incomplete entries', 'funnelforms-pro' ) }
					hint={ __( 'Answers are kept step by step, also when visitors leave before sending.', 'funnelforms-pro' ) }
					checked={ settings.savePartialEntries }
					onChange={ ( v ) => change( ( d ) => void ( d.settings.savePartialEntries = v ) ) }
				/>
			) : null }
			{ 'free' !== process.env.FUNNELFORMS_EDITION || true === settings.saveProgress ? (
				<Toggle
					label={ __( 'Continue later', 'funnelforms-pro' ) }
					hint={ __( 'Visitors can save their answers and get a link to continue.', 'funnelforms-pro' ) }
					checked={ true === settings.saveProgress }
					onChange={ ( v ) => change( ( d ) => void ( d.settings.saveProgress = v ) ) }
				/>
			) : null }
			<p className="ffxb-hint">
				{ __( 'The progress bar, the height of the steps and the transitions are set in the design.', 'funnelforms-pro' ) }{ ' ' }
				<button type="button" className="ffxb-link" onClick={ () => open( 'design' ) }>
					{ __( 'Design', 'funnelforms-pro' ) }
				</button>
			</p>
		</Section>
	);
}

/** With nothing selected: the form at a glance and the way to its other workspaces. */
function FormOverview( { doc }: { doc: FormDocument } ) {
	const change = useChange();
	const open = React.useContext( ViewContext );
	const steps = doc.nodes.filter( ( n ) => 'end' !== n.type ).length;
	const questions = doc.nodes.reduce( ( sum, n ) => sum + ( 'step' === n.type ? n.fields.length : 0 ), 0 );
	const ends = doc.nodes.filter( ( n ) => 'end' === n.type ).length;
	const jumps: Array<{ view: View; title: string; text: string; show: boolean }> = [
		{ view: 'design', title: __( 'Design', 'funnelforms-pro' ), text: __( 'Colours, font and look, with a live preview.', 'funnelforms-pro' ), show: true },
		{
			view: 'actions',
			title: __( 'After sending', 'funnelforms-pro' ),
			text: ! doc.nodes.some( ( n ) => 'contact' === n.type )
				? __( 'Add a contact step: mails and webhooks run when visitors send it.', 'funnelforms-pro' )
				: doc.actions.length
				? sprintf( __( 'Actions: %d, at the contact step.', 'funnelforms-pro' ), doc.actions.length )
				: 'free' === process.env.FUNNELFORMS_EDITION
					? __( 'Mails to you and your visitors, at the contact step.', 'funnelforms-pro' )
					: __( 'Mails, webhooks and connections, at the contact step.', 'funnelforms-pro' ),
			show: doc.nodes.some( ( n ) => 'contact' === n.type ) || doc.actions.length > 0,
		},
		{ view: 'settings', title: __( 'Settings', 'funnelforms-pro' ), text: 'free' === process.env.FUNNELFORMS_EDITION ? __( 'Name, behaviour and the own page of the form.', 'funnelforms-pro' ) : __( 'Languages, calculations, quiz, payment and access.', 'funnelforms-pro' ), show: true },
	];
	return (
		<>
			<Section title={ __( 'Form', 'funnelforms-pro' ) }>
				<TextInput label={ __( 'Name of the form', 'funnelforms-pro' ) } value={ doc.title } onChange={ ( v ) => change( ( d ) => void ( d.title = v ), 'title' ) } hint={ __( 'Only you see the name; visitors see the questions.', 'funnelforms-pro' ) } />
				<dl className="ffxb-overview">
					<div>
						<dt>{ __( 'Steps', 'funnelforms-pro' ) }</dt>
						<dd>{ steps }</dd>
					</div>
					<div>
						<dt>{ __( 'Questions', 'funnelforms-pro' ) }</dt>
						<dd>{ questions }</dd>
					</div>
					<div>
						<dt>{ __( 'Ends', 'funnelforms-pro' ) }</dt>
						<dd>{ ends }</dd>
					</div>
				</dl>
				<p className="ffxb-hint">{ __( 'Select a step on the canvas to edit it.', 'funnelforms-pro' ) }</p>
			</Section>
			<LogicCheck doc={ doc } />
			<nav className="ffxb-jumps" aria-label={ __( 'More of this form', 'funnelforms-pro' ) }>
				{ jumps
					.filter( ( j ) => j.show )
					.map( ( j ) => (
						<button key={ j.view } type="button" className="ffxb-jump" onClick={ () => open( j.view ) }>
							<span className="ffxb-jump__title">{ j.title }</span>
							<span className="ffxb-jump__text">{ j.text }</span>
							<span className="ffxb-jump__arrow" aria-hidden="true">
								&rarr;
							</span>
						</button>
					) ) }
			</nav>
		</>
	);
}

/** All hints about the logic of the form, or that everything leads somewhere. */
function LogicCheck( { doc }: { doc: FormDocument } ) {
	const hints = useHints().filter( ( h ) => 'info' !== h.level );
	return (
		<Section title={ __( 'Logic check', 'funnelforms-pro' ) }>
			{ hints.length ? <HintList doc={ doc } hints={ hints } /> : <p className="ffxb-check-ok">{ __( 'Every step leads on and every end can be reached.', 'funnelforms-pro' ) }</p> }
		</Section>
	);
}

/* ------------------------------------------------------------------ nodes */

function NodeInspector( { doc, node }: { doc: FormDocument; node: FormNode } ) {
	const { store, readOnly } = useEnv();
	const change = useChange();
	const select = store.getState().select;
	const panel = useBuilder( ( s ) => s.panel );
	const hints = useHints().filter( ( h ) => h.node === node.id );
	const title = 'step' === node.type ? __( 'Step', 'funnelforms-pro' ) : 'contact' === node.type ? __( 'Contact step', 'funnelforms-pro' ) : __( 'End', 'funnelforms-pro' );
	const ask = useAiAsk();
	const { ctx } = useEnv();
	const actions = (
		<>
			{ ask ? (
				<IconButton
					label={ __( 'Change with AI', 'funnelforms-pro' ) }
					icon={ icons.sparkles }
					disabled={ readOnly }
					onClick={ () => ask( sprintf( __( 'In the step "%s": ', 'funnelforms-pro' ), nodeName( node, ctx.locale ) || title ) ) }
				/>
			) : null }
			<IconButton
				label={ __( 'Duplicate', 'funnelforms-pro' ) }
				icon={ icons.copy }
				disabled={ readOnly }
				onClick={ () => {
					let id: string | null = null;
					change( ( d ) => {
						id = duplicateNode( d, node.id );
					} );
					if ( id ) {
						select( { node: id } );
					}
				} }
			/>
			<IconButton
				label={ __( 'Delete', 'funnelforms-pro' ) }
				icon={ icons.trash }
				danger
				disabled={ readOnly || doc.nodes.length <= 1 }
				onClick={ () => {
					removeWithNotice( store, ( d ) => removeNode( d, node.id ), fieldsOf( doc, node.id ) );
					select( {} );
				} }
			/>
		</>
	);
	// Hints about the node itself; those about its paths are on the logic panel.
	const own = hints.filter( ( h ) => ! h.edge && ! h.field && ! LOGIC_CODES.includes( h.code ) );
	if ( 'end' === node.type ) {
		return (
			<>
				<Section title={ title } actions={ actions }>
					<HintList doc={ doc } hints={ own.filter( ( h ) => 'noEntry' !== h.code ) } compact />
					<EndProps node={ node } />
					<EndCode doc={ doc } node={ node } />
				</Section>
				<EndArrivals doc={ doc } node={ node } />
			</>
		);
	}
	const logicCount = hints.filter( ( h ) => 'info' !== h.level && ( h.edge || LOGIC_CODES.includes( h.code ) ) ).length;
	const single = 'step' === node.type && 1 === node.fields.length ? node.fields[ 0 ] : undefined;
	const content = (
		<>
			<Section title={ title } actions={ actions }>
				{ 'step' === node.type && 'free' !== process.env.FUNNELFORMS_EDITION ? <StepVariants doc={ doc } nodeId={ node.id } /> : null }
				<HintList doc={ doc } hints={ own } compact />
				{ doc.start !== node.id ? (
					<Button size="sm" icon={ icons.start } onClick={ () => change( ( d ) => setStart( d, node.id ) ) } disabled={ readOnly }>
						{ __( 'Make this the first step', 'funnelforms-pro' ) }
					</Button>
				) : (
					<p className="ffxb-hint">{ __( 'Visitors start here.', 'funnelforms-pro' ) }</p>
				) }
				{ 'contact' === node.type ? <ContactProps node={ node } /> : null }
			</Section>
			{ single && 'step' === node.type ? <FieldProps node={ node } field={ single } /> : <FieldList node={ node } /> }
			{ 'contact' === node.type ? <ContactCode node={ node } /> : null }
		</>
	);
	const logic =
		'contact' === node.type ? (
			<>
				<ActionsSection doc={ doc } node={ node.id } />
				<NodeLogic doc={ doc } node={ node } title={ __( 'Then visitors see', 'funnelforms-pro' ) } />
			</>
		) : (
			<NodeLogic doc={ doc } node={ node } />
		);
	return (
		<>
			<PanelTabs
				panel={ panel }
				logicLabel={ 'contact' === node.type ? __( 'After sending', 'funnelforms-pro' ) : __( 'Logic', 'funnelforms-pro' ) }
				contentLabel={ 'contact' === node.type ? __( 'Contact step', 'funnelforms-pro' ) : single ? __( 'Question', 'funnelforms-pro' ) : __( 'Fields', 'funnelforms-pro' ) }
				count={ logicCount }
			/>
			<div role="tabpanel" id="ffxb-node-panel" aria-labelledby={ 'ffxb-node-tab-' + panel }>
				{ 'logic' === panel ? logic : content }
			</div>
		</>
	);
}

/** Hints that belong on the logic panel of a step. */
const LOGIC_CODES: string[] = [ 'deadEnd', 'noOtherwise', 'contactNoEnd' ];

/** The two panels of a step: what it asks, and where visitors go (or what happens on sending). */
function PanelTabs( { panel, contentLabel, logicLabel, count }: { panel: Panel; contentLabel: string; logicLabel: string; count: number } ) {
	const show = useEnv().store.getState().showPanel;
	const tabs: Array<[ Panel, string ]> = [
		[ 'content', contentLabel ],
		[ 'logic', logicLabel ],
	];
	const onKey = ( e: React.KeyboardEvent ): void => {
		if ( 'ArrowLeft' === e.key || 'ArrowRight' === e.key ) {
			e.preventDefault();
			const next: Panel = 'content' === panel ? 'logic' : 'content';
			show( next );
			document.getElementById( 'ffxb-node-tab-' + next )?.focus();
		}
	};
	return (
		<div className="ffxb-ptabs" role="tablist" aria-label={ __( 'Properties', 'funnelforms-pro' ) }>
			{ tabs.map( ( [ id, label ] ) => (
				<button
					key={ id }
					type="button"
					role="tab"
					id={ 'ffxb-node-tab-' + id }
					aria-selected={ panel === id }
					aria-controls="ffxb-node-panel"
					tabIndex={ panel === id ? 0 : -1 }
					className={ 'ffxb-ptabs__tab' + ( panel === id ? ' is-active' : '' ) }
					onClick={ () => show( id ) }
					onKeyDown={ onKey }
				>
					{ label }
					{ 'logic' === id && count > 0 ? (
						<span className="ffxb-ptabs__count" title={ __( 'Hints about the logic', 'funnelforms-pro' ) }>
							{ count }
						</span>
					) : null }
				</button>
			) ) }
		</div>
	);
}

/** How visitors reach an end, and what sending did before they see it. */
function EndArrivals( { doc, node }: { doc: FormDocument; node: Extract<FormNode, { type: 'end' }> } ) {
	const { store, ctx } = useEnv();
	const select = store.getState().select;
	const incoming = doc.edges.filter( ( e ) => e.to === node.id );
	const fields = fieldIndex( doc );
	return (
		<Section title={ __( 'How visitors get here', 'funnelforms-pro' ) }>
			{ 0 === incoming.length ? <p className="ffxb-hint">{ __( 'No path leads here yet. Choose this end as next step of a contact step or a question, or draw a path on the canvas.', 'funnelforms-pro' ) }</p> : null }
			<ul className="ffxb-arrivals">
				{ incoming.map( ( e ) => {
					const from = findNode( doc, e.from );
					if ( ! from ) {
						return null;
					}
					const contact = 'contact' === from.type;
					const run = contact ? doc.actions.filter( ( a ) => ! a.node || a.node === from.id ) : [];
					return (
						<li key={ e.id } className={ 'ffxb-arrival' + ( contact ? ' ffxb-arrival--sent' : '' ) }>
							<button type="button" className="ffxb-arrival__path" onClick={ () => select( { edge: e.id } ) }>
								<span className="ffxb-arrival__from">{ nodeName( from, ctx.locale ) || __( 'Without a title', 'funnelforms-pro' ) }</span>
								<span className="ffxb-arrival__when">{ e.when ? edgeLabel( e.when, doc, ctx.locale, from.id, fields ) : doc.edges.some( ( x ) => x.from === from.id && x.when ) ? __( 'Otherwise', 'funnelforms-pro' ) : __( 'Always', 'funnelforms-pro' ) }</span>
							</button>
							{ contact ? (
								<p className="ffxb-arrival__note">
									{ run.length
										? sprintf( __( 'After sending: %s', 'funnelforms-pro' ), run.map( ( a ) => kindName( a.kind ) ).join( ', ' ) )
										: __( 'After sending: the entry is saved, nothing else happens.', 'funnelforms-pro' ) }{ ' ' }
									<button type="button" className="ffxb-link" onClick={ () => select( { node: from.id }, 'logic' ) }>
										{ __( 'Edit', 'funnelforms-pro' ) }
									</button>
								</p>
							) : doc.nodes.some( ( n ) => 'contact' === n.type ) ? (
								<p className="ffxb-arrival__note ffxb-arrival__note--muted">{ __( 'Leaves without sending: no entry, no mails.', 'funnelforms-pro' ) }</p>
							) : null }
						</li>
					);
				} ) }
			</ul>
		</Section>
	);
}

function ContactProps( { node }: { node: Extract<FormNode, { type: 'contact' }> } ) {
	const { ctx, lang } = useEnv();
	const change = useChange();
	const edit = ( key: 'title' | 'description' | 'submitLabel' ) => ( value: string ) =>
		change( ( d ) => {
			const n = findNode( d, node.id );
			if ( n && 'contact' === n.type ) {
				put( n, key, lang, value, ctx.locale );
			}
		}, `${ node.id }:${ key }` );
	return (
		<>
			<TextProp label={ __( 'Heading', 'funnelforms-pro' ) } value={ node.title } onChange={ edit( 'title' ) } />
			<TextProp label={ __( 'Text below the heading', 'funnelforms-pro' ) } value={ node.description } onChange={ edit( 'description' ) } multiline />
			<TextProp label={ __( 'Button', 'funnelforms-pro' ) } value={ node.submitLabel } onChange={ edit( 'submitLabel' ) } />
			<ContactLayoutProps
				node={ node }
				change={ ( recipe, key ) =>
					change( ( d ) => {
						const n = findNode( d, node.id );
						if ( n && 'contact' === n.type ) {
							const layout = n.layout ?? {};
							recipe( layout );
							if ( Object.keys( layout ).length ) {
								n.layout = layout;
							} else {
								delete n.layout;
							}
						}
					}, `${ node.id }:layout.${ key }` )
				}
			/>
		</>
	);
}

/** The fields of a step or contact step, to select, order, copy and remove. */
function FieldList( { node }: { node: Extract<FormNode, { type: 'step' | 'contact' }> } ) {
	const { store, ctx, readOnly } = useEnv();
	const doc = useBuilder( ( s ) => s.doc ) as FormDocument;
	const change = useChange();
	const select = store.getState().select;
	const fields = node.fields as AnyField[];
	const name = ( f: AnyField ): string => ( 'contact' === node.type ? contactFieldName( f.type ) : stepFieldName( f.type ) );
	return (
		<Section title={ __( 'Fields', 'funnelforms-pro' ) }>
			<ol className="ffxb-fields">
				{ fields.map( ( f, i ) => (
					<li key={ f.id } className="ffxb-fields__row">
						<button type="button" className="ffxb-fields__main" onClick={ () => select( { node: node.id, field: f.id } ) }>
							<span className="ffxb-fields__type">{ name( f ) }</span>
							<span className="ffxb-fields__label">{ text( f.label, ctx.locale ) || '—' }</span>
							{ 'showWhen' in f && f.showWhen ? (
								<span className="ffxb-fields__cond" title={ describeCondition( f.showWhen, doc, ctx.locale ) }>
									{ __( 'Only if …', 'funnelforms-pro' ) }
								</span>
							) : null }
						</button>
						<IconButton label={ __( 'Move up', 'funnelforms-pro' ) } icon={ <span aria-hidden="true">↑</span> } disabled={ readOnly || 0 === i } onClick={ () => change( ( d ) => void moveField( d, node.id, f.id, node.id, i - 1 ) ) } />
						<IconButton
							label={ __( 'Move down', 'funnelforms-pro' ) }
							icon={ <span aria-hidden="true">↓</span> }
							disabled={ readOnly || i === fields.length - 1 }
							onClick={ () => change( ( d ) => void moveField( d, node.id, f.id, node.id, i + 1 ) ) }
						/>
					</li>
				) ) }
			</ol>
			<p className="ffxb-hint">{ __( 'Add fields from the list on the left, or drag them onto the step.', 'funnelforms-pro' ) }</p>
		</Section>
	);
}

/* ------------------------------------------------------------------ fields */

function FieldInspector( { doc, node, fieldId }: { doc: FormDocument; node: FormNode; fieldId: string } ) {
	const field = fieldIn( doc, node.id, fieldId );
	const select = useEnv().store.getState().select;
	if ( ! field || 'end' === node.type ) {
		return null;
	}
	return (
		<>
			<div className="ffxb-crumbs">
				<Button size="sm" variant="ghost" icon={ icons.back } onClick={ () => select( { node: node.id } ) }>
					{ 'contact' === node.type ? __( 'Contact step', 'funnelforms-pro' ) : __( 'Step', 'funnelforms-pro' ) }
				</Button>
			</div>
			<FieldProps node={ node } field={ field } />
		</>
	);
}

function FieldProps( { node, field }: { node: Extract<FormNode, { type: 'step' | 'contact' }>; field: AnyField } ) {
	const { api, store, ctx, lang, readOnly } = useEnv();
	const change = useChange();
	const select = store.getState().select;
	const contact = 'contact' === node.type;
	// A string, so the selector gives the same value while nothing changes.
	const clash = useBuilder( ( st ) => {
		const other = st.doc ? keyClash( st.doc, field.id ) : null;
		return other ? nodeName( other.node, ctx.locale ) || other.field.key : null;
	} );
	const edit = ( recipe: ( f: AnyField ) => void, key?: string ) =>
		change( ( d ) => {
			const f = fieldIn( d, node.id, field.id );
			if ( f ) {
				recipe( f );
			}
		}, key ? `${ field.id }:${ key }` : undefined );
	const textOf = ( key: string ) => ( value: string ) => edit( ( f ) => put( f, key as keyof AnyField, lang, value, ctx.locale ), key );
	const propText = ( key: string ) => ( value: string ) => edit( ( f ) => put( f.props as Record<string, unknown>, key, lang, value, ctx.locale ), 'props.' + key );
	const props = field.props as Record<string, unknown>;
	const propsEdit = ( recipe: ( p: Record<string, unknown> ) => void, key?: string ): void => edit( ( f ) => recipe( f.props as Record<string, unknown> ), key );
	const actions = (
		<>
			<IconButton
				label={ __( 'Duplicate field', 'funnelforms-pro' ) }
				icon={ icons.copy }
				disabled={ readOnly }
				onClick={ () => {
					let id: string | null = null;
					change( ( d ) => {
						id = duplicateField( d, node.id, field.id );
					} );
					if ( id ) {
						select( { node: node.id, field: id } );
					}
				} }
			/>
			<IconButton
				label={ __( 'Delete field', 'funnelforms-pro' ) }
				icon={ icons.trash }
				danger
				disabled={ readOnly || ( ! contact && node.fields.length <= 1 ) }
				onClick={ () => {
					removeWithNotice( store, ( d ) => void removeField( d, node.id, field.id ), asksFor( field.id ) );
					select( { node: node.id } );
				} }
			/>
		</>
	);
	const name = contact ? contactFieldName( field.type ) : stepFieldName( field.type );
	const hasLabel = ! ( contact && [ 'consent', 'checkbox', 'html', 'captcha' ].includes( field.type ) );
	return (
		<Section title={ name } actions={ actions }>
			{ hasLabel ? <TextProp label={ contact ? __( 'Label', 'funnelforms-pro' ) : 'result' === field.type ? __( 'Heading', 'funnelforms-pro' ) : __( 'Question', 'funnelforms-pro' ) } value={ field.label } onChange={ textOf( 'label' ) } /> : null }
			{ hasLabel && ! contact && 'free' !== process.env.FUNNELFORMS_EDITION ? <AnswerInsert fieldId={ field.id } onInsert={ ( token ) => textOf( 'label' )( `${ editText( field.label, lang, ctx.locale ) } ${ token }`.trim() ) } /> : null }
			{ ! contact && 'description' in field ? <TextProp label={ __( 'Description', 'funnelforms-pro' ) } value={ field.description } onChange={ textOf( 'description' ) } multiline /> : null }
			{ 'placeholder' in props ? <TextProp label={ __( 'Placeholder', 'funnelforms-pro' ) } value={ props.placeholder as Text } onChange={ propText( 'placeholder' ) } /> : null }
			{ contact && ( 'consent' === field.type || 'checkbox' === field.type || 'html' === field.type ) ? (
				<TextProp
					label={ { consent: __( 'Consent text', 'funnelforms-pro' ), checkbox: __( 'Text next to the box', 'funnelforms-pro' ) }[ field.type as string ] ?? __( 'HTML', 'funnelforms-pro' ) }
					value={ props.html as Text }
					onChange={ propText( 'html' ) }
					multiline
					hint={ __( 'Links are allowed, e.g. to the privacy policy.', 'funnelforms-pro' ) }
				/>
			) : null }
			{ contact && 'select' === field.type ? <ContactOptions field={ field as ContactField } edit={ edit as ( recipe: ( f: ContactField ) => void, key?: string ) => void } /> : null }
			{ contact && 'captcha' === field.type ? <CaptchaHint /> : null }
			{ contact && api.icons && [ 'name', 'email', 'phone', 'phone_verification', 'text' ].includes( field.type ) ? (
				<InputIcon
					value={ props.icon }
					disabled={ readOnly }
					onChange={ ( icon ) =>
						edit( ( f ) => {
							const p = f.props as Record<string, unknown>;
							if ( icon ) {
								p.icon = icon;
							} else {
								delete p.icon;
							}
						}, 'props.icon' )
					}
				/>
			) : null }
			{ contact && ( 'phone' === field.type || 'phone_verification' === field.type ) ? (
				<>
					<PhoneCountryProps props={ props } edit={ propsEdit } />
					<PhoneSmsProps props={ props } edit={ propsEdit } always={ 'phone_verification' === field.type } />
				</>
			) : null }
			{ contact && 'email' === field.type ? (
				<Toggle label={ __( 'Business addresses only', 'funnelforms-pro' ) } checked={ true === props.b2bOnly } onChange={ ( v ) => edit( ( f ) => void ( ( f.props as Record<string, unknown> ).b2bOnly = v ) ) } />
			) : null }
			{ ! [ 'content', 'captcha', 'html', 'result' ].includes( field.type ) ? (
				<Toggle label={ __( 'Required', 'funnelforms-pro' ) } checked={ field.required } onChange={ ( v ) => edit( ( f ) => void ( f.required = v ) ) } />
			) : null }
			{ 'step' === node.type ? <FieldVisibility node={ node } fieldId={ field.id } /> : null }
			{ contact ? null : <StepFieldProps node={ node } field={ field as Field } edit={ edit } propText={ propText } /> }
			{ clash ? (
				<Notice tone="warning">
					{ sprintf( __( 'The variable name "%1$s" is used by "%2$s" as well. Calculations, placeholders and integrations then take only one of them; change it under Advanced.', 'funnelforms-pro' ), field.key, clash ) }
				</Notice>
			) : null }
			<details className="ffxb-advanced">
				<summary>{ __( 'Advanced', 'funnelforms-pro' ) }</summary>
				<TextInput
					label={ __( 'Variable name', 'funnelforms-pro' ) }
					value={ field.key }
					onChange={ ( v ) => edit( ( f ) => void ( f.key = v.replace( /[^A-Za-z0-9_-]/g, '_' ) ), 'key' ) }
					hint={ __( 'Used in calculations, placeholders and integrations.', 'funnelforms-pro' ) }
				/>
			</details>
		</Section>
	);
}

type Edit = ( recipe: ( f: AnyField ) => void, key?: string ) => void;

function StepFieldProps( { node, field, edit, propText }: { node: FormNode; field: Field; edit: Edit; propText: ( key: string ) => ( value: string ) => void } ) {
	const set = ( key: string, value: unknown ): void => edit( ( f ) => void ( ( f.props as Record<string, unknown> )[ key ] = value ), 'props.' + key );
	const num = ( key: string ) => ( value: number | undefined ): void => edit( ( f ) => {
		const props = f.props as Record<string, unknown>;
		if ( undefined === value ) {
			// Optional limits are removed; required numbers keep their last value.
			if ( ! [ 'min', 'max', 'step', 'start', 'maxSizeMb', 'maxFiles', 'minItems', 'maxItems' ].includes( key ) || 'number' === field.type ) {
				Reflect.deleteProperty( props, key );
			}
			return;
		}
		props[ key ] = value;
	}, 'props.' + key );
	switch ( field.type ) {
		case 'choice':
			return <ChoiceProps node={ node } field={ field } edit={ edit } />;
		case 'dropdown':
			return <DropdownProps node={ node } field={ field } edit={ edit } />;
		case 'text':
		case 'textarea':
			return <TextFieldProps field={ field } edit={ edit } num={ num } />;
		case 'number':
			return <NumberProps field={ field } edit={ edit } />;
		case 'date':
			return <DateProps field={ field } edit={ edit } />;
		case 'phone':
			return <PhoneCountryProps props={ field.props } edit={ ( recipe, key ) => edit( ( f ) => recipe( f.props as Record<string, unknown> ), key ) } />;
		case 'time':
			return <TimeProps field={ field } edit={ edit } />;
		case 'slider':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProField /> : <SliderProps field={ field } edit={ edit } />;
		case 'rating':
			return <RatingProps field={ field } edit={ edit } />;
		case 'content':
			return <ContentProps field={ field } edit={ edit } propText={ propText } />;
		case 'file':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProField /> : <FileProps field={ field } edit={ edit } propText={ propText } />;
		case 'signature':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProField /> : <SignatureProps field={ field } edit={ edit } />;
		case 'address':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProField /> : <AddressProps field={ field } edit={ edit } />;
		case 'booking':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProField /> : <BookingTypeField value={ field.props.bookingTypeRef } onChange={ ( v ) => set( 'bookingTypeRef', v ) } />;
		case 'result':
			return 'free' === process.env.FUNNELFORMS_EDITION ? <ProField /> : <ResultProps field={ field } edit={ edit } />;
		case 'repeat':
			if ( 'free' === process.env.FUNNELFORMS_EDITION ) {
				return <ProField />;
			}
			return 'step' === node.type ? <RepeatProps node={ node } field={ field } edit={ edit } num={ num } /> : null;
		default:
			return null;
	}
}
