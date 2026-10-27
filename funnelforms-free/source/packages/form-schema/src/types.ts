/**
 * Form document, schema version 1.
 *
 * One document describes a whole form: its steps (nodes), the paths between them (edges),
 * calculations, actions on submit, style and settings. Every revision of a form stores one complete
 * document. The JSON Schema in ../schema/form.v1.schema.json is the normative definition; these
 * types mirror it.
 */

/** Text per locale, e.g. { "de_DE": "Ihr Budget?" }. */
export type Text = Record<string, string>;

/**
 * Text that may contain tokens such as {{field:c_email}}, {{answers}} or {{calc:calc12}}, and
 * {{url:<name>}} for a parameter of the page address (letters, digits, underscore).
 * {{calc:<id>:text}} gives the text of the range the result lies in (Calculation.texts).
 * See TEMPLATE_TOKENS for the full list.
 */
export type Template = Text;

export interface FormDocument {
	schemaVersion: 1;
	id: string;
	title: string;
	locales: { default: string; available: string[] };
	/** Id of the first node. */
	start: string;
	nodes: FormNode[];
	edges: Edge[];
	calculations: Calculation[];
	actions: Action[];
	/** A/B tests: variants decide the start node (whole funnels) and edges (single steps). */
	experiments?: Experiment[];
	style: Style;
	settings: Settings;
	/** PDF of an entry: download in the entry, attachment of mails with attachPdf. */
	pdf?: PdfSettings;
	/** Canvas positions in the builder; never affects behaviour. */
	layout?: { nodes: Record<string, { x: number; y: number }> };
	meta?: DocumentMeta;
}

export type FormNode = StepNode | ContactNode | EndNode;

/** A step with one or more fields. Migrated 3.x forms have exactly one field per step. */
export interface StepNode {
	id: string;
	type: 'step';
	fields: Field[];
	/** Custom JavaScript the site owner attached in 3.x; runs only if the owner allows it. */
	tracking?: { onShow?: string };
	legacy?: { questionId?: number };
}

/** The step that submits the entry (3.x: contact form). */
export interface ContactNode {
	id: string;
	type: 'contact';
	title: Text;
	description: Text;
	submitLabel: Text;
	fields: ContactField[];
	showBottomBar: boolean;
	/** Look of the step, from Funnelforms 4. */
	layout?: ContactLayout;
	tracking?: { onShow?: string; afterSubmit?: string };
	legacy?: { contactFormId?: number };
}

export interface ContactLayout {
	/** Fields per row; in two columns, long fields (text areas, boxes to tick, HTML, captcha, salutation) take the whole row. */
	columns?: { desktop?: 1 | 2; mobile?: 1 | 2 };
	/** Labels only for screen readers; inputs without a placeholder show the label instead. */
	hideLabels?: boolean;
	/** Height of the inputs in px (30 to 120). */
	inputHeight?: number;
	button?: { size?: 's' | 'l'; align?: 'left' | 'center' | 'right' | 'full' };
}

/** End of the funnel: success message and/or redirect. */
export interface EndNode {
	id: string;
	type: 'end';
	success: EndSuccess | null;
	redirect: Redirect | null;
}

/** The thank-you page. */
export interface EndSuccess {
	show: boolean;
	text: Text;
	image?: string;
	/** Large heading above the text. */
	heading?: Text;
	/** A check mark drawn in, or confetti once (left out when the visitor prefers less motion). */
	animation?: 'check' | 'confetti';
	/** A button to a page; the address takes the template tokens. */
	button?: { label: Text; url: Template; newTab?: boolean };
	/** Files to download, from the media library. */
	downloads?: Array<{ label: Text; url: string }>;
	/** The visitor's own answers as a list. */
	showAnswers?: boolean;
}

export interface Redirect {
	url: Template;
	newTab: boolean;
	/** 3.x waits 2000 ms after a submit before redirecting, and 0 ms when reached from a question. */
	delayMs: number;
	/** Query parameters appended to the URL. */
	params: Array<{ name: string; value: Template }>;
	/** Shows the seconds until the redirect and a link to go now. */
	countdown?: boolean;
}

export type Field =
	| ChoiceField
	| DropdownField
	| TextField
	| TextareaField
	| DateField
	| SliderField
	| ContentField
	| FileField
	| AddressField
	| BookingField
	| EmailField
	| PhoneField
	| UrlField
	| NumberField
	| TimeField
	| RatingField
	| SignatureField
	| RepeatField
	| ResultField;

interface FieldBase {
	/** Unique within the document. */
	id: string;
	/**
	 * Variable name used by calculations and integrations. Several fields may share a key
	 * (3.x reused one question in several steps); the most recent answer wins.
	 */
	key: string;
	label: Text;
	description: Text;
	required: boolean;
	/**
	 * Shown only while this condition holds for the answers given before the field: on earlier
	 * steps and in the fields above it in its step. Hidden fields are not required, and their
	 * answers are neither sent nor used by paths and calculations. Answers only, no calculations.
	 */
	showWhen?: Condition;
	tracking?: { onShow?: string };
	legacy?: { questionId?: number };
}

export interface Option {
	id: string;
	label: Text;
	value: string;
	/** icon: classes of the 3.x icon font; image: an address; lucide: the name of a Lucide icon. */
	media?: { kind: 'icon' | 'image' | 'lucide'; value: string };
	/** Number used in calculations when this option is selected. */
	calcValue?: number;
	/**
	 * Knowledge quiz: a right answer. A field with right answers counts 1 in calculations when
	 * exactly they are chosen, else 0 (its calcValues are not used then).
	 */
	correct?: boolean;
	/** Extra value sent with the entry when this option is selected (3.x "hidden field"). */
	hiddenValue?: string;
	/** Personality quiz: points of this option per category id (Quiz.categories). */
	scores?: Record<string, number>;
}

export interface ChoiceField extends FieldBase {
	type: 'choice';
	options: Option[];
	props: {
		multiple: boolean;
		layout: { desktop: 'grid' | 'list' | 'list2'; mobile: 'grid' | 'list' };
		hideIcons: boolean;
		/** Multiple choice: continue automatically once this many options are selected. */
		autoAdvanceAt?: number;
		/** Multiple choice: at least this many options when any is chosen (required: always). */
		minChoices?: number;
		/** Multiple choice: at most this many options; the others are disabled once reached. */
		maxChoices?: number;
		/** Grid layout: answers per row (otherwise as many as fit). */
		columns?: { desktop?: 1 | 2 | 3 | 4; mobile?: 1 | 2 };
		/** Where the icon or image sits; top by default. */
		iconPosition?: 'top' | 'left' | 'right' | 'bottom';
		/** Height of the answers; m by default. */
		size?: 's' | 'm' | 'l';
		/** Images fill the width of their answer. */
		imageFull?: boolean;
	};
}

export interface DropdownField extends FieldBase {
	type: 'dropdown';
	options: Option[];
	props: {
		/** Text while nothing is chosen ("Please choose" by default). */
		placeholder?: Text;
		/** A search box above the options. */
		search?: boolean;
		/** Several options can be chosen. */
		multiple?: boolean;
		minChoices?: number;
		maxChoices?: number;
	};
}

export interface TextField extends FieldBase {
	type: 'text';
	props: {
		placeholder: Text;
		minLength?: number;
		maxLength?: number;
		restrict?: 'letters' | 'digits' | 'birthday';
		/** What the browser may fill in (HTML autocomplete). */
		autocomplete?: AutocompleteToken;
	};
}

/** HTML autocomplete tokens a text field can name. */
export type AutocompleteToken =
	| 'off'
	| 'name'
	| 'given-name'
	| 'family-name'
	| 'organization'
	| 'organization-title'
	| 'street-address'
	| 'address-line1'
	| 'address-line2'
	| 'postal-code'
	| 'address-level2'
	| 'country-name'
	| 'email'
	| 'tel'
	| 'bday'
	| 'url'
	| 'username';

export interface TextareaField extends FieldBase {
	type: 'textarea';
	props: { placeholder: Text; minLength?: number; maxLength?: number; autocomplete?: AutocompleteToken };
}

export interface DateField extends FieldBase {
	type: 'date';
	/** Format tokens dd, mm, yy (four-digit year), separators . - / */
	props: {
		placeholder: Text;
		format: string;
		/** A period: two dates, stored as "<from> – <to>" in the format. */
		range?: boolean;
		/** Only today and later, or only today and earlier. */
		allow?: 'future' | 'past';
		/** Earliest and latest date, YYYY-MM-DD. */
		min?: string;
		max?: string;
	};
}

export interface SliderField extends FieldBase {
	type: 'slider';
	props: {
		min: number;
		max: number;
		step: number;
		start: number;
		unit: { text: Text; position: 'before' | 'after' };
		thousandsSeparator: boolean;
		manualInput: { enabled: boolean; label: Text };
		media?: { kind: 'icon' | 'image'; value: string };
		/** Two handles for a range; the answer is [from, to]. */
		range?: boolean;
		/** Range: where the second handle starts (the maximum by default). */
		startEnd?: number;
		/** Thousands separator when thousandsSeparator is on ("." by default). */
		separator?: '.' | ',' | ' ' | "'";
	};
}

export interface ContentField extends FieldBase {
	type: 'content';
	props: {
		html: Template;
		autoAdvanceMs?: number;
		button: { show: boolean; label: Text };
		/** Loading screen: an animation and changing texts while the step waits autoAdvanceMs. `circle` counts up to 100 %. */
		loader?: { style: 'spinner' | 'bar' | 'dots' | 'circle' | 'search'; messages: Text[] };
		/** Image or video above the text. YouTube and Vimeo load only after a click. */
		media?: ContentMedia;
	};
}

export interface ContentMedia {
	kind: 'image' | 'video';
	/** http(s) address of the image, of a video file, or of a YouTube or Vimeo video; empty while not chosen yet. */
	url: string;
	alt?: Text;
	caption?: Text;
	/** Width in percent of the step (10 to 100); full width without. */
	width?: number;
}

export interface FileField extends FieldBase {
	type: 'file';
	props: {
		dropzoneText: Text;
		maxSizeMb: number;
		maxFiles: number;
		/** MIME types that are not accepted; empty means every type WordPress allows. */
		deniedMimeTypes: string[];
		visibility: 'public' | 'private';
		/** Only these file extensions (lower case, without dot); every allowed type without. */
		allowedExtensions?: string[];
		/** Text below the upload area, e.g. which files fit. */
		hint?: Text;
		/** Small pictures of chosen images. */
		preview?: boolean;
	};
}

export interface AddressField extends FieldBase {
	type: 'address';
	props: {
		zoom: number;
		start: { name: string; lat: number; lng: number };
		combined: boolean;
		showCountry: boolean;
		placesAutocomplete: boolean;
		/** With suggestions: a button that fills the address from the visitor's location. */
		locate?: boolean;
	};
}

export interface BookingField extends FieldBase {
	type: 'booking';
	/** Reference to a booking type (3.x: appointment event). */
	props: { bookingTypeRef: string };
}

/** E-mail address as a step field (3.x had it only in the contact step). */
export interface EmailField extends FieldBase {
	type: 'email';
	props: { placeholder: Text; b2bOnly?: boolean };
}

/**
 * Phone number. Without `country`: 7 to 20 digits with + ( ) / . - and spaces, as typed. With it:
 * a country picker, checked per country and stored in E.164 (+4915112345678).
 */
export interface PhoneField extends FieldBase {
	type: 'phone';
	props: { placeholder: Text; country?: PhoneCountries };
}

/**
 * Country picker of a phone field (step or contact field). Countries are ISO 3166-1 alpha-2
 * codes (DE); the data of each lies in plugin/assets/phone/countries.json.
 */
export interface PhoneCountries {
	/** Country shown first; without it the country of the form's language. */
	default?: string;
	/** Listed on top of the picker. */
	preferred?: string[];
	/** Only numbers of these countries are accepted; all countries without. */
	allowed?: string[];
}

/**
 * Confirming a contact phone field by text message (Funnelforms Pro): props.sms of a `phone`
 * contact field, and of the 3.x type `phone_verification`, which always confirms.
 */
export interface PhoneSms {
	/** SMS connection (Twilio, Bird); legacy:messagebird from 3.x until another is chosen. */
	connectionRef: string;
	/** Sender name or number; Bird takes the sender of its channel. */
	sender?: string;
	/** The text message; {{code}} is the code of six digits. */
	text: Text;
}

/** Web address; https:// is added when the visitor leaves out the scheme. */
export interface UrlField extends FieldBase {
	type: 'url';
	props: { placeholder: Text };
}

/** A number, usable in calculations and conditions like a slider. */
export interface NumberField extends FieldBase {
	type: 'number';
	props: {
		placeholder: Text;
		min?: number;
		max?: number;
		/** Step of the arrows in the browser; any number is accepted. */
		step?: number;
		unit?: { text: Text; position: 'before' | 'after' };
	};
}

/** Time of day as HH:MM (24 hours). */
export interface TimeField extends FieldBase {
	type: 'time';
	props: { min?: string; max?: string; stepMinutes?: number };
}

/** Rating from min (0 or 1) to max as stars or a row of numbers; the value is the number. */
export interface RatingField extends FieldBase {
	type: 'rating';
	props: {
		min: 0 | 1;
		max: number;
		/** `colors`: tiles from red over yellow to green. */
		style: 'stars' | 'numbers' | 'colors';
		lowLabel: Text;
		highLabel: Text;
		/** What the points show instead of their number: faces, or own texts (`labels`). Stars show it below. */
		show?: 'emojis' | 'labels';
		/** Own text per point, from `min` to `max`, for `show: 'labels'`. */
		labels?: Text[];
	};
}

/**
 * Drawn signature, uploaded by the runtime as one PNG (like a file field with one private file).
 * Visitors who cannot draw type their name instead; the runtime writes it into the image.
 */
export interface SignatureField extends FieldBase {
	type: 'signature';
	props: {
		clearLabel: Text;
		typeLabel: Text;
		/** Ink colour (#rrggbb); the text colour of the form without. */
		penColor?: string;
		/** Visitors may also upload a picture of their signature (PNG or JPEG, stored as PNG). */
		upload?: boolean;
	};
}

/** Field types a repeat group may hold. */
export type RepeatItemField = TextField | TextareaField | EmailField | PhoneField | UrlField | NumberField | DateField | TimeField | DropdownField;

/**
 * Fields filled in once per item (e.g. one row per person). The answer is a list of items, each
 * an object of sub-field id to answer; calculations and conditions see the number of items.
 */
export interface RepeatField extends FieldBase {
	type: 'repeat';
	props: {
		/** Items the visitor must fill in; a required group needs at least one. */
		minItems: number;
		maxItems: number;
		addLabel: Text;
		/** Heading of each item; %d is its number. */
		itemLabel: Text;
		/** Ids are unique within the group. */
		fields: RepeatItemField[];
	};
}

/**
 * Live result (Funnelforms Pro): results of calculations, worked out again by the plugin while the
 * visitor answers. Asks nothing; the label is its heading. The formulas stay on the server.
 */
export interface ResultField extends FieldBase {
	type: 'result';
	props: {
		/**
		 * card: a box in the step; sticky: shown on this step and every later one, a bar at the bottom
		 * of the screen on phones, the whole box below the steps on wider screens and beside them
		 * where the form is wide enough.
		 */
		style: 'card' | 'sticky';
		/** The first line is the result, shown large; the others break it down. */
		lines: ResultLine[];
		/** Small print below the results, e.g. "Estimate, VAT included". */
		disclaimer?: Text;
		/**
		 * show (default): the results while the visitor answers. contact: the box shows only that the
		 * result is ready (blurred, with the teaser) until the contact step is sent; the plugin sends no
		 * number of its calculations to the browser before, and thank-you page and mails show it in full.
		 */
		reveal?: 'show' | 'contact';
		/** Line shown while the result is locked; empty for the default text. */
		teaser?: Text;
	};
}

export interface ResultLine {
	/** Calculation whose result the line shows, in its format. */
	calculation: string;
	/** A range: this calculation's result is the upper end ("1.200 – 1.500 €"). */
	to?: string;
	label: Text;
	/** A starting price: "from" in front of the result. */
	from?: boolean;
	/** Text right before and after the result, e.g. " €" for a calculation formatted without a currency. */
	prefix?: string;
	suffix?: string;
	/** Shows the text of the range the result lies in (Calculation.texts) instead of the number. */
	text?: boolean;
}

export type ContactFieldType =
	| 'salutation'
	| 'name'
	| 'email'
	| 'phone'
	| 'phone_verification'
	| 'text'
	| 'consent'
	| 'captcha'
	| 'html'
	/** Choice from a list (`props.options`, `props.placeholder`); stores the option id, shows its label. */
	| 'select'
	/** Text over several lines (`props.placeholder`, `props.maxLength`). */
	| 'textarea'
	/** A box to tick with its own text (`props.html`), e.g. for a newsletter; shown as yes or no. */
	| 'checkbox';

export interface ContactField {
	id: string;
	type: ContactFieldType;
	/** Placeholder name in templates and the key sent to integrations; 3.x field id. */
	key: string;
	label: Text;
	required: boolean;
	/** Phone fields: `country` (PhoneCountries) and `sms` (PhoneSms) besides placeholder and icon. */
	props: Record<string, unknown>;
}

/** A part of an address answer (AddressField): the parts it shows, or the combined line. */
export type AddressPart = 'street' | 'number' | 'zip' | 'city' | 'country' | 'address';

export type Condition =
	| { all: Condition[] }
	| { any: Condition[] }
	/** selected: the option is among the chosen ones; selectedOnly: it is the only chosen one. */
	| { field: string; op: 'selected' | 'selectedOnly'; value: string }
	/** number: the answer as a decimal (default) or whole number, or count: how many answers were chosen (options, files, items). */
	| { field: string; op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq'; value: number; number?: 'float' | 'int' | 'count' }
	/**
	 * equalsText and notEqualsText compare exactly (as 3.x); the others ignore case and the spaces
	 * around the answer. With `part`, the part of an address answer.
	 */
	| { field: string; op: 'equalsText' | 'notEqualsText' | 'contains' | 'notContains' | 'startsWith' | 'endsWith'; value: string; part?: AddressPart }
	/** Whether the field (or the part of an address) has an answer. */
	| { field: string; op: 'filled' | 'empty'; part?: AddressPart }
	/**
	 * A date answer (the start of a period) before, after or on a day: YYYY-MM-DD or today (the
	 * site's time zone), moved by `days`. Read in the format of the date field.
	 */
	| { field: string; op: 'dateBefore' | 'dateAfter' | 'dateOn'; value: string; days?: number }
	/** Result of a calculation, e.g. a lead score. The plugin computes it; the browser asks it for the next step. */
	| { calc: string; op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq'; value: number }
	/** Holds for page views shown this variant of an A/B test. */
	| { experiment: string; variant: string };

/**
 * An A/B test. While running, each page view gets one variant, drawn by weight; when stopped,
 * every visitor gets the winner, or the first variant without one. A variant with `start`
 * begins the form at that node (a test of whole funnels); edges with a variant condition
 * test single steps.
 */
export interface Experiment {
	id: string;
	name?: string;
	/** Paused and stopped tests show everyone the winner, or the first variant. */
	status: 'running' | 'paused' | 'stopped';
	winner?: string;
	/** How long the test runs; without it, until someone stops it. */
	days?: number;
	/** At the end: show everyone the winner (apply, the default), or pause and ask. */
	onEnd?: 'apply' | 'ask';
	/** What a variant must bring more of: sent forms per view (the default) or lead value per view. */
	goal?: 'complete' | 'value';
	/** The plugin's bookkeeping, as YYYY-MM-DD in the site's time zone: first published as running. */
	startedAt?: string;
	/** Day the test was paused; the days paused move its end. */
	pausedAt?: string;
	/** Days the test was paused before. */
	pausedDays?: number;
	/** Days added to the run, by hand or because there were too few views. */
	extended?: number;
	endedAt?: string;
	/** What the figures said when the plugin ended the test. */
	outcome?: 'winner' | 'tie' | 'few_views';
	/** The variant the figures pointed to when the test ended. */
	suggested?: string;
	variants: ExperimentVariant[];
}

export interface ExperimentVariant {
	id: string;
	label?: string;
	/** Share of page views, relative to the other variants' weights. */
	weight: number;
	start?: string;
	/** A test of designs: style tokens this variant shows instead of the form's (colours, corners, spacing). */
	style?: Record<string, string>;
	/** Only in the public document: the CSS variables of `style`, made by the plugin. */
	css?: string;
	/** Test plan: waits with weight 0 and meets the variant kept when the round ends. */
	planned?: true;
	/** Test plan: lost an earlier round; weight 0. */
	retired?: true;
}

/**
 * A path between nodes. For each node the edges are checked in array order and the first one
 * whose condition holds is taken (an edge without `when` always holds); the edge with
 * default=true is taken only when no other edge holds.
 */
export interface Edge {
	id: string;
	from: string;
	to: string;
	when?: Condition;
	default?: boolean;
}

export type ExpressionNode =
	| { num: number }
	| { var: string }
	| { neg: ExpressionNode }
	| { op: '+' | '-' | '*' | '/' | '^' | '%'; args: [ExpressionNode, ExpressionNode] }
	| FunctionNode;

/** Functions of calculations; Domain\Form\Calculator computes them the same way. */
export type CalcFunction = 'round' | 'floor' | 'ceil' | 'abs' | 'sqrt' | 'min' | 'max' | 'sum' | 'avg' | 'if' | 'and' | 'or' | 'not' | 'argmax' | 'clamp' | 'lookup' | 'days' | 'age';

/**
 * Calculations beyond the four basic operations (5.0): functions, comparisons, counts, points of
 * a quiz category and the results of other calculations.
 */
export type FunctionNode =
	/**
	 * round, floor and ceil take the number and optionally the decimal places (negative rounds to
	 * tens, hundreds …); if(condition; then; else) computes only the branch it takes; and, or and
	 * not give 1 or 0; argmax gives the position (from 1) of the largest argument, the first of equal ones.
	 * clamp(x; min; max) keeps x between min and max. lookup(x; limit1; value1; limit2; value2; …;
	 * otherwise) gives the value of the first limit x is less than or equal to, else the last argument
	 * (an even number of arguments, 4 to 50). days(date) counts the days from today to a date
	 * (negative in the past), days(from; to) the days between two dates; age(date) the full years
	 * from a date until today, age(from; to) between two dates. A date nobody gave makes days and age 0.
	 */
	| { fn: CalcFunction; args: ExpressionNode[] }
	/** 1 when the comparison holds, else 0; = and != allow for the rounding of decimals. */
	| { cmp: '<' | '<=' | '>' | '>=' | '=' | '!='; args: [ExpressionNode, ExpressionNode] }
	/** How many answers a field has: chosen options, files or items; 1 for any other answer, 0 without one. */
	| { count: string }
	/** Personality quiz: the points the chosen options of a field give a category (Option.scores). */
	| { score: string; category: string }
	/** The result of another calculation of the form. */
	| { ref: string }
	/**
	 * The date answered in the fields with this key, as days since 1970-01-01 (a period: its first
	 * day; days() of a period alone gives its length). In formulas an argument [key] of days() and
	 * age(), elsewhere date([key]). No date: not a number.
	 */
	| { date: string };

export interface Calculation {
	id: string;
	label: string;
	/** Explicit evaluation tree; variables are field keys, missing answers count as 0. */
	expression: ExpressionNode;
	format: CalculationFormat;
	/** error: the 3.x formula could not be computed; the expression is a 0 placeholder and the runtime shows the calculation error text, as 3.x did. */
	legacy?: { calculationId?: number; formula?: string; ignored?: string; error?: string };
	/**
	 * Texts by range of the result (Funnelforms Pro), e.g. "Beginner" for a score of 0 to 40: the
	 * first range the result lies in gives {{calc:<id>:text}} and live result lines with `text`.
	 */
	texts?: CalculationText[];
}

/** A range of results and its text; from and to belong to the range, one left out leaves it open. */
export interface CalculationText {
	from?: number;
	to?: number;
	text: Text;
}

export interface CalculationFormat {
	decimals: number;
	decimalSeparator: string;
	thousandsSeparator: string;
	/** Text before and after the number, e.g. a currency ("€ " or " €"). */
	prefix?: string;
	suffix?: string;
}

/** Runs when an entry is submitted; `node` limits it to submits through that contact node. */
/** on: when the entry is sent, or once its payment went through (settings.payment). */
/** when: only for entries this condition holds for, e.g. leads from one region to one team (Funnelforms Pro). */
export type Action = { id: string; on: 'submit' | 'paid'; node?: string; when?: Condition } & (
	| { kind: 'email'; config: EmailConfig }
	| { kind: 'autoresponder'; config: EmailConfig & { recipientField?: string; attachmentUrl?: string } }
	/** format: the 3.x payload (default) or "ff4", the payload of Funnelforms 4 (Domain\Entry\Ff4Payload). */
	| { kind: 'webhook'; config: { url: string; format?: 'ff4' } }
	| { kind: 'crm'; config: { provider: string; connectionRef: string; mapping: Record<string, unknown> } }
	| { kind: 'chat'; config: ChatConfig }
	| { kind: 'sms'; config: SmsConfig }
	| { kind: 'whatsapp'; config: WhatsAppConfig }
	| { kind: 'conversion'; config: ConversionConfig }
	| { kind: 'googleAds'; config: GoogleAdsConfig }
);

/**
 * Google Ads conversion. Sent in the browser through the site's Google tag (gtag.js) after the
 * entry is stored, with the value the plugin computed; never queued on the server.
 */
export interface GoogleAdsConfig {
	/** Conversion ID and label, e.g. AW-123456789/AbC-D_efG. */
	sendTo: string;
	valueCalculation?: string;
	currency?: string;
	/** true: only with marketing consent; false: unless the visitor refused. */
	requireConsent: boolean;
	/** Enhanced conversions: e-mail and phone go to the Google tag, only with marketing consent. */
	enhanced?: boolean;
}

/** Server-side conversion, sent only with the consent the platform needs. */
export interface ConversionConfig {
	platform: 'meta' | 'ga4' | 'tiktok';
	connectionRef: string;
	/** Empty for the standard event of the platform. */
	eventName: string;
	/** Calculation whose result is the value of the conversion. */
	valueCalculation?: string;
	currency?: string;
	/** false: send unless the visitor refused, for banners that do not report consent. */
	requireConsent: boolean;
	testEventCode?: string;
	countryCode?: string;
}

/** WhatsApp template message through the customer's WhatsApp Business account. */
export interface WhatsAppConfig {
	connectionRef: string;
	to: Template;
	countryCode?: string;
	/** Name of a template Meta approved. */
	template: string;
	/** Language code of the template, e.g. de or en_US. */
	language: string;
	/** Texts for the placeholders {{1}}, {{2}} … of the template body. */
	parameters: Template[];
}

/** Text message through the customer's SMS provider (Twilio, Bird). */
export interface SmsConfig {
	connectionRef: string;
	/** Numbers, separated by commas; tokens such as {{field:phone}} send to the visitor. */
	to: Template;
	sender: string;
	message: Template;
	/** Country code for numbers entered without one, e.g. 49. */
	countryCode?: string;
}

/** Message about a new entry in Slack or Microsoft Teams; the webhook address lives in the connection. */
export interface ChatConfig {
	service: 'slack' | 'teams';
	connectionRef: string;
	/** Plain text above the answers, with the tokens of mail templates. */
	message: Template;
	showAnswers: boolean;
	showContact: boolean;
}

export interface EmailConfig {
	to: Template;
	cc: Template;
	bcc: Template;
	from: Template;
	fromName: Template;
	replyTo: Template;
	subject: Template;
	body: Template;
	/** Convert line breaks to <br> (3.x default). */
	nl2br: boolean;
	transport: { type: 'wp_mail' } | { type: 'smtp'; connectionRef: string };
	/** Attach the PDF of the entry. */
	attachPdf?: boolean;
	/**
	 * branded: the text inside a mail layout with the colour and logo of the form, answers as a
	 * table; plain or missing: the text as written, as in 3.x.
	 */
	layout?: 'branded' | 'plain';
}

/** Title, intro and footer take the tokens of mail templates; an empty title means the form title. */
export interface PdfSettings {
	title: Template;
	intro: Template;
	footer: Template;
	showAnswers: boolean;
	showContact: boolean;
	showCalculations: boolean;
}

export interface Style {
	/** "classic" reproduces the 3.x look from the stored legacy values. */
	preset: 'default' | 'classic';
	/** Theme the tokens started from (builder); the tokens alone decide the look. */
	theme?: string;
	tokens: Record<string, string>;
	/** CSS of the form, printed after it; changing it needs unfiltered_html. */
	css?: string;
	legacy?: Record<string, string>;
}

export interface Settings {
	/** Language of buttons and messages; empty for the language of the page (WPML, Polylang). */
	uiLocale: string;
	/** percent: the share of the way done is written next to the bar. */
	progressBar: { show: boolean; percent?: boolean };
	loadingAnimation: boolean;
	scrollToTop: { desktop: boolean; mobile: boolean };
	rtl: boolean;
	/** A choice of the form's languages on its first step (forms in several languages). */
	languageSwitch?: boolean;
	autoHeight: boolean;
	iconFont: boolean;
	/** Save incomplete entries step by step. */
	savePartialEntries: boolean;
	/** Visitors may save their answers and continue later with a link. */
	saveProgress?: boolean;
	/** Calculation whose result is the lead score of an entry. */
	scoreCalculation?: string;
	/** Calculation whose result is the estimated order value of a lead (Funnelforms Pro); stored, sorted and sent on with each entry. */
	valueCalculation?: string;
	quiz?: Quiz;
	/** Double opt-in: confirmation link to the address in this e-mail contact field. */
	doubleOptIn?: { field: string; subject: Template; body: Template; confirmation: Template };
	/** Win back visitors who leave: a reminder with a link back to their answers (Funnelforms Pro). */
	abandonment?: Abandonment;
	/** Entries on the website ([funnelforms_entries]): reviews, lists of participants. */
	publicEntries?: PublicEntries;
	/** Payment after the contact step; checked and charged on the server, never sent to visitors. */
	payment?: Payment;
	/** Checked on the server; never part of the document sent to visitors. */
	access?: {
		/** Hash from wp_hash_password(). */
		password?: { hash: string };
		/** The form closes after this many complete entries. */
		maxEntries?: number;
		/** ISO 8601 times of the window in which the form takes entries. */
		opensAt?: string;
		closesAt?: string;
		/** Shown instead of the form while it is closed. */
		closedMessage?: Text;
		/** Only visitors logged in to the website see the form; the others see a link to log in. */
		loginRequired?: boolean;
		/** Shown with the login link; a standard text without. */
		loginMessage?: Text;
	};
	/** Minutes from the start in which the form must be sent: a countdown in the runtime, checked on the server. */
	timeLimit?: { minutes: number; message?: Text };
	/** false: no captcha of the site's spam protection in this form; without it the site's captcha applies. */
	captcha?: boolean;
	/** Delete entries this many days after submission; without it the site's period applies. */
	retentionDays?: number;
	prevLabel?: Text;
	nextLabel?: Text;
	heading?: Text;
}

/**
 * Once a valid address is in `field` and the visitor leaves without sending, one reminder with a
 * link back to the answers goes to it after `delayMinutes`, unless the entry was sent meanwhile.
 * Checked and sent by the plugin (Application\Abandonment); the browser gets field, basis,
 * consentField and notice only.
 */
export interface Abandonment {
	/** E-mail field of the contact step. */
	field: string;
	/** consent: only when the visitor ticked `consentField`; notice: a notice under the e-mail field, with a way to say no. */
	basis: 'consent' | 'notice';
	/** Box to tick (consent or checkbox) of the contact step; needed for basis consent. */
	consentField?: string;
	/** Text under the e-mail field (basis notice); a standard text when empty. */
	notice?: Text;
	/** Minutes after leaving before the reminder goes out (15 to 10080; the builder offers 30, 60, 180 and 1440). */
	delayMinutes: number;
	/** A second reminder this many hours after the first; without it there is only one. */
	secondAfterHours?: number;
	subject: Template;
	/** Tokens of mail templates; {{resume_url}} places the link back, {{unsubscribe_url}} the link to stop reminders. */
	body: Template;
	/** branded (default): the designed mail layout; plain: the text as written. */
	layout?: 'branded' | 'plain';
	/** Also mail the site owner about the abandoned lead when the reminder is due. */
	notifyOwner?: boolean;
}

/**
 * A quiz: a calculation adds up the points of the questions, and the contact steps lead to the
 * result with the highest `min` the points reach. The builder keeps the formula and these edges in
 * step with the questions and results.
 */
export interface Quiz {
	/**
	 * points: answers score their calcValue; knowledge: a question scores 1 when exactly its right
	 * answers are chosen; personality: answers give points to categories (Option.scores) and the
	 * category with the most points decides the result.
	 */
	kind: 'points' | 'knowledge' | 'personality';
	/** Calculation of the points; in a personality quiz, of the position of the leading category (from 1). */
	calculation: string;
	/** End nodes of the results, each shown from `min` points on; in a personality quiz `min` is the position of the result's category. */
	results: Array<{ node: string; min: number; category?: string }>;
	/** Personality quiz: the types a visitor can be, in order; ties go to the first. */
	categories?: Array<{ id: string; label: string }>;
	/** Knowledge quiz: after each question the visitor sees whether the answer was right; the right answers then reach the browser. */
	feedback?: boolean;
}

export interface DocumentMeta {
	legacy?: {
		formId: number;
		migratorVersion: number;
		/** Things the migration noticed, e.g. unreachable paths in 3.x. */
		notes: string[];
	};
	[key: string]: unknown;
}

/** Tokens allowed in templates. */
export const TEMPLATE_TOKENS = [
	'answers',
	'answers_with_hidden',
	/** All contact details of the entry, "label: value". */
	'contact',
	/** The results of the calculations the form shows or uses (helpers only other calculations use left out). */
	'calculations',
	/** The block for the site owner: contact details, results, lead score, page and source. */
	'lead',
	'answers:base64json',
	'legacy:answers_serialized_base64url',
	'entry:id',
	'page:url',
	'page:query',
	'page:title',
	'booking:date',
	'booking:time',
	'booking:name',
	'booking:duration',
	'code',
	'payment:status',
	'payment:amount',
	'payment:reference',
	'quiz:max',
	'entry:date',
	'entry:time',
	'form:title',
	'visit:device',
	'visit:browser',
	'visit:duration',
	'visit:referrer',
	'utm',
	'utm:source',
	'utm:medium',
	'utm:campaign',
	'utm:term',
	'utm:content',
] as const;

/**
 * Entries shown on the website. Only the listed fields are shown (step fields with text, choices
 * or numbers; contact fields name and text), and only entries that were published: by an admin
 * when `approval` is on, otherwise when sent. With `consentField`, an entry is published only when
 * the visitor ticked that consent.
 */
export interface PublicEntries {
	fields: string[];
	approval: boolean;
	consentField?: string;
	/** Names as first name and initial ("Erika M."). */
	shortNames?: boolean;
	showDate?: boolean;
	perPage?: number;
}

/**
 * Payment through the site's own Stripe, PayPal or Mollie account. The plugin computes the amount
 * on the server from the calculation (or takes the fixed amount) and sends the visitor to the
 * provider's payment page; actions with `on: 'paid'` wait until the payment went through.
 */
export interface Payment {
	/** Ref of a payment connection, e.g. `stripe:…`; its type names the provider. */
	connection: string;
	/** In the currency, not in cents. Nothing is charged when it comes to 0 or less. */
	amount: { calculation: string } | { fixed: number };
	/** ISO 4217, e.g. EUR. */
	currency: string;
	/** deposit: depositPercent of the amount; subscription: the amount every interval (Stripe only). */
	mode: 'payment' | 'deposit' | 'subscription';
	depositPercent?: number;
	interval?: 'month' | 'year';
	/** What the visitor pays for; tokens of mail templates allowed. */
	description: Text;
	/** E-mail contact field: fills in the payment page and gets the receipt. */
	emailField?: string;
	/** Only for submits through this contact node. */
	node?: string;
	/** Coupon codes the visitor can enter in `couponField`; checked on the server, ignoring case. */
	coupons?: PaymentCoupon[];
	/** Text field (of a step or the contact step) that takes the coupon code. */
	couponField?: string;
	/** Stripe: the payment page also takes the promotion codes of the Stripe account. */
	promotionCodes?: boolean;
}

/** A discount in percent of the amount, or a fixed amount in the currency. */
export interface PaymentCoupon {
	code: string;
	percent?: number;
	amount?: number;
}
