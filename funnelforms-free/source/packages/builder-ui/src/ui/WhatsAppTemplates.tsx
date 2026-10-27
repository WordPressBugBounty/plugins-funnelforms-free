/**
 * The template of a WhatsApp action: chosen from the templates of the WhatsApp Business account
 * with a preview, or written here and submitted to Meta for review. Without the ID of the business
 * account (or the route) the name and language are entered by hand, as before.
 */
import React, { useEffect, useState } from 'react';
import { ApiError, type NewWhatsAppTemplate, type WhatsAppTemplate } from '../api';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { Button, Dialog, icons, Notice, Select, TextInput } from './ui';

/** Languages Meta offers for templates that forms are written in most. */
const LANGUAGES = [ 'de', 'en', 'en_US', 'en_GB', 'fr', 'it', 'es', 'nl', 'pl', 'pt_BR', 'pt_PT', 'tr', 'sv', 'da', 'cs', 'hu' ];

/** Number of placeholders {{1}} … {{n}} of a text; null when one is skipped or not a number. */
export function templatePlaceholders( body: string ): number | null {
	const numbers = new Set<number>();
	for ( const [ , inner ] of body.matchAll( /\{\{\s*([^}]*?)\s*\}\}/g ) ) {
		if ( ! /^[1-9]\d?$/.test( inner ?? '' ) ) {
			return null;
		}
		numbers.add( Number( inner ) );
	}
	return 0 === numbers.size || Math.max( ...numbers ) === numbers.size ? numbers.size : null;
}

function languageName( code: string ): string {
	try {
		const name = new Intl.DisplayNames( undefined, { type: 'language' } ).of( code.replace( '_', '-' ) );
		return name && name !== code ? `${ name } (${ code })` : code;
	} catch {
		return code;
	}
}

function statusName( status: string ): string {
	switch ( status ) {
		case 'APPROVED':
			return __( 'approved', 'funnelforms-pro' );
		case 'PENDING':
		case 'IN_APPEAL':
			return __( 'in review', 'funnelforms-pro' );
		case 'REJECTED':
			return __( 'rejected', 'funnelforms-pro' );
		default:
			return __( 'paused or disabled', 'funnelforms-pro' );
	}
}

type Loaded = { state: 'loading' } | { state: 'ready'; templates: WhatsAppTemplate[] } | { state: 'failed'; code: string; message: string };

export function WhatsAppTemplatePicker( {
	connectionRef,
	template,
	language,
	values,
	defaultLanguage,
	onTemplate,
	onLanguage,
	onChoose,
}: {
	connectionRef: string;
	template: string;
	language: string;
	/** Texts of the parameters, for the preview. */
	values: string[];
	defaultLanguage: string;
	onTemplate: ( name: string ) => void;
	onLanguage: ( language: string ) => void;
	onChoose: ( template: WhatsAppTemplate ) => void;
} ) {
	const { api, rights, readOnly } = useEnv();
	const [ loaded, setLoaded ] = useState<Loaded>( { state: 'loading' } );
	const [ round, setRound ] = useState( 0 );
	/** auto: the list unless the action names a template the account lacks. */
	const [ mode, setMode ] = useState<'auto' | 'list' | 'manual'>( 'auto' );
	const [ creating, setCreating ] = useState( false );
	const listable = '' !== connectionRef && connectionRef.startsWith( 'whatsapp:' ) && !! api.whatsAppTemplates;

	useEffect( () => {
		if ( ! listable || ! api.whatsAppTemplates ) {
			return;
		}
		let live = true;
		setLoaded( { state: 'loading' } );
		api.whatsAppTemplates( connectionRef ).then(
			( templates ) => live && setLoaded( { state: 'ready', templates } ),
			( e: unknown ) => live && setLoaded( { state: 'failed', code: e instanceof ApiError ? e.code : 'error', message: e instanceof Error ? e.message : String( e ) } )
		);
		return () => {
			live = false;
		};
	}, [ api, connectionRef, listable, round ] );

	const templates = 'ready' === loaded.state ? loaded.templates : [];
	const current = templates.find( ( t ) => t.name === template && t.language === language );
	const listed = listable && 'ready' === loaded.state && templates.length > 0 && ( 'list' === mode || ( 'auto' === mode && ( '' === template || !! current ) ) );
	const reload = (): void => setRound( ( r ) => r + 1 );

	const manualInputs = (
		<>
			<TextInput label={ __( 'Template', 'funnelforms-pro' ) } value={ template } onChange={ ( v ) => onTemplate( v.trim() ) } hint={ __( 'Name of a template Meta approved for your account.', 'funnelforms-pro' ) } />
			<TextInput label={ __( 'Language of the template', 'funnelforms-pro' ) } value={ language } placeholder="de" onChange={ ( v ) => onLanguage( v.trim() ) } />
		</>
	);

	return (
		<div className="ffxb-wa-templates">
			{ listed ? (
				<Select
					label={ __( 'Template', 'funnelforms-pro' ) }
					value={ current ? `${ current.name }|${ current.language }` : '' }
					options={ [
						{ value: '', label: __( 'Choose…', 'funnelforms-pro' ) },
						...templates.map( ( t ) => ( { value: `${ t.name }|${ t.language }`, label: `${ t.name } · ${ t.language } · ${ statusName( t.status ) }` } ) ),
					] }
					onChange={ ( v ) => {
						const chosen = templates.find( ( t ) => `${ t.name }|${ t.language }` === v );
						if ( chosen && ! readOnly ) {
							onChoose( chosen );
						}
					} }
					hint={ __( 'The templates of your WhatsApp Business account.', 'funnelforms-pro' ) }
				/>
			) : (
				manualInputs
			) }
			{ listable && 'loading' === loaded.state ? <p className="ffxb-hint">{ __( 'Loading the templates…', 'funnelforms-pro' ) }</p> : null }
			{ listable && 'ready' === loaded.state && 0 === templates.length ? <p className="ffxb-hint">{ __( 'The account has no templates yet.', 'funnelforms-pro' ) }</p> : null }
			{ listable && 'failed' === loaded.state && 'connection_incomplete' === loaded.code ? (
				<AccountId connectionRef={ connectionRef } onSaved={ reload } />
			) : listable && 'failed' === loaded.state ? (
				<Notice tone="warning" action={ <Button size="sm" variant="ghost" onClick={ reload }>{ __( 'Try again', 'funnelforms-pro' ) }</Button> }>
					{ sprintf( __( 'The templates could not be loaded: %s', 'funnelforms-pro' ), loaded.message ) }
				</Notice>
			) : null }
			{ current ? <TemplatePreview template={ current } values={ values } /> : null }
			{ listable && 'ready' === loaded.state ? (
				<div className="ffxb-inline ffxb-wa-templates__tools">
					{ templates.length > 0 ? (
						<Button size="sm" variant="ghost" onClick={ () => setMode( listed ? 'manual' : 'list' ) }>
							{ listed ? __( 'Enter the name yourself', 'funnelforms-pro' ) : __( 'Choose from the account', 'funnelforms-pro' ) }
						</Button>
					) : null }
					<Button size="sm" variant="ghost" onClick={ reload }>
						{ __( 'Reload', 'funnelforms-pro' ) }
					</Button>
					{ rights.settings && api.createWhatsAppTemplate && ! readOnly ? (
						<Button size="sm" variant="ghost" icon={ icons.plus } onClick={ () => setCreating( true ) }>
							{ __( 'New template', 'funnelforms-pro' ) }
						</Button>
					) : null }
				</div>
			) : null }
			{ creating ? (
				<NewTemplateDialog
					connectionRef={ connectionRef }
					defaultLanguage={ defaultLanguage }
					onClose={ () => setCreating( false ) }
					onCreated={ ( t ) => {
						setLoaded( { state: 'ready', templates: [ ...templates.filter( ( x ) => x.name !== t.name || x.language !== t.language ), t ].sort( ( a, b ) => a.name.localeCompare( b.name ) || a.language.localeCompare( b.language ) ) } );
						setMode( 'list' );
						onChoose( t );
						setCreating( false );
					} }
				/>
			) : null }
		</div>
	);
}

/** The message as the visitor gets it, with the texts of the parameters in its placeholders. */
export function TemplatePreview( { template, values }: { template: WhatsAppTemplate; values: string[] } ) {
	const fill = ( text: string ) =>
		text.split( /(\{\{\s*\d+\s*\}\})/ ).map( ( part, i ) => {
			const n = /^\{\{\s*(\d+)\s*\}\}$/.exec( part );
			if ( ! n ) {
				return part;
			}
			const value = values[ Number( n[ 1 ] ) - 1 ]?.trim() ?? '';
			return (
				<mark key={ i } className={ `ffxb-wa-preview__value${ '' === value ? ' is-empty' : '' }` }>
					{ '' === value ? part : value }
				</mark>
			);
		} );
	return (
		<>
			{ 'REJECTED' === template.status ? (
				<Notice tone="danger">
					{ template.rejectedReason && 'NONE' !== template.rejectedReason
						? sprintf( __( 'Meta rejected this template (%s). Change it in the WhatsApp Manager or write a new one.', 'funnelforms-pro' ), template.rejectedReason )
						: __( 'Meta rejected this template. Change it in the WhatsApp Manager or write a new one.', 'funnelforms-pro' ) }
				</Notice>
			) : 'PENDING' === template.status || 'IN_APPEAL' === template.status ? (
				<Notice tone="info">{ __( 'Meta is still reviewing this template, usually for a few minutes. Messages are sent once it is approved.', 'funnelforms-pro' ) }</Notice>
			) : 'APPROVED' !== template.status ? (
				<Notice tone="warning">{ __( 'Meta paused or disabled this template; messages with it are not sent.', 'funnelforms-pro' ) }</Notice>
			) : null }
			{ template.supported ? null : <Notice tone="warning">{ __( 'This template needs a picture, a document or variables in the header or buttons, which forms do not send. Choose another one.', 'funnelforms-pro' ) }</Notice> }
			{ template.placeholders > values.length ? <Notice tone="warning">{ sprintf( __( 'The template has %d placeholders. Give each one a text below.', 'funnelforms-pro' ), template.placeholders ) }</Notice> : null }
			<figure className="ffxb-wa-preview" aria-label={ __( 'Preview of the message', 'funnelforms-pro' ) }>
				{ template.header ? <strong className="ffxb-wa-preview__header">{ template.header }</strong> : null }
				<p className="ffxb-wa-preview__body">{ fill( template.body ) }</p>
				{ template.footer ? <small className="ffxb-wa-preview__footer">{ template.footer }</small> : null }
			</figure>
		</>
	);
}

/** Asks for the ID of the business account, which listing and submitting templates need. */
function AccountId( { connectionRef, onSaved }: { connectionRef: string; onSaved: () => void } ) {
	const { api, rights } = useEnv();
	const [ id, setId ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const save = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			await api.updateConnection( connectionRef, { businessAccountId: id.trim() } );
			onSaved();
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	if ( ! rights.settings ) {
		return <p className="ffxb-hint">{ __( 'To choose templates from the account, someone who may change the settings adds the ID of the WhatsApp Business account to the connection.', 'funnelforms-pro' ) }</p>;
	}
	return (
		<div className="ffxb-wa-account">
			<p className="ffxb-hint">{ __( 'To choose templates here and write new ones, add the ID of your WhatsApp Business account (WhatsApp Manager → Account tools → Business account ID).', 'funnelforms-pro' ) }</p>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<div className="ffxb-inline">
				<TextInput label={ __( 'WhatsApp Business account ID', 'funnelforms-pro' ) } value={ id } onChange={ ( v ) => setId( v.replace( /\D/g, '' ) ) } />
				<Button size="sm" variant="primary" disabled={ busy || id.length < 5 } onClick={ () => void save() }>
					{ __( 'Save', 'funnelforms-pro' ) }
				</Button>
			</div>
		</div>
	);
}

function NewTemplateDialog( { connectionRef, defaultLanguage, onClose, onCreated }: { connectionRef: string; defaultLanguage: string; onClose: () => void; onCreated: ( t: WhatsAppTemplate ) => void } ) {
	const { api } = useEnv();
	const [ draft, setDraft ] = useState<NewWhatsAppTemplate>( () => ( {
		name: '',
		language: LANGUAGES.includes( defaultLanguage ) ? defaultLanguage : LANGUAGES.includes( defaultLanguage.slice( 0, 2 ) ) ? defaultLanguage.slice( 0, 2 ) : 'en',
		category: 'UTILITY',
		body: '',
		examples: [],
		footer: '',
	} ) );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const count = templatePlaceholders( draft.body );
	const examples = Array.from( { length: count ?? 0 }, ( _, i ) => draft.examples[ i ] ?? '' );
	const complete = '' !== draft.name && '' !== draft.body.trim() && null !== count && examples.every( ( e ) => '' !== e.trim() );
	const set = ( changes: Partial<NewWhatsAppTemplate> ): void => setDraft( ( d ) => ( { ...d, ...changes } ) );
	const save = async (): Promise<void> => {
		if ( ! api.createWhatsAppTemplate ) {
			return;
		}
		setBusy( true );
		setError( null );
		try {
			onCreated( await api.createWhatsAppTemplate( connectionRef, { ...draft, body: draft.body.trim(), examples: examples.map( ( e ) => e.trim() ), footer: draft.footer?.trim() ?? '' } ) );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
			setBusy( false );
		}
	};
	return (
		<Dialog
			title={ __( 'New WhatsApp template', 'funnelforms-pro' ) }
			open
			wide
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ busy || ! complete } onClick={ () => void save() }>
						{ __( 'Submit to Meta', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<TextInput label={ __( 'Name', 'funnelforms-pro' ) } value={ draft.name } placeholder="anfrage_bestaetigung" onChange={ ( v ) => set( { name: v.toLowerCase().replace( /[^a-z0-9_]+/g, '_' ).slice( 0, 512 ) } ) } hint={ __( 'Lowercase letters, digits and underscores.', 'funnelforms-pro' ) } />
			<Select label={ __( 'Language', 'funnelforms-pro' ) } value={ draft.language } options={ LANGUAGES.map( ( l ) => ( { value: l, label: languageName( l ) } ) ) } onChange={ ( v ) => set( { language: v } ) } />
			<Select<NewWhatsAppTemplate[ 'category' ]>
				label={ __( 'Kind', 'funnelforms-pro' ) }
				value={ draft.category }
				options={ [
					{ value: 'UTILITY', label: __( 'Service message (e.g. confirmation of the request)', 'funnelforms-pro' ) },
					{ value: 'MARKETING', label: __( 'Marketing (offers, news)', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => set( { category: v } ) }
				hint={ __( 'Meta charges marketing messages higher and may change the kind on review.', 'funnelforms-pro' ) }
			/>
			<TextInput label={ __( 'Message', 'funnelforms-pro' ) } value={ draft.body } multiline onChange={ ( v ) => set( { body: v.slice( 0, 1024 ) } ) } hint={ __( 'Placeholders {{1}}, {{2}} … take the texts the action sends, e.g. the name from the form. Put text before the first and after the last one.', 'funnelforms-pro' ) } />
			<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ null === count } onClick={ () => set( { body: draft.body + ( draft.body && ! /\s$/.test( draft.body ) ? ' ' : '' ) + `{{${ ( count ?? 0 ) + 1 }}}` } ) }>
				{ __( 'Add a placeholder', 'funnelforms-pro' ) }
			</Button>
			{ null === count ? <Notice tone="warning">{ __( 'Number the placeholders {{1}}, {{2}} … without gaps.', 'funnelforms-pro' ) }</Notice> : null }
			{ examples.map( ( value, i ) => (
				<TextInput
					key={ i }
					label={ sprintf( __( 'Example for {{%d}}', 'funnelforms-pro' ), i + 1 ) }
					value={ value }
					onChange={ ( v ) =>
						setDraft( ( d ) => {
							const next = Array.from( { length: count ?? 0 }, ( _, j ) => d.examples[ j ] ?? '' );
							next[ i ] = v;
							return { ...d, examples: next };
						} )
					}
				/>
			) ) }
			{ examples.length ? <p className="ffxb-hint">{ __( 'Meta reviews the message with these examples; they are not sent.', 'funnelforms-pro' ) }</p> : null }
			<TextInput label={ __( 'Footer (optional)', 'funnelforms-pro' ) } value={ draft.footer ?? '' } onChange={ ( v ) => set( { footer: v.slice( 0, 60 ) } ) } hint={ __( 'Small grey line below the message, at most 60 characters.', 'funnelforms-pro' ) } />
			<p className="ffxb-hint">{ __( 'Meta reviews new templates, usually within minutes. Messages are sent once the template is approved.', 'funnelforms-pro' ) }</p>
		</Dialog>
	);
}
