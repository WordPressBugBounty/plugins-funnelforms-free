/**
 * Repeat groups: how many items visitors fill in, the heading of each item, the text of the add
 * button, and the fields each item asks for, with their type, question, placeholder, whether they
 * are required and the settings of their type.
 */
import React, { useState } from 'react';
import type { DateField, DropdownField, Field, NumberField, RepeatField, RepeatItemField, StepNode, TextareaField, TextField, TimeField } from '@funnelforms/form-schema';
import { addRepeatField, moveRepeatField, newId, removeRepeatField, REPEAT_FIELD_TYPES, setRepeatFieldType, text, type RepeatFieldType } from '../document';
import { editText, setText } from '../languages';
import type { Edit } from './Answers';
import { stepFieldName } from './catalog';
import { useEnv } from './context';
import { __ } from './i18n';
import { PhoneCountryProps } from './PhoneProps';
import { DateProps, NumberProps, TimeProps } from './RangeProps';
import { TextFieldProps } from './TextProps';
import { LinesInput, put, TextProp } from './texts';
import { Button, IconButton, icons, NumberInput, Select, Toggle } from './ui';

type Num = ( key: string ) => ( value: number | undefined ) => void;

export function RepeatProps( { node, field, edit, num }: { node: StepNode; field: RepeatField; edit: Edit; num: Num } ) {
	const { ctx, lang, readOnly, store } = useEnv();
	const change = store.getState().change;
	const [ open, setOpen ] = useState<string | null>( null );
	const [ adding, setAdding ] = useState<RepeatFieldType>( 'text' );
	const p = field.props;
	const types = REPEAT_FIELD_TYPES.map( ( t ) => ( { value: t, label: stepFieldName( t ) } ) );
	const groupText = ( key: 'itemLabel' | 'addLabel' ) => ( value: string ): void => edit( ( f ) => put( ( f as RepeatField ).props, key, lang, value, ctx.locale ), 'props.' + key );
	return (
		<>
			<div className="ffxb-pair">
				<NumberInput label={ __( 'At least', 'funnelforms-pro' ) } value={ p.minItems } min={ 0 } onChange={ num( 'minItems' ) } />
				<NumberInput label={ __( 'At most', 'funnelforms-pro' ) } value={ p.maxItems } min={ 1 } onChange={ num( 'maxItems' ) } />
			</div>
			<TextProp label={ __( 'Heading of each item', 'funnelforms-pro' ) } value={ p.itemLabel } onChange={ groupText( 'itemLabel' ) } hint={ __( '%d is the number of the item, e.g. "Person %d".', 'funnelforms-pro' ) } />
			<TextProp label={ __( 'Button to add an item', 'funnelforms-pro' ) } value={ p.addLabel } onChange={ groupText( 'addLabel' ) } />
			<div className="ffxb-subfields" role="group" aria-label={ __( 'Fields of each item', 'funnelforms-pro' ) }>
				<p className="ffxb-subfields__title">{ __( 'Fields of each item', 'funnelforms-pro' ) }</p>
				{ p.fields.map( ( sub, i ) => (
					<details
						key={ sub.id }
						className="ffxb-subfield"
						open={ open === sub.id }
						onToggle={ ( e ) => {
							const shown = ( e.currentTarget as HTMLDetailsElement ).open;
							if ( shown !== ( open === sub.id ) ) {
								setOpen( shown ? sub.id : null );
							}
						} }
					>
						<summary>
							<span className="ffxb-fields__type">
								{ stepFieldName( sub.type ) }
								{ sub.required ? ' *' : '' }
							</span>
							<span className="ffxb-fields__label">{ text( sub.label, ctx.locale ) || '—' }</span>
						</summary>
						<SubField
							field={ sub }
							types={ types }
							edit={ ( recipe, key ) =>
								edit( ( f ) => {
									const inner = ( f as RepeatField ).props.fields.find( ( x ) => x.id === sub.id );
									if ( inner ) {
										recipe( inner as Field );
									}
								}, `fields.${ sub.id }${ key ? '.' + key : '' }` )
							}
							setType={ ( type ) => change( ( d ) => setRepeatFieldType( d, node.id, field.id, sub.id, type, ctx ) ) }
							setOptions={ ( labels ) =>
								change( ( d ) => {
									const group = ( d.nodes.find( ( n ) => n.id === node.id ) as StepNode | undefined )?.fields.find( ( f ) => f.id === field.id ) as RepeatField | undefined;
									const inner = group?.props.fields.find( ( x ) => x.id === sub.id );
									if ( 'dropdown' !== inner?.type ) {
										return;
									}
									if ( lang !== ctx.locale ) {
										inner.options.forEach( ( o, n ) => setText( o.label, lang, labels[ n ] ?? '', ctx.locale ) );
										return;
									}
									inner.options = labels.map( ( label, n ) => {
										const known = inner.options[ n ];
										if ( known ) {
											setText( known.label, lang, label, ctx.locale );
											return known;
										}
										return { id: newId( d, 'o' ), label: { [ lang ]: label }, value: String( n + 1 ) };
									} );
								}, `${ field.id }:fields.${ sub.id }.options` )
							}
						/>
						<div className="ffxb-subfield__actions">
							<IconButton label={ __( 'Move up', 'funnelforms-pro' ) } icon={ <span aria-hidden="true">↑</span> } disabled={ readOnly || 0 === i } onClick={ () => change( ( d ) => moveRepeatField( d, node.id, field.id, sub.id, i - 1 ) ) } />
							<IconButton
								label={ __( 'Move down', 'funnelforms-pro' ) }
								icon={ <span aria-hidden="true">↓</span> }
								disabled={ readOnly || i === p.fields.length - 1 }
								onClick={ () => change( ( d ) => moveRepeatField( d, node.id, field.id, sub.id, i + 1 ) ) }
							/>
							<IconButton
								label={ __( 'Delete field', 'funnelforms-pro' ) }
								icon={ icons.trash }
								danger
								disabled={ readOnly || p.fields.length <= 1 }
								onClick={ () => change( ( d ) => void removeRepeatField( d, node.id, field.id, sub.id ) ) }
							/>
						</div>
					</details>
				) ) }
				<div className="ffxb-subfields__add">
					<Select label={ __( 'Type of the new field', 'funnelforms-pro' ) } value={ adding } options={ types } onChange={ setAdding } disabled={ readOnly } />
					<Button
						variant="secondary"
						icon={ icons.plus }
						disabled={ readOnly }
						onClick={ () => {
							let id: string | null = null;
							change( ( d ) => {
								id = addRepeatField( d, node.id, field.id, adding, ctx );
							} );
							setOpen( id );
						} }
					>
						{ __( 'Add field', 'funnelforms-pro' ) }
					</Button>
				</div>
			</div>
		</>
	);
}

/** One field of each item: its type, texts, whether it is required, and the settings of its type. */
function SubField( {
	field,
	types,
	edit,
	setType,
	setOptions,
}: {
	field: RepeatItemField;
	types: Array<{ value: RepeatFieldType; label: string }>;
	edit: Edit;
	setType: ( type: RepeatFieldType ) => void;
	setOptions: ( labels: string[] ) => void;
} ) {
	const { ctx, lang, readOnly } = useEnv();
	const textOf = ( key: 'label' ) => ( value: string ): void => edit( ( f ) => put( f, key, lang, value, ctx.locale ), key );
	const num: Num = ( key ) => ( value ) =>
		edit( ( f ) => {
			const props = f.props as Record<string, unknown>;
			if ( undefined === value ) {
				Reflect.deleteProperty( props, key );
			} else {
				props[ key ] = value;
			}
		}, 'props.' + key );
	const props = field.props as Record<string, unknown>;
	let settings: React.ReactNode = null;
	switch ( field.type ) {
		case 'text':
		case 'textarea':
			settings = <TextFieldProps field={ field as TextField | TextareaField } edit={ edit } num={ num } />;
			break;
		case 'number':
			settings = <NumberProps field={ field as NumberField } edit={ edit } />;
			break;
		case 'date':
			settings = <DateProps field={ field as DateField } edit={ edit } />;
			break;
		case 'time':
			settings = <TimeProps field={ field as TimeField } edit={ edit } />;
			break;
		case 'phone':
			settings = <PhoneCountryProps props={ props } edit={ ( recipe, key ) => edit( ( f ) => recipe( f.props as Record<string, unknown> ), key ) } />;
			break;
		case 'dropdown':
			settings = (
				<LinesInput
					label={ __( 'Answers', 'funnelforms-pro' ) }
					hint={ __( 'One answer per line.', 'funnelforms-pro' ) }
					lines={ ( field as DropdownField ).options.map( ( o ) => editText( o.label, lang, ctx.locale ) ) }
					resetKey={ field.id + lang }
					onLines={ setOptions }
				/>
			);
			break;
	}
	return (
		<div className="ffxb-subfield__body">
			<Select label={ __( 'Type', 'funnelforms-pro' ) } value={ field.type } options={ types } onChange={ setType } disabled={ readOnly } />
			<TextProp label={ __( 'Question', 'funnelforms-pro' ) } value={ field.label } onChange={ textOf( 'label' ) } />
			{ 'placeholder' in props ? (
				<TextProp
					label={ __( 'Placeholder', 'funnelforms-pro' ) }
					value={ props.placeholder as Record<string, string> }
					onChange={ ( v ) => edit( ( f ) => put( f.props as Record<string, unknown>, 'placeholder', lang, v, ctx.locale ), 'props.placeholder' ) }
				/>
			) : null }
			<Toggle label={ __( 'Required', 'funnelforms-pro' ) } checked={ field.required } onChange={ ( v ) => edit( ( f ) => void ( f.required = v ), 'required' ) } />
			{ settings }
		</div>
	);
}
