/**
 * CRM, newsletter and spreadsheet connections: the dialog to add or change one, used by the
 * overview on Funnelforms → Integrations (IntegrationsHub) and by the CRM action in the editor, so
 * a form can be set up without leaving it, and the catalog of tools and connections.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ApiError, fixUrl } from '../api';
import type { ConnectApi, CrmConnection, CrmProvider, CrmSignIn } from '../connect';
import { __, sprintf } from './i18n';
import { Button, Dialog, Notice, Select, TextInput } from './ui';

function message( e: unknown ): string {
	return e instanceof Error ? e.message : String( e );
}

/** The providers and connections, loaded once; `reload` reads them again. */
export function useCrmCatalog( api: ConnectApi | undefined ) {
	const [ providers, setProviders ] = useState<CrmProvider[] | null>( null );
	const [ connections, setConnections ] = useState<CrmConnection[] | null>( null );
	const [ error, setError ] = useState<string | null>( null );

	const load = useCallback( async (): Promise<void> => {
		if ( ! api ) {
			return;
		}
		setError( null );
		try {
			const [ p, c ] = await Promise.all( [ api.crmProviders(), api.crmConnections() ] );
			setProviders( p );
			setConnections( c );
		} catch ( e ) {
			setError( message( e ) );
		}
	}, [ api ] );

	useEffect( () => {
		void load();
	}, [ load ] );

	return { providers, connections, setConnections, error, reload: load };
}

/** Provider names as the dropdowns show them: the tool, then what kind it is. */
export function providerOptions( providers: CrmProvider[] ): Array<{ value: string; label: string }> {
	const kind = ( p: CrmProvider ): string => ( 'newsletter' === p.category ? __( 'Newsletter', 'funnelforms-pro' ) : 'spreadsheet' === p.category ? __( 'Spreadsheet', 'funnelforms-pro' ) : __( 'CRM', 'funnelforms-pro' ) );
	return [ ...providers ].sort( ( a, b ) => a.label.localeCompare( b.label ) ).map( ( p ) => ( { value: p.provider, label: `${ p.label } (${ kind( p ) })` } ) );
}

/** Seconds a sign-in window may take before the wait ends. */
const SIGN_IN_SECONDS = 300;

/**
 * Signs in to a tool in a window (Google Sheets), as the calendar connections do: the window tells
 * the page by postMessage, and the result is asked for as well, because some sign-in pages cut the
 * window off from its opener. The window opens right on the click, before the address is known, so
 * browsers allow it; `onLink` gets the address when they did not.
 */
export async function crmSignIn( api: ConnectApi, ref: string | undefined, onLink: ( url: string ) => void ): Promise<CrmSignIn> {
	const popup = window.open( '', 'ffx-crm', 'popup,width=520,height=720' );
	let started: { url: string; state: string };
	try {
		started = await api.startCrmSignIn( ref );
	} catch ( e ) {
		popup?.close();
		throw e;
	}
	if ( popup && ! popup.closed ) {
		popup.location.href = started.url;
	} else {
		onLink( started.url );
	}
	return new Promise( ( resolve ) => {
		let over = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const done = ( result: CrmSignIn ): void => {
			if ( over ) {
				return;
			}
			over = true;
			clearTimeout( timer );
			window.removeEventListener( 'message', listen );
			popup?.close();
			resolve( result );
		};
		const listen = ( event: MessageEvent ): void => {
			const data = event.data as ( CrmSignIn & { source?: string } ) | null;
			if ( event.origin === window.location.origin && 'funnelforms-crm' === data?.source && data.state === started.state ) {
				done( data );
			}
		};
		const poll = async ( left: number ): Promise<void> => {
			if ( over ) {
				return;
			}
			if ( left <= 0 ) {
				done( { ok: false, state: started.state, code: 'timeout', message: __( 'The sign-in took too long. Please try again.', 'funnelforms-pro' ) } );
				return;
			}
			try {
				const result = await api.crmSignIn( started.state );
				if ( result ) {
					done( result );
					return;
				}
			} catch {
				// Asked again on the next turn.
			}
			timer = setTimeout( () => void poll( left - 2 ), 2000 );
		};
		window.addEventListener( 'message', listen );
		timer = setTimeout( () => void poll( SIGN_IN_SECONDS ), 2000 );
	} );
}

/** Add a connection, or change one: its name, and the access data (empty fields keep what is stored). */
export function CrmConnectionDialog( { api, providers, provider, connection, onClose, onSaved }: { api: ConnectApi; providers: CrmProvider[]; provider?: string; connection?: CrmConnection; onClose: () => void; onSaved: ( c: CrmConnection ) => void } ) {
	const editing = Boolean( connection );
	const [ chosen, setChosen ] = useState( connection?.provider ?? provider ?? '' );
	const [ label, setLabel ] = useState( connection?.label ?? '' );
	const [ values, setValues ] = useState<Record<string, string>>( {} );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ link, setLink ] = useState( '' );
	// The Account page, when the website is not (or no longer) connected with Funnelforms.
	const [ accountUrl, setAccountUrl ] = useState( '' );
	const spec = providers.find( ( p ) => p.provider === chosen );
	const given = ( name: string ): string => ( values[ name ] ?? '' ).trim();
	const complete = Boolean( spec ) && ( editing ? '' !== label.trim() : spec?.credentials.every( ( c ) => ! c.required || '' !== given( c.name ) ) ?? false );

	const save = async (): Promise<void> => {
		if ( ! spec ) {
			return;
		}
		setBusy( true );
		setError( null );
		setAccountUrl( '' );
		try {
			const credentials = Object.fromEntries( spec.credentials.map( ( c ) => [ c.name, given( c.name ) ] ).filter( ( [ , v ] ) => '' !== v ) );
			const name = label.trim() || spec.label;
			onSaved( connection ? await api.updateCrmConnection( connection.ref, { label: name, credentials } ) : await api.createCrmConnection( spec.provider, name, credentials ) );
		} catch ( e ) {
			setError( message( e ) );
			setBusy( false );
		}
	};

	const signIn = async (): Promise<void> => {
		if ( ! spec ) {
			return;
		}
		setBusy( true );
		setError( null );
		setAccountUrl( '' );
		try {
			const result = await crmSignIn( api, connection?.ref, setLink );
			if ( ! result.ok || ! result.connection ) {
				setError( result.message ?? __( 'The sign-in did not work.', 'funnelforms-pro' ) );
				setAccountUrl( fixUrl( result.url ) );
				setBusy( false );
				return;
			}
			onSaved( { createdAt: '', forms: 0, legacy: false, ...connection, ...result.connection } );
		} catch ( e ) {
			setError( message( e ) );
			setAccountUrl( e instanceof ApiError ? fixUrl( e.data.url ) : '' );
			setBusy( false );
		}
	};

	return (
		<Dialog
			title={ editing ? __( 'Change connection', 'funnelforms-pro' ) : __( 'Add connection', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					{ spec?.signIn && ! editing ? null : (
						<Button variant="primary" disabled={ busy || ! complete } onClick={ () => void save() }>
							{ editing ? __( 'Save', 'funnelforms-pro' ) : __( 'Save connection', 'funnelforms-pro' ) }
						</Button>
					) }
				</>
			}
		>
			{ error ? (
				<Notice tone="danger">
					{ error }
					{ accountUrl ? (
						<>
							{ ' ' }
							<a href={ accountUrl }>{ __( 'Connect the website', 'funnelforms-pro' ) }</a>
						</>
					) : null }
				</Notice>
			) : null }
			{ editing || provider ? null : (
				<Select
					label={ __( 'Tool', 'funnelforms-pro' ) }
					value={ chosen }
					options={ [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) }, ...providerOptions( providers ) ] }
					onChange={ ( v ) => {
						setChosen( v );
						setValues( {} );
					} }
				/>
			) }
			{ spec ? (
				<>
					{ spec.help ? <Notice tone="info">{ spec.help }</Notice> : null }
					{ spec.signIn && ! editing ? null : <TextInput label={ __( 'Name', 'funnelforms-pro' ) } value={ label } placeholder={ spec.label } onChange={ setLabel } hint={ __( 'Shown when you choose the connection.', 'funnelforms-pro' ) } /> }
					{ spec.signIn ? (
						<>
							<Button variant={ editing ? 'secondary' : 'primary' } disabled={ busy } onClick={ () => void signIn() }>
								{ editing ? __( 'Sign in again', 'funnelforms-pro' ) : sprintf( __( 'Sign in with %s', 'funnelforms-pro' ), 'Google' ) }
							</Button>
							{ busy && ! link ? <p className="ffxb-hint">{ __( 'Waiting for the sign-in window…', 'funnelforms-pro' ) }</p> : null }
							{ link ? (
								<p className="ffxb-hint">
									{ __( 'The sign-in window did not open.', 'funnelforms-pro' ) }{ ' ' }
									<a href={ link } target="_blank" rel="noopener noreferrer">
										{ __( 'Open it here', 'funnelforms-pro' ) }
									</a>
								</p>
							) : null }
						</>
					) : null }
					{ spec.credentials.map( ( c ) => (
						<TextInput
							key={ spec.provider + c.name }
							label={ editing || c.required ? c.label : sprintf( __( '%s (optional)', 'funnelforms-pro' ), c.label ) }
							type={ c.secret ? 'password' : c.input }
							value={ values[ c.name ] ?? '' }
							onChange={ ( v ) => setValues( ( x ) => ( { ...x, [ c.name ]: v } ) ) }
							hint={ editing ? __( 'Leave empty to keep what is stored.', 'funnelforms-pro' ) : undefined }
						/>
					) ) }
					{ spec.signIn ? null : <p className="ffxb-hint">{ __( 'Access data is stored encrypted and never shown again.', 'funnelforms-pro' ) }</p> }
				</>
			) : null }
		</Dialog>
	);
}

/** The name of a provider, as the action editor shows it. */
export function providerLabel( providers: CrmProvider[] | null, provider: string ): string {
	return providers?.find( ( p ) => p.provider === provider )?.label ?? provider;
}
