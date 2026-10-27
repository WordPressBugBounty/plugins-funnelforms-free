/**
 * The answers of choice and dropdown fields: the list of answers with their values, numbers,
 * right answers and images, and how the answers look and how many can be chosen.
 */
import React, { useState } from 'react';
import type { ChoiceField, ContactField, DropdownField, Field, FormNode, Option } from '@funnelforms/form-schema';
import { addOption, addOptions, asksFor, moveOption, removeOption, splitOptionList, text } from '../document';
import { removeWithNotice } from './Removal';
import { editText } from '../languages';
import { setRightAnswer } from '../quiz';
import type { Recipe } from '../store';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';
import { put, TextProp } from './texts';
import { IconChoice } from './IconPicker';
import { Button, ChoiceTiles, Dialog, Field as FieldRow, Group, IconButton, icons, Notice, NumberInput, Sketch, TextInput, Toggle } from './ui';

export type Edit = ( recipe: ( f: Field | ContactField ) => void, key?: string ) => void;

function useChange(): ( recipe: Recipe, key?: string ) => void {
	return useEnv().store.getState().change;
}

/** Sets or removes one of the field's props. */
function useProp( edit: Edit ): ( key: string, value: unknown ) => void {
	return ( key, value ) =>
		edit( ( f ) => {
			const props = f.props as Record<string, unknown>;
			if ( undefined === value || false === value ) {
				Reflect.deleteProperty( props, key );
			} else {
				props[ key ] = value;
			}
		}, 'props.' + key );
}

/** How many answers: at least, at most, and moving on at a number (choice only). */
function Limits( { field, edit }: { field: ChoiceField | DropdownField; edit: Edit } ) {
	const set = useProp( edit );
	const max = field.options.length;
	const autoAdvance = 'choice' === field.type ? field.props.autoAdvanceAt : undefined;
	return (
		<>
			<div className="ffxb-pair">
				<NumberInput label={ __( 'At least', 'funnelforms-pro' ) } value={ field.props.minChoices } min={ 1 } max={ max } onChange={ ( v ) => set( 'minChoices', v ) } />
				<NumberInput label={ __( 'At most', 'funnelforms-pro' ) } value={ field.props.maxChoices } min={ 1 } max={ max } onChange={ ( v ) => set( 'maxChoices', v ) } />
			</div>
			{ 'choice' === field.type ? (
				<NumberInput label={ __( 'Continue on its own at this number of answers', 'funnelforms-pro' ) } value={ autoAdvance } min={ 1 } max={ max } onChange={ ( v ) => set( 'autoAdvanceAt', v ) } />
			) : null }
			{ undefined !== field.props.minChoices && undefined !== field.props.maxChoices && field.props.minChoices > field.props.maxChoices ? (
				<Notice tone="warning">{ __( 'The smallest number is above the largest.', 'funnelforms-pro' ) }</Notice>
			) : null }
		</>
	);
}

/* Small drawings of the look of the answers for the tiles of the properties panel. */

function TilesSketch() {
	return (
		<Sketch>
			<rect x="5" y="6" width="11" height="20" rx="2" />
			<rect x="18.5" y="6" width="11" height="20" rx="2" />
			<rect x="32" y="6" width="11" height="20" rx="2" />
		</Sketch>
	);
}

function ListSketch( { columns = 1 }: { columns?: 1 | 2 } ) {
	const rows = [ 6, 13.5, 21 ];
	return (
		<Sketch>
			{ 1 === columns
				? rows.map( ( y ) => <rect key={ y } x="6" y={ y } width="36" height="5" rx="2" /> )
				: rows.flatMap( ( y ) => [ <rect key={ 'a' + y } x="5" y={ y } width="17" height="5" rx="2" />, <rect key={ 'b' + y } x="26" y={ y } width="17" height="5" rx="2" /> ] ) }
		</Sketch>
	);
}

/** Tiles in a row; 0 is as many as fit. */
function RowSketch( { count }: { count: number } ) {
	if ( 0 === count ) {
		return (
			<Sketch>
				<path d="M6 16h36M10 12l-4 4 4 4M38 12l4 4-4 4" />
			</Sketch>
		);
	}
	const gap = 2;
	const width = ( 36 - gap * ( count - 1 ) ) / count;
	return (
		<Sketch>
			{ Array.from( { length: count }, ( _, i ) => (
				<rect key={ i } x={ 6 + i * ( width + gap ) } y="9" width={ width } height="14" rx="2" />
			) ) }
		</Sketch>
	);
}

function HeightSketch( { height }: { height: number } ) {
	return (
		<Sketch>
			<rect x="8" y={ 16 - height / 2 } width="32" height={ height } rx="2" />
		</Sketch>
	);
}

function IconSketch( { at }: { at: 'top' | 'left' | 'right' | 'bottom' } ) {
	const icon = { top: [ 19, 5 ], bottom: [ 19, 18 ], left: [ 8, 11.5 ], right: [ 31, 11.5 ] }[ at ];
	const text = { top: 'M16 23h16', bottom: 'M16 10h16', left: 'M20 16h18', right: 'M10 16h18' }[ at ];
	return (
		<Sketch>
			<rect x={ icon[ 0 ] } y={ icon[ 1 ] } width="9" height="9" rx="2" fill="currentColor" />
			<path d={ text } />
		</Sketch>
	);
}

export function ChoiceProps( { node, field, edit }: { node: FormNode; field: ChoiceField; edit: Edit } ) {
	const set = useProp( edit );
	const p = field.props;
	const columns = ( device: 'desktop' | 'mobile', value: string ): void =>
		edit( ( f ) => {
			const props = ( f as ChoiceField ).props;
			const next = { ...props.columns, [ device ]: '' === value ? undefined : Number( value ) };
			if ( undefined === next.desktop && undefined === next.mobile ) {
				delete props.columns;
			} else {
				props.columns = JSON.parse( JSON.stringify( next ) ) as ChoiceField[ 'props' ][ 'columns' ];
			}
		}, 'props.columns' );
	return (
		<>
			<Group title={ __( 'Answers', 'funnelforms-pro' ) }>
				<Toggle label={ __( 'Several answers allowed', 'funnelforms-pro' ) } checked={ p.multiple } onChange={ ( v ) => edit( ( f ) => void ( ( f as ChoiceField ).props.multiple = v ), 'props.multiple' ) } />
				{ p.multiple ? <Limits field={ field } edit={ edit } /> : null }
				<Options node={ node } field={ field } edit={ edit } />
			</Group>
			<Group title={ __( 'Look of the answers', 'funnelforms-pro' ) }>
				<ChoiceTiles
					label={ __( 'Layout on large screens', 'funnelforms-pro' ) }
					value={ p.layout.desktop }
					options={ [
						{ value: 'grid', label: __( 'Tiles', 'funnelforms-pro' ), icon: <TilesSketch /> },
						{ value: 'list', label: __( 'List', 'funnelforms-pro' ), icon: <ListSketch /> },
						{ value: 'list2', label: __( 'List in two columns', 'funnelforms-pro' ), icon: <ListSketch columns={ 2 } /> },
					] }
					onChange={ ( v ) => edit( ( f ) => void ( ( f as ChoiceField ).props.layout.desktop = v ), 'props.layout' ) }
				/>
				{ 'grid' === p.layout.desktop ? (
					<ChoiceTiles
						label={ __( 'Tiles per row on large screens', 'funnelforms-pro' ) }
						value={ String( p.columns?.desktop ?? '' ) }
						columns={ 5 }
						options={ [ { value: '', label: __( 'As many as fit', 'funnelforms-pro' ), icon: <RowSketch count={ 0 } /> }, ...[ 1, 2, 3, 4 ].map( ( n ) => ( { value: String( n ), label: String( n ), icon: <RowSketch count={ n } /> } ) ) ] }
						onChange={ ( v ) => columns( 'desktop', v ) }
					/>
				) : null }
				<ChoiceTiles
					label={ __( 'Height of the answers', 'funnelforms-pro' ) }
					value={ p.size ?? 'm' }
					options={ [
						{ value: 's', label: __( 'Small', 'funnelforms-pro' ), icon: <HeightSketch height={ 8 } /> },
						{ value: 'm', label: __( 'Medium', 'funnelforms-pro' ), icon: <HeightSketch height={ 14 } /> },
						{ value: 'l', label: __( 'Large', 'funnelforms-pro' ), icon: <HeightSketch height={ 22 } /> },
					] }
					onChange={ ( v ) => set( 'size', 'm' === v ? undefined : v ) }
				/>
				{ p.hideIcons ? null : (
					<ChoiceTiles
						label={ __( 'Position of icons and images', 'funnelforms-pro' ) }
						value={ p.iconPosition ?? 'top' }
						columns={ 4 }
						options={ [
							{ value: 'top', label: __( 'Above the text', 'funnelforms-pro' ), icon: <IconSketch at="top" /> },
							{ value: 'left', label: __( 'Left of the text', 'funnelforms-pro' ), icon: <IconSketch at="left" /> },
							{ value: 'right', label: __( 'Right of the text', 'funnelforms-pro' ), icon: <IconSketch at="right" /> },
							{ value: 'bottom', label: __( 'Below the text', 'funnelforms-pro' ), icon: <IconSketch at="bottom" /> },
						] }
						onChange={ ( v ) => set( 'iconPosition', 'top' === v ? undefined : v ) }
					/>
				) }
				{ p.hideIcons ? null : <Toggle label={ __( 'Images fill the answer', 'funnelforms-pro' ) } checked={ true === p.imageFull } onChange={ ( v ) => set( 'imageFull', v ) } /> }
				<Toggle label={ __( 'Hide icons and images', 'funnelforms-pro' ) } checked={ p.hideIcons } onChange={ ( v ) => edit( ( f ) => void ( ( f as ChoiceField ).props.hideIcons = v ), 'props.hideIcons' ) } />
			</Group>
			<Group title={ __( 'On phones', 'funnelforms-pro' ) }>
				<ChoiceTiles
					label={ __( 'Layout on phones', 'funnelforms-pro' ) }
					value={ p.layout.mobile }
					columns={ 2 }
					options={ [
						{ value: 'list', label: __( 'List', 'funnelforms-pro' ), icon: <ListSketch /> },
						{ value: 'grid', label: __( 'Tiles', 'funnelforms-pro' ), icon: <TilesSketch /> },
					] }
					onChange={ ( v ) => edit( ( f ) => void ( ( f as ChoiceField ).props.layout.mobile = v ), 'props.layout' ) }
				/>
				{ 'grid' === p.layout.mobile ? (
					<ChoiceTiles
						label={ __( 'Tiles per row on phones', 'funnelforms-pro' ) }
						value={ String( p.columns?.mobile ?? '2' ) }
						columns={ 2 }
						options={ [ 1, 2 ].map( ( n ) => ( { value: String( n ), label: String( n ), icon: <RowSketch count={ n } /> } ) ) }
						onChange={ ( v ) => columns( 'mobile', '2' === v ? '' : v ) }
					/>
				) : null }
			</Group>
		</>
	);
}

export function DropdownProps( { node, field, edit }: { node: FormNode; field: DropdownField; edit: Edit } ) {
	const { ctx, lang } = useEnv();
	const set = useProp( edit );
	return (
		<>
			<TextProp
				label={ __( 'Text while nothing is chosen', 'funnelforms-pro' ) }
				value={ field.props.placeholder }
				onChange={ ( v ) => edit( ( f ) => put( f.props as DropdownField[ 'props' ], 'placeholder', lang, v, ctx.locale ), 'props.placeholder' ) }
			/>
			<Toggle label={ __( 'Search box above the answers', 'funnelforms-pro' ) } checked={ true === field.props.search } onChange={ ( v ) => set( 'search', v ) } />
			<Toggle label={ __( 'Several answers allowed', 'funnelforms-pro' ) } checked={ true === field.props.multiple } onChange={ ( v ) => set( 'multiple', v ) } />
			{ field.props.multiple ? <Limits field={ field } edit={ edit } /> : null }
			<Options node={ node } field={ field } edit={ edit } />
		</>
	);
}

/** The image of an answer: a thumbnail with change and remove, or a button to choose one. */
function OptionImage( { option, n, disabled, onPick, onRemove }: { option: Option; n: number; disabled: boolean; onPick: () => Promise<void>; onRemove: () => void } ) {
	if ( 'image' !== option.media?.kind ) {
		return <IconButton label={ sprintf( __( 'Choose an image for answer %d', 'funnelforms-pro' ), n ) } icon={ icons.image } disabled={ disabled } onClick={ () => void onPick() } />;
	}
	return (
		<span className="ffxb-option-image">
			<button type="button" className="ffxb-option-image__thumb" aria-label={ sprintf( __( 'Change the image of answer %d', 'funnelforms-pro' ), n ) } disabled={ disabled } onClick={ () => void onPick() }>
				<img src={ option.media.value } alt="" />
			</button>
			<button type="button" className="ffxb-option-image__remove" aria-label={ sprintf( __( 'Remove the image of answer %d', 'funnelforms-pro' ), n ) } title={ __( 'Remove image', 'funnelforms-pro' ) } disabled={ disabled } onClick={ onRemove }>
				×
			</button>
		</span>
	);
}

/** Data type of an answer dragged to another place in the list. */
const OPTION_DRAG = 'application/x-ffx-option';

/** Answers pasted as a list. */
function PasteOptions( { onClose, onAdd }: { onClose: () => void; onAdd: ( labels: string[] ) => void } ) {
	const [ value, setValue ] = useState( '' );
	const labels = splitOptionList( value );
	return (
		<Dialog
			title={ __( 'Paste a list of answers', 'funnelforms-pro' ) }
			open
			onClose={ onClose }
			actions={
				<>
					<Button variant="ghost" onClick={ onClose }>
						{ __( 'Cancel', 'funnelforms-pro' ) }
					</Button>
					<Button
						variant="primary"
						disabled={ ! labels.length }
						onClick={ () => {
							onAdd( labels );
							onClose();
						} }
					>
						{ sprintf( __( 'Add %d answers', 'funnelforms-pro' ), labels.length ) }
					</Button>
				</>
			}
		>
			<TextInput label={ __( 'Answers', 'funnelforms-pro' ) } multiline value={ value } onChange={ setValue } hint={ __( 'One answer per line, or separated by commas or semicolons.', 'funnelforms-pro' ) } />
		</Dialog>
	);
}

export function Options( { node, field, edit }: { node: FormNode; field: Extract<Field, { options: Option[] }>; edit: Edit } ) {
	const { api, ctx, lang, readOnly, store } = useEnv();
	const change = useChange();
	const [ pasting, setPasting ] = useState( false );
	const pickImage = api.pickImage?.bind( api );
	// A knowledge quiz marks right answers; otherwise numbers for calculations, once the form has
	// calculations or the answers have numbers.
	const knowledge = useBuilder( ( st ) => 'knowledge' === st.doc?.settings.quiz?.kind );
	const calculations = useBuilder( ( st ) => ( st.doc?.calculations.length ?? 0 ) > 0 );
	const calc = ! knowledge && ( calculations || field.options.some( ( o ) => undefined !== o.calcValue ) );
	const move = ( id: string, to: number ): void => change( ( d ) => void moveOption( d, node.id, field.id, id, to ) );
	const option = ( id: string, recipe: ( o: Option ) => void, key: string ): void =>
		edit( ( f ) => {
			const o = ( f as typeof field ).options.find( ( x ) => x.id === id );
			if ( o ) {
				recipe( o );
			}
		}, `${ id }:${ key }` );
	return (
		<FieldRow label={ __( 'Answers', 'funnelforms-pro' ) }>
			{ () => (
				<div className="ffxb-options">
					{ calc || knowledge ? (
						<div className="ffxb-options__row ffxb-options__head" aria-hidden="true">
							<span className="ffxb-options__handle" />
							<span>{ __( 'Answer', 'funnelforms-pro' ) }</span>
							<span className="ffxb-input--tiny">{ calc ? __( 'Saved as', 'funnelforms-pro' ) : __( 'Value', 'funnelforms-pro' ) }</span>
							<span className={ knowledge ? 'ffxb-options__right' : 'ffxb-input--tiny' }>{ knowledge ? __( 'Right', 'funnelforms-pro' ) : __( 'Counts as', 'funnelforms-pro' ) }</span>
							<span className="ffxb-options__actions" />
						</div>
					) : null }
					{ field.options.map( ( o, i ) => (
						<div
							key={ o.id }
							className="ffxb-options__row"
							onDragOver={ ( e ) => {
								if ( e.dataTransfer.types.includes( OPTION_DRAG ) ) {
									e.preventDefault();
									e.dataTransfer.dropEffect = 'move';
								}
							} }
							onDrop={ ( e ) => {
								const id = e.dataTransfer.getData( OPTION_DRAG );
								if ( id ) {
									e.preventDefault();
									move( id, i );
								}
							} }
						>
							<button
								type="button"
								className="ffxb-options__handle"
								draggable={ ! readOnly }
								disabled={ readOnly || field.options.length < 2 }
								aria-label={ sprintf( __( 'Move answer %d', 'funnelforms-pro' ), i + 1 ) }
								title={ __( 'Drag to sort, or use the arrow keys', 'funnelforms-pro' ) }
								onDragStart={ ( e ) => {
									e.dataTransfer.setData( OPTION_DRAG, o.id );
									e.dataTransfer.effectAllowed = 'move';
								} }
								onKeyDown={ ( e ) => {
									if ( 'ArrowUp' === e.key || 'ArrowDown' === e.key ) {
										e.preventDefault();
										move( o.id, i + ( 'ArrowUp' === e.key ? -1 : 1 ) );
									}
								} }
							>
								<span aria-hidden="true">⠿</span>
							</button>
							<input
								className="ffxb-input"
								aria-label={ sprintf( __( 'Answer %d', 'funnelforms-pro' ), i + 1 ) }
								value={ editText( o.label, lang, ctx.locale ) }
								placeholder={ lang !== ctx.locale ? text( o.label, ctx.locale ) : undefined }
								onChange={ ( e ) => option( o.id, ( x ) => put( x, 'label', lang, e.target.value, ctx.locale ), 'label' ) }
							/>
							<input
								className={ `ffxb-input ${ calc || knowledge ? 'ffxb-input--tiny' : 'ffxb-input--narrow' }` }
								aria-label={ sprintf( __( 'Value of answer %d', 'funnelforms-pro' ), i + 1 ) }
								title={ calc ? __( 'Value sent with the entry; it does not count in calculations', 'funnelforms-pro' ) : __( 'Value sent with the entry', 'funnelforms-pro' ) }
								value={ o.value }
								onChange={ ( e ) => option( o.id, ( x ) => void ( x.value = e.target.value ), 'value' ) }
							/>
							{ calc ? (
								<input
									className="ffxb-input ffxb-input--tiny"
									type="number"
									step="any"
									aria-label={ sprintf( __( 'Number of answer %d for calculations', 'funnelforms-pro' ), i + 1 ) }
									title={ __( 'Number for calculations, e.g. the price of the answer', 'funnelforms-pro' ) }
									placeholder="0"
									value={ undefined === o.calcValue ? '' : String( o.calcValue ) }
									onChange={ ( e ) =>
										option(
											o.id,
											( x ) => {
												const n = Number.parseFloat( e.target.value );
												if ( Number.isFinite( n ) ) {
													x.calcValue = n;
												} else {
													delete x.calcValue;
												}
											},
											'calcValue'
										)
									}
								/>
							) : null }
							{ knowledge ? (
								<span className="ffxb-options__right">
									<input
										type="checkbox"
										aria-label={ sprintf( __( 'Answer %d is right', 'funnelforms-pro' ), i + 1 ) }
										title={ __( 'Right answer of the quiz', 'funnelforms-pro' ) }
										checked={ true === o.correct }
										disabled={ readOnly }
										onChange={ ( e ) => change( ( d ) => setRightAnswer( d, field.id, o.id, e.target.checked ) ) }
									/>
								</span>
							) : null }
							<span className="ffxb-options__actions">
								{ 'choice' === field.type && api.icons ? (
									<IconChoice
										value={ 'lucide' === o.media?.kind ? o.media.value : null }
										label={ 'lucide' === o.media?.kind ? sprintf( __( 'Change the icon of answer %d', 'funnelforms-pro' ), i + 1 ) : sprintf( __( 'Choose an icon for answer %d', 'funnelforms-pro' ), i + 1 ) }
										title={ sprintf( __( 'Icon of answer %d', 'funnelforms-pro' ), i + 1 ) }
										disabled={ readOnly }
										onChange={ ( name ) =>
											option(
												o.id,
												( x ) => {
													if ( name ) {
														x.media = { kind: 'lucide', value: name };
													} else {
														delete x.media;
													}
												},
												'media'
											)
										}
									/>
								) : null }
								{ pickImage ? (
									<OptionImage
										option={ o }
										n={ i + 1 }
										disabled={ readOnly }
										onPick={ async () => {
											const image = await pickImage();
											if ( image ) {
												option( o.id, ( x ) => void ( x.media = { kind: 'image', value: image.url } ), 'media' );
											}
										} }
										onRemove={ () => option( o.id, ( x ) => void delete x.media, 'media' ) }
									/>
								) : null }
								<IconButton label={ __( 'Remove answer', 'funnelforms-pro' ) } icon={ icons.close } disabled={ readOnly || field.options.length <= 1 } onClick={ () => removeWithNotice( store, ( d ) => removeOption( d, node.id, field.id, o.id ), asksFor( field.id, o.id ) ) } />
							</span>
						</div>
					) ) }
					<div className="ffxb-options__add">
						<Button size="sm" icon={ icons.plus } disabled={ readOnly } onClick={ () => change( ( d ) => void addOption( d, node.id, field.id, ctx ) ) }>
							{ __( 'Add answer', 'funnelforms-pro' ) }
						</Button>
						<Button size="sm" variant="ghost" disabled={ readOnly } onClick={ () => setPasting( true ) }>
							{ __( 'Paste a list', 'funnelforms-pro' ) }
						</Button>
					</div>
					{ calc ? <p className="ffxb-hint">{ __( '"Counts as" is the number an answer adds to calculations, e.g. its price; empty counts as 0. "Saved as" is what entries, mails and integrations get; it does not count.', 'funnelforms-pro' ) }</p> : null }
					{ pasting ? <PasteOptions onClose={ () => setPasting( false ) } onAdd={ ( labels ) => change( ( d ) => void addOptions( d, node.id, field.id, labels, ctx ) ) } /> : null }
				</div>
			) }
		</FieldRow>
	);
}

