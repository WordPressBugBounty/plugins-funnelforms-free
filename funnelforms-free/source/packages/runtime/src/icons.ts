/**
 * Icons of the Lucide set (ISC license) that answers and contact fields use. The plugin sends the
 * icons a form uses as SVG markup it built from its own icon file (Frontend\Icons::svg()): plain
 * shapes and their geometry, nothing that can run or load anything.
 */
import { trusted } from './dom';

/** SVG markup by icon name. */
export type IconSet = Record<string, string>;

/** The icon in a span with these classes; null when the set lacks it. */
export function lucideIcon( icons: IconSet | undefined, name: string, className: string ): HTMLElement | null {
	const svg = icons && Object.prototype.hasOwnProperty.call( icons, name ) ? icons[ name ] : '';
	return 'string' === typeof svg && svg ? trusted( 'span', svg, { class: className, 'aria-hidden': 'true' } ) : null;
}
