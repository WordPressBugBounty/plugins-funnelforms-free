/**
 * The notice on a form that still runs on Funnelforms 3, with the button that moves it to the new
 * renderer right there (like "Move to Funnelforms 5" under Migration → Forms). When something keeps
 * the form on Funnelforms 3, the notice says what and how to solve it, with a link to the page of
 * the form under Migration.
 */
import React, { useState } from 'react';
import type { MoveResult } from '../api';
import { useBuilder, useEnv } from './context';
import { __ } from './i18n';
import { Button, Notice } from './ui';

export function LegacyNotice( { text }: { text: string } ) {
	const { api, store, readOnly } = useEnv();
	const form = useBuilder( ( s ) => s.form );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ blocked, setBlocked ] = useState<MoveResult | null>( null );
	const [ moved, setMoved ] = useState( false );
	if ( ! form ) {
		return null;
	}
	if ( 'legacy' !== form.renderer ) {
		return moved ? <Notice tone="success">{ __( 'The form runs on Funnelforms 5 now. Your pages and shortcodes stay as they are.', 'funnelforms-pro' ) }</Notice> : null;
	}
	const move = api.moveToV5?.bind( api );
	const run = async (): Promise<void> => {
		if ( ! move ) {
			return;
		}
		setBusy( true );
		setError( null );
		setBlocked( null );
		try {
			const result = await move( form.id );
			const latest = store.getState().form;
			if ( 'v5' === result.renderer && latest ) {
				setMoved( true );
				store.setState( { form: { ...latest, renderer: 'v5' } } );
			} else {
				setBlocked( result );
			}
		} catch ( e ) {
			setError( e instanceof Error ? e.message : String( e ) );
		}
		setBusy( false );
	};
	const button = move ? (
		<Button size="sm" variant="primary" disabled={ readOnly || busy } onClick={ () => void run() }>
			{ __( 'Switch to Funnelforms 5', 'funnelforms-pro' ) }
		</Button>
	) : undefined;
	return (
		<>
			<Notice tone="warning" action={ button }>
				{ text }
			</Notice>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ blocked ? (
				<Notice tone="danger" title={ __( 'Why it stays on Funnelforms 3 for now', 'funnelforms-pro' ) }>
					<ul>
						{ blocked.reasons.map( ( r ) => (
							<li key={ r.title }>
								<strong>{ r.title }</strong>
								{ r.fix ? ' ' + r.fix : '' }
							</li>
						) ) }
					</ul>
					{ blocked.detailsUrl ? (
						<p>
							<a className="ffxb-link" href={ blocked.detailsUrl }>
								{ __( 'See the details', 'funnelforms-pro' ) }
							</a>
						</p>
					) : null }
				</Notice>
			) : null }
		</>
	);
}
