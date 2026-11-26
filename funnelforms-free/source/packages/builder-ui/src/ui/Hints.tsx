/**
 * Hints about the logic of the form (logic.ts) in words, as cards (Issues.tsx) with a way to the place they are about.
 */
import React from 'react';
import type { FormDocument } from '@funnelforms/form-schema';
import type { LogicHint } from '../logic';
import { useEnv } from './context';
import { hintIssues } from './formCheck';
import { IssueList } from './Issues';

export { hintText, restText } from './hintText';
export { useHints } from './Issues';

/** Hints as a list; outside the properties of their place each one can bring it into view. */
export function HintList( { doc, hints, compact = false }: { doc: FormDocument; hints: LogicHint[]; compact?: boolean } ) {
	const { ctx } = useEnv();
	return <IssueList issues={ hintIssues( doc, hints, ctx.locale ) } compact={ compact } />;
}
