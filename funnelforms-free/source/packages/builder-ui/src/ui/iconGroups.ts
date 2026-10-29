/**
 * Groups of the icon choice: icons that fit answers of forms, so the choice can be browsed without
 * a search word. Every name is one of the Lucide set the plugin ships (test/icons.test.ts).
 */
import { __ } from './i18n';

export interface IconGroup {
	id: string;
	title: string;
	icons: string[];
}

/** In the order the choice shows them; the first is shown when nothing fits the answer. */
export function iconGroups(): IconGroup[] {
	return [
		{ id: 'popular', title: __( 'Popular', 'funnelforms-pro' ), icons: [ 'house', 'building', 'car', 'truck', 'sun', 'zap', 'euro', 'wallet', 'briefcase', 'user', 'users', 'heart', 'star', 'thumbs-up', 'check', 'x', 'circle-question-mark', 'calendar', 'clock', 'phone', 'mail', 'map-pin', 'shield-check', 'gift', 'rocket', 'sparkles', 'target', 'trophy', 'face-slightly-smiling' ] },
		{ id: 'home', title: __( 'Home and building', 'funnelforms-pro' ), icons: [ 'house', 'house-plus', 'building', 'hotel', 'warehouse', 'factory', 'store', 'tent', 'castle', 'church', 'school', 'landmark', 'door-open', 'door-closed', 'key', 'key-round', 'lamp', 'lamp-desk', 'sofa', 'armchair', 'bed', 'bed-double', 'bath', 'shower-head', 'toilet', 'cooking-pot', 'refrigerator', 'washing-machine', 'microwave', 'fence', 'trees', 'paint-roller', 'paintbrush', 'hammer', 'wrench', 'drill', 'ruler', 'construction', 'hard-hat', 'brick-wall', 'heater', 'fan' ] },
		{ id: 'energy', title: __( 'Energy and technology', 'funnelforms-pro' ), icons: [ 'sun', 'sun-medium', 'solar-panel', 'zap', 'battery', 'battery-charging', 'battery-full', 'plug', 'plug-zap', 'power', 'lightbulb', 'flame', 'fuel', 'thermometer', 'thermometer-sun', 'snowflake', 'heater', 'wind', 'droplet', 'droplets', 'gauge', 'cpu', 'monitor', 'laptop', 'smartphone', 'tablet', 'wifi', 'router', 'server', 'cloud', 'satellite-dish', 'tv', 'cable' ] },
		{ id: 'vehicles', title: __( 'Vehicles and moving', 'funnelforms-pro' ), icons: [ 'car', 'car-front', 'car-taxi-front', 'bus', 'truck', 'caravan', 'bike', 'motorbike', 'scooter', 'tractor', 'ship', 'sailboat', 'plane', 'plane-takeoff', 'train-front', 'tram-front', 'forklift', 'package', 'package-open', 'boxes', 'container', 'fuel', 'parking-meter', 'route', 'navigation', 'map', 'map-pin', 'milestone' ] },
		{ id: 'money', title: __( 'Money and insurance', 'funnelforms-pro' ), icons: [ 'euro', 'dollar-sign', 'pound-sterling', 'swiss-franc', 'coins', 'banknote', 'wallet', 'credit-card', 'landmark', 'piggy-bank', 'receipt', 'percent', 'calculator', 'chart-line', 'chart-pie', 'trending-up', 'trending-down', 'hand-coins', 'badge-percent', 'badge-euro', 'shield', 'shield-check', 'umbrella', 'file-text', 'signature', 'scale' ] },
		{ id: 'work', title: __( 'Work and business', 'funnelforms-pro' ), icons: [ 'briefcase', 'briefcase-business', 'building', 'handshake', 'presentation', 'chart-bar', 'chart-column', 'target', 'rocket', 'lightbulb', 'puzzle', 'settings', 'wrench', 'clipboard-list', 'clipboard-check', 'list-checks', 'file-text', 'folder', 'printer', 'megaphone', 'store', 'shopping-cart', 'shopping-bag', 'tag', 'tags', 'award', 'medal', 'trophy', 'crown' ] },
		{ id: 'people', title: __( 'People and family', 'funnelforms-pro' ), icons: [ 'user', 'users', 'user-round', 'users-round', 'user-plus', 'user-check', 'baby', 'person-standing', 'accessibility', 'contact', 'heart-handshake', 'hand-heart', 'handshake', 'face-slightly-smiling', 'graduation-cap', 'school', 'dog', 'cat' ] },
		{ id: 'health', title: __( 'Health and wellbeing', 'funnelforms-pro' ), icons: [ 'heart', 'heart-pulse', 'activity', 'stethoscope', 'pill', 'syringe', 'hospital', 'cross', 'brain', 'eye', 'ear', 'bone', 'toothbrush', 'dumbbell', 'bike', 'footprints', 'apple', 'salad', 'leaf', 'flower', 'flower-2', 'sparkles', 'scissors', 'bath' ] },
		{ id: 'time', title: __( 'Time and dates', 'funnelforms-pro' ), icons: [ 'calendar', 'calendar-days', 'calendar-check', 'calendar-clock', 'clock', 'clock-3', 'clock-check', 'alarm-clock', 'timer', 'hourglass', 'sunrise', 'sunset', 'moon', 'sun', 'repeat' ] },
		{ id: 'contact', title: __( 'Contact', 'funnelforms-pro' ), icons: [ 'phone', 'phone-call', 'smartphone', 'mail', 'mail-open', 'message-circle', 'message-square', 'messages-square', 'send', 'at-sign', 'globe', 'video', 'mic', 'headphones', 'bell', 'map-pin' ] },
		{ id: 'answers', title: __( 'Answers and ratings', 'funnelforms-pro' ), icons: [ 'check', 'circle-check', 'x', 'circle-x', 'circle-question-mark', 'circle-alert', 'info', 'thumbs-up', 'thumbs-down', 'star', 'star-half', 'heart', 'face-grinning', 'face-slightly-smiling', 'face-neutral', 'face-slightly-frowning', 'face-angry', 'ban', 'plus', 'minus', 'circle', 'square', 'signal-low', 'signal-medium', 'signal-high', 'gauge', 'battery-low', 'battery-medium', 'battery-full' ] },
		{ id: 'leisure', title: __( 'Leisure, travel and food', 'funnelforms-pro' ), icons: [ 'plane', 'tree-palm', 'luggage', 'tent', 'mountain', 'map', 'compass', 'camera', 'eighth-notes', 'gamepad-2', 'ticket', 'party-popper', 'cake', 'gift', 'utensils', 'coffee', 'wine', 'beer', 'pizza', 'ice-cream-cone', 'book', 'book-open', 'film', 'tv' ] },
		{ id: 'nature', title: __( 'Nature and animals', 'funnelforms-pro' ), icons: [ 'tree-pine', 'trees', 'leaf', 'sprout', 'flower', 'flower-2', 'clover', 'sun', 'cloud', 'cloud-rain', 'snowflake', 'mountain', 'waves-horizontal', 'droplet', 'dog', 'cat', 'bird', 'fish', 'rabbit', 'paw-print', 'bug', 'recycle' ] },
	];
}
