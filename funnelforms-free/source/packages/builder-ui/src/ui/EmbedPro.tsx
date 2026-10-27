/**
 * The ways to embed that only Funnelforms Pro has: a popup, a button in a corner, and the embed
 * code for websites outside WordPress. Only the Pro build reaches this module (Embed.tsx).
 */
import React from 'react';
import { cssClass, cssSize, frameCode, HEIGHT_UNITS, popupShortcode, widgetShortcode, WIDTH_UNITS, type Corner, type EmbedConfig, type FrameSettings, type PopupSettings, type PopupTrigger, type WidgetAnimation, type WidgetSettings } from '../embed';
import { useBuilder } from './context';
import { CodeBox, Steps, type EmbedMethod } from './EmbedParts';
import { __, sprintf } from './i18n';
import { ColorInput, Notice, NumberInput, Select, TextInput, Toggle } from './ui';

interface Props {
	method: Exclude<EmbedMethod, 'inline' | 'link'>;
	config: EmbedConfig | null;
	popup: PopupSettings;
	onPopup: ( popup: PopupSettings ) => void;
	widget: WidgetSettings;
	onWidget: ( widget: WidgetSettings ) => void;
	frame: FrameSettings;
	onFrame: ( frame: FrameSettings ) => void;
}

export function EmbedProPanel( props: Props ) {
	switch ( props.method ) {
		case 'popup':
			return <PopupPanel popup={ props.popup } onPopup={ props.onPopup } />;
		case 'widget':
			return <WidgetPanel widget={ props.widget } onWidget={ props.onWidget } />;
		default:
			return <FramePanel config={ props.config } frame={ props.frame } onFrame={ props.onFrame } />;
	}
}

/** The block and the Elementor widget offer the same under Display. */
function blockNote(): string {
	return __( 'In the block "Funnelforms" or the Elementor widget you choose the same under Display, without a shortcode.', 'funnelforms-pro' );
}

function PopupPanel( { popup, onPopup }: { popup: PopupSettings; onPopup: ( popup: PopupSettings ) => void } ) {
	const form = useBuilder( ( s ) => s.form );
	if ( ! form ) {
		return null;
	}
	const set = ( patch: Partial<PopupSettings> ): void => onPopup( { ...popup, ...patch } );
	const triggers: Array<{ value: PopupTrigger; label: string }> = [
		{ value: 'delay', label: __( 'Popup after a delay', 'funnelforms-pro' ) },
		{ value: 'click', label: __( 'Popup on a click', 'funnelforms-pro' ) },
		{ value: 'scroll', label: __( 'Popup after scrolling', 'funnelforms-pro' ) },
		{ value: 'exit', label: __( 'Popup when the visitor is about to leave', 'funnelforms-pro' ) },
	];
	const automatic = 'click' !== popup.trigger;
	const needsNew = 'legacy' === form.renderer && ( 'scroll' === popup.trigger || 'exit' === popup.trigger );
	const cls = cssClass( popup.clickClass ) || 'funnelforms-open';
	return (
		<>
			<div className="ffxb-embed__settings">
				<div className="ffxb-embed__grid">
					<Select label={ __( 'Opens', 'funnelforms-pro' ) } value={ popup.trigger } options={ triggers } onChange={ ( trigger ) => set( { trigger } ) } />
					{ 'delay' === popup.trigger ? <NumberInput label={ __( 'Delay (seconds)', 'funnelforms-pro' ) } value={ popup.delay } min={ 0 } onChange={ ( v ) => set( { delay: v ?? 0 } ) } /> : null }
					{ 'click' === popup.trigger ? <TextInput label={ __( 'CSS class of the buttons or links', 'funnelforms-pro' ) } value={ popup.clickClass } onChange={ ( clickClass ) => set( { clickClass } ) } /> : null }
					{ 'scroll' === popup.trigger ? <NumberInput label={ __( 'Opens after this share of the page (%)', 'funnelforms-pro' ) } value={ popup.scroll } min={ 1 } max={ 100 } onChange={ ( v ) => set( { scroll: v ?? 50 } ) } /> : null }
				</div>
				{ automatic ? (
					<NumberInput
						label={ __( 'Do not show again for (hours)', 'funnelforms-pro' ) }
						hint={ __( 'After the visitor closed the popup. 0 shows it on every page view. After an entry it stays closed for 30 days.', 'funnelforms-pro' ) }
						value={ popup.pause }
						min={ 0 }
						max={ 8760 }
						onChange={ ( v ) => set( { pause: v ?? 0 } ) }
					/>
				) : null }
				{ needsNew ? <Notice tone="warning">{ __( 'This form still runs on Funnelforms 3, which shows it in the page instead. Scrolling and leaving the page work once it uses the new renderer.', 'funnelforms-pro' ) }</Notice> : null }
			</div>
			<CodeBox label={ __( 'Shortcode', 'funnelforms-pro' ) } code={ popupShortcode( form.shortcode, popup ) } />
			<Steps
				steps={ [
					__( 'Copy the shortcode.', 'funnelforms-pro' ),
					__( 'Paste it into the page where the popup should open, anywhere in the content.', 'funnelforms-pro' ),
					'click' === popup.trigger ? sprintf( __( 'Give the buttons or links that open the form the CSS class %s.', 'funnelforms-pro' ), cls ) : __( 'Save the page. The popup opens by itself.', 'funnelforms-pro' ),
					blockNote(),
				] }
			/>
		</>
	);
}

function WidgetPanel( { widget, onWidget }: { widget: WidgetSettings; onWidget: ( widget: WidgetSettings ) => void } ) {
	const form = useBuilder( ( s ) => s.form );
	if ( ! form ) {
		return null;
	}
	const set = ( patch: Partial<WidgetSettings> ): void => onWidget( { ...widget, ...patch } );
	const corners: Array<{ value: Corner; label: string }> = [
		{ value: 'bottom-right', label: __( 'Bottom right', 'funnelforms-pro' ) },
		{ value: 'bottom-left', label: __( 'Bottom left', 'funnelforms-pro' ) },
		{ value: 'top-right', label: __( 'Top right', 'funnelforms-pro' ) },
		{ value: 'top-left', label: __( 'Top left', 'funnelforms-pro' ) },
	];
	const animations: Array<{ value: WidgetAnimation; label: string }> = [
		{ value: '', label: __( 'None', 'funnelforms-pro' ) },
		{ value: 'pulse', label: __( 'Pulse', 'funnelforms-pro' ) },
		{ value: 'bounce', label: __( 'Bounce', 'funnelforms-pro' ) },
		{ value: 'shake', label: __( 'Shake', 'funnelforms-pro' ) },
	];
	return (
		<>
			<div className="ffxb-embed__settings">
				{ 'legacy' === form.renderer ? <Notice tone="warning">{ __( 'This form still runs on Funnelforms 3, which shows it in the page instead. The button works once it uses the new renderer.', 'funnelforms-pro' ) }</Notice> : null }
				<div className="ffxb-embed__grid">
					<Select label={ __( 'Corner', 'funnelforms-pro' ) } value={ widget.position } options={ corners } onChange={ ( position ) => set( { position } ) } />
					<Select label={ __( 'Animation', 'funnelforms-pro' ) } value={ widget.animation } options={ animations } onChange={ ( animation ) => set( { animation } ) } />
					<TextInput label={ __( 'Text of the button', 'funnelforms-pro' ) } value={ widget.text } placeholder={ __( 'Get in touch', 'funnelforms-pro' ) } onChange={ ( text ) => set( { text } ) } />
					<ColorInput label={ __( 'Colour of the button', 'funnelforms-pro' ) } value={ widget.color } hex={ /^#[0-9a-f]{6}$/i.test( widget.color ) ? widget.color : '#6a30f5' } onChange={ ( color ) => set( { color } ) } />
				</div>
				<p className="ffxb-hint">{ __( 'Empty for the accent colour of the form.', 'funnelforms-pro' ) }</p>
			</div>
			<CodeBox label={ __( 'Shortcode', 'funnelforms-pro' ) } code={ widgetShortcode( form.shortcode, widget ) } />
			<Steps
				steps={ [
					__( 'Copy the shortcode.', 'funnelforms-pro' ),
					__( 'Paste it into every page that should show the button, for example in a widget area of the footer for the whole website.', 'funnelforms-pro' ),
					__( 'Save. The button appears in its corner and opens the form.', 'funnelforms-pro' ),
					blockNote(),
				] }
			/>
		</>
	);
}

function FramePanel( { config, frame, onFrame }: { config: EmbedConfig | null; frame: FrameSettings; onFrame: ( frame: FrameSettings ) => void } ) {
	const form = useBuilder( ( s ) => s.form );
	const title = useBuilder( ( s ) => s.doc?.title ?? '' );
	if ( ! form ) {
		return null;
	}
	if ( ! config ) {
		return <Notice tone="warning">{ __( 'The embed code for other websites is not available on this website.', 'funnelforms-pro' ) }</Notice>;
	}
	const set = ( patch: Partial<FrameSettings> ): void => onFrame( { ...frame, ...patch } );
	const widthOk = null !== cssSize( frame.width, WIDTH_UNITS );
	const heightOk = null !== cssSize( frame.height, HEIGHT_UNITS );
	return (
		<>
			<div className="ffxb-embed__settings">
				{ 'legacy' === form.renderer ? <Notice tone="warning">{ __( 'This form still runs on Funnelforms 3. The embed code shows it once it uses the new renderer.', 'funnelforms-pro' ) }</Notice> : null }
				<div className="ffxb-embed__grid">
					<TextInput label={ __( 'Width', 'funnelforms-pro' ) } value={ frame.width } onChange={ ( width ) => set( { width } ) } hint={ widthOk ? sprintf( __( 'Supports: %s', 'funnelforms-pro' ), WIDTH_UNITS.join( ', ' ) ) : __( 'A number with %, px, rem or vw, such as 100%.', 'funnelforms-pro' ) } />
					<TextInput label={ __( 'Height', 'funnelforms-pro' ) } value={ frame.height } onChange={ ( height ) => set( { height } ) } hint={ heightOk ? sprintf( __( 'Supports: %s', 'funnelforms-pro' ), HEIGHT_UNITS.join( ', ' ) ) : __( 'A number with px, %, rem or vh, such as 600px.', 'funnelforms-pro' ) } />
				</div>
				<Toggle label={ __( 'Automatic height', 'funnelforms-pro' ) } checked={ frame.autoHeight } onChange={ ( autoHeight ) => set( { autoHeight } ) } hint={ __( 'The frame takes the height of each step; the height above is the start.', 'funnelforms-pro' ) } />
			</div>
			<CodeBox label={ __( 'Embed code', 'funnelforms-pro' ) } code={ frameCode( config, form.uid, title, frame ) } />
			{ config.domains.length ? (
				<Notice tone="info">
					{ sprintf( __( 'Only these websites may show your forms: %s.', 'funnelforms-pro' ), config.domains.join( ', ' ) ) }{ ' ' }
					{ config.settingsUrl ? (
						<a className="ffxb-link" href={ config.settingsUrl }>
							{ __( 'Change the list', 'funnelforms-pro' ) }
						</a>
					) : null }
				</Notice>
			) : null }
			<Steps
				steps={ [
					__( 'Copy the embed code.', 'funnelforms-pro' ),
					__( 'Paste it into the HTML of the other website where the form should appear, for example in an HTML or code block.', 'funnelforms-pro' ),
					__( 'Publish the page. The form loads from this WordPress website, and entries arrive here as usual.', 'funnelforms-pro' ),
				] }
			/>
		</>
	);
}
