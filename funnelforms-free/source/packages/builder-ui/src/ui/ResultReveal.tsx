/**
 * "Live result" for calculator funnels (Funnelforms Pro): when visitors see the result (while they
 * answer, or blurred with a teaser until the contact step) and lines that show the text of the
 * range a result lies in.
 */
import React, { useState } from 'react';
import type { FormDocument, ResultField, ResultLine } from '@funnelforms/form-schema';
import { revealedLater, revealOnEndPages } from '../reveal';
import type { Edit } from './Answers';
import { useBuilder, useEnv } from './context';
import { __, sprintf } from './i18n';
import { put, TextProp } from './texts';
import { Button, Notice, Select, Toggle } from './ui';

export function ResultReveal( { field, edit }: { field: ResultField; edit: Edit } ) {
	const { ctx, lang, readOnly, store } = useEnv();
	const doc = useBuilder( ( st ) => st.doc );
	const [ added, setAdded ] = useState<number | null>( null );
	const p = field.props;
	const locked = 'contact' === p.reveal;
	const props = ( recipe: ( props: ResultField[ 'props' ] ) => void, key?: string ): void => edit( ( f ) => recipe( ( f as ResultField ).props ), key );
	return (
		<>
			<Select
				label={ __( 'Show the result', 'funnelforms-pro' ) }
				value={ locked ? 'contact' : 'show' }
				options={ [
					{ value: 'show', label: __( 'While visitors answer', 'funnelforms-pro' ) },
					{ value: 'contact', label: __( 'After the contact step, blurred until then', 'funnelforms-pro' ) },
				] }
				hint={ locked ? __( 'Visitors see that their result is ready, blurred, until they send their contact details. No number reaches their browser before.', 'funnelforms-pro' ) : undefined }
				onChange={ ( v ) =>
					props( ( pr ) => {
						if ( 'contact' === v ) {
							pr.reveal = 'contact';
						} else {
							delete pr.reveal;
							delete pr.teaser;
						}
					}, 'reveal' )
				}
			/>
			{ locked ? (
				<TextProp
					label={ __( 'Line while the result is locked', 'funnelforms-pro' ) }
					value={ p.teaser }
					onChange={ ( v ) => props( ( pr ) => put( pr, 'teaser', lang, v, ctx.locale ), 'teaser' ) }
					hint={ __( 'Empty: "Your result is ready. We will show it to you in full after your contact details."', 'funnelforms-pro' ) }
				/>
			) : null }
			{ locked && doc && ! revealedLater( doc, field ) ? (
				<Notice
					tone="warning"
					action={
						<Button
							size="sm"
							disabled={ readOnly }
							onClick={ () => {
								let changed = 0;
								store.getState().change( ( d: FormDocument ) => {
									changed = revealOnEndPages( d, field, ctx.locale );
								} );
								setAdded( changed );
							} }
						>
							{ __( 'Show it on the thank-you page', 'funnelforms-pro' ) }
						</Button>
					}
				>
					{ __( 'No thank-you page or mail to the visitor shows this result yet, so visitors would never see it in full.', 'funnelforms-pro' ) }
				</Notice>
			) : null }
			{ null !== added ? (
				<p className="ffxb-hint" role="status">
					{ added ? sprintf( /* translators: %d: number of thank-you pages */ __( 'Added to %d thank-you pages.', 'funnelforms-pro' ), added ) : __( 'Every thank-you page shows it already or redirects.', 'funnelforms-pro' ) }
				</p>
			) : null }
		</>
	);
}

/** "Show the text by result": a line shows the text of the range its result lies in (Calculation.texts). */
export function LineTextToggle( { line, onChange }: { line: ResultLine; onChange: ( on: boolean ) => void } ) {
	const { readOnly } = useEnv();
	const calc = useBuilder( ( st ) => st.doc?.calculations.find( ( c ) => c.id === line.calculation ) );
	if ( ! line.text && ! calc?.texts?.length ) {
		return null;
	}
	return (
		<Toggle
			label={ __( 'Show the text by result instead of the number', 'funnelforms-pro' ) }
			checked={ true === line.text }
			disabled={ readOnly }
			hint={ calc?.texts?.length ? undefined : __( 'The calculation has no texts by result yet.', 'funnelforms-pro' ) }
			onChange={ onChange }
		/>
	);
}
