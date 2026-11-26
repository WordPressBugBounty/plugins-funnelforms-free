/**
 * Telegram connections: the customer's own bot. What a bot token and a chat ID look like (the
 * rules of plugin/src/Integrations/Chat/TelegramMessage.php, so a typo is caught before any
 * request), which bot a chat search asks and what a found chat fills in.
 */
import type { TelegramChat } from './api';

/** A token as @BotFather gives it: the bot's number, a colon and its secret. */
export const TELEGRAM_TOKEN = /^\d{5,12}:[A-Za-z0-9_-]{30,60}$/;

/** A chat ID (negative for groups and channels) or the @name of a public channel. */
export const TELEGRAM_CHAT = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/;

/** Whether a typed token has the form of a bot token (spaces around it are dropped on saving). */
export function validTelegramToken( token: string ): boolean {
	return TELEGRAM_TOKEN.test( token.trim() );
}

/** Whether a typed chat is an ID or the @name of a public channel. */
export function validTelegramChat( chat: string ): boolean {
	return TELEGRAM_CHAT.test( chat.trim() );
}

/**
 * Which bot a chat search asks: a token typed in wins (also when a saved connection gets a new
 * one), else the saved connection, whose token never leaves the server. Null while the typed
 * token is no token or there is nothing to ask.
 */
export function telegramBot( typed: string, ref?: string ): { botToken: string } | { ref: string } | null {
	const token = typed.trim();
	if ( '' !== token ) {
		return validTelegramToken( token ) ? { botToken: token } : null;
	}
	return ref ? { ref } : null;
}

/** Whether a typed chat is a @name: only public channels and groups have one, and anyone can read them. */
export function namesPublicChat( chat: string ): boolean {
	return chat.trim().startsWith( '@' );
}

/** The credentials after a chat was chosen: its ID, and its name, which the overview shows. */
export function withTelegramChat( values: Record<string, string>, chat: TelegramChat ): Record<string, string> {
	return { ...values, chatId: chat.id, chatTitle: chat.title };
}

/**
 * The name of a connection after a chat was chosen: a group or channel names a connection whose
 * name is still empty or the default "Telegram". A private chat does not, as its name is the
 * name of a person.
 */
export function telegramLabel( label: string, chat: TelegramChat ): string {
	const name = label.trim();
	return ( '' === name || 'Telegram' === name ) && 'private' !== chat.type && '' !== chat.title ? chat.title : label;
}

/** The credentials after the chat ID was typed by hand: the name of a found chat no longer fits. */
export function withTypedChat( values: Record<string, string>, chat: string ): Record<string, string> {
	const next: Record<string, string> = { ...values, chatId: chat };
	delete next.chatTitle;
	return next;
}
