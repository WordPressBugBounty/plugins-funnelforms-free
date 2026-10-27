/**
 * "Use my website's design": the colours and fonts the site's own theme and page builder are set
 * to (theme.json, the Customizer, Elementor, Astra, Kadence, GeneratePress, OceanWP, Divi, the
 * logo), read by the plugin without a request (Application\SiteDesign). The user sees each colour
 * with where it was found, adjusts what they like, checks the contrast and applies. When the
 * reading is unsure, nothing is chosen for them; the start page can be read instead.
 */
import React, { useState } from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import type { Branding, SiteDesign } from '../api';
import type { BrandingPicks } from '../themes';
import { BrandingChoices, firstPicks, KEEP, nothingPicked, useApplyBranding } from './BrandingImport';
import { useEnv } from './context';
import { __, sprintf } from './i18n';
import { Button, Dialog, Notice, Spinner } from './ui';

const brushIcon = (
	<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M3 21v-3.5a3.5 3.5 0 1 1 3.5 3.5zM9.5 14.5 20 4M14 6l4 4" />
	</svg>
);

type State = { state: 'closed' } | { state: 'loading' } | { state: 'failed'; message: string } | { state: 'found'; found: Branding; site: SiteDesign; page: boolean };

export function SiteDesignButton( { doc }: { doc: FormDocument } ) {
	const { api, readOnly } = useEnv();
	const [ state, setState ] = useState<State>( { state: 'closed' } );
	const [ picks, setPicks ] = useState<BrandingPicks>( KEEP );
	const [ reading, setReading ] = useState( false );
	const applying = useApplyBranding();
	if ( ! api.siteDesign ) {
		return null;
	}
	const siteDesign = api.siteDesign.bind( api );

	const open = async (): Promise<void> => {
		setState( { state: 'loading' } );
		try {
			const site = await siteDesign();
			setState( { state: 'found', found: site, site, page: false } );
			setPicks( firstPicks( site ) );
		} catch ( e ) {
			setState( { state: 'failed', message: e instanceof Error ? e.message : String( e ) } );
		}
	};
	// The start page of the own site, when the theme names too little.
	const readPage = async ( site: SiteDesign ): Promise<void> => {
		setReading( true );
		try {
			const page = await api.branding( site.url, true );
			setState( { state: 'found', found: page, site, page: true } );
			setPicks( firstPicks( page ) );
		} catch ( e ) {
			setState( { state: 'failed', message: e instanceof Error ? e.message : String( e ) } );
		}
		setReading( false );
	};
	const close = (): void => setState( { state: 'closed' } );
	const found = 'found' === state.state ? state.found : null;
	const empty = found && ! found.colors.length && ! found.fonts.length;

	return (
		<>
			<button type="button" className="ffxb-site-design" disabled={ readOnly || 'loading' === state.state } onClick={ () => void open() }>
				<span className="ffxb-site-design__icon">{ brushIcon }</span>
				<span className="ffxb-site-design__text">
					<strong>{ __( 'Use my website\'s design', 'funnelforms-pro' ) }</strong>
					<span>{ __( 'Colours and font of your theme, in one click', 'funnelforms-pro' ) }</span>
				</span>
			</button>
			<Dialog
				title={ __( 'Your website\'s design', 'funnelforms-pro' ) }
				open={ 'closed' !== state.state }
				onClose={ close }
				actions={
					<>
						<Button variant="ghost" onClick={ close }>
							{ __( 'Cancel', 'funnelforms-pro' ) }
						</Button>
						<Button variant="primary" disabled={ ! found || applying.busy || !! empty || nothingPicked( picks ) } onClick={ () => found && void applying.apply( found, picks ).then( ( done ) => done && close() ) }>
							{ applying.busy ? __( 'Downloading…', 'funnelforms-pro' ) : __( 'Apply', 'funnelforms-pro' ) }
						</Button>
					</>
				}
			>
				{ 'loading' === state.state ? <Spinner label={ __( 'Reading your theme…', 'funnelforms-pro' ) } /> : null }
				{ 'failed' === state.state ? <Notice tone="danger">{ state.message }</Notice> : null }
				{ 'found' === state.state ? (
					<div className="ffxb-branding">
						<p className="ffxb-hint">
							{ state.page
								? sprintf( /* translators: %s: address of the start page */ __( 'Read from your start page, %s.', 'funnelforms-pro' ), state.found.url )
								: state.site.sources.length
								? sprintf( /* translators: %s: list of sources, e.g. Twenty Twenty-Five, Elementor */ __( 'Read from %s.', 'funnelforms-pro' ), state.site.sources.join( ', ' ) )
								: __( 'Your theme names no colours or fonts.', 'funnelforms-pro' ) }
						</p>
						{ empty ? <Notice tone="warning">{ __( 'No colours or fonts were found.', 'funnelforms-pro' ) }</Notice> : <BrandingChoices doc={ doc } found={ state.found } picks={ picks } onChange={ setPicks } /> }
						{ ! state.page && 'high' !== state.found.confidence ? (
							<div className="ffxb-site-design__more">
								<p className="ffxb-hint">{ __( 'Your site can also load its start page once and read the colours that show there.', 'funnelforms-pro' ) }</p>
								<Button size="sm" variant="secondary" disabled={ reading } onClick={ () => void readPage( state.site ) }>
									{ reading ? __( 'Loading…', 'funnelforms-pro' ) : __( 'Read my start page', 'funnelforms-pro' ) }
								</Button>
							</div>
						) : null }
						{ applying.error ? <Notice tone="danger">{ applying.error }</Notice> : null }
					</div>
				) : null }
			</Dialog>
		</>
	);
}
