import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blank } from './blank';
import { addActionFor, chatServices, CONNECTION_TYPES } from '../src/actions';
import { actionName, kindName } from '../src/ui/Actions';
import { namesPublicChat, TELEGRAM_CHAT, TELEGRAM_TOKEN, telegramBot, telegramLabel, validTelegramChat, validTelegramToken, withTelegramChat, withTypedChat } from '../src/telegram';

/** The cases the server plays too (plugin/tests/Unit/Integrations/TelegramMessageTest.php). */
const vectors = JSON.parse( readFileSync( join( __dirname, '../../../plugin/tests/fixtures/telegram/vectors.json' ), 'utf-8' ) ) as {
	token: string;
	tokens: { valid: string[]; invalid: string[] };
	chats: { valid: string[]; invalid: string[] };
};

describe( 'Telegram tokens and chats', () => {
	it( 'checks bot tokens and chat IDs as the server does', () => {
		expect( vectors.tokens.valid.filter( ( t ) => ! TELEGRAM_TOKEN.test( t ) ) ).toEqual( [] );
		expect( vectors.tokens.invalid.filter( ( t ) => TELEGRAM_TOKEN.test( t ) ) ).toEqual( [] );
		expect( vectors.chats.valid.filter( ( c ) => ! TELEGRAM_CHAT.test( c ) ) ).toEqual( [] );
		expect( vectors.chats.invalid.filter( ( c ) => TELEGRAM_CHAT.test( c ) ) ).toEqual( [] );
		// Typed values lose the spaces around them on saving, as on the server.
		expect( validTelegramToken( ' ' + vectors.token + '\n' ) ).toBe( true );
		expect( validTelegramToken( vectors.token + '/getMe' ) ).toBe( false );
		expect( validTelegramChat( ' -1001234567890 ' ) ).toBe( true );
		expect( validTelegramChat( 'vertrieb' ) ).toBe( false );
		// Only public chats have a @name: anyone can read them, so the dialog warns.
		expect( [ ' @vertrieb_news', '-1001234567890', '' ].map( namesPublicChat ) ).toEqual( [ true, false, false ] );
	} );

	it( 'asks the bot of the token typed in, else the saved connection', () => {
		expect( telegramBot( ' ' + vectors.token + ' ' ) ).toEqual( { botToken: vectors.token } );
		// A new token for a saved connection wins over the stored one.
		expect( telegramBot( vectors.token, 'telegram:1' ) ).toEqual( { botToken: vectors.token } );
		expect( telegramBot( '', 'telegram:1' ) ).toEqual( { ref: 'telegram:1' } );
		// Something typed that is no token asks nobody, not even the saved connection.
		expect( telegramBot( '12345', 'telegram:1' ) ).toBeNull();
		expect( telegramBot( '   ' ) ).toBeNull();
	} );

	it( 'fills in the chat found, and names the connection after a group or channel only', () => {
		const group = { id: '-1001234567890', title: 'Vertrieb Nord', type: 'supergroup' as const };
		const person = { id: '123456789', title: 'Erika Beispiel', type: 'private' as const };
		expect( withTelegramChat( { botToken: vectors.token }, group ) ).toEqual( { botToken: vectors.token, chatId: '-1001234567890', chatTitle: 'Vertrieb Nord' } );
		expect( telegramLabel( '', group ) ).toBe( 'Vertrieb Nord' );
		expect( telegramLabel( 'Telegram', { ...group, type: 'channel' } ) ).toBe( 'Vertrieb Nord' );
		expect( telegramLabel( 'Team', group ) ).toBe( 'Team' );
		// The name of a person is no name for a connection.
		expect( telegramLabel( '', person ) ).toBe( '' );
		expect( telegramLabel( 'Telegram', person ) ).toBe( 'Telegram' );
		// A chat ID typed by hand drops the name of the chat found before.
		expect( withTypedChat( { botToken: vectors.token, chatId: '-1001234567890', chatTitle: 'Vertrieb Nord' }, '@vertrieb_news' ) ).toEqual( { botToken: vectors.token, chatId: '@vertrieb_news' } );
	} );
} );

describe( 'Telegram actions', () => {
	it( 'are a chat service, offered where the host finds chats, and added from a connection', () => {
		expect( CONNECTION_TYPES.chat ).toEqual( [ 'slack', 'teams', 'telegram' ] );
		expect( chatServices( true ) ).toEqual( [ 'slack', 'teams', 'telegram' ] );
		expect( chatServices( false ) ).toEqual( [ 'slack', 'teams' ] );
		// Named by the service; the kind names Telegram only where the host offers it.
		expect( actionName( { kind: 'chat', config: { service: 'telegram' } }, false ) ).toBe( 'Telegram message' );
		expect( [ kindName( 'chat' ), kindName( 'chat', false ), actionName( { kind: 'chat', config: {} }, false ) ] ).toEqual( [ 'Slack, Teams or Telegram message', 'Slack or Teams message', 'Slack or Teams message' ] );
		const doc = blank();
		const id = addActionFor( doc, { type: 'telegram', ref: 'telegram:1' } );
		expect( doc.actions.find( ( a ) => a.id === id ) ).toMatchObject( { on: 'submit', kind: 'chat', config: { service: 'telegram', connectionRef: 'telegram:1', showAnswers: true, showContact: true } } );
	} );
} );
