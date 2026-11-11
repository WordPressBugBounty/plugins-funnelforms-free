/**
 * Funnelforms → AI Phone Agent (Admin\LeadcallerPage): connect ElevenLabs with its key, bring a
 * number from Twilio, and create agents, like appointment types: what each one wants to reach,
 * how it sounds, what it asks and when it calls. Forms only link an agent (action aiCall, AiCall.tsx).
 * The page talks to Http\LeadcallerController.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AI_GOALS, AI_LANGUAGES, disclosure, goalTexts, newAgent, type AiAgent, type AiCallResult, type AiGoal, type AiQuestion, type AiVoice, type LeadcallerApi, type LeadcallerState, type TwilioAccess } from '../aicall';
import { WpRestAdapter } from '../wp-rest';
import { goalName } from './AiCall';
import { useCountries } from './PhoneProps';
import { __, sprintf } from './i18n';
import { Badge, Button, Dialog, Field, Notice, Select, Spinner, TextInput, Toggle } from './ui';

export interface LeadcallerConfig {
	root: string;
	nonce: string;
	userLocale?: string;
	/** Funnelforms → Forms, where the agent is linked. */
	formsUrl?: string;
	/** Funnelforms → Appointments, tab appointment types. */
	typesUrl?: string;
	/** Funnelforms → Integrations, where calendars are connected. */
	calendarsUrl?: string;
}

const KEYS_URL = 'https://elevenlabs.io/app/settings/api-keys';
const TWILIO_URL = 'https://console.twilio.com/';
const TWILIO_BUY_URL = 'https://console.twilio.com/us1/develop/phone-numbers/manage/search';
const MAX_QUESTIONS = 8;

function message( e: unknown ): string {
	return e instanceof Error ? e.message : String( e );
}

/** The language of the page for names of languages and days. */
function pageLocale( userLocale: string | undefined ): string | undefined {
	return userLocale ? userLocale.replace( '_', '-' ) : undefined;
}

function languageName( code: string, locale: string | undefined ): string {
	try {
		const names = new Intl.DisplayNames( locale ? [ locale ] : undefined, { type: 'language' } );
		const name = names.of( 'no' === code ? 'nb' : code ) ?? code;
		return name.charAt( 0 ).toLocaleUpperCase( locale ) + name.slice( 1 );
	} catch {
		return code;
	}
}

/** Short name of an ISO day, 1 = Monday. */
function dayName( day: number, locale: string | undefined ): string {
	return new Date( 2024, 0, day ).toLocaleDateString( locale, { weekday: 'short' } );
}

/** "Mon–Fri, 09:00–19:00": the days in runs, then the hours. */
export function windowText( window: AiAgent[ 'window' ], locale: string | undefined ): string {
	const days = [ ...window.days ].sort( ( a, b ) => a - b );
	const runs: string[] = [];
	for ( let i = 0; i < days.length; ) {
		let j = i;
		while ( j + 1 < days.length && ( days[ j + 1 ] ?? 0 ) === ( days[ j ] ?? 0 ) + 1 ) {
			j++;
		}
		const from = dayName( days[ i ] ?? 1, locale );
		runs.push( j - i >= 2 ? from + '–' + dayName( days[ j ] ?? 1, locale ) : days.slice( i, j + 1 ).map( ( d ) => dayName( d, locale ) ).join( ', ' ) );
		i = j + 1;
	}
	return ( runs.length ? runs.join( ', ' ) : __( 'Every day', 'funnelforms-pro' ) ) + ', ' + window.from + '–' + window.to;
}

/** Whether greeting and questions are still the starting texts of the goal and language. */
function untouched( agent: AiAgent ): boolean {
	const texts = goalTexts( agent.goal, agent.language );
	const asked = agent.questions.map( ( q ) => ( { label: q.label, hint: q.hint } ) );
	// An agent that books has no starting questions: the appointment type brings day, time and kind.
	return texts.greeting === agent.greeting && ( JSON.stringify( texts.questions ) === JSON.stringify( asked ) || ( 'appointment' === agent.goal && ! asked.length ) );
}

function goalHint( goal: AiGoal ): string {
	const hints: Record<AiGoal, string> = {
		qualify: __( 'Asks about need, budget and timing, so you know how promising the lead is.', 'funnelforms-pro' ),
		appointment: __( 'Offers free times from your calendar and books the appointment right in the call.', 'funnelforms-pro' ),
		confirm: __( 'Confirms the request and clears up missing details.', 'funnelforms-pro' ),
		followUp: __( 'Asks how your offer was received and what is still missing.', 'funnelforms-pro' ),
	};
	return hints[ goal ];
}

/** What keeps an agent from calling, in words. */
function missingText( code: string ): string {
	const texts: Record<string, string> = {
		no_number: __( 'Choose the number it calls from.', 'funnelforms-pro' ),
		no_remote: __( 'Not set up in ElevenLabs yet: save it again.', 'funnelforms-pro' ),
	};
	return texts[ code ] ?? code;
}

const PATHS = {
	key: [ 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z', 'M16.5 7.5h.01' ],
	call: [ 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z' ],
	agent: [ 'M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M2 14h2M20 14h2M15 13v2M9 13v2' ],
	form: [ 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M10 9H8M16 13H8M16 17H8' ],
	goal: [ 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' ],
	voice: [ 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2M12 19v3' ],
	says: [ 'M7.9 20A9 9 0 1 0 4 16.1L2 22z' ],
	asks: [ 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01' ],
	calendar: [ 'M8 2v4M16 2v4M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 15l2 2 4-4' ],
	person: [ 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' ],
	hours: [ 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2' ],
	after: [ 'M16 3h5v5', 'M8 3H3v5', 'M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3', 'm15 9 6-6' ],
	play: [ 'M6 4l14 8-14 8z' ],
	stop: [ 'M7 7h10v10H7z' ],
	check: [ 'M5 12l5 5 9-10' ],
};

/** Name of a voice without its tagline: "Marcel - Friendly German Explainer" gives Marcel and the rest. */
export function voiceTitle( name: string ): { title: string; tagline: string } {
	const [ title = '', ...rest ] = name.split( /\s+[-–—|]\s+/ );
	return { title: title.trim() || name, tagline: rest.join( ' – ' ).trim() };
}

/**
 * The voices that fit a call in a language, best first: those of the language, conversational
 * ones before others.
 */
export function voicesFor( voices: readonly AiVoice[], language: string ): AiVoice[] {
	const rank = ( v: AiVoice ): number => ( 'conversational' === v.use ? 0 : 1 );
	return voices.filter( ( v ) => v.language === language ).sort( ( a, b ) => rank( a ) - rank( b ) || a.name.localeCompare( b.name ) );
}

const VOICE_LIBRARY_URL = 'https://elevenlabs.io/app/voice-library';

function genderName( gender: string ): string {
	return ( { female: __( 'Female', 'funnelforms-pro' ), male: __( 'Male', 'funnelforms-pro' ), neutral: __( 'Neutral', 'funnelforms-pro' ) } as Record<string, string> )[ gender ] ?? '';
}

/**
 * The voice of an agent: voices of the call's language first, filters for all voices, female or
 * male and a search, each with a sample to listen to.
 */
function VoicePicker( {
	voices,
	value,
	valueName,
	language,
	languageLabel,
	onPick,
}: {
	voices: AiVoice[] | null;
	value: string;
	valueName: string;
	language: string;
	languageLabel: string;
	onPick: ( voice: AiVoice | null ) => void;
} ) {
	const uid = useId();
	const matching = useMemo( () => voicesFor( voices ?? [], language ), [ voices, language ] );
	const [ scope, setScope ] = useState<'language' | 'all'>( 'language' );
	const [ gender, setGender ] = useState<'' | 'female' | 'male'>( '' );
	const [ query, setQuery ] = useState( '' );
	const [ playing, setPlaying ] = useState( '' );
	const audio = useRef<HTMLAudioElement | null>( null );
	useEffect( () => () => audio.current?.pause(), [] );
	// Another language shows its voices first again.
	useEffect( () => setScope( 'language' ), [ language ] );

	if ( null === voices ) {
		return (
			<div className="ffxb-lc-voices is-loading">
				<Spinner label={ __( 'Loading…', 'funnelforms-pro' ) } />
			</div>
		);
	}
	const listen = ( v: AiVoice ): void => {
		audio.current?.pause();
		if ( playing === v.id ) {
			setPlaying( '' );
			return;
		}
		audio.current = new Audio( v.preview );
		audio.current.onended = () => setPlaying( '' );
		setPlaying( v.id );
		void audio.current.play().catch( () => setPlaying( '' ) );
	};
	const effective = 0 === matching.length ? 'all' : scope;
	const base = 'language' === effective ? matching : [ ...voices ].sort( ( a, b ) => a.name.localeCompare( b.name ) );
	const needle = query.trim().toLowerCase();
	const shown = base.filter( ( v ) => ( ! gender || v.gender === gender ) && ( ! needle || `${ v.name } ${ v.accent }`.toLowerCase().includes( needle ) ) );
	const current = voices.find( ( v ) => v.id === value );
	const row = ( v: AiVoice ) => {
		const { title, tagline } = voiceTitle( v.name );
		const details = [ genderName( v.gender ), tagline || ( 'standard' !== v.accent ? v.accent : '' ) ].filter( Boolean ).join( ' · ' );
		return (
			<li key={ v.id } className={ 'ffxb-lc-voice' + ( v.id === value ? ' is-active' : '' ) }>
				<label>
					<input type="radio" name={ `${ uid }-voice` } checked={ v.id === value } onChange={ () => onPick( v ) } />
					<span className="ffxb-lc-voice__text">
						<strong>{ title }</strong>
						{ details ? <span>{ details }</span> : null }
					</span>
				</label>
				{ 'conversational' === v.use ? <Badge tone="brand">{ __( 'Good for calls', 'funnelforms-pro' ) }</Badge> : null }
				{ v.preview ? (
					<Button size="sm" variant="ghost" icon={ <LineIcon name={ playing === v.id ? 'stop' : 'play' } /> } onClick={ () => listen( v ) } aria-label={ sprintf( /* translators: %s: name of a voice */ __( 'Listen to %s', 'funnelforms-pro' ), title ) }>
						{ playing === v.id ? __( 'Stop', 'funnelforms-pro' ) : __( 'Listen', 'funnelforms-pro' ) }
					</Button>
				) : null }
			</li>
		);
	};

	return (
		<div className="ffxb-lc-voices">
			<div className="ffxb-lc-voices__bar">
				<div className="ffxb-bt-chips" role="group" aria-label={ __( 'Voice', 'funnelforms-pro' ) }>
					{ matching.length > 0 ? (
						<button type="button" className="ffxb-bt-chip" aria-pressed={ 'language' === effective } onClick={ () => setScope( 'language' ) }>
							{ sprintf( /* translators: 1: language, e.g. German; 2: number of voices */ __( '%1$s (%2$d)', 'funnelforms-pro' ), languageLabel, matching.length ) }
						</button>
					) : null }
					<button type="button" className="ffxb-bt-chip" aria-pressed={ 'all' === effective } onClick={ () => setScope( 'all' ) }>
						{ sprintf( /* translators: %d: number of voices */ __( 'All voices (%d)', 'funnelforms-pro' ), voices.length ) }
					</button>
					<span className="ffxb-lc-voices__sep" aria-hidden="true" />
					{ ( [ 'female', 'male' ] as const ).map( ( g ) => (
						<button key={ g } type="button" className="ffxb-bt-chip" aria-pressed={ gender === g } onClick={ () => setGender( gender === g ? '' : g ) }>
							{ genderName( g ) }
						</button>
					) ) }
				</div>
				{ base.length > 8 ? <input type="search" className="ffxb-input ffxb-lc-voices__search" value={ query } placeholder={ __( 'Search', 'funnelforms-pro' ) } aria-label={ __( 'Search voices', 'funnelforms-pro' ) } onChange={ ( e ) => setQuery( e.target.value ) } /> : null }
			</div>
			{ 0 === matching.length ? (
				<p className="ffxb-field__hint">
					{ sprintf( /* translators: %s: language, e.g. German */ __( 'Your ElevenLabs account has no voice for %s yet. Every voice speaks every language; for a natural accent add one from the voice library of ElevenLabs, then open this window again.', 'funnelforms-pro' ), languageLabel ) }{ ' ' }
					<a href={ VOICE_LIBRARY_URL } target="_blank" rel="noreferrer">
						{ __( 'Open voice library', 'funnelforms-pro' ) }
					</a>
				</p>
			) : null }
			<ul className="ffxb-lc-voices__list">
				{ 'all' === effective && ! gender && ! needle ? (
					<li className={ 'ffxb-lc-voice' + ( '' === value ? ' is-active' : '' ) }>
						<label>
							<input type="radio" name={ `${ uid }-voice` } checked={ '' === value } onChange={ () => onPick( null ) } />
							<span className="ffxb-lc-voice__text">
								<strong>{ __( 'Standard voice', 'funnelforms-pro' ) }</strong>
								<span>{ __( 'Chosen by ElevenLabs', 'funnelforms-pro' ) }</span>
							</span>
						</label>
					</li>
				) : null }
				{ value && ! current ? (
					<li className="ffxb-lc-voice is-active">
						<label>
							<input type="radio" name={ `${ uid }-voice` } checked readOnly />
							<span className="ffxb-lc-voice__text">
								<strong>{ valueName || value }</strong>
								<span>{ __( 'Not in your ElevenLabs account any more, or not allowed for agents. Choose another voice.', 'funnelforms-pro' ) }</span>
							</span>
						</label>
					</li>
				) : null }
				{ /* The chosen voice stays in sight when the filter would hide it. */ }
				{ current && ! shown.includes( current ) ? row( current ) : null }
				{ shown.map( row ) }
				{ 0 === shown.length ? <li className="ffxb-lc-voices__none">{ __( 'No voice matches.', 'funnelforms-pro' ) }</li> : null }
			</ul>
			<p className="ffxb-field__hint">
				{ __( 'The voices of your ElevenLabs account. Voices that ElevenLabs does not allow for agents are left out.', 'funnelforms-pro' ) }{ ' ' }
				<a href={ VOICE_LIBRARY_URL } target="_blank" rel="noreferrer">
					{ __( 'More voices', 'funnelforms-pro' ) }
				</a>
			</p>
		</div>
	);
}

function LineIcon( { name }: { name: keyof typeof PATHS } ) {
	return (
		<svg className="ffxb-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
			{ PATHS[ name ].map( ( d ) => (
				<path key={ d } d={ d } />
			) ) }
		</svg>
	);
}

/** A part of the agent editor with its icon and title (the look of the appointment type editor). */
function Part( { icon, title, hint, children }: { icon: keyof typeof PATHS; title: string; hint?: string; children: React.ReactNode } ) {
	const id = useId();
	return (
		<section className="ffxb-bt__section" aria-labelledby={ id }>
			<header className="ffxb-bt__head">
				<span className="ffxb-bt__icon">
					<LineIcon name={ icon } />
				</span>
				<div>
					<h3 id={ id } className="ffxb-bt__title">
						{ title }
					</h3>
					{ hint ? <p className="ffxb-hint">{ hint }</p> : null }
				</div>
			</header>
			<div className="ffxb-bt__body">{ children }</div>
		</section>
	);
}

export function LeadcallerScreen( { config, api: given }: { config: LeadcallerConfig; api?: LeadcallerApi } ) {
	const api = useMemo( () => given ?? new WpRestAdapter( { root: config.root, nonce: config.nonce } ).leadcaller, [ given, config.root, config.nonce ] );
	const locale = pageLocale( config.userLocale );
	const [ state, setState ] = useState<LeadcallerState | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ said, say ] = useState<string>( '' );
	const [ editing, setEditing ] = useState<AiAgent | null>( null );
	const [ testing, setTesting ] = useState<AiAgent | null>( null );
	const [ addingNumber, setAddingNumber ] = useState( false );

	useEffect( () => {
		let live = true;
		api.state().then(
			( s ) => live && setState( s ),
			( e: unknown ) => live && setError( message( e ) )
		);
		return () => {
			live = false;
		};
	}, [ api ] );

	if ( ! state ) {
		return error ? (
			<div className="ffx-notice ffx-notice--danger" role="alert">
				<p>{ error }</p>
			</div>
		) : (
			<Spinner label={ __( 'Loading…', 'funnelforms-pro' ) } />
		);
	}

	const ready = state.agents.filter( ( a ) => ! a.missing?.length );
	const step = ! state.connected || state.error ? 1 : ! state.numbers.length ? 2 : ! state.agents.length ? 3 : 4;
	const fresh = (): AiAgent => {
		const agent = newAgent( ( config.userLocale ?? 'de' ).slice( 0, 2 ), state.site );
		const only = state.numbers[ 0 ];
		if ( 1 === state.numbers.length && only ) {
			agent.number = only.id;
			agent.numberLabel = only.label || only.number;
			agent.numberProvider = 'sip_trunk' === only.provider ? 'sip_trunk' : 'twilio';
		}
		return agent;
	};

	return (
		<div className="ffx-lc">
			<p className="ffx-lc__said" role="status" aria-live="polite">
				{ said }
			</p>

			<section className="ffx-card ffx-lc-setup" aria-labelledby="ffx-lc-setup-title">
				<div className="ffx-card__head">
					<div>
						<h2 id="ffx-lc-setup-title">{ __( 'Set up in four steps', 'funnelforms-pro' ) }</h2>
						<p>{ __( 'You do this once. After that every form can use your agents.', 'funnelforms-pro' ) }</p>
					</div>
					{ 4 === step && ready.length ? <Badge tone="success">{ __( 'Ready for calls', 'funnelforms-pro' ) }</Badge> : null }
				</div>
				<ol className="ffx-lc-steps">
					<Step n={ 1 } done={ state.connected && ! state.error } current={ 1 === step } icon="key" title={ __( 'Connect ElevenLabs', 'funnelforms-pro' ) }>
						<ConnectStep api={ api } state={ state } onState={ setState } say={ say } />
					</Step>
					<Step n={ 2 } done={ state.numbers.length > 0 } current={ 2 === step } icon="call" title={ __( 'Add the phone number the agent calls from', 'funnelforms-pro' ) }>
						{ state.numbers.length ? (
							<ul className="ffx-lc-numbers">
								{ state.numbers.map( ( n ) => (
									<li key={ n.id }>
										<strong>{ n.number }</strong>
										{ n.label && n.label !== n.number ? <span className="ffx-muted">{ n.label }</span> : null }
										<Badge tone="success">{ 'sip_trunk' === n.provider ? 'SIP' : 'Twilio' }</Badge>
									</li>
								) ) }
							</ul>
						) : (
							<p className="ffx-muted">{ __( 'The agent needs its own number to call your leads. Buy one at Twilio (with “Voice”); Funnelforms connects it to ElevenLabs for you.', 'funnelforms-pro' ) }</p>
						) }
						<div className="ffx-lc-step__actions">
							<Button variant={ 2 === step ? 'primary' : 'secondary' } size="sm" disabled={ ! state.connected } onClick={ () => setAddingNumber( true ) }>
								{ state.numbers.length ? __( 'Add another number', 'funnelforms-pro' ) : __( 'Add number from Twilio', 'funnelforms-pro' ) }
							</Button>
						</div>
					</Step>
					<Step n={ 3 } done={ state.agents.length > 0 } current={ 3 === step } icon="agent" title={ __( 'Create an agent', 'funnelforms-pro' ) }>
						<p className="ffx-muted">{ __( 'Choose what the agent should reach, how it sounds and what it asks. Then call yourself to try it.', 'funnelforms-pro' ) }</p>
						<div className="ffx-lc-step__actions">
							<Button variant={ 3 === step ? 'primary' : 'secondary' } size="sm" disabled={ ! state.connected } onClick={ () => setEditing( fresh() ) }>
								{ __( 'Create agent', 'funnelforms-pro' ) }
							</Button>
						</div>
					</Step>
					<Step n={ 4 } done={ false } current={ 4 === step } icon="form" title={ __( 'Link it in a form', 'funnelforms-pro' ) }>
						<p className="ffx-muted">{ __( 'In the form builder select the contact step, open “After sending” and add “AI Phone Agent”. Choose the agent; the form needs a phone field and a consent box, which one click adds.', 'funnelforms-pro' ) }</p>
						{ config.formsUrl ? (
							<div className="ffx-lc-step__actions">
								<a className={ 'ffxb-button ffxb-button--sm ' + ( 4 === step ? 'ffxb-button--primary' : 'ffxb-button--secondary' ) } href={ config.formsUrl }>
									{ __( 'Open forms', 'funnelforms-pro' ) }
								</a>
							</div>
						) : null }
					</Step>
				</ol>
			</section>

			<section className="ffx-card ffx-lc-agents" aria-labelledby="ffx-lc-agents-title">
				<div className="ffx-card__head">
					<div>
						<h2 id="ffx-lc-agents-title">{ __( 'Agents', 'funnelforms-pro' ) }</h2>
						<p>{ __( 'Each agent calls new leads of the forms it is linked to, within its call hours.', 'funnelforms-pro' ) }</p>
					</div>
					{ state.agents.length ? (
						<Button variant="primary" disabled={ ! state.connected } onClick={ () => setEditing( fresh() ) }>
							{ __( 'New agent', 'funnelforms-pro' ) }
						</Button>
					) : null }
				</div>
				{ state.agents.length ? (
					<ul className="ffx-appt-types__list ffx-lc-list">
						{ state.agents.map( ( a ) => (
							<li key={ a.id }>
								<div className="ffx-appt-types__main">
									<span className="ffx-appt-types__title">{ a.name }</span>
									<span className="ffx-appt-types__hours">{ windowText( a.window, locale ) }</span>
									<span className="ffx-appt-types__facts">
										{ [ goalName( a.goal ), languageName( a.language, locale ), ( a.voiceName ? voiceTitle( a.voiceName ).title : __( 'Standard voice', 'funnelforms-pro' ) ), a.numberLabel ].filter( Boolean ).join( ' · ' ) }
									</span>
									{ a.missing?.length ? <span className="ffx-lc-list__missing">{ a.missing.map( missingText ).join( ' ' ) }</span> : null }
								</div>
								{ a.missing?.length ? <Badge tone="warning">{ __( 'Not ready', 'funnelforms-pro' ) }</Badge> : <Badge tone="success">{ __( 'Ready', 'funnelforms-pro' ) }</Badge> }
								<Button size="sm" disabled={ !! a.missing?.includes( 'no_number' ) } onClick={ () => setTesting( a ) }>
									{ __( 'Test call', 'funnelforms-pro' ) }
								</Button>
								<Button size="sm" aria-label={ sprintf( /* translators: %s: name of the agent */ __( 'Edit %s', 'funnelforms-pro' ), a.name ) } onClick={ () => setEditing( a ) }>
									{ __( 'Edit', 'funnelforms-pro' ) }
								</Button>
							</li>
						) ) }
					</ul>
				) : (
					<div className="ffx-empty">
						<h2>{ __( 'No agents yet', 'funnelforms-pro' ) }</h2>
						<p>{ state.connected ? __( 'Create your first agent: it takes about two minutes.', 'funnelforms-pro' ) : __( 'Connect ElevenLabs first, then create your first agent.', 'funnelforms-pro' ) }</p>
					</div>
				) }
			</section>

			<section className="ffx-card ffx-lc-how" aria-labelledby="ffx-lc-how-title">
				<h2 id="ffx-lc-how-title">{ __( 'What happens with a new lead', 'funnelforms-pro' ) }</h2>
				<ol className="ffx-lc-how__list">
					<li>{ __( 'The lead sends the form and checks the consent box.', 'funnelforms-pro' ) }</li>
					<li>{ __( 'A few minutes later, within the call hours, the agent calls. It says first that it is an AI assistant.', 'funnelforms-pro' ) }</li>
					<li>{ __( 'It asks your questions, one at a time, and leaves out what the form already answers.', 'funnelforms-pro' ) }</li>
					<li>{ __( 'After the call the entry gets a note with the result and a summary, and each answer as its own detail. If nobody answers, the agent tries again later.', 'funnelforms-pro' ) }</li>
				</ol>
				<p className="ffx-muted">{ sprintf( /* translators: %s: name of the service, ElevenLabs */ __( 'Calls, voice and transcript are processed by %s for you. Mention it in your privacy policy and conclude its data processing agreement.', 'funnelforms-pro' ), 'ElevenLabs' ) }</p>
			</section>

			{ editing ? (
				<div className="ffxb ffxb--embedded">
					<AgentEditor
						api={ api }
						state={ state }
						agent={ editing }
						locale={ locale }
						links={ { types: config.typesUrl, calendars: config.calendarsUrl } }
						onAddNumber={ () => setAddingNumber( true ) }
						onClose={ () => setEditing( null ) }
						onSaved={ ( saved, created ) => {
							setState( ( s ) => s && { ...s, agents: s.agents.some( ( a ) => a.id === saved.id ) ? s.agents.map( ( a ) => ( a.id === saved.id ? saved : a ) ) : [ ...s.agents, saved ] } );
							setEditing( null );
							say( sprintf( /* translators: %s: name of the agent */ __( '%s was saved.', 'funnelforms-pro' ), saved.name ) );
							if ( created && ! saved.missing?.length ) {
								setTesting( saved );
							}
						} }
						onDeleted={ ( gone ) => {
							setState( ( s ) => s && { ...s, agents: s.agents.filter( ( a ) => a.id !== gone.id ) } );
							setEditing( null );
							say( sprintf( /* translators: %s: name of the agent */ __( '%s was deleted.', 'funnelforms-pro' ), gone.name ) );
						} }
					/>
				</div>
			) : null }
			{ addingNumber ? (
				<div className="ffxb ffxb--embedded">
					<NumberDialog
						api={ api }
						state={ state }
						onClose={ () => setAddingNumber( false ) }
						onAdded={ ( next, number ) => {
							setState( next );
							setAddingNumber( false );
							say( sprintf( /* translators: %s: phone number */ __( '%s is connected.', 'funnelforms-pro' ), number ) );
						} }
					/>
				</div>
			) : null }
			{ testing ? (
				<div className="ffxb ffxb--embedded">
					<TestCallDialog api={ api } agent={ testing } onClose={ () => setTesting( null ) } />
				</div>
			) : null }
		</div>
	);
}

function Step( { n, done, current, icon, title, children }: { n: number; done: boolean; current: boolean; icon: keyof typeof PATHS; title: string; children: React.ReactNode } ) {
	return (
		<li className={ 'ffx-lc-step' + ( done ? ' is-done' : '' ) + ( current ? ' is-current' : '' ) }>
			<span className="ffx-lc-step__mark" aria-hidden="true">
				{ done ? <LineIcon name="check" /> : <LineIcon name={ icon } /> }
			</span>
			<div className="ffx-lc-step__body">
				<h3>
					<span className="screen-reader-text">{ sprintf( /* translators: %d: number of the step */ __( 'Step %d:', 'funnelforms-pro' ), n ) } </span>
					{ title }
					{ done ? <span className="screen-reader-text"> { __( '(done)', 'funnelforms-pro' ) }</span> : null }
				</h3>
				{ children }
			</div>
		</li>
	);
}

function ConnectStep( { api, state, onState, say }: { api: LeadcallerApi; state: LeadcallerState; onState: ( s: LeadcallerState ) => void; say: ( text: string ) => void } ) {
	const [ key, setKey ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ changing, setChanging ] = useState( false );

	const connect = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const next = await api.connect( key.trim() );
			onState( next );
			setKey( '' );
			setChanging( false );
			say( __( 'ElevenLabs is connected.', 'funnelforms-pro' ) );
		} catch ( e ) {
			setError( message( e ) );
		} finally {
			setBusy( false );
		}
	};
	const disconnect = async (): Promise<void> => {
		setBusy( true );
		try {
			onState( await api.disconnect() );
			say( __( 'ElevenLabs was disconnected.', 'funnelforms-pro' ) );
		} catch ( e ) {
			setError( message( e ) );
		} finally {
			setBusy( false );
		}
	};

	if ( state.connected && ! changing ) {
		return (
			<>
				{ state.error ? <Notice tone="danger">{ state.error }</Notice> : <p className="ffx-muted">{ __( 'Connected. Funnelforms sets up your agents in your ElevenLabs account; you do not have to do anything there.', 'funnelforms-pro' ) }</p> }
				{ error ? <Notice tone="danger">{ error }</Notice> : null }
				<div className="ffx-lc-step__actions">
					<Button size="sm" onClick={ () => setChanging( true ) }>
						{ __( 'Change key', 'funnelforms-pro' ) }
					</Button>
					<Button size="sm" variant="ghost" disabled={ busy } onClick={ () => void disconnect() }>
						{ __( 'Disconnect', 'funnelforms-pro' ) }
					</Button>
				</div>
			</>
		);
	}
	return (
		<>
			<p className="ffx-muted">{ __( 'ElevenLabs gives the agent its voice and makes the calls. You only need an API key:', 'funnelforms-pro' ) }</p>
			<ol className="ffx-lc-howto">
				<li>
					{ __( 'Sign in to ElevenLabs and open Developers → API keys.', 'funnelforms-pro' ) }{ ' ' }
					<a className="ffx-link" href={ KEYS_URL } target="_blank" rel="noreferrer">
						{ __( 'Open API keys', 'funnelforms-pro' ) }
					</a>
				</li>
				<li>{ __( 'Click “Create key”. Allow “ElevenLabs Agents” (write) and “Voices” (read), or leave all access on.', 'funnelforms-pro' ) }</li>
				<li>{ __( 'Copy the key and paste it here.', 'funnelforms-pro' ) }</li>
			</ol>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			<div className="ffx-lc-connect">
				<TextInput label={ __( 'ElevenLabs API key', 'funnelforms-pro' ) } type="password" value={ key } onChange={ setKey } />
				<Button variant="primary" disabled={ busy || key.trim().length < 10 } onClick={ () => void connect() }>
					{ busy ? __( 'Checking…', 'funnelforms-pro' ) : __( 'Connect', 'funnelforms-pro' ) }
				</Button>
				{ changing ? (
					<Button variant="ghost" onClick={ () => setChanging( false ) }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
				) : null }
			</div>
		</>
	);
}

function NumberDialog( { api, state, onClose, onAdded }: { api: LeadcallerApi; state: LeadcallerState; onClose: () => void; onAdded: ( state: LeadcallerState, number: string ) => void } ) {
	const saved = state.twilio[ 0 ];
	const [ ref, setRef ] = useState( saved?.ref ?? '' );
	const [ sid, setSid ] = useState( '' );
	const [ token, setToken ] = useState( '' );
	const [ found, setFound ] = useState<Array<{ number: string; name: string }> | null>( null );
	const [ chosen, setChosen ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const name = useId();
	const have = new Set( state.numbers.map( ( n ) => n.number ) );
	const access: TwilioAccess = ref ? { connectionRef: ref } : { accountSid: sid.trim(), authToken: token.trim() };
	const complete = ref ? true : /^AC[0-9a-fA-F]{32}$/.test( sid.trim() ) && token.trim().length >= 16;

	const load = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			const list = await api.twilioNumbers( access );
			setFound( list );
			setChosen( list.find( ( n ) => ! have.has( n.number ) )?.number ?? '' );
		} catch ( e ) {
			setError( message( e ) );
		} finally {
			setBusy( false );
		}
	};
	const add = async (): Promise<void> => {
		setBusy( true );
		setError( null );
		try {
			onAdded( await api.importNumber( access, chosen ), chosen );
		} catch ( e ) {
			setError( message( e ) );
			setBusy( false );
		}
	};

	return (
		<Dialog
			title={ __( 'Add number from Twilio', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					{ found ? (
						<Button variant="primary" disabled={ busy || ! chosen } onClick={ () => void add() }>
							{ busy ? __( 'Connecting…', 'funnelforms-pro' ) : __( 'Use this number', 'funnelforms-pro' ) }
						</Button>
					) : (
						<Button variant="primary" disabled={ busy || ! complete } onClick={ () => void load() }>
							{ busy ? __( 'Loading…', 'funnelforms-pro' ) : __( 'Show my numbers', 'funnelforms-pro' ) }
						</Button>
					) }
				</>
			}
		>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ found ? (
				found.length ? (
					<fieldset className="ffxb-lc-pick">
						<legend className="ffxb-field__label">{ __( 'Which number should the agent call from?', 'funnelforms-pro' ) }</legend>
						{ found.map( ( n ) => (
							<label key={ n.number } className={ 'ffxb-lc-pick__item' + ( chosen === n.number ? ' is-active' : '' ) }>
								<input type="radio" name={ name } value={ n.number } checked={ chosen === n.number } disabled={ have.has( n.number ) } onChange={ () => setChosen( n.number ) } />
								<strong>{ n.number }</strong>
								<span className="ffxb-hint">{ have.has( n.number ) ? __( 'Already connected', 'funnelforms-pro' ) : n.name }</span>
							</label>
						) ) }
					</fieldset>
				) : (
					<Notice tone="warning" title={ __( 'This Twilio account has no number yet', 'funnelforms-pro' ) }>
						{ __( 'In Twilio open Phone Numbers → Buy a number and choose one with “Voice”. Then load your numbers again.', 'funnelforms-pro' ) }{ ' ' }
						<a className="ffxb-link" href={ TWILIO_BUY_URL } target="_blank" rel="noreferrer">
							{ __( 'Buy a number', 'funnelforms-pro' ) }
						</a>
					</Notice>
				)
			) : (
				<>
					<p className="ffxb-hint">{ __( 'ElevenLabs does not sell numbers, Twilio does. Once Funnelforms knows your Twilio access, it connects the number to ElevenLabs for you.', 'funnelforms-pro' ) }</p>
					<ol className="ffxb-lc-howto">
						<li>
							{ __( 'Create a Twilio account and buy a number with “Voice” (Phone Numbers → Buy a number). For numbers from Germany Twilio asks for your address and company details first.', 'funnelforms-pro' ) }{ ' ' }
							<a className="ffxb-link" href={ TWILIO_BUY_URL } target="_blank" rel="noreferrer">
								{ __( 'Buy a number', 'funnelforms-pro' ) }
							</a>
						</li>
						<li>
							{ __( 'Copy the Account SID and the Auth Token from the start page of the Twilio console (Account Info).', 'funnelforms-pro' ) }{ ' ' }
							<a className="ffxb-link" href={ TWILIO_URL } target="_blank" rel="noreferrer">
								{ __( 'Open Twilio console', 'funnelforms-pro' ) }
							</a>
						</li>
					</ol>
					{ state.twilio.length ? (
						<Select
							label={ __( 'Twilio account', 'funnelforms-pro' ) }
							value={ ref }
							options={ [ ...state.twilio.map( ( t ) => ( { value: t.ref, label: t.label } ) ), { value: '', label: __( 'Another account: enter its access', 'funnelforms-pro' ) } ] }
							onChange={ setRef }
						/>
					) : null }
					{ ref ? null : (
						<>
							<TextInput label={ __( 'Account SID', 'funnelforms-pro' ) } value={ sid } placeholder="AC…" onChange={ setSid } />
							<TextInput label={ __( 'Auth Token', 'funnelforms-pro' ) } type="password" value={ token } onChange={ setToken } />
						</>
					) }
				</>
			) }
		</Dialog>
	);
}

/** Choices of a select, with the current value even when it is not among them. */
function choices( values: number[], current: number, label: ( n: number ) => string ): Array<{ value: string; label: string }> {
	return [ ...new Set( [ ...values, current ] ) ].sort( ( a, b ) => a - b ).map( ( n ) => ( { value: String( n ), label: label( n ) } ) );
}

function minutesText( n: number ): string {
	if ( 0 === n ) {
		return __( 'Right away', 'funnelforms-pro' );
	}
	if ( n >= 60 && 0 === n % 60 ) {
		return 1 === n / 60 ? __( 'After 1 hour', 'funnelforms-pro' ) : sprintf( /* translators: %d: number of hours */ __( 'After %d hours', 'funnelforms-pro' ), n / 60 );
	}
	return 1 === n ? __( 'After 1 minute', 'funnelforms-pro' ) : sprintf( /* translators: %d: number of minutes */ __( 'After %d minutes', 'funnelforms-pro' ), n );
}

function AgentEditor( {
	api,
	state,
	agent: start,
	locale,
	links = {},
	onAddNumber,
	onClose,
	onSaved,
	onDeleted,
}: {
	api: LeadcallerApi;
	state: LeadcallerState;
	agent: AiAgent;
	locale: string | undefined;
	/** Where appointment types are made and calendars connected. */
	links?: { types?: string | undefined; calendars?: string | undefined };
	onAddNumber: () => void;
	onClose: () => void;
	onSaved: ( agent: AiAgent, created: boolean ) => void;
	onDeleted: ( agent: AiAgent ) => void;
} ) {
	const [ agent, setAgent ] = useState<AiAgent>( start );
	const [ voices, setVoices ] = useState<AiVoice[] | null>( null );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ tried, setTried ] = useState( false );
	const [ deleting, setDeleting ] = useState( false );
	const [ more, setMore ] = useState( false );
	const uid = useId();
	const isNew = ! start.id;
	// A new agent gets a voice of its language, until one is chosen by hand.
	const autoVoice = useRef( isNew && '' === start.voice );

	useEffect( () => {
		let live = true;
		api.voices().then(
			( list ) => live && setVoices( list ),
			() => live && setVoices( [] )
		);
		return () => {
			live = false;
		};
	}, [ api ] );

	useEffect( () => {
		if ( ! autoVoice.current || ! voices ) {
			return;
		}
		const best = voicesFor( voices, agent.language )[ 0 ];
		setAgent( ( a ) => ( { ...a, voice: best?.id ?? '', voiceName: best?.name ?? '' } ) );
	}, [ voices, agent.language ] );

	// Numbers added while the editor is open (the number dialog) can be chosen right away.
	useEffect( () => {
		const only = state.numbers[ 0 ];
		if ( ! agent.number && 1 === state.numbers.length && only ) {
			setAgent( ( a ) => ( { ...a, number: only.id, numberLabel: only.label || only.number, numberProvider: 'sip_trunk' === only.provider ? 'sip_trunk' : 'twilio' } ) );
		}
		// Only when the numbers change.
	}, [ state.numbers ] );

	const set = ( changes: Partial<AiAgent> ): void => setAgent( ( a ) => ( { ...a, ...changes } ) );
	const types = state.types ?? [];
	/**
	 * A new goal or language brings its texts, unless the texts were changed. An agent that makes
	 * appointments books into the first appointment type; the type brings day, time and kind, so
	 * the starting questions about them go.
	 */
	const retext = ( changes: Pick<AiAgent, 'goal' | 'language'> ): void =>
		setAgent( ( a ) => {
			const next = { ...a, ...changes };
			if ( 'appointment' === next.goal && ! next.bookingType && types[ 0 ] && ( isNew || 'appointment' !== a.goal ) ) {
				next.bookingType = types[ 0 ].ref;
			}
			if ( ! untouched( a ) ) {
				return next;
			}
			const texts = goalTexts( next.goal, next.language );
			return { ...next, greeting: texts.greeting, questions: 'appointment' === next.goal && next.bookingType ? [] : texts.questions };
		} );
	const type = types.find( ( t ) => t.ref === agent.bookingType );
	const books = 'appointment' === agent.goal && '' !== agent.bookingType;
	const setQuestion = ( i: number, changes: Partial<AiQuestion> ): void => setAgent( ( a ) => ( { ...a, questions: a.questions.map( ( q, j ) => ( i === j ? { ...q, ...changes } : q ) ) } ) );
	const company = agent.company.trim() || state.site;
	const nameMissing = '' === agent.name.trim();

	const save = async (): Promise<void> => {
		setTried( true );
		if ( nameMissing ) {
			return;
		}
		setBusy( true );
		setError( null );
		try {
			const body = { ...agent, questions: agent.questions.filter( ( q ) => q.label.trim() ) };
			onSaved( await api.saveAgent( body ), isNew );
		} catch ( e ) {
			setError( message( e ) );
			setBusy( false );
		}
	};
	const remove = async (): Promise<void> => {
		setBusy( true );
		try {
			await api.deleteAgent( agent.id );
			onDeleted( agent );
		} catch ( e ) {
			setError( message( e ) );
			setBusy( false );
		}
	};
	const countries = useCountries();
	const siteCountry = countries.find( ( c ) => c.iso === state.country )?.name ?? '';
	const toggleDay = ( day: number ): void => set( { window: { ...agent.window, days: agent.window.days.includes( day ) ? agent.window.days.filter( ( d ) => d !== day ) : [ ...agent.window.days, day ].sort( ( a, b ) => a - b ) } } );

	return (
		<Dialog
			title={ isNew ? __( 'New agent', 'funnelforms-pro' ) : __( 'Edit agent', 'funnelforms-pro' ) }
			open
			wide
			onClose={ onClose }
			actions={
				<>
					{ isNew ? null : deleting ? (
						<span className="ffxb-lc-confirm">
							<span>{ __( 'Forms that use it stop calling.', 'funnelforms-pro' ) }</span>
							<Button variant="danger" disabled={ busy } onClick={ () => void remove() }>
								{ __( 'Delete agent', 'funnelforms-pro' ) }
							</Button>
						</span>
					) : (
						<Button variant="ghost" className="ffxb-bt__delete" onClick={ () => setDeleting( true ) }>
							{ __( 'Delete', 'funnelforms-pro' ) }
						</Button>
					) }
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button variant="primary" disabled={ busy } onClick={ () => void save() }>
						{ busy ? __( 'Saving…', 'funnelforms-pro' ) : isNew ? __( 'Create agent', 'funnelforms-pro' ) : __( 'Save', 'funnelforms-pro' ) }
					</Button>
				</>
			}
		>
			<div className="ffxb-bt ffxb-lc">
				<div className="ffxb-bt__main">
					{ error ? <Notice tone="danger">{ error }</Notice> : null }

					<Part icon="goal" title={ __( 'Name and goal', 'funnelforms-pro' ) }>
						<div className={ tried && nameMissing ? 'ffxb-bt__invalid' : undefined }>
							<Field label={ __( 'Name', 'funnelforms-pro' ) } hint={ __( 'Only for you, to find it in forms, e.g. “Call back solar requests”.', 'funnelforms-pro' ) }>
								{ ( id ) => <input id={ id } className="ffxb-input" value={ agent.name } maxLength={ 80 } aria-invalid={ tried && nameMissing } onChange={ ( e ) => set( { name: e.target.value } ) } /> }
							</Field>
							{ tried && nameMissing ? <p className="ffxb-field__error">{ __( 'Please enter a name.', 'funnelforms-pro' ) }</p> : null }
						</div>
						<fieldset className="ffxb-bt-kinds ffxb-lc-goals">
							<legend className="ffxb-field__label">{ __( 'What should the call reach?', 'funnelforms-pro' ) }</legend>
							{ AI_GOALS.map( ( g ) => (
								<label key={ g } className={ 'ffxb-bt-kind' + ( g === agent.goal ? ' is-active' : '' ) }>
									<input type="radio" name={ `${ uid }-goal` } value={ g } checked={ g === agent.goal } onChange={ () => retext( { goal: g, language: agent.language } ) } />
									<strong>{ goalName( g ) }</strong>
									<span className="ffxb-bt-kind__hint">{ goalHint( g ) }</span>
								</label>
							) ) }
						</fieldset>
					</Part>

					{ 'appointment' === agent.goal ? (
						<Part icon="calendar" title={ __( 'Appointments', 'funnelforms-pro' ) } hint={ __( 'The agent offers free times of an appointment type and books the time the lead agrees to, right in the call. Hours, team and connected calendars of the type count, as for a booking in a form. The lead gets the usual confirmation.', 'funnelforms-pro' ) }>
							{ types.length ? (
								<>
									<Select
										label={ __( 'Books into the appointment type', 'funnelforms-pro' ) }
										value={ agent.bookingType }
										options={ [
											...types.map( ( t ) => ( { value: t.ref, label: `${ t.title } · ${ t.durations.map( ( d ) => sprintf( /* translators: %d: minutes */ __( '%d min', 'funnelforms-pro' ), d ) ).join( ', ' ) }` } ) ),
											...( agent.bookingType && ! type ? [ { value: agent.bookingType, label: __( 'Deleted appointment type', 'funnelforms-pro' ) } ] : [] ),
											{ value: '', label: __( 'Book nothing, only note a preferred time', 'funnelforms-pro' ) },
										] }
										onChange={ ( v ) => set( { bookingType: v } ) }
									/>
									{ links.types ? (
										<p className="ffxb-hint">
											<a className="ffxb-link" href={ links.types } target="_blank" rel="noreferrer">
												{ __( 'Edit appointment types', 'funnelforms-pro' ) }
											</a>
										</p>
									) : null }
									{ type && ! type.conflicts && ! type.write ? (
										<Notice
											tone="info"
											title={ __( 'No calendar connected to this type', 'funnelforms-pro' ) }
											action={
												links.calendars ? (
													<a className="ffxb-btn ffxb-btn--sm" href={ state.calendars ? links.types ?? links.calendars : links.calendars } target="_blank" rel="noreferrer">
														{ state.calendars ? __( 'Choose calendars in the type', 'funnelforms-pro' ) : __( 'Connect a calendar', 'funnelforms-pro' ) }
													</a>
												) : undefined
											}
										>
											{ __( 'Only appointments booked in Funnelforms count as busy. Connect Google, Microsoft or a CalDAV calendar and choose it in the appointment type, so that the agent never offers a time you are busy.', 'funnelforms-pro' ) }
										</Notice>
									) : null }
									{ books && false === state.reachable ? (
										<Notice tone="info">{ __( 'ElevenLabs cannot reach this website from the internet (for example a local test site). The agent offers the free times of the type, and the plugin books the time agreed right after the call.', 'funnelforms-pro' ) }</Notice>
									) : null }
								</>
							) : (
								<Notice
									tone="warning"
									title={ __( 'No appointment type yet', 'funnelforms-pro' ) }
									action={
										links.types ? (
											<a className="ffxb-btn ffxb-btn--primary ffxb-btn--sm" href={ links.types } target="_blank" rel="noreferrer">
												{ __( 'Create an appointment type', 'funnelforms-pro' ) }
											</a>
										) : undefined
									}
								>
									{ __( 'Under Funnelforms → Appointments you say when you have time, how long an appointment takes and which calendars count. Until then the agent only notes a preferred time. Reload this page afterwards.', 'funnelforms-pro' ) }
								</Notice>
							) }
						</Part>
					) : null }

					<Part icon="voice" title={ __( 'Language and voice', 'funnelforms-pro' ) }>
						<Select label={ __( 'Language of the call', 'funnelforms-pro' ) } value={ agent.language } options={ AI_LANGUAGES.map( ( l ) => ( { value: l, label: languageName( l, locale ) } ) ) } onChange={ ( v ) => retext( { goal: agent.goal, language: v } ) } />
						<fieldset className="ffxb-lc-pick">
							<legend className="ffxb-field__label">{ __( 'Voice', 'funnelforms-pro' ) }</legend>
							<VoicePicker
								voices={ voices }
								value={ agent.voice }
								valueName={ agent.voiceName }
								language={ agent.language }
								languageLabel={ languageName( agent.language, locale ) }
								onPick={ ( v ) => {
									autoVoice.current = false;
									set( { voice: v?.id ?? '', voiceName: v?.name ?? '' } );
								} }
							/>
						</fieldset>
					</Part>

					<Part icon="says" title={ __( 'How the agent introduces itself', 'funnelforms-pro' ) }>
						<TextInput label={ __( 'Company name', 'funnelforms-pro' ) } value={ agent.company } placeholder={ state.site } onChange={ ( v ) => set( { company: v } ) } hint={ __( 'The agent says it calls on behalf of this company.', 'funnelforms-pro' ) } />
						<TextInput
							label={ __( 'Greeting', 'funnelforms-pro' ) }
							multiline
							value={ agent.greeting }
							onChange={ ( v ) => set( { greeting: v } ) }
							hint={ sprintf( /* translators: %s: the first sentence of each call, e.g. "Hello, this is the AI assistant of Example Ltd." */ __( 'Comes right after the sentence the law asks for: “%s”', 'funnelforms-pro' ), disclosure( agent.language, company ) ) }
						/>
					</Part>

					<Part icon="form" title={ __( 'Prompt notes', 'funnelforms-pro' ) } hint={ __( 'Rules and basics the agent keeps to in every call: tone, how it addresses people, what it may say about you and what it must never do.', 'funnelforms-pro' ) }>
						<TextInput
							label={ __( 'Notes for the agent', 'funnelforms-pro' ) }
							multiline
							value={ agent.about }
							placeholder={ __( 'For example: We are a family business for heat pumps near Hamburg. Address people formally, stay friendly and calm, and keep it short. Never name prices; offer a callback by our team instead.', 'funnelforms-pro' ) }
							onChange={ ( v ) => set( { about: v } ) }
							hint={ __( 'In your words, as you would brief a new colleague. The agent follows these notes in every call; the rules of the law and of Funnelforms always come first.', 'funnelforms-pro' ) }
						/>
					</Part>

					<Part icon="asks" title={ __( 'What the agent asks', 'funnelforms-pro' ) } hint={ __( 'Each answer is written to the entry as its own detail. The agent asks one thing at a time and leaves out what the form already answers.', 'funnelforms-pro' ) }>
						<ol className="ffxb-lc-questions">
							{ agent.questions.map( ( q, i ) => (
								<li key={ q.key ?? i }>
									<TextInput label={ sprintf( /* translators: %d: number of the question */ __( 'Question %d', 'funnelforms-pro' ), i + 1 ) } value={ q.label } onChange={ ( v ) => setQuestion( i, { label: v } ) } hint={ __( 'Short, as it should appear in the entry, e.g. “Budget”.', 'funnelforms-pro' ) } />
									<TextInput label={ __( 'What exactly to find out', 'funnelforms-pro' ) } value={ q.hint } onChange={ ( v ) => setQuestion( i, { hint: v } ) } />
									<Button size="sm" variant="ghost" aria-label={ sprintf( /* translators: %d: number of the question */ __( 'Remove question %d', 'funnelforms-pro' ), i + 1 ) } onClick={ () => set( { questions: agent.questions.filter( ( _, j ) => j !== i ) } ) }>
										{ __( 'Remove', 'funnelforms-pro' ) }
									</Button>
								</li>
							) ) }
						</ol>
						{ agent.questions.length < MAX_QUESTIONS ? (
							<Button size="sm" onClick={ () => set( { questions: [ ...agent.questions, { label: '', hint: '' } ] } ) }>
								{ __( 'Add question', 'funnelforms-pro' ) }
							</Button>
						) : null }
					</Part>

					<Part icon="hours" title={ __( 'When it calls', 'funnelforms-pro' ) } hint={ sprintf( /* translators: %s: time zone of the agent, e.g. Europe/Berlin */ __( 'Times in the time zone %s. Leads who send the form at night are called the next morning.', 'funnelforms-pro' ), agent.timezone || state.timezone ) }>
						{ state.numbers.length ? (
							<Select
								label={ __( 'Calls from the number', 'funnelforms-pro' ) }
								value={ agent.number }
								options={ [ ...( agent.number ? [] : [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) } ] ), ...state.numbers.map( ( n ) => ( { value: n.id, label: n.label && n.label !== n.number ? `${ n.number } · ${ n.label }` : n.number } ) ), ...( agent.number && ! state.numbers.some( ( n ) => n.id === agent.number ) ? [ { value: agent.number, label: agent.numberLabel || __( 'Removed number', 'funnelforms-pro' ) } ] : [] ) ] }
								onChange={ ( v ) => {
									const n = state.numbers.find( ( x ) => x.id === v );
									set( { number: v, numberLabel: n ? n.label || n.number : '', numberProvider: 'sip_trunk' === n?.provider ? 'sip_trunk' : 'twilio' } );
								} }
							/>
						) : (
							<Notice
								tone="warning"
								title={ __( 'No number yet', 'funnelforms-pro' ) }
								action={
									<Button size="sm" variant="primary" onClick={ onAddNumber }>
										{ __( 'Add number from Twilio', 'funnelforms-pro' ) }
									</Button>
								}
							>
								{ __( 'You can save the agent now; it calls once it has a number.', 'funnelforms-pro' ) }
							</Notice>
						) }
						<div className="ffxb-lc-row">
							<Select
								label={ __( 'Time zone', 'funnelforms-pro' ) }
								value={ agent.timezone }
								options={ [ { value: '', label: sprintf( /* translators: %s: time zone of the website, e.g. Europe/Berlin */ __( 'Time zone of the website (%s)', 'funnelforms-pro' ), state.timezone ) }, ...( state.zones ?? ( agent.timezone ? [ agent.timezone ] : [] ) ).map( ( z ) => ( { value: z, label: z.replace( /_/g, ' ' ) } ) ) ] }
								onChange={ ( v ) => set( { timezone: v } ) }
								hint={ __( 'Call hours, call backs and the time the agent knows go by this time zone.', 'funnelforms-pro' ) }
							/>
							<Select
								label={ __( 'Country of the leads', 'funnelforms-pro' ) }
								value={ agent.country }
								options={ [ { value: '', label: siteCountry ? sprintf( /* translators: %s: country, e.g. Germany */ __( 'Country of the form’s language (%s)', 'funnelforms-pro' ), siteCountry ) : __( 'Country of the form’s language', 'funnelforms-pro' ) }, ...countries.map( ( c ) => ( { value: c.iso, label: `${ c.name } +${ c.code }` } ) ) ] }
								onChange={ ( v ) => set( { country: v } ) }
								hint={ __( 'For numbers typed without a country code, e.g. 0152 …: the agent calls them in this country.', 'funnelforms-pro' ) }
							/>
						</div>
						<div className="ffxb-field">
							<span className="ffxb-field__label" id={ `${ uid }-days` }>
								{ __( 'Days', 'funnelforms-pro' ) }
							</span>
							<div className="ffxb-bt-chips" role="group" aria-labelledby={ `${ uid }-days` }>
								{ [ 1, 2, 3, 4, 5, 6, 7 ].map( ( d ) => (
									<button key={ d } type="button" className="ffxb-bt-chip" aria-pressed={ agent.window.days.includes( d ) } onClick={ () => toggleDay( d ) }>
										{ dayName( d, locale ) }
									</button>
								) ) }
							</div>
						</div>
						<div className="ffxb-lc-row">
							<TextInput label={ __( 'From', 'funnelforms-pro' ) } type="time" value={ agent.window.from } onChange={ ( v ) => set( { window: { ...agent.window, from: v } } ) } />
							<TextInput label={ __( 'Until', 'funnelforms-pro' ) } type="time" value={ agent.window.to } onChange={ ( v ) => set( { window: { ...agent.window, to: v } } ) } />
						</div>
						<div className="ffxb-lc-row">
							<Select label={ __( 'First call', 'funnelforms-pro' ) } value={ String( agent.delayMinutes ) } options={ choices( [ 0, 1, 2, 5, 10, 15, 30, 60 ], agent.delayMinutes, minutesText ) } onChange={ ( v ) => set( { delayMinutes: Number( v ) } ) } hint={ __( 'after the form was sent', 'funnelforms-pro' ) } />
							<Select
								label={ __( 'If nobody answers', 'funnelforms-pro' ) }
								value={ String( agent.retries ) }
								options={ [ 0, 1, 2, 3 ].map( ( n ) => ( { value: String( n ), label: 0 === n ? __( 'Do not call again', 'funnelforms-pro' ) : 1 === n ? __( 'Try once more', 'funnelforms-pro' ) : sprintf( /* translators: %d: number of further calls */ __( 'Try %d more times', 'funnelforms-pro' ), n ) } ) ) }
								onChange={ ( v ) => set( { retries: Number( v ) } ) }
								hint={ __( 'A voicemail counts as not answered: the agent hangs up without a message.', 'funnelforms-pro' ) }
							/>
							{ agent.retries ? <Select label={ __( 'Next try', 'funnelforms-pro' ) } value={ String( agent.retryMinutes ) } options={ choices( [ 30, 60, 120, 240, 1440 ], agent.retryMinutes, minutesText ) } onChange={ ( v ) => set( { retryMinutes: Number( v ) } ) } /> : null }
						</div>
						<p className="ffxb-hint">{ __( 'If the lead has no time and names another day and time, the agent calls again then, within the call hours.', 'funnelforms-pro' ) }</p>
					</Part>

					<Part icon="person" title={ __( 'If the lead wants to talk to a person', 'funnelforms-pro' ) }>
						<TextInput
							label={ __( 'Connect with this number', 'funnelforms-pro' ) }
							type="tel"
							value={ agent.transfer }
							placeholder="+49 30 1234567"
							onChange={ ( v ) => set( { transfer: v } ) }
							hint={ agent.transfer.trim() && ! e164( agent.transfer ) ? __( 'With the country code, e.g. +49 30 1234567.', 'funnelforms-pro' ) : __( 'Optional. When the lead wants to talk to your team right away, the agent connects the call to this number, for example your office.', 'funnelforms-pro' ) }
						/>
					</Part>

					<Part icon="after" title={ __( 'After the call', 'funnelforms-pro' ) }>
						<Select
							label={ __( 'Move the lead to this stage when the goal is reached', 'funnelforms-pro' ) }
							value={ agent.successStage }
							options={ [ { value: '', label: __( 'Leave the stage as it is', 'funnelforms-pro' ) }, ...state.stages.map( ( s ) => ( { value: s.key, label: s.name } ) ) ] }
							onChange={ ( v ) => set( { successStage: v } ) }
						/>
						<Toggle label={ __( 'Save the whole conversation in the entry', 'funnelforms-pro' ) } checked={ agent.transcript } onChange={ ( v ) => set( { transcript: v } ) } hint={ __( 'Otherwise the entry gets the summary and the answers only.', 'funnelforms-pro' ) } />
						<button type="button" className="ffxb-lc-more" aria-expanded={ more } onClick={ () => setMore( ! more ) }>
							{ __( 'More settings', 'funnelforms-pro' ) }
						</button>
						{ more ? (
							<>
								<TextInput label={ __( 'Further instructions', 'funnelforms-pro' ) } multiline value={ agent.instructions } onChange={ ( v ) => set( { instructions: v } ) } hint={ __( 'Optional, in your words, e.g. “Never name prices. Offer a callback by our team instead.”', 'funnelforms-pro' ) } />
								<Select label={ __( 'Calls per day at most', 'funnelforms-pro' ) } value={ String( agent.dailyLimit ) } options={ choices( [ 10, 25, 50, 100, 250, 500, 1000 ], agent.dailyLimit, ( n ) => String( n ) ) } onChange={ ( v ) => set( { dailyLimit: Number( v ) } ) } hint={ __( 'Protects your ElevenLabs and Twilio credit.', 'funnelforms-pro' ) } />
							</>
						) : null }
					</Part>
				</div>

				<aside className="ffxb-bt__preview ffxb-lc-preview" aria-labelledby={ `${ uid }-preview` }>
					<h3 id={ `${ uid }-preview` } className="ffxb-bt__preview-title">
						{ __( 'How the call goes', 'funnelforms-pro' ) }
					</h3>
					<div className="ffxb-lc-chat">
						<p className="ffxb-lc-bubble">
							{ disclosure( agent.language, company ) } { agent.greeting }
						</p>
						{ books ? <p className="ffxb-lc-bubble is-question">{ type ? sprintf( /* translators: %s: name of the appointment type */ __( 'Offers two free times for “%s” and books the one the lead takes.', 'funnelforms-pro' ), type.title ) : __( 'Offers two free times and books the one the lead takes.', 'funnelforms-pro' ) }</p> : null }
						{ agent.questions
							.filter( ( q ) => q.label.trim() )
							.map( ( q, i ) => (
								<p key={ i } className="ffxb-lc-bubble is-question">
									{ q.hint.trim() || q.label }
								</p>
							) ) }
					</div>
					<h3 className="ffxb-bt__preview-title">{ __( 'Written to the entry', 'funnelforms-pro' ) }</h3>
					<ul className="ffxb-lc-entry">
						<li>
							<strong>{ __( 'Result', 'funnelforms-pro' ) }</strong> { __( 'goal reached or not, or not reached by phone', 'funnelforms-pro' ) }
						</li>
						<li>
							<strong>{ __( 'Summary', 'funnelforms-pro' ) }</strong> { __( 'of the conversation, in a few sentences', 'funnelforms-pro' ) }
						</li>
						{ agent.questions
							.filter( ( q ) => q.label.trim() )
							.map( ( q, i ) => (
								<li key={ i }>
									<strong>{ q.label }</strong> { __( 'the answer', 'funnelforms-pro' ) }
								</li>
							) ) }
						{ 'appointment' === agent.goal ? (
							<li>
								<strong>{ __( 'Appointment', 'funnelforms-pro' ) }</strong> { books ? __( 'booked in the appointment type, with confirmation to the lead', 'funnelforms-pro' ) : __( 'the time agreed', 'funnelforms-pro' ) }
							</li>
						) : null }
						<li>
							<strong>{ __( 'Interest', 'funnelforms-pro' ) }</strong> { __( 'how interested the lead is', 'funnelforms-pro' ) }
						</li>
						<li>
							<strong>{ __( 'Notes', 'funnelforms-pro' ) }</strong> { __( 'anything else worth knowing', 'funnelforms-pro' ) }
						</li>
						{ agent.transcript ? (
							<li>
								<strong>{ __( 'Conversation', 'funnelforms-pro' ) }</strong> { __( 'word for word', 'funnelforms-pro' ) }
							</li>
						) : null }
					</ul>
				</aside>
			</div>
		</Dialog>
	);
}

/** A number as typed, in the form +4917012345678, or null. */
export function e164( typed: string ): string | null {
	const n = typed.replace( /[\s()./-]/g, '' ).replace( /^00/, '+' );
	return /^\+[1-9][0-9]{6,14}$/.test( n ) ? n : null;
}

function TestCallDialog( { api, agent, onClose }: { api: LeadcallerApi; agent: AiAgent; onClose: () => void } ) {
	const [ to, setTo ] = useState( '' );
	const [ name, setName ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ conversation, setConversation ] = useState<string | null>( null );
	const [ result, setResult ] = useState<AiCallResult | null>( null );
	const number = e164( to );

	useEffect( () => {
		if ( ! conversation ) {
			return;
		}
		let live = true;
		let tries = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = (): void => {
			api.callResult( conversation, agent.id ).then(
				( r ) => {
					if ( ! live ) {
						return;
					}
					if ( r.done || ++tries > 200 ) {
						setResult( r );
					} else {
						timer = setTimeout( poll, 4000 );
					}
				},
				( e: unknown ) => live && setError( message( e ) )
			);
		};
		timer = setTimeout( poll, 4000 );
		return () => {
			live = false;
			if ( timer ) {
				clearTimeout( timer );
			}
		};
	}, [ api, agent.id, conversation ] );

	const call = async (): Promise<void> => {
		if ( ! number ) {
			return;
		}
		setBusy( true );
		setError( null );
		try {
			setConversation( ( await api.testCall( agent.id, number, name.trim() ) ).conversation );
		} catch ( e ) {
			setError( message( e ) );
		} finally {
			setBusy( false );
		}
	};

	return (
		<Dialog
			title={ sprintf( /* translators: %s: name of the agent */ __( 'Test call: %s', 'funnelforms-pro' ), agent.name ) }
			open
			onClose={ onClose }
			actions={
				conversation ? (
					<Button variant="primary" onClick={ onClose }>
						{ __( 'Close', 'funnelforms-pro' ) }
					</Button>
				) : (
					<>
						<Button variant="ghost" onClick={ onClose }>
							{ __( 'Cancel', 'funnelforms-pro' ) }
						</Button>
						<Button variant="primary" disabled={ busy || ! number } onClick={ () => void call() }>
							{ busy ? __( 'Calling…', 'funnelforms-pro' ) : __( 'Call me now', 'funnelforms-pro' ) }
						</Button>
					</>
				)
			}
		>
			{ error ? <Notice tone="danger">{ error }</Notice> : null }
			{ ! conversation ? (
				<>
					<p className="ffxb-hint">{ __( 'The agent calls you right away, also outside its call hours, and acts as if you had just sent a form. Afterwards you see here what would be written to the entry.', 'funnelforms-pro' ) }</p>
					{ 'appointment' === agent.goal && agent.bookingType ? <p className="ffxb-hint">{ __( 'It offers the real free times of the appointment type, but a test call books nothing.', 'funnelforms-pro' ) }</p> : null }
					<TextInput label={ __( 'Your phone number', 'funnelforms-pro' ) } type="tel" value={ to } placeholder="+49 170 1234567" onChange={ setTo } hint={ to && ! number ? __( 'With the country code, e.g. +49 170 1234567.', 'funnelforms-pro' ) : __( 'With the country code.', 'funnelforms-pro' ) } />
					<TextInput label={ __( 'Your name in the test', 'funnelforms-pro' ) } value={ name } onChange={ setName } hint={ __( 'Optional; otherwise your WordPress name.', 'funnelforms-pro' ) } />
				</>
			) : ! result ? (
				<Spinner label={ __( 'Your phone rings in a moment. Talk to the agent; the result appears here after you hang up.', 'funnelforms-pro' ) } />
			) : (
				<CallResult result={ result } />
			) }
		</Dialog>
	);
}

function CallResult( { result }: { result: AiCallResult } ) {
	if ( ! result.done ) {
		return <Notice tone="warning">{ __( 'The call is still running or ElevenLabs has no result yet. You find it later in your ElevenLabs account under Conversations.', 'funnelforms-pro' ) }</Notice>;
	}
	return (
		<div className="ffxb-lc-result">
			{ ! result.reached ? (
				<Notice tone="warning">{ __( 'Not reached: nobody answered, or the mailbox did. With a lead the agent would try again later.', 'funnelforms-pro' ) }</Notice>
			) : true === result.goal ? (
				<Notice tone="success">{ __( 'Goal reached. This is what the entry would get:', 'funnelforms-pro' ) }</Notice>
			) : (
				<Notice tone="info">{ false === result.goal ? __( 'Call finished, goal not reached. This is what the entry would get:', 'funnelforms-pro' ) : __( 'Call finished. This is what the entry would get:', 'funnelforms-pro' ) }</Notice>
			) }
			{ result.summary ? (
				<p>
					<strong>{ __( 'Summary', 'funnelforms-pro' ) }:</strong> { result.summary }
				</p>
			) : null }
			{ result.details?.length ? (
				<dl className="ffxb-lc-details">
					{ result.details.map( ( d ) => (
						<React.Fragment key={ d.label }>
							<dt>{ d.label }</dt>
							<dd>{ d.value }</dd>
						</React.Fragment>
					) ) }
				</dl>
			) : null }
			{ result.transcript?.length ? (
				<details className="ffxb-lc-transcript">
					<summary>{ __( 'Conversation', 'funnelforms-pro' ) }</summary>
					{ result.transcript.map( ( line, i ) => (
						<p key={ i } className={ 'agent' === line.role ? 'is-agent' : 'is-lead' }>
							<strong>{ 'agent' === line.role ? __( 'Agent', 'funnelforms-pro' ) : __( 'Lead', 'funnelforms-pro' ) }:</strong> { line.text }
						</p>
					) ) }
				</details>
			) : null }
		</div>
	);
}
