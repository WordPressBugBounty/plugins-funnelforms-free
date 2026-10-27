/**
 * The "CRM or newsletter" action: which tool and connection receive the entry, and which field of
 * the contact step goes where. The choices a tool offers (lists, tags, pipelines, deal stages) are
 * read from the account through the connection, as Funnelforms 3 did while editing.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Action, FormDocument } from '@funnelforms/form-schema';
import { choicesFor, contactFieldName, contactFields, contactToken, mappingGaps, suggestMapping, type CrmChoice, type CrmConnection, type CrmMappingField, type CrmOptions, type CrmProvider } from '../connect';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { CrmConnectionDialog, providerOptions, useCrmCatalog } from './CrmConnections';
import { Button, Dialog, icons, Notice, Select, Spinner, TextInput } from './ui';

type CrmActionOf = Extract<Action, { kind: 'crm' }>;

type Choices = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; data: CrmOptions } | { state: 'failed'; text: string };

/** What the account of a connection offers; read again when the connection changes. */
function useChoices( provider: CrmProvider | undefined, ref: string, known: boolean ): [ Choices, () => void, React.Dispatch<React.SetStateAction<Choices>> ] {
	const { api } = useEnv();
	const [ choices, setChoices ] = useState<Choices>( { state: 'idle' } );
	const wanted = Boolean( api.connect && provider?.lookups && ref && known && provider.mapping.some( ( m ) => 'choice' === m.kind ) );
	const [ tick, setTick ] = useState( 0 );

	useEffect( () => {
		if ( ! wanted || ! api.connect ) {
			setChoices( { state: 'idle' } );
			return undefined;
		}
		let live = true;
		setChoices( { state: 'loading' } );
		api.connect.crmOptions( ref ).then(
			( data ) => live && setChoices( { state: 'ready', data } ),
			( e: unknown ) => live && setChoices( { state: 'failed', text: e instanceof Error ? e.message : String( e ) } )
		);
		return () => {
			live = false;
		};
	}, [ api, ref, wanted, tick ] );

	return [ choices, useCallback( () => setTick( ( n ) => n + 1 ), [] ), setChoices ];
}

export function CrmAction( { doc, action, common }: { doc: FormDocument; action: CrmActionOf; common: React.ReactNode } ) {
	const { api, rights, store, readOnly } = useEnv();
	const change = store.getState().change;
	const catalog = useCrmCatalog( api.connect );
	const [ adding, setAdding ] = useState( false );
	const locale = doc.locales.default;
	const { provider, connectionRef, mapping } = action.config;
	const spec = catalog.providers?.find( ( p ) => p.provider === provider );
	const own: CrmConnection[] = useMemo( () => ( catalog.connections ?? [] ).filter( ( c ) => c.provider === provider ), [ catalog.connections, provider ] );
	const known = own.some( ( c ) => c.ref === connectionRef );
	const fields = useMemo( () => contactFields( doc, action.node ), [ doc, action.node ] );
	const [ choices, retry, setChoices ] = useChoices( spec, connectionRef, known );
	const [ sheet, setSheet ] = useState( false );

	const edit = ( recipe: ( config: CrmActionOf[ 'config' ] ) => void, key?: string ): void =>
		change( ( d ) => {
			const a = d.actions.find( ( x ) => x.id === action.id );
			if ( a && 'crm' === a.kind ) {
				recipe( a.config );
			}
		}, key ? `action:${ action.id }:${ key }` : undefined );

	const pickProvider = ( next: string ): void => {
		const target = catalog.providers?.find( ( p ) => p.provider === next );
		const only = ( catalog.connections ?? [] ).filter( ( c ) => c.provider === next );
		edit( ( config ) => {
			config.provider = next;
			config.connectionRef = 1 === only.length ? only[ 0 ]?.ref ?? '' : '';
			config.mapping = target ? suggestMapping( target, fields ) : {};
		} );
	};

	const setValue = ( name: string, value: string ): void =>
		edit( ( config ) => {
			// A value that depends on this one (deal stage on pipeline) no longer fits.
			const dropped = new Set( [ ...( '' === value ? [ name ] : [] ), ...( spec?.mapping ?? [] ).filter( ( m ) => m.dependsOn === name ).map( ( m ) => m.name ) ] );
			config.mapping = Object.fromEntries( Object.entries( { ...config.mapping, [ name ]: value } ).filter( ( [ k ] ) => ! dropped.has( k ) ) );
		}, `crm:${ name }` );

	if ( ! api.connect ) {
		return (
			<>
				<p className="ffxb-hint">{ __( 'This connection comes from Funnelforms 3 and keeps working as it is. Its settings are not edited here yet.', 'funnelforms-pro' ) }</p>
				{ common }
			</>
		);
	}
	if ( catalog.error ) {
		return (
			<>
				<Notice tone="danger" action={ <Button size="sm" onClick={ () => void catalog.reload() }>{ __( 'Try again', 'funnelforms-pro' ) }</Button> }>
					{ catalog.error }
				</Notice>
				{ common }
			</>
		);
	}
	if ( ! catalog.providers || ! catalog.connections ) {
		return <Spinner label={ __( 'Loading…', 'funnelforms-pro' ) } />;
	}

	const connectionOptions = [
		{ value: '', label: __( 'Choose…', 'funnelforms-pro' ) },
		...own.map( ( c ) => ( { value: c.ref, label: c.legacy ? `${ c.label } (${ __( 'From Funnelforms 3', 'funnelforms-pro' ) })` : c.label } ) ),
		...( connectionRef && ! known ? [ { value: connectionRef, label: __( 'Deleted connection', 'funnelforms-pro' ) } ] : [] ),
	];
	const gaps = spec ? mappingGaps( spec, mapping ) : [];

	const fieldInput = ( item: CrmMappingField ) => {
		const current = 'string' === typeof mapping[ item.name ] ? ( mapping[ item.name ] as string ) : '';
		const label = item.required ? sprintf( __( '%s (required)', 'funnelforms-pro' ), item.label ) : item.label;
		if ( 'contact' === item.kind ) {
			const options = [ { value: '', label: __( 'Not sent', 'funnelforms-pro' ) }, ...fields.map( ( f ) => ( { value: contactToken( f.key ), label: contactFieldName( f, locale ) } ) ) ];
			if ( current && ! options.some( ( o ) => o.value === current ) ) {
				options.push( { value: current, label: sprintf( __( 'Unknown field %s', 'funnelforms-pro' ), current ) } );
			}
			return <Select label={ label } value={ current } options={ options } onChange={ ( v ) => setValue( item.name, v ) } />;
		}
		if ( 'text' === item.kind ) {
			return <TextInput label={ label } value={ current } onChange={ ( v ) => setValue( item.name, v ) } />;
		}
		const list: CrmChoice[] | null = 'ready' === choices.state ? choicesFor( item, choices.data, mapping ) : null;
		if ( ! list ) {
			// The tool offers no choices (or they are not read): the value is typed in.
			return 'loading' === choices.state ? (
				<Select label={ label } value={ current } disabled options={ [ { value: current, label: __( 'Loading…', 'funnelforms-pro' ) } ] } onChange={ () => undefined } />
			) : (
				<TextInput label={ label } value={ current } onChange={ ( v ) => setValue( item.name, v.trim() ) } />
			);
		}
		const waiting = Boolean( item.dependsOn ) && '' === ( mapping[ item.dependsOn ?? '' ] ?? '' );
		const options = [ { value: '', label: waiting ? __( 'Choose the value above first', 'funnelforms-pro' ) : __( 'Choose…', 'funnelforms-pro' ) }, ...list.map( ( c ) => ( { value: c.value, label: c.label } ) ) ];
		if ( current && ! options.some( ( o ) => o.value === current ) ) {
			options.push( { value: current, label: sprintf( __( 'Current value (%s)', 'funnelforms-pro' ), current ) } );
		}
		const select = <Select label={ label } value={ current } options={ options } disabled={ waiting } onChange={ ( v ) => setValue( item.name, v ) } />;
		if ( 'googlesheets' !== spec?.provider ) {
			return select;
		}
		return (
			<>
				{ select }
				<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly } onClick={ () => setSheet( true ) }>
					{ __( 'New spreadsheet', 'funnelforms-pro' ) }
				</Button>
			</>
		);
	};

	/** A spreadsheet just created: offered in the list and chosen. */
	const created = ( name: string, choice: CrmChoice ): void => {
		setChoices( ( c ) => ( 'ready' === c.state ? { state: 'ready', data: { ...c.data, options: { ...c.data.options, [ name ]: [ ...( ( c.data.options[ name ] as CrmChoice[] | undefined ) ?? [] ), choice ] } } } : c ) );
		setValue( name, choice.value );
		setSheet( false );
	};

	return (
		<div className="ffxb-crm">
			<Select label={ __( 'Tool', 'funnelforms-pro' ) } value={ provider } options={ [ ...( provider ? [] : [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) } ] ), ...providerOptions( catalog.providers ) ] } disabled={ readOnly } onChange={ pickProvider } />
			{ spec ? (
				<>
					<Select label={ __( 'Connection', 'funnelforms-pro' ) } value={ connectionRef } options={ connectionOptions } disabled={ readOnly } onChange={ ( v ) => edit( ( config ) => void ( config.connectionRef = v ) ) } />
					{ 0 === own.length ? <Notice tone="info">{ sprintf( __( 'No %s connection yet. Add the access data of your account to send entries there.', 'funnelforms-pro' ), spec.label ) }</Notice> : null }
					{ rights.settings ? (
						<Button size="sm" variant="ghost" icon={ icons.plus } disabled={ readOnly } onClick={ () => setAdding( true ) }>
							{ __( 'Add connection', 'funnelforms-pro' ) }
						</Button>
					) : 0 === own.length ? (
						<p className="ffxb-hint">{ __( 'Connections are added by someone who may change the settings.', 'funnelforms-pro' ) }</p>
					) : null }
					{ adding ? (
						<CrmConnectionDialog
							api={ api.connect }
							providers={ catalog.providers }
							provider={ spec.provider }
							onClose={ () => setAdding( false ) }
							onSaved={ ( c ) => {
								catalog.setConnections( ( list ) => [ ...( list ?? [] ), c ] );
								edit( ( config ) => void ( config.connectionRef = c.ref ) );
								setAdding( false );
							} }
						/>
					) : null }
					{ 'failed' === choices.state ? (
						<Notice tone="warning" action={ <Button size="sm" onClick={ retry }>{ __( 'Try again', 'funnelforms-pro' ) }</Button> }>
							{ choices.text } { __( 'You can check the access data under Funnelforms → Integrations.', 'funnelforms-pro' ) }
						</Notice>
					) : null }
					{ connectionRef ? (
						<fieldset className="ffxb-crm__map">
							<legend className="ffxb-crm__legend">{ __( 'What goes where', 'funnelforms-pro' ) }</legend>
							{ 'loading' === choices.state ? <Spinner label={ sprintf( __( 'Reading the choices from %s…', 'funnelforms-pro' ), spec.label ) } /> : null }
							{ spec.mapping.map( ( item ) => (
								<React.Fragment key={ item.name }>{ fieldInput( item ) }</React.Fragment>
							) ) }
							{ 0 === fields.length ? <p className="ffxb-hint">{ __( 'Add fields to a contact step to send them.', 'funnelforms-pro' ) }</p> : null }
							{ gaps.length ? (
								<Notice tone="warning">
									{ sprintf( __( 'Still to fill in: %s.', 'funnelforms-pro' ), gaps.map( ( g ) => spec.mapping.find( ( m ) => m.name === g )?.label ?? g ).join( ', ' ) ) }
								</Notice>
							) : null }
						</fieldset>
					) : null }
				</>
			) : provider ? (
				<Notice tone="warning">{ sprintf( __( 'The tool "%s" is not known.', 'funnelforms-pro' ), provider ) }</Notice>
			) : null }
			{ sheet && connectionRef ? <SpreadsheetDialog connectionRef={ connectionRef } title={ doc.title } onClose={ () => setSheet( false ) } onCreated={ ( choice ) => created( 'spreadsheet', choice ) } /> : null }
			{ common }
		</div>
	);
}

/** Asks for the title and creates a spreadsheet in the account of the connection. */
function SpreadsheetDialog( { connectionRef, title, onClose, onCreated }: { connectionRef: string; title: string; onClose: () => void; onCreated: ( choice: CrmChoice ) => void } ) {
	const { api } = useEnv();
	const [ name, setName ] = useState( title );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const create = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			onCreated( await ( api.connect as NonNullable<typeof api.connect> ).createSpreadsheet( connectionRef, name.trim() ) );
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
			setBusy( false );
		}
	};
	return (
		<Dialog
			title={ __( 'New spreadsheet', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ busy || '' === name.trim() } onClick={ () => void create() }>
						{ __( 'Create spreadsheet', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<TextInput label={ __( 'Title', 'funnelforms-pro' ) } value={ name } onChange={ setName } hint={ __( 'Created in the Google account of the connection. Each entry becomes a row; the first row holds the headings.', 'funnelforms-pro' ) } />
		</Dialog>
	);
}
