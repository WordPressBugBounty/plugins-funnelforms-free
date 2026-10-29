/**
 * Entry of the admin script (plugin/assets/builder/builder.js): mounts the builder, or the
 * entries screen, into the page the plugin prints, with the REST root, nonce and texts it
 * passes along.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { setEdition, type EditionCatalog } from './edition';
import { setPrivacy } from './privacy';
import { setCode, type CodeSetting } from './code';
import { setIntegrationsUrl, setOwnerEmail } from './actions';
import { setSpam, type SpamProtection } from './spam';
import { WpRestAdapter } from './wp-rest';
import { App, type AppConfig } from './ui/App';
import { FormStatsScreen } from './ui/Stats';
import { EntriesScreen, type EntriesConfig } from './ui/Entries';
import { AppointmentsScreen } from './ui/Appointments';
import type { AppointmentsConfig } from './appointments';
import { IntegrationsScreen, type IntegrationsConfig } from './ui/Integrations';
import { PredictionScreen, type PredictionScreenConfig } from './ui/PredictionScreen';
import { FunnelformsImport, ImportScreen, type ImportConfig } from './ui/ImportScreen';

interface PageConfig extends AppConfig, EntriesConfig, ImportConfig {
	/** Which screen the page shows; the builder without it. */
	screen?: 'entries' | 'import' | 'import-funnelforms' | 'integrations' | 'form-stats' | 'prediction';
	/** The figures of one form (screen form-stats, Funnelforms Free): the form, whether it is published, the editor with its figures on the canvas. */
	formId?: number;
	published?: boolean;
	canvasUrl?: string;
	root: string;
	nonce: string;
	icons?: string;
	/** Address of the site's logo (Application\SiteLogo). */
	logo?: string | null;
	/** Free or Pro, and what is Pro (Edition::catalog()). */
	edition?: EditionCatalog;
	/** The site's privacy mode (PrivacyMode). */
	privacy?: 'eu' | 'global' | 'open';
	/** Whether the site runs the custom code of forms (TrackingCode). */
	code?: Partial<CodeSetting>;
	/** The site's spam protection (SpamCheck::protection()). */
	spam?: Partial<SpamProtection>;
	/** The site's admin address, the recipient of new mails to the owner. */
	ownerEmail?: string;
	/** Funnelforms → Integrations, for users who may connect tools; Funnelforms Pro. */
	connectUrl?: string | null;
}

function start(): void {
	const element = document.getElementById( 'funnelforms-builder' );
	const config = ( window as unknown as { funnelformsBuilder?: PageConfig } ).funnelformsBuilder;
	if ( ! element || ! config ) {
		return;
	}
	if ( 'free' === process.env.FUNNELFORMS_EDITION ) {
		setEdition( config.edition );
	}
	setPrivacy( config.privacy );
	setCode( config.code );
	setSpam( config.spam );
	setOwnerEmail( config.ownerEmail );
	setIntegrationsUrl( config.connectUrl );
	// Appointments, integrations and CRM connections are Funnelforms Pro; Free has no page for them.
	if ( 'free' !== process.env.FUNNELFORMS_EDITION && 'appointments' === ( config.screen as string ) ) {
		createRoot( element ).render( <AppointmentsScreen config={ config as unknown as AppointmentsConfig } /> );
		return;
	}
	const api = new WpRestAdapter( { root: config.root, nonce: config.nonce, icons: config.icons, logo: config.logo } );
	if ( 'free' !== process.env.FUNNELFORMS_EDITION && 'integrations' === config.screen ) {
		createRoot( element ).render(
			<div className="ffxb ffxb--embedded">
				<IntegrationsScreen api={ api } config={ config as unknown as IntegrationsConfig } />
			</div>
		);
		return;
	}
	if ( 'free' !== process.env.FUNNELFORMS_EDITION && 'prediction' === config.screen ) {
		// The page of the Predictive AI (Admin\PredictionPage), inside the frame of the admin pages.
		createRoot( element ).render(
			<div className="ffxb ffxb--embedded">
				<PredictionScreen api={ api } config={ config as unknown as PredictionScreenConfig } />
			</div>
		);
		return;
	}
	if ( 'form-stats' === config.screen && config.formId ) {
		// Inside the frame of the statistics page (StatsPage::free_form()), like the import screens.
		createRoot( element ).render(
			<div className="ffxb ffxb--embedded">
				<FormStatsScreen api={ api } formId={ config.formId } published={ true === config.published } canvasUrl={ config.canvasUrl } locale={ config.userLocale } />
			</div>
		);
		return;
	}
	if ( 'import-funnelforms' === config.screen ) {
		createRoot( element ).render(
			<div className="ffxb ffxb--embedded">
				<FunnelformsImport api={ api } config={ config } />
			</div>
		);
		return;
	}
	if ( 'import' === config.screen ) {
		// A screen inside the frame of the Funnelforms admin pages (Ui::open), which brings the page's look.
		createRoot( element ).render(
			<div className="ffxb ffxb--embedded">
				<ImportScreen api={ api.connect } config={ config } />
			</div>
		);
		return;
	}
	createRoot( element ).render(
		'entries' === config.screen ? (
			<div className="ffxb">
				<EntriesScreen api={ api } config={ config } />
			</div>
		) : (
			<App api={ api } config={ config } />
		)
	);
}

if ( 'loading' === document.readyState ) {
	document.addEventListener( 'DOMContentLoaded', start );
} else {
	start();
}
