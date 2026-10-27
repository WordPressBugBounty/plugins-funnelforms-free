/**
 * What the builder needs from a backend. The WordPress plugin implements it with WpRestAdapter;
 * another host (Funnelforms 4) can bring its own adapter without changes to the builder.
 */
import type { Experiment, FormDocument } from '@funnelforms/form-schema';
import type { TEMPLATE_CATEGORIES, TEMPLATE_GOALS } from './templateTaxonomy';
import type { ConnectApi } from './connect';

export interface UserRef {
	id: number;
	name: string;
}

export type FormStatus = 'draft' | 'published' | 'trashed';

export interface FormSummary {
	id: number;
	uid: string;
	title: string;
	category: string;
	status: FormStatus;
	renderer: 'legacy' | 'v5';
	/** Post ID of the Funnelforms 3 form it came from. */
	legacyId: number | null;
	currentRevision: number | null;
	hasDraft: boolean;
	draftUpdatedAt: string | null;
	draftAuthor: UserRef | null;
	lockedBy: UserRef | null;
	/** Number of entries; null when the user may not see entries. */
	entries: number | null;
	shortcode: string;
	/** Address of the form's own page, /funnelforms/<slug>; empty without one. */
	publicSlug?: string;
	/** /funnelforms/<slug>, or /?funnelforms=<slug> when the site uses plain permalinks. */
	publicUrl?: string | null;
	/** /?funnelforms=<slug>: reaches WordPress on every server. */
	publicFallback?: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface FormDetail extends FormSummary {
	/** The draft, or the current revision when there is no draft. */
	document: FormDocument | null;
	/** Seconds the edit lock holds without being renewed. */
	lockTtl: number;
}

export interface FormList {
	forms: FormSummary[];
	total: number;
	categories: string[];
}

export interface ListQuery {
	search?: string;
	status?: FormStatus;
	category?: string;
	orderby?: 'updated' | 'title';
	page?: number;
	perPage?: number;
}

export interface SaveResult {
	/** What publishing would refuse. */
	problems: string[];
	/** Rights the user lacks to publish these changes. */
	missingRights: string[];
	form: FormSummary;
}

export interface PublishResult {
	revision: number;
	renderer: 'legacy' | 'v5';
	/** Why the new renderer cannot show the form yet. */
	warnings: string[];
	form: FormSummary;
	/** The dates the plugin keeps of each A/B test, by test id (Pro). */
	experiments?: Record<string, Partial<Pick<Experiment, 'startedAt' | 'pausedAt' | 'pausedDays' | 'extended' | 'endedAt' | 'outcome' | 'suggested'>>>;
}

export interface Revision {
	id: number;
	current: boolean;
	note: string;
	author: UserRef | null;
	createdAt: string | null;
}

/** What a form made from a template is for (TEMPLATE_GOALS). */
export type TemplateGoal = ( typeof TEMPLATE_GOALS )[ number ];

/** The industry a template is made for; `general` fits every business (TEMPLATE_CATEGORIES). */
export type TemplateCategory = ( typeof TEMPLATE_CATEGORIES )[ number ];

/**
 * What a template shows off beyond questions and the contact step; price: it shows the visitor an
 * amount, result: another result (a quiz, a size), score: it rates leads.
 */
export type TemplateFeature = 'quiz' | 'logic' | 'calculation' | 'booking' | 'upload' | 'address' | 'rating' | 'signature' | 'price' | 'result' | 'score';

/**
 * A template for new forms (plugin/templates). Title and description are in the admin's
 * language; the first question and the sample of its answers in the language of the form.
 */
export interface FormTemplate {
	id: string;
	title: string;
	description: string;
	goal: TemplateGoal;
	category: TemplateCategory;
	/** Lucide icon (TemplateCatalog.icons). */
	icon: string;
	/** Theme the template starts in (themes.ts); empty or unknown draws the thumbnail in the builder's colours. */
	theme?: string;
	features: TemplateFeature[];
	/** Search words (German and English synonyms) beyond the texts. */
	keywords?: string[];
	/** Recommended templates come first: lower first; null for the others. */
	rank?: number | null;
	/** A template of Funnelforms Pro that Funnelforms Free shows locked (it opens the page about Pro). */
	pro?: boolean;
	/** Number of question steps. */
	steps: number;
	/** Questions on the longest way through the form (texts and results are no questions). */
	questions?: number;
	firstQuestion: string;
	/** What the first step asks for, to draw a thumbnail: up to four answers with their icons, or the rating's points and style. */
	sample: { kind: 'choice' | 'slider' | 'rating' | 'input' | 'content' | 'date' | 'booking'; options: Array<{ label: string; icon: string }>; max: number; style: string };
}

/** The template gallery: templates in one form language, the languages to choose from and the icons the templates show. */
export interface TemplateCatalog {
	goals: TemplateGoal[];
	categories: TemplateCategory[];
	languages: string[];
	/** Language of the questions in `templates`. */
	locale: string;
	templates: FormTemplate[];
	icons: Record<string, IconElements>;
	/** The site's industry (setup assistant or diagnostic settings): the gallery starts with it. */
	industry?: TemplateCategory | '';
}

/** A style saved on the site: the style tokens of a form, under a name. */
export interface SavedStyle {
	id: string;
	name: string;
	tokens: Record<string, string>;
	createdAt: string;
}

/** Colours and fonts read from a website, for the form's design. */
export interface Branding {
	/** The page read, after redirects. */
	url: string;
	/** Colours to choose from, the suggested ones first (#rrggbb). */
	colors: string[];
	/** The suggestions for the accent colour, the text and the background. */
	roles: { primary?: string; text?: string; background?: string };
	/** Fonts, the main one first; local when the site hosts it (value: of font.family); google when it is a Google Font the site has or can download; from: where it was found. */
	fonts: Array<{ family: string; value: string; local: boolean; google?: boolean; from?: string }>;
	/** How sure the suggestions are: low means nothing names an accent colour, so none should be applied without a look. */
	confidence?: 'high' | 'medium' | 'low';
	/** Where each colour was found, by colour (e.g. "Elementor: Accent"). */
	origins?: Record<string, string>;
}

/** Colours and fonts the site's own theme and page builder are set to (read without a request). */
export interface SiteDesign extends Branding {
	/** What they were read from: the theme, Elementor, the logo. */
	sources: string[];
	/** Address of the site's logo. */
	logo: string | null;
}

/** Settings of an appointment type (Domain\Booking\BookingType in the plugin). */
export interface BookingConfig {
	version: 2;
	kind: 'personal' | 'call' | 'video';
	/** Address, phone number or video link, by kind. */
	location: string;
	/** Time zone of the hours; empty for the site's. */
	timezone: string;
	/** Opening hours: weekdays (1 Monday … 7 Sunday) with a time span each. */
	hours: Array<{ days: number[]; from: string; to: string }>;
	/** Minutes visitors can book, the first one preselected. */
	durations: number[];
	/** Minutes between start times. */
	interval: number;
	/** Minutes kept free before each appointment. */
	bufferBefore: number;
	/** Minutes kept free after each appointment. */
	bufferAfter: number;
	/** Minutes from now before the first bookable time. */
	notice: number;
	horizon: { mode: 'rolling'; amount: number; unit: 'day' | 'week' | 'month' } | { mode: 'range'; from: string; to: string } | { mode: 'unlimited' };
	/** Days without appointments (holidays), Y-m-d. */
	closed: Array<{ from: string; to: string }>;
	/** Days with other hours than the weekly ones (Y-m-d); no hours: closed that day. */
	special: Array<{ date: string; hours: Array<{ from: string; to: string }> }>;
	/** Appointments per day and person; 0 for no limit. */
	dailyLimit: number;
	/** User ids who are booked; none books the site. */
	staff: number[];
	assignment: 'roundRobin' | 'collective';
	/** Whether visitors get an invitation with a calendar file. */
	invitation: boolean;
	/** Reminders, minutes before the appointment. */
	reminders: number[];
	/**
	 * Calendar connections: where appointments are written ("owner": into the calendar of the
	 * person booked) and which block times. Calendars of the people booked block them anyway.
	 */
	calendars: { write: string; conflicts: string[] };
}

/** A calendar connection as Funnelforms → Integrations shows it (GET calendars). */
export interface CalendarAccount {
	ref: string;
	type: 'google' | 'microsoft' | 'caldav';
	label: string;
	/** E-mail address, or user and server of a CalDAV account. */
	account: string;
	/** ID of the main calendar, which gets the appointments. */
	calendar: string;
	/** IDs of the calendars checked for busy times. */
	busy: string[];
	/** User ID of the team member it belongs to; 0 for the website. */
	owner: number;
	ownerName: string;
	/** Why it could not be read lately (auth_failed: connect again). */
	error: string | null;
	/** Appointment types it counts for. */
	usedBy: Array<{ ref: string; title: string }>;
	/** Taken over from Funnelforms 3 when false; those stay. */
	removable: boolean;
	createdAt: string;
}

/** GET calendars. */
export interface CalendarsOverview {
	connections: CalendarAccount[];
	/** Team members a calendar can belong to (they see entries). */
	people: Array<{ id: number; name: string }>;
	/** Google and Microsoft sign in through the Funnelforms account of the website. */
	website: { connected: boolean; accountUrl: string };
	types: Array<{ ref: string; title: string; staff: number[]; write: string }>;
	timezone: string;
}

export interface BookingType {
	/** What booking fields keep in bookingTypeRef: bt:<id>, or legacy:<post id> for 3.x types. */
	ref: string;
	id: number;
	title: string;
	config: BookingConfig;
	/** Taken over from Funnelforms 3. */
	legacy: boolean;
	/** Still uses the calendar connected in Funnelforms 3; waits to be saved again. */
	cronofy: boolean;
}

/** GET admin/forms/booking-types. */
export interface BookingTypes {
	types: BookingType[];
	/** Users who can be booked (they can see entries). */
	staff: Array<{ id: number; name: string }>;
	/**
	 * Calendar connections: type caldav (Apple iCloud and others), google or microsoft; error: why
	 * the calendar could not be read lately (auth_failed: it has to be connected again).
	 */
	calendars: CalendarConnection[];
	/** The site's time zone. */
	timezone: string;
	defaults: BookingConfig;
}

export interface CalendarConnection {
	ref: string;
	type: string;
	label: string;
	error: string | null;
}

/** A calendar of a connected Google or Microsoft account. */
export interface CalendarChoice {
	id: string;
	name: string;
	/** Appointments can be added. */
	writable: boolean;
	/** The main calendar of the account. */
	primary: boolean;
}

/** How a sign-in to Google or Microsoft ended (docs/api/connections.md). */
export interface CalendarSignIn {
	ok: boolean;
	state: string;
	connection?: CalendarConnection;
	/** New connections: the calendars of the account and the one chosen. */
	calendars?: CalendarChoice[];
	calendar?: string;
	code?: string;
	message?: string;
	/** The Account page, when the website has to be connected with Funnelforms first. */
	url?: string;
}

/** An image of the media library. */
export interface MediaImage {
	id: number;
	url: string;
	alt: string;
}

/** Any file of the media library, e.g. a PDF to download. */
export interface MediaFile {
	id: number;
	url: string;
	title: string;
}

/** A font uploaded on the site (uploads/af2_fonts); the file name is the value of font.family. */
export interface FontFile {
	file: string;
	family: string;
	size: number;
}

/** A Google Font the site can download once and serve itself; its family is the value of font.family. */
export interface GoogleFont {
	family: string;
	category: 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';
	/** Downloaded to the site already. */
	installed: boolean;
}

/** A connection of the site (chat, SMS, WhatsApp, conversions, mail server); never its credentials. */
/** Figures of one variant of an A/B test (GET stats/<form id>, docs/api/stats.md). */
export interface VariantStats {
	id: string;
	label: string;
	weight: number;
	views: number;
	starts: number;
	completions: number;
	conversionRate: number | null;
	uplift: number | null;
	chanceToBeatControl: number | null;
}

export interface ExperimentStats {
	id: string;
	name: string;
	status: 'running' | 'paused' | 'stopped';
	winner: string | null;
	variants: VariantStats[];
}

/** Figures of a published form for a period (docs/api/stats.md). */
export interface FormStatsReport {
	form: number;
	/** First and last day, YYYY-MM-DD in the site's time zone. */
	from: string;
	to: string;
	totals: {
		views: number;
		starts: number;
		completions: number;
		conversionRate: number | null;
		/** Seconds from the first answer to sending, of the sent forms that measured it; null without any. */
		averageSeconds?: number | null;
		medianSeconds?: number | null;
	};
	/** Sent forms per device kind. */
	devices?: { desktop: number; tablet: number; mobile: number };
	daily: Array<{ date: string; views: number; starts: number; completions: number }>;
	/** Page views that saw a step, and those that left on it without sending the form. */
	steps: Array<{ id: string; type: 'step' | 'contact'; title: string; reached: number; left: number }>;
	/** Choice and dropdown fields: page views per answer, and how many of them sent the form. */
	answers?: Array<{ field: string; step: string; title: string; options: Array<{ id: string; label: string; chosen: number; completed: number }> }>;
	experiments?: ExperimentStats[];
	/**
	 * Forms that remind visitors who leave: visitors who left after typing their address, those
	 * reminded, those who sent the form after a reminder, and recovered of reminded (null without any).
	 */
	abandonment?: { abandoned: number; reminded: number; recovered: number; recoveryRate: number | null };
	/** With detail 'full' (FormAnalytics in the plugin); the fields below only with it. */
	times?: {
		/** Median seconds per node, of sent forms; only nodes with at least three values. */
		steps: Record<string, number>;
	};
	/** Ways between nodes: from '' is the start; a contact step to its end counts sent forms. */
	paths?: Array<{ from: string; to: string; sessions: number; completed: number }>;
	/** Input fields of steps and contact steps: failed checks; touched and lastTouched only from the extended level. */
	fieldStats?: Array<{ field: string; step: string; type: string; title: string; invalid: number; touched: number; lastTouched: number }>;
	/** Extended level: page views and sent forms per device class at the view. */
	deviceViews?: Array<{ device: 'mobile' | 'tablet' | 'desktop'; views: number; completions: number; conversionRate: number | null }>;
	/** Page views of the period with the extended level (statistics allowed). */
	extended?: number;
	/** Extended level: visitors recognised by the id in their browser. */
	visitors?: { unique: number; returning: number; views: number; returnViews: number; completions: number; returnCompletions: number; returningRate: number | null; returnConversionRate: number | null };
}

export interface Connection {
	ref: string;
	type: string;
	label: string;
	/** Stripe: the address to register as webhook endpoint in Stripe. */
	webhookUrl?: string;
	/** Payment accounts: a test account (test keys, PayPal sandbox). */
	test?: boolean;
}

/** What a test of a connection sends: the number for SMS and WhatsApp, the sender of an SMS, the template of WhatsApp. */
export interface ConnectionTest {
	to?: string;
	sender?: string;
	template?: string;
	language?: string;
}

/** A page of the site. */
export interface SitePage {
	id: number;
	title: string;
	url: string;
}

/** A message template of a WhatsApp Business account (docs/api/connections.md). */
export interface WhatsAppTemplate {
	id: string;
	name: string;
	language: string;
	/** APPROVED, PENDING, REJECTED, PAUSED, DISABLED … as Meta names it. */
	status: string;
	/** MARKETING, UTILITY or AUTHENTICATION. */
	category: string;
	header: string;
	body: string;
	footer: string;
	/** Placeholders {{1}} … of the body: the parameters an action sends. */
	placeholders: number;
	/** False when the template needs what forms cannot send (images, header or button variables). */
	supported: boolean;
	rejectedReason: string;
}

/** A new template to submit to Meta: examples are texts for the placeholders, in order. */
export interface NewWhatsAppTemplate {
	name: string;
	language: string;
	category: 'UTILITY' | 'MARKETING';
	body: string;
	examples: string[];
	footer?: string;
}

export interface ImportedForm {
	id: number | null;
	title?: string;
	legacyId?: number;
	/** 'ff4' for a form of Funnelforms 4, with its id there in sourceId. */
	source?: string;
	sourceId?: string;
	problems?: string[];
	notes?: string[];
	/** The notes in words, when the import describes them. */
	messages?: string[];
	errors?: string[];
}

/** Elements of an icon on a 24 × 24 grid: [element, attributes]. */
export type IconElements = Array<[ string, Record<string, string> ]>;

/** The Lucide icons the plugin ships (assets/icons/lucide.json): elements and search words by name. */
export interface IconLibrary {
	version: string;
	icons: Record<string, IconElements>;
	tags: Record<string, string>;
}

/** The AI form builder of the page (Funnelforms Pro): whether the license allows it, and where it is connected. */
export interface AiConfig {
	ready: boolean;
	accountUrl: string;
}

/** A form the AI form builder made, with a sentence or two about it. */
export type AiCreated = FormDetail & { summary: string };

/** A document the AI form builder changed, with a sentence or two about what changed. */
export interface AiChange {
	document: FormDocument;
	summary: string;
}

export interface FormsApi {
	list( query?: ListQuery ): Promise<FormList>;
	get( id: number ): Promise<FormDetail>;
	create( title: string, category?: string ): Promise<FormDetail>;
	update( id: number, changes: { category?: string; status?: FormStatus; publicSlug?: string } ): Promise<FormDetail>;
	/** To the trash, or deleted for good when it is already there and force is set. */
	remove( id: number, force?: boolean ): Promise<void>;
	saveDraft( id: number, document: FormDocument ): Promise<SaveResult>;
	dropDraft( id: number ): Promise<FormDetail>;
	publish( id: number, note?: string ): Promise<PublishResult>;
	revisions( id: number ): Promise<Revision[]>;
	revision( id: number, revision: number ): Promise<Revision & { document: FormDocument }>;
	restore( id: number, revision: number ): Promise<FormDetail>;
	duplicate( id: number ): Promise<FormDetail>;
	lock( id: number, force?: boolean ): Promise<void>;
	unlock( id: number ): Promise<void>;
	exportForm( id: number, revision?: 'draft' | 'current' ): Promise<unknown>;
	importFile( file: Blob, name: string ): Promise<ImportedForm[]>;
	/**
	 * Page of the preview frame, from the saved draft, in `locale` when the form has it; refused
	 * (409, data.problems) while it has problems.
	 */
	preview( id: number, locale?: string ): Promise<{ html: string }>;
	templates( locale?: string ): Promise<TemplateCatalog>;
	/** Page of the preview frame for a template, in a language of the catalog (the site's without). */
	templatePreview( id: string, locale?: string ): Promise<{ html: string }>;
	/** A new draft form from a template, in a language of the catalog (the site's without). */
	fromTemplate( id: string, locale?: string ): Promise<FormDetail>;
	/**
	 * A new draft form from a description of the business and the goal (AI form builder,
	 * Funnelforms Pro), in the site's language; nothing is published. Missing where the host has
	 * none. Fails with not_connected, ai_not_included, too_many, ai_quota, ai_busy, ai_refused,
	 * ai_invalid, ai_timeout, ai_unavailable or unreachable.
	 */
	aiCreate?( prompt: string ): Promise<AiCreated>;
	/** The document changed by an instruction (AI form builder); nothing is saved. Fails like aiCreate. */
	aiEdit?( id: number, prompt: string, document: FormDocument ): Promise<AiChange>;
	/** Styles saved on the site, newest first. */
	styles(): Promise<SavedStyle[]>;
	saveStyle( name: string, tokens: Record<string, string> ): Promise<SavedStyle>;
	deleteStyle( id: string ): Promise<void>;
	fonts(): Promise<FontFile[]>;
	/** Uploads a font (TTF, OTF, WOFF, WOFF2; refused without the right to upload files). */
	uploadFont( file: Blob, name: string ): Promise<FontFile>;
	/** The Google Fonts the site can download, with those it has. Missing where the host offers none. */
	googleFonts?(): Promise<GoogleFont[]>;
	/** Downloads a Google Font to the site (refused without the right to upload files). */
	installGoogleFont?( family: string ): Promise<GoogleFont>;
	/** Lets the user choose or upload an image in the media library; null when closed without one. Missing where the host has no media library. */
	pickImage?( current?: number ): Promise<MediaImage | null>;
	/** Lets the user choose or upload any file in the media library; null when closed without one. */
	pickFile?(): Promise<MediaFile | null>;
	/** The icon set for answers and contact fields; missing where the host ships none. */
	icons?(): Promise<IconLibrary>;
	/** An image of the media library by its ID; null when it is gone. */
	image?( id: number ): Promise<MediaImage | null>;
	/** Loads a website from the server and reads its colours and fonts; consent: the user may use them. */
	branding( url: string, consent: boolean ): Promise<Branding>;
	/** The colours and fonts of this site's theme and page builder; missing where the host cannot read them. */
	siteDesign?(): Promise<SiteDesign>;
	/** Address of the site's logo (or site icon), to pick colours from; missing or null without one. */
	readonly siteLogo?: string | null;
	/** Appointment types with who can be booked and the calendars; needs the right to edit forms. */
	bookingTypes(): Promise<BookingTypes>;
	/** Saves an appointment type, a new one without id; fails with data.problems when incomplete. */
	saveBookingType( id: number | null, title: string, config: BookingConfig ): Promise<BookingType>;
	/** Deletes an appointment type; its bookings stay. */
	deleteBookingType( id: number ): Promise<void>;
	/** CRM and newsletter connections and the import of forms of other plugins; missing where the host has none. */
	readonly connect?: ConnectApi;
	/** Connections actions can use. */
	connections(): Promise<Connection[]>;
	/** Adds a connection; needs the right to change settings. */
	createConnection( type: string, label: string, credentials: Record<string, string | boolean> ): Promise<Connection>;
	/** Replaces the credentials given (e.g. the Stripe signing secret) and the label; needs the right to change settings. */
	updateConnection( ref: string, credentials: Record<string, string> ): Promise<Connection>;
	/** Deletes a connection; actions that use it stop sending. Needs the right to change settings. */
	deleteConnection?( ref: string ): Promise<void>;
	/** Sends a test message through a connection (SMS and WhatsApp to the number given), or reads its calendar; fails with not_testable, invalid_number or delivery_failed. */
	testConnection?( ref: string, test: ConnectionTest ): Promise<void>;
	/** Published pages of the site whose title holds the search, for redirects. */
	pages?( search: string ): Promise<SitePage[]>;
	/** Templates of a WhatsApp connection; fails with connection_incomplete without the business account ID. */
	whatsAppTemplates?( ref: string ): Promise<WhatsAppTemplate[]>;
	/** Submits a WhatsApp template to Meta for review; needs the right to change settings. */
	createWhatsAppTemplate?( ref: string, template: NewWhatsAppTemplate ): Promise<WhatsAppTemplate>;
	/** Starts signing in to a Google or Microsoft calendar (ref: connect that one again); open url in a window. */
	startCalendarSignIn( provider: 'google' | 'microsoft', ref?: string ): Promise<{ url: string; state: string }>;
	/** The end of a sign-in; null while it runs. */
	calendarSignIn( state: string ): Promise<CalendarSignIn | null>;
	/** The calendar connections of the website (Funnelforms → Integrations); needs the right to change settings. */
	calendarsOverview?(): Promise<CalendarsOverview>;
	/** The calendars of one connected account. */
	accountCalendars?( ref: string ): Promise<CalendarChoice[]>;
	/** Main calendar, checked calendars and owner of a connection; answers the new overview. */
	arrangeCalendar?( ref: string, changes: { calendar?: string; busy?: string[]; owner?: number } ): Promise<CalendarsOverview>;
	/** A/B test figures of the last 30 days; needs the right to see entries. */
	experimentStats( formId: number ): Promise<ExperimentStats[]>;
	/**
	 * Figures of the published form; days as YYYY-MM-DD, the last 30 days without them; detail
	 * 'full' adds the analytics (paths, fields, times); view 'canvas' tells the plugin the analytics
	 * mode of the canvas was opened. Needs the right to see entries.
	 */
	formStats( formId: number, from?: string, to?: string, detail?: 'full', view?: 'canvas' ): Promise<FormStatsReport>;
	/** Hash of a form password for settings.access.password; the password is not stored. */
	passwordHash( password: string ): Promise<string>;
	/** Forms per status and the figures of the last 30 days, for the head of the list. */
	formFigures?(): Promise<FormFigures>;
}

/** Figures of one form over the last 30 days, as the statistics page counts them. */
export interface FormFigure {
	views: number;
	entries: number;
	/** Entries per view; null without views. */
	rate: number | null;
	/** Whether views are measured (the form runs on the new renderer). */
	measured: boolean;
	/** Entries per day, oldest first. */
	series: number[];
}

/** GET stats/forms (docs/api/stats.md). */
export interface FormFigures {
	forms: { total: number; published: number; draft: number; trashed: number };
	/** Null without the right to see entries. */
	figures: {
		days: number;
		views: number;
		entries: number;
		rate: number | null;
		viewsBefore: number;
		entriesBefore: number;
		rateBefore: number | null;
		/** By form ID. */
		forms: Record<string, FormFigure>;
	} | null;
}

/**
 * Key of a lead stage: new, contacted, won and lost (the stages of 5.0), or a stage the site added
 * (GET entries/stages). The column lead_status of the entries.
 */
export type LeadStatus = string;

/** Colours of a lead stage, the tones of the plugin's badges. */
export type LeadStageTone = 'info' | 'warning' | 'success' | 'neutral' | 'danger';

/** A lead stage, a column of the entries board (GET entries/stages, Application\LeadStages). */
export interface LeadStage {
	key: LeadStatus;
	/** The name to show: the site's own, or the standard name in the reader's language. */
	name: string;
	tone: LeadStageTone;
	/** The name is the standard one (stages of 5.0 not renamed). */
	standard?: boolean;
	/** New entries arrive here, so it cannot be deleted. */
	locked?: boolean;
	/** Entries in the stage, the archived ones too. */
	entries?: number;
}

/** A stage to save: new stages come without a key. */
export interface LeadStageInput {
	key?: LeadStatus;
	name: string;
	tone: LeadStageTone;
}

export type PaymentStatus = 'open' | 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded' | 'disputed';

export interface EntryPayment {
	status: PaymentStatus;
	provider: string;
	mode: string;
	interval: string | null;
	amount: number;
	total: number;
	currency: string;
	reference: string | null;
	paidAt: string | null;
	error: string | null;
	/** Paid in a test account (Stripe or Mollie test keys, PayPal sandbox). */
	test?: boolean;
	/** Coupon code the visitor used and the discount it gave, in the currency. */
	coupon?: string | null;
	discount?: number | null;
	/** Stripe subscriptions: active, past_due, canceled, … */
	subscriptionStatus?: string | null;
	/** The payment in the provider's dashboard. */
	dashboardUrl?: string | null;
}

/** An entry as lists show it (docs/api/entries.md). */
export interface EntrySummary {
	id: number;
	uid: string;
	form: { id: number; legacyId: number | null; title: string } | null;
	/** spam: in the spam folder, which other lists leave out; abandoned: a visitor who left after typing the address (Pro). */
	status: 'complete' | 'partial' | 'spam' | 'abandoned';
	/** Why the entry is in the spam folder; null for other entries. */
	spam?: { reasons: SpamReason[] } | null;
	leadStatus: LeadStatus;
	/** The name of the stage as the site calls it. */
	leadStage?: string;
	read: boolean;
	archived: boolean;
	public: boolean;
	tags: string[];
	score: number | null;
	/** Lead value: the estimated order value (settings.valueCalculation). */
	value?: number | null;
	variants: Record<string, string>;
	optIn: { status: 'pending' | 'confirmed'; confirmedAt: string | null } | null;
	/** Visitor who left after typing the address (status abandoned), or the entry such a visitor sent later. */
	abandon?: EntryAbandon | null;
	payment: EntryPayment | null;
	assignedTo: UserRef | null;
	imported: boolean;
	legacyLeadId: number | null;
	locale: string;
	createdAt: string | null;
	completedAt: string | null;
	sourceUrl: string | null;
	/** Kind of device the entry was sent from; empty for imported entries and those from before. */
	device: EntryDevice | '';
	contact: Array<{ label: string; type: string; value: unknown }>;
}

export type EntryDevice = 'desktop' | 'tablet' | 'mobile';

/**
 * Reminders to a visitor who left: waiting (none yet), sent, stopped ("Don't remind me"),
 * recovered (sent the form after a reminder) or completed (sent it before one was due).
 */
export interface EntryAbandon {
	state: 'waiting' | 'sent' | 'stopped' | 'recovered' | 'completed';
	lastStep: { id: string; title: string } | null;
	leftAt: string | null;
	remindedAt: string | null;
	reminders: number;
}

/** What put an entry into the spam folder (SpamCheck::REASONS in the plugin). */
export type SpamReason = 'honeypot' | 'too_fast' | 'captcha_score' | 'akismet' | 'rule_words' | 'rule_email' | 'rule_ip' | 'rule_disposable';

/** How the visitor filled in the form: no IP address, the user agent only as these names. */
export interface EntryVisit {
	device: EntryDevice | '';
	browser: string;
	os: string;
	/** Address the visitor came from, without query. */
	referrer: string;
	/** Seconds from the first click to sending. */
	seconds: number | null;
	/** Seconds per step, in the order of the path. */
	steps: Array<{ node: string; title: string; seconds: number }>;
}

export interface EntryNote {
	id: number;
	text: string;
	author: UserRef | null;
	createdAt: string | null;
}

/** A booked appointment (GET appointments, entry details). */
export interface Appointment {
	id: number;
	entryId: number;
	status: 'confirmed' | 'cancelled' | string;
	/** ISO times, UTC. */
	start: string;
	end: string;
	duration: number;
	/** Time zone of the appointment type. */
	timezone: string;
	type: { ref: string; title: string; kind: 'personal' | 'call' | 'video'; location: string } | null;
	/** People booked; empty when the type books the site. */
	people: UserRef[];
	visitor: { name: string; email: string };
	form: { id: number; title: string } | null;
	/** Confirmed and not started yet. */
	changeable: boolean;
}

export interface EntryDetail extends EntrySummary {
	/** display: the answer with its unit, for sliders and number fields that have one. */
	answers: Array<{ fieldId?: string; label: string; value: unknown; display?: string; fileIds?: number[]; items?: unknown[] }>;
	hiddenFields: Record<string, unknown>;
	calculations: Array<{ calculationId?: string; title: string; value: number | null; formatted: string | null; error: string | null }>;
	page: { title: string | null; url: string | null } | null;
	utm: Record<string, string>;
	consent: Array<{ fieldId: string; checked: boolean; text: string }>;
	files: Array<{ id: number; fieldId: string; name: string; type: string; size: number; url: string }>;
	pdfUrl: string;
	notes: EntryNote[];
	deliveries: Array<{ id: number; action: string; status: string; attempts: number; error: string | null; updatedAt: string | null }>;
	/** Actions that can run again for this entry. */
	actions: Array<{ id: string; kind: string }>;
	appointments: Appointment[];
	visit: EntryVisit | null;
}

export interface EntryFilter {
	form?: number;
	/** spam: the spam folder, abandoned: visitors who left (Pro); the other values leave both out, as does no status. */
	status?: 'complete' | 'partial' | 'spam' | 'abandoned';
	leadStatus?: LeadStatus;
	read?: boolean;
	archived?: boolean;
	search?: string;
	after?: string;
	before?: string;
	tag?: string;
	/** User ID; 0 for entries assigned to nobody. */
	assignedTo?: number;
	payment?: PaymentStatus;
	device?: EntryDevice;
	/** Highest lead value or score first (Pro); newest first without. */
	sort?: 'value' | 'score';
	page?: number;
	perPage?: number;
}

export interface EntryList {
	entries: EntrySummary[];
	total: number;
	pages: number;
}

export interface EntryChanges {
	read?: boolean;
	archived?: boolean;
	public?: boolean;
	leadStatus?: LeadStatus;
	tags?: string[];
	assignedTo?: number;
}

export interface BulkChanges extends Omit<EntryChanges, 'tags'> {
	addTags?: string[];
	removeTags?: string[];
	delete?: boolean;
	/** Takes the entries out of the spam folder and sends what was held back. */
	notSpam?: boolean;
}

/** What the entries screen needs from a backend (the entries API of the plugin). */
export interface EntriesApi {
	entries( filter: EntryFilter ): Promise<EntryList>;
	entry( id: number ): Promise<EntryDetail>;
	updateEntry( id: number, changes: EntryChanges ): Promise<EntrySummary>;
	bulkEntries( ids: number[], changes: BulkChanges ): Promise<{ updated?: number; deleted?: number; released?: number; missing: number[] }>;
	deleteEntry( id: number ): Promise<void>;
	/** Takes an entry out of the spam folder; appointmentTaken when its time was booked meanwhile. */
	notSpam( id: number ): Promise<EntrySummary & { appointmentTaken: boolean }>;
	addNote( id: number, text: string ): Promise<EntryNote>;
	deleteNote( id: number, note: number ): Promise<void>;
	/** Queues an action (mail, webhook, CRM …) of the entry again. */
	resend( id: number, action: string ): Promise<void>;
	/** Asks the payment provider for the status now. */
	checkPayment( id: number ): Promise<EntryPayment>;
	/** Cancels an appointment of the entry; the visitor and the people booked are told. */
	cancelAppointment( id: number, appointment: number ): Promise<Appointment>;
	entryTags(): Promise<Array<{ tag: string; entries: number }>>;
	assignees(): Promise<UserRef[]>;
	/** Counts of the open entries for the head of the list. */
	entryFigures?( query: EntryFiguresQuery ): Promise<EntryFigures>;
	/** The lead stages of the site, with the entries in each (Funnelforms Pro). */
	leadStages?(): Promise<LeadStage[]>;
	/** Saves all stages in their order; moveTo names where the entries of deleted stages go. */
	saveLeadStages?( stages: LeadStageInput[], moveTo?: Record<string, LeadStatus> ): Promise<LeadStage[]>;
}

/** Moments (RFC 3339) the counts start at, and the form to count. */
export interface EntryFiguresQuery {
	form?: number;
	today: string;
	week: string;
	previous: string;
}

/** GET stats/entries: counts over the open (not archived) entries (docs/api/stats.md). */
export interface EntryFigures {
	total: number;
	unread: number;
	today: number | null;
	week: number | null;
	/** The 7 days before the week. */
	previous: number | null;
	/** Open entries per lead stage key. */
	leads: Record<LeadStatus, number>;
	/** Entries in the spam folder. */
	spam?: number;
}

/** A refused request: code and HTTP status from the server, plus what else it answered. */
/** An address the server sent to fix a problem (the Account page), when it is a web address; '' otherwise. */
export function fixUrl( value: unknown ): string {
	return 'string' === typeof value && /^https?:\/\//i.test( value ) ? value : '';
}

export class ApiError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
		readonly data: Record<string, unknown> = {}
	) {
		super( message );
		this.name = 'ApiError';
	}

	/** Who holds the edit lock, when the request failed on it. */
	get lockedBy(): UserRef | null {
		return 'locked' === this.code ? ( this.data.lockedBy as UserRef | undefined ) ?? null : null;
	}
}
