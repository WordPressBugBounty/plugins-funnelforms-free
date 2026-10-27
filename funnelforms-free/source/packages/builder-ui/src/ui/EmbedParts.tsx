/**
 * Parts the panels of the embed workspace share: the code with a copy button and the steps to use it.
 */
import React, { useEffect, useState } from 'react';
import { __ } from './i18n';
import { Button, icons } from './ui';

export type EmbedMethod = 'inline' | 'link' | 'external' | 'popup' | 'widget';

/** The code of a way to embed with a copy button. */
export function CodeBox( { label, code }: { label: string; code: string } ) {
	const [ copied, setCopied ] = useState( false );
	useEffect( () => setCopied( false ), [ code ] );
	const copy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText( code );
			setCopied( true );
			setTimeout( () => setCopied( false ), 1800 );
		} catch {
			// Without the clipboard (no HTTPS) the code stays selectable by hand.
		}
	};
	return (
		<div className="ffxb-embed__code-wrap">
			<h3 className="ffxb-embed__label">{ label }</h3>
			<div className="ffxb-embed__code">
				<pre tabIndex={ 0 } aria-label={ label }>
					<code>{ code }</code>
				</pre>
				<Button size="sm" variant="primary" className="ffxb-embed__copy" icon={ copied ? icons.check : icons.copy } onClick={ () => void copy() }>
					{ copied ? __( 'Copied', 'funnelforms-pro' ) : __( 'Copy', 'funnelforms-pro' ) }
				</Button>
			</div>
		</div>
	);
}

/** Numbered steps to use the code. */
export function Steps( { steps }: { steps: React.ReactNode[] } ) {
	return (
		<div className="ffxb-embed__how">
			<h3 className="ffxb-embed__label">{ __( 'How to embed this form:', 'funnelforms-pro' ) }</h3>
			<ol className="ffxb-embed__steps">
				{ steps.map( ( step, i ) => (
					<li key={ i }>{ step }</li>
				) ) }
			</ol>
		</div>
	);
}
