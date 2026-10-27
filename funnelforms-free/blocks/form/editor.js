/**
 * Editor of the block "Funnelforms" (no build step; uses the editor's own packages).
 *
 * Choosing a form stores its 3.x ID, the id of the shortcode [funnelforms id="…"], or for forms
 * made in the builder their uid ([funnelforms uid="…"]). Forms on the new renderer are previewed
 * live but cannot be clicked, so no test entries are created.
 */
( function ( wp ) {
	'use strict';

	var el = wp.element.createElement;
	var useEffect = wp.element.useEffect;
	var useRef = wp.element.useRef;
	var __ = wp.i18n.__;
	var blockEditor = wp.blockEditor;
	var components = wp.components;
	var ServerSideRender = wp.serverSideRender;
	var forms = ( window.funnelformsBlock && window.funnelformsBlock.forms ) || [];
	// Popups and the corner button are Funnelforms Pro; Free shows the form in the page only.
	var popups = ! window.funnelformsBlock || false !== window.funnelformsBlock.popups;

	function options() {
		return [ { value: '0', label: __( 'Choose a form', 'funnelforms-free' ) } ].concat(
			forms.map( function ( form ) {
				return { value: form.key, label: form.title };
			} )
		);
	}

	function picker( key, setAttributes ) {
		return el( components.SelectControl, {
			label: __( 'Form', 'funnelforms-free' ),
			value: key,
			options: options(),
			onChange: function ( value ) {
				var uid = value.indexOf( '-' ) > 0;
				setAttributes( { formId: uid ? 0 : parseInt( value, 10 ) || 0, formUid: uid ? value : '' } );
			},
			__nextHasNoMarginBottom: true,
			__next40pxDefaultSize: true,
		} );
	}

	/** Whether and how the form pops up: Frontend\\Shortcode::display_attributes(). */
	function Display( props ) {
		var attributes = props.attributes;
		var setAttributes = props.setAttributes;
		var mode = attributes.display || 'inline';
		var palette = blockEditor.useSettings ? blockEditor.useSettings( 'color.palette' )[ 0 ] : [];
		var common = { __nextHasNoMarginBottom: true, __next40pxDefaultSize: true };
		var number = function ( key, label, help, min, max ) {
			return el(
				components.TextControl,
				Object.assign( {}, common, {
					label: label,
					help: help,
					type: 'number',
					min: min,
					max: max,
					value: attributes[ key ] < 0 ? '' : String( attributes[ key ] ),
					onChange: function ( value ) {
						var update = {};
						update[ key ] = '' === value ? -1 : Number( value );
						setAttributes( update );
					},
				} )
			);
		};
		var controls = [
			el(
				components.SelectControl,
				Object.assign( {}, common, {
					key: 'display',
					label: __( 'Display', 'funnelforms-free' ),
					value: mode,
					options: [
						{ value: 'inline', label: __( 'In the page', 'funnelforms-free' ) },
						{ value: 'delay', label: __( 'Popup after a delay', 'funnelforms-free' ) },
						{ value: 'click', label: __( 'Popup on a click', 'funnelforms-free' ) },
						{ value: 'scroll', label: __( 'Popup after scrolling', 'funnelforms-free' ) },
						{ value: 'exit', label: __( 'Popup when the visitor is about to leave', 'funnelforms-free' ) },
						{ value: 'widget', label: __( 'Button in a corner of the page', 'funnelforms-free' ) },
					],
					onChange: function ( value ) {
						setAttributes( { display: value } );
					},
				} )
			),
		];
		if ( 'delay' === mode ) {
			controls.push( number( 'popupDelay', __( 'Delay (seconds)', 'funnelforms-free' ), '', 0 ) );
		}
		if ( 'click' === mode ) {
			controls.push(
				el(
					components.TextControl,
					Object.assign( {}, common, {
						key: 'class',
						label: __( 'CSS class of the buttons or links', 'funnelforms-free' ),
						help: __( 'Give buttons or links this CSS class; a click on them opens the form.', 'funnelforms-free' ),
						value: attributes.popupClickClass || '',
						onChange: function ( value ) {
							setAttributes( { popupClickClass: value } );
						},
					} )
				)
			);
		}
		if ( 'scroll' === mode ) {
			controls.push(
				el(
					components.RangeControl,
					Object.assign( {}, common, {
						key: 'scroll',
						label: __( 'Opens after this share of the page (%)', 'funnelforms-free' ),
						min: 1,
						max: 100,
						value: attributes.popupScroll,
						onChange: function ( value ) {
							setAttributes( { popupScroll: value || 50 } );
						},
					} )
				)
			);
		}
		if ( 'delay' === mode || 'scroll' === mode || 'exit' === mode ) {
			controls.push( number( 'popupPause', __( 'Do not show again for (hours)', 'funnelforms-free' ), __( 'After the visitor closed the popup. 0 shows it on every page view. After an entry it stays closed for 30 days.', 'funnelforms-free' ), 0, 8760 ) );
		}
		if ( 'widget' === mode ) {
			controls.push(
				el(
					components.SelectControl,
					Object.assign( {}, common, {
						key: 'corner',
						label: __( 'Corner', 'funnelforms-free' ),
						value: attributes.widgetPosition,
						options: [
							{ value: 'bottom-right', label: __( 'Bottom right', 'funnelforms-free' ) },
							{ value: 'bottom-left', label: __( 'Bottom left', 'funnelforms-free' ) },
							{ value: 'top-right', label: __( 'Top right', 'funnelforms-free' ) },
							{ value: 'top-left', label: __( 'Top left', 'funnelforms-free' ) },
						],
						onChange: function ( value ) {
							setAttributes( { widgetPosition: value } );
						},
					} )
				),
				el(
					components.TextControl,
					Object.assign( {}, common, {
						key: 'text',
						label: __( 'Text of the button', 'funnelforms-free' ),
						placeholder: __( 'Get in touch', 'funnelforms-free' ),
						value: attributes.widgetText || '',
						onChange: function ( value ) {
							setAttributes( { widgetText: value } );
						},
					} )
				),
				el( components.BaseControl, Object.assign( {}, common, { key: 'color', label: __( 'Colour of the button', 'funnelforms-free' ), help: __( 'Empty for the accent colour of the form.', 'funnelforms-free' ) } ),
					el( components.ColorPalette, {
						colors: palette || [],
						value: attributes.widgetColor || undefined,
						disableCustomColors: false,
						clearable: true,
						onChange: function ( value ) {
							setAttributes( { widgetColor: value && /^#[0-9a-f]{3,8}$/i.test( value ) ? value : '' } );
						},
					} )
				),
				el(
					components.SelectControl,
					Object.assign( {}, common, {
						key: 'animation',
						label: __( 'Animation', 'funnelforms-free' ),
						value: attributes.widgetAnimation || '',
						options: [
							{ value: '', label: __( 'None', 'funnelforms-free' ) },
							{ value: 'pulse', label: __( 'Pulse', 'funnelforms-free' ) },
							{ value: 'bounce', label: __( 'Bounce', 'funnelforms-free' ) },
							{ value: 'shake', label: __( 'Shake', 'funnelforms-free' ) },
						],
						onChange: function ( value ) {
							setAttributes( { widgetAnimation: value } );
						},
					} )
				)
			);
		}
		if ( 'inline' !== mode ) {
			controls.push( el( 'p', { key: 'note', className: 'components-base-control__help' }, __( 'The editor shows the form itself; it pops up on the page.', 'funnelforms-free' ) ) );
		}
		return el( components.PanelBody, { title: __( 'Display', 'funnelforms-free' ), initialOpen: 'inline' !== mode }, controls );
	}

	/** Starts the runtime on the previewed markup, inside the editor canvas. */
	function Preview( props ) {
		var box = useRef( null );
		useEffect( function () {
			var node = box.current;
			if ( ! node ) {
				return undefined;
			}
			var view = node.ownerDocument.defaultView;
			node.setAttribute( 'inert', '' );
			var start = function () {
				if ( view && view.funnelforms ) {
					view.funnelforms.mount( node );
				}
			};
			var observer = new view.MutationObserver( start );
			observer.observe( node, { childList: true, subtree: true } );
			start();
			return function () {
				observer.disconnect();
			};
		}, [] );
		return el(
			'div',
			{ ref: box, className: 'ffx-block-preview' },
			el( ServerSideRender, { block: 'funnelforms/form', attributes: props.attributes } )
		);
	}

	wp.blocks.registerBlockType( 'funnelforms/form', {
		edit: function ( props ) {
			var formId = props.attributes.formId || 0;
			var formUid = props.attributes.formUid || '';
			var key = formUid || String( formId );
			var blockProps = blockEditor.useBlockProps();
			var inspector = el(
				blockEditor.InspectorControls,
				null,
				el( components.PanelBody, { title: __( 'Form', 'funnelforms-free' ) }, picker( key, props.setAttributes ) ),
				popups ? el( Display, { attributes: props.attributes, setAttributes: props.setAttributes } ) : null
			);
			if ( ! formId && ! formUid ) {
				return el(
					'div',
					blockProps,
					inspector,
					el(
						components.Placeholder,
						{
							icon: 'feedback',
							label: 'Funnelforms',
							instructions: forms.length
								? __( 'Choose the form to show here.', 'funnelforms-free' )
								: __( 'No forms yet. Create one in Funnelforms first.', 'funnelforms-free' ),
						},
						forms.length ? picker( key, props.setAttributes ) : null
					)
				);
			}
			return el( 'div', blockProps, inspector, el( Preview, { attributes: { formId: formId, formUid: formUid, editorPreview: true } } ) );
		},
		save: function () {
			return null;
		},
	} );
} )( window.wp );
