/**
 * Shadowdark Extras — which tab of the active GM does the work (#187 review).
 *
 * Foundry lets one user be signed in from several tabs at once, and each tab
 * runs this module. Work that must happen once, such as finishing a camp's
 * rest, is done by one of the active GM's tabs: each GM tab says hello on the
 * module socket when it's ready and every HEARTBEAT_MS after, and of the tabs
 * still heard from, the one signed in longest is the one. With one tab there
 * is no one to hear from, and it is the one.
 */
import { MODULE_ID } from "./module-id.mjs";

const TYPE = "sdxGmSession";
const HEARTBEAT_MS = 5000;
/** This user's other tabs, by socket id: `{ since, seen }`. */
const sessions = new Map();
let since = null;

/**
 * Whether `mine` is the tab that works among `others`: the one signed in
 * longest, the socket id breaking a tie, ignoring any not heard from within
 * `timeoutMs`. Pure.
 */
export function isPrimarySession(mine, others, now, timeoutMs = 3 * HEARTBEAT_MS) {
	for (const [sid, s] of others) {
		if (now - s.seen > timeoutMs) continue;
		if (s.since < mine.since || (s.since === mine.since && sid < mine.sid)) return false;
	}
	return true;
}

/** Say hello to this user's other tabs, answer theirs, and keep saying it. Call at ready. */
export function registerGmSessions() {
	if (!game.user?.isGM || !game.socket) return;
	since = Date.now();
	const channel = `module.${MODULE_ID}`;
	const hello = (reply = false) => game.socket.emit(channel, {
		type: TYPE, userId: game.user.id, sid: game.socket.id, since, reply,
	});
	game.socket.on(channel, msg => {
		if (msg?.type !== TYPE || msg.userId !== game.user.id || msg.sid === game.socket.id) return;
		const known = sessions.has(msg.sid);
		sessions.set(msg.sid, { since: msg.since, seen: Date.now() });
		if (!known && !msg.reply) hello(true);
	});
	hello();
	setInterval(() => hello(), HEARTBEAT_MS)?.unref?.();
}

/** Whether this tab is the active GM's one working tab. */
export function isPrimaryGmSession() {
	if (!game.user?.isGM || game.users?.activeGM?.id !== game.user?.id) return false;
	if (since === null || !sessions.size) return true;
	return isPrimarySession({ sid: game.socket?.id, since }, sessions, Date.now());
}

// Registered as this loads (the camping rest imports it), so the composition root, at its size cap, needn't.
globalThis.Hooks?.once("ready", registerGmSessions);
