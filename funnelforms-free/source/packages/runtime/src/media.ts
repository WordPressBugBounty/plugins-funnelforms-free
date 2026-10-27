import type { ContentMedia } from '@funnelforms/form-schema';
import { h } from './dom';

export type VideoSource = { provider: 'youtube' | 'vimeo'; id: string } | { provider: 'file'; url: string };

/** What a video address points to: a YouTube or Vimeo video, or a video file. */
export function videoSource( address: string ): VideoSource | null {
	let url: URL;
	try {
		url = new URL( address );
	} catch {
		return null;
	}
	if ( url.protocol !== 'https:' && url.protocol !== 'http:' ) {
		return null;
	}
	const host = url.hostname.replace( /^(www|m)\./, '' );
	const path = url.pathname.split( '/' ).filter( Boolean );
	let id: string | null | undefined = null;
	if ( host === 'youtu.be' ) {
		id = path[ 0 ];
	} else if ( host === 'youtube.com' || host === 'youtube-nocookie.com' ) {
		id = path[ 0 ] === 'watch' ? url.searchParams.get( 'v' ) : [ 'embed', 'shorts', 'live', 'v' ].includes( path[ 0 ] ?? '' ) ? path[ 1 ] : null;
	} else if ( host === 'vimeo.com' || host === 'player.vimeo.com' ) {
		const vimeo = ( host === 'player.vimeo.com' ? path.slice( 1 ) : path ).find( ( part ) => /^\d+$/.test( part ) );
		return vimeo ? { provider: 'vimeo', id: vimeo } : null;
	} else {
		return { provider: 'file', url: url.href };
	}
	return id && /^[\w-]{6,20}$/.test( id ) ? { provider: 'youtube', id } : null;
}

export interface MediaContext {
	text( value: Record<string, string> | undefined ): string;
	t( key: string ): string;
}

const plain = ( html: string ): string => html.replace( /<[^>]*>/g, '' ).trim();

/** Image or video above the text of a content step. YouTube and Vimeo load only after a click. */
export function contentMedia( media: ContentMedia, ctx: MediaContext ): HTMLElement | null {
	if ( ! /^https?:\/\//i.test( media.url ) ) {
		return null;
	}
	const caption = plain( ctx.text( media.caption ) );
	let body: HTMLElement;
	if ( media.kind === 'image' ) {
		body = h( 'img', { class: 'ffx-media-image', src: media.url, alt: plain( ctx.text( media.alt ) ), loading: 'lazy', decoding: 'async' } );
	} else {
		const source = videoSource( media.url );
		if ( ! source ) {
			return null;
		}
		if ( source.provider === 'file' ) {
			body = h( 'video', { class: 'ffx-media-video', src: source.url, controls: true, preload: 'metadata', playsinline: true } );
		} else {
			// Nothing is loaded from YouTube or Vimeo before the visitor asks for it.
			const name = source.provider === 'youtube' ? 'YouTube' : 'Vimeo';
			const play = h( 'button', { type: 'button', class: 'ffx-video-play' }, ctx.t( 'video_load' ) );
			body = h( 'div', { class: 'ffx-media-video ffx-video-consent' }, play, h( 'p', { class: 'ffx-video-note' }, ctx.t( 'video_note' ).replace( '%s', name ) ) );
			play.addEventListener( 'click', () => {
				const src = source.provider === 'youtube' ? `https://www.youtube-nocookie.com/embed/${ source.id }?autoplay=1&rel=0` : `https://player.vimeo.com/video/${ source.id }?autoplay=1&dnt=1`;
				const frame = h( 'iframe', { class: 'ffx-media-video', src, title: caption || name, allow: 'autoplay; fullscreen; picture-in-picture', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' } );
				body.replaceWith( frame );
				frame.focus();
			} );
		}
	}
	const figure = h( 'figure', { class: 'ffx-media' }, body, caption ? h( 'figcaption', { class: 'ffx-media-caption' }, caption ) : null );
	if ( media.width && media.width < 100 ) {
		figure.style.setProperty( '--ffx-media-width', `${ media.width }%` );
	}
	return figure;
}
