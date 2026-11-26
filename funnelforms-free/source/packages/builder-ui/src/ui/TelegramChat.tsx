/**
 * The chat of a Telegram connection: asks the bot which chats wrote to it lately, added it or
 * posted in a channel it administers, lists them and fills in the one chosen. One group or
 * channel found is taken right away; a private chat is always chosen by hand, as anyone can write
 * to a bot. Used by the overview of Funnelforms → Integrations and by the connection dialog of
 * the form builder; the chat ID can always be typed in by hand instead. A public chat (a group
 * or channel with a @name) gets a warning: anyone could read the entries there.
 */
import React, { useRef, useState } from 'react';
import type { FormsApi, TelegramChat } from '../api';
import { telegramBot, validTelegramToken } from '../telegram';
import { __, sprintf } from './i18n';
import { Button, Notice, Select } from './ui';

/** How to set up the bot, for the dialog that connects it; with the chat search of the host or without. */
export function telegramSteps( search: boolean ): string {
	return search
		? __( 'In Telegram open @BotFather, create a bot with /newbot and paste its token here. Then send the bot a message or add it to your group or channel (in a channel as admin) and click “Find chat”.', 'funnelforms-pro' )
		: __( 'In Telegram open @BotFather, create a bot with /newbot and paste its token here. Then add the bot to your group or channel (in a channel as admin) and enter the chat ID.', 'funnelforms-pro' );
}

/** What the chat ID field accepts; it does not suggest the @name of a public channel. */
export function telegramChatHint(): string {
	return __( 'Enter the chat ID as Telegram gives it, e.g. -1001234567890. Use a private group or channel: in a public one anyone can read the entries.', 'funnelforms-pro' );
}

/** For a public chat: a group or channel found with a @name, or a @name typed in, which only public chats have. */
export function TelegramPublicNotice() {
	return <Notice tone="warning">{ __( 'This chat is public: anyone can read the entries there, with their answers and contact details. Choose a private group or channel.', 'funnelforms-pro' ) }</Notice>;
}

/** The kind of a chat; supergroups are groups to the customer. Not "Channel" alone, which is the channel of a visit elsewhere. */
function typeName( type: TelegramChat[ 'type' ] ): string {
	switch ( type ) {
		case 'private':
			return __( 'Private chat', 'funnelforms-pro' );
		case 'channel':
			return __( 'Telegram channel', 'funnelforms-pro' );
		default:
			return __( 'Group chat', 'funnelforms-pro' );
	}
}

/**
 * Shown where the host has the search (api.telegramChats); called as a method, so the adapter
 * keeps its this. The list belongs to the bot it was asked for: a token typed in afterwards hides
 * it, and an answer that comes after the token changed is dropped. What it shows as chosen is the
 * chat ID of the dialog (chatId), so an ID typed by hand is never named as a chat found.
 */
export function TelegramChatFinder( { api, token, connectionRef, chatId, onPick }: { api: Pick<FormsApi, 'telegramChats'>; token: string; connectionRef?: string; chatId: string; onPick: ( chat: TelegramChat ) => void } ) {
	const [ busy, setBusy ] = useState( false );
	const [ found, setFound ] = useState<{ bot: string; chats: TelegramChat[] | null; error: string | null } | null>( null );
	const bot = telegramBot( token, connectionRef );
	const asking = bot ? JSON.stringify( bot ) : '';
	// The bot of the dialog now, for answers that come after the token changed.
	const current = useRef( asking );
	current.current = asking;
	const wrongToken = '' !== token.trim() && ! validTelegramToken( token );

	const search = async (): Promise<void> => {
		if ( ! bot ) {
			return;
		}
		const asked = asking;
		setBusy( true );
		setFound( null );
		try {
			const chats = ( await api.telegramChats?.( bot ) ) ?? [];
			if ( current.current !== asked ) {
				return;
			}
			setFound( { bot: asked, chats, error: null } );
			const only = 1 === chats.length ? chats[ 0 ] : undefined;
			// Anyone can write to a bot: a private chat found alone could be a stranger's.
			if ( only && 'private' !== only.type ) {
				onPick( only );
			}
		} catch ( e ) {
			if ( current.current === asked ) {
				setFound( { bot: asked, chats: null, error: e instanceof Error ? e.message : String( e ) } );
			}
		} finally {
			setBusy( false );
		}
	};

	const shown = found && found.bot === asking ? found : null;
	const chats = shown?.chats ?? null;
	const picked = chats?.find( ( c ) => c.id === chatId.trim() );
	const named = ( c: TelegramChat ): string => `${ c.title } (${ typeName( c.type ) })`;
	// One chat found and taken: named. Otherwise, and once another ID is typed, the list to choose from.
	const taken = chats && 1 === chats.length && picked ? picked : undefined;
	return (
		<div className="ffxb-telegram">
			{ /* In a block of its own, so the grid of the form does not stretch the button. */ }
			<div className="ffxb-telegram__find">
				<Button size="sm" disabled={ busy || ! bot } onClick={ () => void search() }>
					{ busy ? __( 'Searching…', 'funnelforms-pro' ) : __( 'Find chat', 'funnelforms-pro' ) }
				</Button>
			</div>
			{ wrongToken ? <p className="ffxb-hint">{ __( 'This is not a bot token. Copy the whole token that @BotFather sent, e.g. 123456789:AAH…', 'funnelforms-pro' ) }</p> : null }
			{ shown?.error ? <Notice tone="danger">{ shown.error }</Notice> : null }
			{ chats && ! chats.length ? <Notice tone="info">{ __( 'No chat found yet. Send the bot a message, or add it to the group or channel and write there, then search again. You can also enter the chat ID by hand.', 'funnelforms-pro' ) }</Notice> : null }
			{ taken ? <Notice tone="success">{ sprintf( __( 'Chat found: %s.', 'funnelforms-pro' ), named( taken ) ) }</Notice> : null }
			{ chats && chats.length && ! taken ? (
				<>
					<Notice tone="info">{ sprintf( __( 'Chats found: %d. Choose the one that gets the messages.', 'funnelforms-pro' ), chats.length ) }</Notice>
					<Select
						label={ __( 'Chat', 'funnelforms-pro' ) }
						value={ picked?.id ?? '' }
						options={ [ { value: '', label: __( 'Choose…', 'funnelforms-pro' ) }, ...chats.map( ( c ) => ( { value: c.id, label: named( c ) } ) ) ] }
						onChange={ ( v ) => {
							const chat = chats.find( ( c ) => c.id === v );
							if ( chat ) {
								onPick( chat );
							}
						} }
					/>
				</>
			) : null }
			{ picked?.public ? <TelegramPublicNotice /> : null }
			{ chats && chats.length ? <p className="ffxb-hint">{ __( 'Chat not listed? Telegram keeps the messages to a bot for one day and lists the first 100 of them. Write to the bot again, or enter the chat ID by hand.', 'funnelforms-pro' ) }</p> : null }
		</div>
	);
}
