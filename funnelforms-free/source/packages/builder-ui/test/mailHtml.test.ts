import { describe, expect, it } from 'vitest';
import { cleanHtml, fromVisual, safeUrl, textToHtml, toVisual } from '../src/mailHtml';

describe( 'mail HTML', () => {
	it( 'keeps formatting, links and placeholders and drops what could run', () => {
		expect( cleanHtml( '<h2>Hallo</h2><p><b>fett</b> <a href="{{page:url}}">Seite</a> <a href="mailto:a@b.de">Mail</a></p>' ) ).toBe( '<h2>Hallo</h2><p><b>fett</b> <a href="{{page:url}}">Seite</a> <a href="mailto:a@b.de">Mail</a></p>' );
		expect( cleanHtml( '<p onmouseover="x()">a<iframe src="https://x"></iframe><svg onload="x()"></svg><a href=" JaVa&#x09;Script:alert(1)">b</a><img src="data:text/html,x"></p><style>p{}</style>' ) ).toBe( '<p>a<a>b</a><img></p>' );
	} );

	it( 'tells safe addresses from script addresses', () => {
		expect( [ 'https://a.de', '/pfad', '#oben', 'tel:+49', '{{field:web}}', 'bild.png', '' ].every( safeUrl ) ).toBe( true );
		expect( [ 'javascript:alert(1)', 'java\nscript:x', 'data:image/png;base64,x', 'vbscript:x' ].some( safeUrl ) ).toBe( false );
	} );

	it( 'shows line breaks as <br> and stores none when they are kept', () => {
		expect( toVisual( 'Hallo\n\n{{answers}}', true ) ).toBe( 'Hallo<br><br>{{answers}}' );
		expect( toVisual( '<p>a\nb</p>', false ) ).toBe( '<p>a\nb</p>' );
		expect( fromVisual( 'Hallo<br>\nWelt<br>', true ) ).toBe( 'Hallo<br> Welt' );
		expect( textToHtml( '<b> & \n' ) ).toBe( '&lt;b&gt; &amp; <br>' );
	} );
} );
