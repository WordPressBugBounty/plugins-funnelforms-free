/**
 * Contact step extras: the look of the step and the answers of a list (from Funnelforms 4), what
 * a text field accepts and which salutations visitors can choose (from Funnelforms 3).
 */
import React from 'react';
import type { ContactField, ContactLayout, ContactNode, Text } from '@funnelforms/form-schema';
import { editText, setText } from '../languages';
import { useEnv } from './context';
import { __ } from './i18n';
import { LinesInput } from './texts';
import { ChoiceTiles, Group, Notice, NumberInput, Select, Sketch, TextInput, Toggle } from './ui';

type Option = { id: string; label: Text };

type ContactEdit = ( recipe: ( f: ContactField ) => void, key?: string ) => void;

/**
 * Masks the new renderer applies (as runtime maskSupported and Domain\Form\InputMask): 9 a digit,
 * a a letter, * a letter or digit, everything else as typed. Other masks keep the form on 3.x.
 */
export function maskWorks( mask: string ): boolean {
	return '' !== mask && ! /[[\]{}()|\\#&b-zA-Z]/.test( mask );
}

/** Whether a pattern is a regular expression the browser understands (runtime and server add ^ and $). */
export function patternWorks( pattern: string ): boolean {
	try {
		new RegExp( `^(?:${ pattern })$`, 'u' );
		return true;
	} catch {
		return false;
	}
}

/** What a text field of the contact step accepts: length, numbers only, a pattern, an input mask. */
export function ContactTextProps( { field, edit, readOnly }: { field: ContactField; edit: ContactEdit; readOnly: boolean } ) {
	const props = field.props;
	const set = ( key: string, value: unknown ): void =>
		edit( ( f ) => {
			const p = f.props as Record<string, unknown>;
			if ( undefined === value || '' === value ) {
				Reflect.deleteProperty( p, key );
			} else {
				p[ key ] = value;
			}
		}, 'props.' + key );
	const pattern = typeof props.pattern === 'string' ? props.pattern : '';
	const mask = typeof props.mask === 'string' ? props.mask : '';
	return (
		<details className="ffxb-advanced" open={ '' !== pattern || '' !== mask || undefined !== props.minLength || undefined !== props.maxLength || 'number' === props.inputType }>
			<summary>{ __( 'Check the input', 'funnelforms-pro' ) }</summary>
			<div className="ffxb-pair">
				<NumberInput label={ __( 'Minimum length', 'funnelforms-pro' ) } value={ typeof props.minLength === 'number' ? props.minLength : undefined } min={ 0 } disabled={ readOnly } onChange={ ( v ) => set( 'minLength', v ) } />
				<NumberInput label={ __( 'Maximum length', 'funnelforms-pro' ) } value={ typeof props.maxLength === 'number' && props.maxLength > 0 ? props.maxLength : undefined } min={ 1 } disabled={ readOnly } onChange={ ( v ) => set( 'maxLength', v ) } />
			</div>
			<Select<string>
				label={ __( 'Allowed input', 'funnelforms-pro' ) }
				value={ 'number' === props.inputType ? 'number' : 'text' }
				disabled={ readOnly }
				options={ [
					{ value: 'text', label: __( 'Anything', 'funnelforms-pro' ) },
					{ value: 'number', label: __( 'A number', 'funnelforms-pro' ) },
				] }
				onChange={ ( v ) => set( 'inputType', 'number' === v ? 'number' : undefined ) }
			/>
			<TextInput
				label={ __( 'Input mask', 'funnelforms-pro' ) }
				value={ mask }
				placeholder="99999"
				hint={ __( '9 stands for a digit, a for a letter, * for a letter or digit; everything else is added as typed, e.g. 99999 for a postcode or DE99 9999 9999 9999 9999 99 for an IBAN.', 'funnelforms-pro' ) }
				onChange={ ( v ) => set( 'mask', v ) }
			/>
			{ '' !== mask && ! maskWorks( mask ) ? <Notice tone="warning">{ __( 'The new form display cannot apply this mask, so the form stays on Funnelforms 3. Use only 9, a, * and other characters that are added as typed.', 'funnelforms-pro' ) }</Notice> : null }
			<TextInput
				label={ __( 'Pattern (regular expression)', 'funnelforms-pro' ) }
				value={ pattern }
				placeholder="[0-9]{5}"
				hint={ __( 'For experts: the whole input must match, e.g. [0-9]{5} for a German postcode.', 'funnelforms-pro' ) }
				onChange={ ( v ) => set( 'pattern', v ) }
			/>
			{ '' !== pattern && ! patternWorks( pattern ) ? <Notice tone="warning">{ __( 'This pattern is not a valid regular expression, so it does not check anything.', 'funnelforms-pro' ) }</Notice> : null }
		</details>
	);
}

/** Salutations visitors can choose; at least one stays. */
export function SalutationProps( { field, edit, readOnly }: { field: ContactField; edit: ContactEdit; readOnly: boolean } ) {
	const allow = ( field.props.allow ?? {} ) as Record<string, boolean>;
	const all: Array<[ string, string ]> = [
		[ 'male', __( 'Mr.', 'funnelforms-pro' ) ],
		[ 'female', __( 'Ms.', 'funnelforms-pro' ) ],
		[ 'diverse', __( 'Diverse', 'funnelforms-pro' ) ],
		[ 'company', __( 'Company', 'funnelforms-pro' ) ],
	];
	const shown = all.filter( ( [ key ] ) => false !== allow[ key ] ).length;
	return (
		<Group title={ __( 'Salutations to choose from', 'funnelforms-pro' ) }>
			{ all.map( ( [ key, label ] ) => {
				const on = false !== allow[ key ];
				return (
					<Toggle
						key={ key }
						label={ label }
						checked={ on }
						disabled={ readOnly || ( on && shown <= 1 ) }
						onChange={ ( v ) =>
							edit( ( f ) => {
								const next = { ...( ( f.props.allow ?? {} ) as Record<string, boolean> ) };
								if ( v ) {
									Reflect.deleteProperty( next, key );
								} else {
									next[ key ] = false;
								}
								if ( Object.values( next ).some( ( x ) => false === x ) ) {
									f.props.allow = next;
								} else {
									delete f.props.allow;
								}
							}, 'props.allow' )
						}
					/>
				);
			} ) }
		</Group>
	);
}

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
