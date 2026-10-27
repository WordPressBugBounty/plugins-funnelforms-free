/**
 * Contact step extras from Funnelforms 4: the look of the step and the answers of a list.
 */
import React from 'react';
import type { ContactField, ContactLayout, ContactNode, Text } from '@funnelforms/form-schema';
import { editText, setText } from '../languages';
import { useEnv } from './context';
import { __ } from './i18n';
import { LinesInput } from './texts';
import { ChoiceTiles, Group, NumberInput, Sketch, Toggle } from './ui';

type Option = { id: string; label: Text };

/** Answers of a list in the contact step, one per line. A translation only changes the texts. */
export function ContactOptions( { field, edit }: { field: ContactField; edit: ( recipe: ( f: ContactField ) => void, key?: string ) => void } ) {
	const { ctx, lang } = useEnv();
	const options = ( Array.isArray( field.props.options ) ? field.props.options : [] ) as Option[];
	return (
		<LinesInput
			label={ __( 'Answers', 'funnelforms-pro' ) }
			hint={ __( 'One answer per line.', 'funnelforms-pro' ) }
			lines={ options.map( ( o ) => editText( o.label, lang, ctx.locale ) ) }
			resetKey={ field.id + lang }
			onLines={ ( lines ) =>
				edit( ( f ) => {
					const list = ( Array.isArray( f.props.options ) ? f.props.options : [] ) as Option[];
					if ( lang !== ctx.locale ) {
						list.forEach( ( o, i ) => setText( o.label, lang, lines[ i ] ?? '', ctx.locale ) );
						return;
					}
					const taken = new Set( list.map( ( o ) => o.id ) );
					let n = list.length;
					f.props.options = lines.map( ( line, i ): Option => {
						const known = list[ i ];
						if ( known ) {
							setText( known.label, lang, line, ctx.locale );
							return known;
						}
						while ( taken.has( `o${ ++n }` ) );
						taken.add( `o${ n }` );
						return { id: `o${ n }`, label: { [ lang ]: line } };
					} );
				}, 'options' )
			}
		/>
	);
}

/** Columns, labels, input height and the button of a contact step. */
export function ContactLayoutProps( { node, change }: { node: ContactNode; change: ( recipe: ( layout: ContactLayout ) => void, key: string ) => void } ) {
	const layout = node.layout ?? {};
	const columns = ( device: 'desktop' | 'mobile' ) => ( v: string ): void =>
		change( ( l ) => {
			const c = { ...l.columns };
			if ( '2' === v ) {
				c[ device ] = 2;
			} else {
				Reflect.deleteProperty( c, device );
			}
			if ( Object.keys( c ).length ) {
				l.columns = c;
			} else {
				delete l.columns;
			}
		}, 'columns.' + device );
	const button = ( key: 'size' | 'align' ) => ( v: string ): void =>
		change( ( l ) => {
			const b = { ...l.button } as Record<string, string>;
			if ( '' === v ) {
				Reflect.deleteProperty( b, key );
			} else {
				b[ key ] = v;
			}
			if ( Object.keys( b ).length ) {
				l.button = b as ContactLayout[ 'button' ];
			} else {
				delete l.button;
			}
		}, 'button.' + key );
	const perRow = [
		{ value: '1', label: __( 'One field per row', 'funnelforms-pro' ), icon: <FieldsSketch columns={ 1 } /> },
		{ value: '2', label: __( 'Two fields per row', 'funnelforms-pro' ), icon: <FieldsSketch columns={ 2 } /> },
	];
	return (
		<Group title={ __( 'Look of the contact step', 'funnelforms-pro' ) }>
			<ChoiceTiles label={ __( 'On large screens', 'funnelforms-pro' ) } value={ String( layout.columns?.desktop ?? 1 ) } columns={ 2 } options={ perRow } onChange={ columns( 'desktop' ) } />
			<ChoiceTiles label={ __( 'On phones', 'funnelforms-pro' ) } value={ String( layout.columns?.mobile ?? 1 ) } columns={ 2 } options={ perRow } onChange={ columns( 'mobile' ) } />
			<ChoiceTiles
				label={ __( 'Button position', 'funnelforms-pro' ) }
				value={ layout.button?.align ?? '' }
				columns={ 4 }
				options={ [
					{ value: '', label: __( 'Full width', 'funnelforms-pro' ), icon: <ButtonSketch x={ 6 } width={ 36 } /> },
					{ value: 'left', label: __( 'On the left', 'funnelforms-pro' ), icon: <ButtonSketch x={ 6 } width={ 16 } /> },
					{ value: 'center', label: __( 'In the centre', 'funnelforms-pro' ), icon: <ButtonSketch x={ 16 } width={ 16 } /> },
					{ value: 'right', label: __( 'On the right', 'funnelforms-pro' ), icon: <ButtonSketch x={ 26 } width={ 16 } /> },
				] }
				onChange={ button( 'align' ) }
			/>
			<ChoiceTiles
				label={ __( 'Button size', 'funnelforms-pro' ) }
				value={ layout.button?.size ?? '' }
				options={ [
					{ value: 's', label: __( 'Small', 'funnelforms-pro' ), icon: <ButtonSketch x={ 16 } width={ 16 } height={ 7 } /> },
					{ value: '', label: __( 'Normal', 'funnelforms-pro' ), icon: <ButtonSketch x={ 13 } width={ 22 } height={ 10 } /> },
					{ value: 'l', label: __( 'Large', 'funnelforms-pro' ), icon: <ButtonSketch x={ 9 } width={ 30 } height={ 14 } /> },
				] }
				onChange={ button( 'size' ) }
			/>
			<Toggle
				label={ __( 'Hide labels', 'funnelforms-pro' ) }
				hint={ __( 'Inputs show the label as placeholder; screen readers still read it.', 'funnelforms-pro' ) }
				checked={ true === layout.hideLabels }
				onChange={ ( v ) =>
					change( ( l ) => {
						if ( v ) {
							l.hideLabels = true;
						} else {
							delete l.hideLabels;
						}
					}, 'hideLabels' )
				}
			/>
			<NumberInput
				label={ __( 'Height of the inputs (px)', 'funnelforms-pro' ) }
				value={ layout.inputHeight }
				min={ 30 }
				max={ 120 }
				onChange={ ( v ) =>
					change( ( l ) => {
						if ( undefined === v ) {
							delete l.inputHeight;
						} else {
							l.inputHeight = Math.min( 120, Math.max( 30, Math.round( v ) ) );
						}
					}, 'inputHeight' )
				}
			/>
		</Group>
	);
}

/* Small drawings of the contact step for the tiles of the properties panel. */

function FieldsSketch( { columns }: { columns: 1 | 2 } ) {
	return (
		<Sketch>
			{ 1 === columns ? (
				<>
					<rect x="6" y="6" width="36" height="6" rx="2" />
					<rect x="6" y="15" width="36" height="6" rx="2" />
					<rect x="6" y="24" width="36" height="3" rx="1.5" fill="currentColor" />
				</>
			) : (
				<>
					<rect x="6" y="6" width="17" height="6" rx="2" />
					<rect x="25" y="6" width="17" height="6" rx="2" />
					<rect x="6" y="15" width="17" height="6" rx="2" />
					<rect x="25" y="15" width="17" height="6" rx="2" />
					<rect x="6" y="24" width="36" height="3" rx="1.5" fill="currentColor" />
				</>
			) }
		</Sketch>
	);
}

function ButtonSketch( { x, width, height = 8 }: { x: number; width: number; height?: number } ) {
	return (
		<Sketch>
			<path d="M6 7h36" />
			<rect x={ x } y={ 20 - height / 2 } width={ width } height={ height } rx="2.5" fill="currentColor" />
		</Sketch>
	);
}
