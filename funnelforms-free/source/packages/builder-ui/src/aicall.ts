/**
 * The AI Phone Agent: agents of Funnelforms → AI Phone Agent (Http\LeadcallerController), their
 * starting texts per goal and language, and the fields a form needs for the action aiCall. The
 * plugin adds the sentence that an AI assistant is calling itself (Integrations\Voice\CallRules),
 * so the greetings here do not.
 */
import type { ContactField, Field, FormDocument } from '@funnelforms/form-schema';

export type AiGoal = 'qualify' | 'appointment' | 'confirm' | 'followUp';

export const AI_GOALS: AiGoal[] = [ 'qualify', 'appointment', 'confirm', 'followUp' ];

/** Languages an agent speaks, in the order of the list. */
export const AI_LANGUAGES = [ 'de', 'en', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'da', 'sv', 'no', 'fi', 'cs', 'tr', 'el', 'hu', 'ro', 'ru', 'ja', 'ko', 'zh', 'id', 'vi' ] as const;

export interface AiQuestion {
	key?: string;
	label: string;
	hint: string;
}

/** An agent as the Leadcaller page edits it (Application\AiAgents::normalize()). */
export interface AiAgent {
	id: string;
	name: string;
	goal: AiGoal;
	language: string;
	voice: string;
	voiceName: string;
	company: string;
	/** Prompt notes: rules, tone and basics for every call (formerly "About you"). */
	about: string;
	greeting: string;
	questions: AiQuestion[];
	instructions: string;
	number: string;
	numberLabel: string;
	numberProvider: 'twilio' | 'sip_trunk';
	/** IANA time zone of call hours, call backs and the time the agent knows; '' for the site's. */
	timezone: string;
	/** Country (ISO, DE) of numbers typed without a country code; '' for the country of the form's language. */
	country: string;
	window: { days: number[]; from: string; to: string };
	delayMinutes: number;
	retries: number;
	retryMinutes: number;
	dailyLimit: number;
	transcript: boolean;
	successStage: string;
	/** Appointment type (bt:<id>) an agent with the goal appointment books into; '' notes a time only. */
	bookingType: string;
	/** Number the agent connects the person with when they want to talk to the team now; '' for none. */
	transfer: string;
	remote?: string;
	synced?: number;
	/** What keeps it from calling: no_remote, no_number. */
	missing?: string[];
}

/** An agent as the builder lists it (GET leadcaller/agents). */
export interface AiAgentSummary {
	id: string;
	name: string;
	goal: AiGoal;
	ready: boolean;
}

export interface AiNumber {
	id: string;
	number: string;
	label: string;
	provider: string;
	outbound: boolean;
}

export interface AiVoice {
	id: string;
	name: string;
	language: string;
	gender: string;
	accent: string;
	/** What ElevenLabs says it suits, e.g. conversational. */
	use: string;
	preview: string;
}

/** GET leadcaller. */
export interface LeadcallerState {
	connected: boolean;
	error: string | null;
	numbers: AiNumber[];
	agents: AiAgent[];
	twilio: Array<{ ref: string; label: string }>;
	stages: Array<{ key: string; name: string }>;
	site: string;
	about: string;
	timezone: string;
	/** Time zones an agent can work in (IANA). */
	zones?: string[];
	/** Country of numbers without a country code when the agent names none (from the site's language). */
	country?: string;
	user: string;
	/** Appointment types of Funnelforms → Appointments the agent can book into. */
	types?: AiBookingType[];
	/** Calendars connected (Google, Microsoft, CalDAV). */
	calendars?: number;
	/** Whether ElevenLabs can likely reach the site in a call; not for local test sites. */
	reachable?: boolean;
}

/** An appointment type as the Leadcaller page lists it. */
export interface AiBookingType {
	ref: string;
	title: string;
	durations: number[];
	/** Calendars it checks for busy times. */
	conflicts: number;
	/** Whether appointments go into a calendar. */
	write: boolean;
}

/** The outcome of a test call (GET leadcaller/calls/<id>). */
export interface AiCallResult {
	done: boolean;
	reached?: boolean;
	goal?: boolean | null;
	duration?: number;
	summary?: string;
	details?: Array<{ label: string; value: string }>;
	transcript?: Array<{ role: 'lead' | 'agent'; text: string }>;
}

interface GoalTexts {
	greeting: string;
	questions: Array<[ string, string ]>;
}

type LanguageTexts = Record<AiGoal, GoalTexts>;

/** What a new agent says first and asks, per language; other languages start from English. */
const TEXTS: Record<'de' | 'en' | 'fr' | 'es' | 'it', LanguageTexts> = {
	de: {
		qualify: {
			greeting: 'Sie haben gerade bei uns angefragt. Haben Sie zwei Minuten für ein paar kurze Fragen?',
			questions: [
				[ 'Bedarf', 'Was genau die Person braucht' ],
				[ 'Budget', 'Ungefährer Betrag, den die Person ausgeben möchte' ],
				[ 'Zeitpunkt', 'Wann es losgehen soll' ],
				[ 'Entscheidung', 'Ob die Person allein entscheidet oder wer noch mitentscheidet' ],
			],
		},
		appointment: {
			greeting: 'Danke für Ihre Anfrage. Ich würde gern einen Termin für ein kurzes Beratungsgespräch mit Ihnen finden. Passt es gerade?',
			questions: [
				[ 'Wunschtermin', 'Tag und Uhrzeit für das Beratungsgespräch' ],
				[ 'Art des Gesprächs', 'Telefon, Video oder vor Ort' ],
			],
		},
		confirm: {
			greeting: 'Danke für Ihre Anfrage. Ich möchte kurz Ihre Angaben bestätigen, damit wir Ihnen schnell helfen können. Passt es gerade?',
			questions: [
				[ 'Korrekturen', 'Was an den Angaben im Formular nicht stimmt' ],
				[ 'Offene Fragen', 'Was die Person noch wissen möchte' ],
			],
		},
		followUp: {
			greeting: 'Ich melde mich wegen Ihrer Anfrage und unseres Angebots. Haben Sie kurz Zeit?',
			questions: [
				[ 'Eindruck vom Angebot', 'Wie das Angebot gefällt' ],
				[ 'Was noch fehlt', 'Was zur Entscheidung noch fehlt oder unklar ist' ],
				[ 'Nächster Schritt', 'Wann und wie es weitergehen soll' ],
			],
		},
	},
	en: {
		qualify: {
			greeting: 'You just sent us a request. Do you have two minutes for a few short questions?',
			questions: [
				[ 'Need', 'What exactly the person needs' ],
				[ 'Budget', 'Rough amount the person wants to spend' ],
				[ 'Timing', 'When it should start' ],
				[ 'Decision', 'Whether the person decides alone or who else decides' ],
			],
		},
		appointment: {
			greeting: 'Thank you for your request. I would like to find a time for a short consultation with you. Is now a good moment?',
			questions: [
				[ 'Preferred appointment', 'Day and time for the consultation' ],
				[ 'Kind of meeting', 'Phone, video or in person' ],
			],
		},
		confirm: {
			greeting: 'Thank you for your request. I would like to quickly confirm your details so we can help you fast. Is now a good moment?',
			questions: [
				[ 'Corrections', 'What is not right in the details of the form' ],
				[ 'Open questions', 'What the person would still like to know' ],
			],
		},
		followUp: {
			greeting: 'I am calling about your request and our offer. Do you have a moment?',
			questions: [
				[ 'Opinion of the offer', 'How the person likes the offer' ],
				[ 'What is missing', 'What is missing or unclear for a decision' ],
				[ 'Next step', 'When and how to go on' ],
			],
		},
	},
	fr: {
		qualify: {
			greeting: 'Vous venez de nous envoyer une demande. Avez-vous deux minutes pour quelques questions ?',
			questions: [
				[ 'Besoin', 'Ce dont la personne a besoin exactement' ],
				[ 'Budget', 'Montant approximatif que la personne veut dépenser' ],
				[ 'Délai', 'Quand le projet doit commencer' ],
				[ 'Décision', 'Si la personne décide seule ou qui décide avec elle' ],
			],
		},
		appointment: {
			greeting: 'Merci pour votre demande. J’aimerais trouver avec vous un moment pour un court entretien de conseil. Est-ce que cela vous convient maintenant ?',
			questions: [
				[ 'Rendez-vous souhaité', 'Jour et heure de l’entretien' ],
				[ 'Type d’entretien', 'Téléphone, vidéo ou sur place' ],
			],
		},
		confirm: {
			greeting: 'Merci pour votre demande. Je souhaite confirmer rapidement vos informations pour vous aider au plus vite. Est-ce que cela vous convient maintenant ?',
			questions: [
				[ 'Corrections', 'Ce qui n’est pas exact dans le formulaire' ],
				[ 'Questions', 'Ce que la personne aimerait encore savoir' ],
			],
		},
		followUp: {
			greeting: 'Je vous appelle au sujet de votre demande et de notre offre. Avez-vous un instant ?',
			questions: [
				[ 'Avis sur l’offre', 'Ce que la personne pense de l’offre' ],
				[ 'Ce qui manque', 'Ce qui manque ou n’est pas clair pour décider' ],
				[ 'Prochaine étape', 'Quand et comment continuer' ],
			],
		},
	},
	es: {
		qualify: {
			greeting: 'Acaba de enviarnos una solicitud. ¿Tiene dos minutos para unas preguntas breves?',
			questions: [
				[ 'Necesidad', 'Qué necesita exactamente la persona' ],
				[ 'Presupuesto', 'Importe aproximado que quiere gastar' ],
				[ 'Plazo', 'Cuándo debería empezar' ],
				[ 'Decisión', 'Si decide sola o quién más decide' ],
			],
		},
		appointment: {
			greeting: 'Gracias por su solicitud. Me gustaría encontrar un momento para una breve consulta con usted. ¿Le viene bien ahora?',
			questions: [
				[ 'Cita deseada', 'Día y hora de la consulta' ],
				[ 'Tipo de reunión', 'Teléfono, vídeo o en persona' ],
			],
		},
		confirm: {
			greeting: 'Gracias por su solicitud. Quisiera confirmar brevemente sus datos para poder ayudarle rápido. ¿Le viene bien ahora?',
			questions: [
				[ 'Correcciones', 'Qué no es correcto en los datos del formulario' ],
				[ 'Preguntas', 'Qué le gustaría saber todavía' ],
			],
		},
		followUp: {
			greeting: 'Le llamo por su solicitud y nuestra oferta. ¿Tiene un momento?',
			questions: [
				[ 'Opinión de la oferta', 'Qué le parece la oferta' ],
				[ 'Qué falta', 'Qué falta o no está claro para decidir' ],
				[ 'Siguiente paso', 'Cuándo y cómo seguir' ],
			],
		},
	},
	it: {
		qualify: {
			greeting: 'Ci ha appena inviato una richiesta. Ha due minuti per qualche breve domanda?',
			questions: [
				[ 'Esigenza', 'Di cosa ha bisogno esattamente la persona' ],
				[ 'Budget', 'Importo indicativo che vuole spendere' ],
				[ 'Tempi', 'Quando dovrebbe iniziare' ],
				[ 'Decisione', 'Se decide da sola o chi altro decide' ],
			],
		},
		appointment: {
			greeting: 'Grazie per la sua richiesta. Vorrei trovare con lei un momento per una breve consulenza. Le va bene adesso?',
			questions: [
				[ 'Appuntamento desiderato', 'Giorno e ora della consulenza' ],
				[ 'Tipo di incontro', 'Telefono, video o di persona' ],
			],
		},
		confirm: {
			greeting: 'Grazie per la sua richiesta. Vorrei confermare velocemente i suoi dati per aiutarla al più presto. Le va bene adesso?',
			questions: [
				[ 'Correzioni', 'Cosa non è giusto nei dati del modulo' ],
				[ 'Domande', 'Cosa vorrebbe ancora sapere' ],
			],
		},
		followUp: {
			greeting: 'La chiamo per la sua richiesta e la nostra offerta. Ha un momento?',
			questions: [
				[ 'Opinione sull’offerta', 'Cosa pensa dell’offerta' ],
				[ 'Cosa manca', 'Cosa manca o non è chiaro per decidere' ],
				[ 'Prossimo passo', 'Quando e come proseguire' ],
			],
		},
	},
};

/** Greeting and questions of a goal in a language (English for languages without own texts). */
export function goalTexts( goal: AiGoal, language: string ): { greeting: string; questions: AiQuestion[] } {
	const texts = ( TEXTS[ language as keyof typeof TEXTS ] ?? TEXTS.en )[ goal ];
	return { greeting: texts.greeting, questions: texts.questions.map( ( [ label, hint ] ) => ( { label, hint } ) ) };
}

/** The sentence every call starts with, as the plugin says it (CallRules::DISCLOSURE). */
const DISCLOSURE: Record<string, string> = {
	de: 'Hallo, hier spricht der KI-Assistent von %s.',
	en: 'Hello, this is the AI assistant of %s.',
	es: 'Hola, le habla el asistente de IA de %s.',
	fr: 'Bonjour, ici l’assistant IA de %s.',
	it: 'Buongiorno, sono l’assistente IA di %s.',
	nl: 'Hallo, u spreekt met de AI-assistent van %s.',
	pl: 'Dzień dobry, tu asystent AI firmy %s.',
	pt: 'Olá, fala o assistente de IA de %s.',
	da: 'Hej, det er AI-assistenten fra %s.',
	sv: 'Hej, det här är AI-assistenten från %s.',
	no: 'Hei, dette er AI-assistenten til %s.',
	fi: 'Hei, täällä %s:n tekoälyavustaja.',
	cs: 'Dobrý den, tady AI asistent společnosti %s.',
	tr: 'Merhaba, ben %s yapay zekâ asistanıyım.',
};

export function disclosure( language: string, company: string ): string {
	return ( DISCLOSURE[ language ] ?? DISCLOSURE.en ?? '' ).replace( '%s', company || 'Funnelforms' );
}

/** A new agent with the texts of the first goal in the language. */
export function newAgent( language: string, site: string ): AiAgent {
	const lang = ( AI_LANGUAGES as readonly string[] ).includes( language ) ? language : 'en';
	const texts = goalTexts( 'qualify', lang );
	return {
		id: '',
		name: '',
		goal: 'qualify',
		language: lang,
		voice: '',
		voiceName: '',
		company: site,
		about: '',
		greeting: texts.greeting,
		questions: texts.questions,
		instructions: '',
		number: '',
		numberLabel: '',
		numberProvider: 'twilio',
		timezone: '',
		country: '',
		window: { days: [ 1, 2, 3, 4, 5 ], from: '09:00', to: '19:00' },
		delayMinutes: 2,
		retries: 2,
		retryMinutes: 60,
		dailyLimit: 50,
		transcript: false,
		successStage: '',
		bookingType: '',
		transfer: '',
	};
}

/** Phone fields of the contact steps: the numbers a call can go to. */
export function phoneFields( doc: FormDocument ): ContactField[] {
	return doc.nodes.flatMap( ( n ) => ( 'contact' === n.type ? n.fields.filter( ( f ) => 'phone' === f.type || 'phone_verification' === f.type ) : [] ) );
}

/** Consent fields of the contact steps: one of them must allow the call. */
/** The questions of the steps whose answers a form can share with the agent, in the order of the form. */
export function questionFields( doc: FormDocument ): Field[] {
	return doc.nodes.flatMap( ( n ) => ( 'step' === n.type ? n.fields.filter( ( f ) => 'content' !== f.type && 'result' !== f.type ) : [] ) );
}

export function consentFields( doc: FormDocument ): ContactField[] {
	return doc.nodes.flatMap( ( n ) => ( 'contact' === n.type ? n.fields.filter( ( f ) => 'consent' === f.type ) : [] ) );
}

type Request = <T>( method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown ) => Promise<T>;

/** Twilio access for reading and importing numbers: a saved Twilio connection or the keys typed in. */
export type TwilioAccess = { connectionRef: string } | { accountSid: string; authToken: string };

/** The routes of Funnelforms → AI Phone Agent (Http\LeadcallerController). */
export interface LeadcallerApi {
	state(): Promise<LeadcallerState>;
	/** Checks the key with ElevenLabs and stores it; fails with permanent_auth_failed. */
	connect( apiKey: string ): Promise<LeadcallerState>;
	disconnect(): Promise<LeadcallerState>;
	voices(): Promise<AiVoice[]>;
	/** The numbers of a Twilio account. */
	twilioNumbers( access: TwilioAccess ): Promise<Array<{ number: string; name: string }>>;
	/** Connects a Twilio number to ElevenLabs, so agents can call from it. */
	importNumber( access: TwilioAccess, number: string ): Promise<LeadcallerState>;
	/** Creates (no id) or changes an agent; Funnelforms sets it up in ElevenLabs. */
	saveAgent( agent: AiAgent ): Promise<AiAgent>;
	deleteAgent( id: string ): Promise<void>;
	/** Calls the number now with an example lead. */
	testCall( id: string, to: string, name: string ): Promise<{ conversation: string }>;
	callResult( conversation: string, agent: string ): Promise<AiCallResult>;
}

export function createLeadcallerApi( request: Request ): LeadcallerApi {
	const base = '~/leadcaller';
	return {
		state: () => request( 'GET', base ),
		connect: ( apiKey ) => request( 'POST', base + '/connect', { apiKey } ),
		disconnect: () => request( 'DELETE', base + '/connect' ),
		voices: () => request( 'GET', base + '/voices' ),
		twilioNumbers: ( access ) => request( 'POST', base + '/twilio-numbers', access ),
		importNumber: ( access, number ) => request( 'POST', base + '/numbers', { ...access, number } ),
		saveAgent: ( agent ) => request( 'POST', base + '/agents' + ( agent.id ? '/' + agent.id : '' ), agent ),
		deleteAgent: ( id ) => request( 'DELETE', base + '/agents/' + id ),
		testCall: ( id, to, name ) => request( 'POST', base + '/agents/' + id + '/test', { to, name } ),
		callResult: ( conversation, agent ) => request( 'GET', base + '/agents/' + agent + '/calls/' + encodeURIComponent( conversation ) ),
	};
}
