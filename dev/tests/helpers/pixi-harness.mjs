// Test harness for PIXI-backed pointer interaction code.
//
// The canvas classes in scripts/journal and scripts/canvas are PIXI display
// objects that react to pointer events. Their logic — drag dead zones, GM
// gating, which listeners get attached and released — is ordinary branching,
// but it is unreachable from a test without a PIXI object graph to hang it on.
//
// This provides the smallest graph that behaves like the real one for those
// purposes: an event emitter with PIXI's (event, handler, context) signature,
// a display object with position/scale/rotation and a parent that can convert
// global coordinates to local ones, and recorders for the ambient globals the
// code reaches for (gsap, game, ui).
//
// Nothing here simulates rendering. Anything that needs a real texture belongs
// in a live Foundry check, not in this harness.

/** PIXI's EventEmitter dispatches with an explicit context argument. */
export class StubEmitter {
	constructor() {
		this._handlers = [];
	}

	on(event, fn, context) {
		this._handlers.push({ event, fn, context });
		return this;
	}

	off(event, fn, context) {
		this._handlers = this._handlers.filter(h =>
			!(h.event === event && h.fn === fn && h.context === context));
		return this;
	}

	emit(event, ...args) {
		for (const h of [...this._handlers]) {
			if (h.event === event) h.fn.call(h.context ?? this, ...args);
		}
		return this;
	}

	/** Event names currently subscribed, in registration order, with duplicates. */
	listenerEvents() {
		return this._handlers.map(h => h.event);
	}

	listenerCount(event) {
		return this._handlers.filter(h => h.event === event).length;
	}
}

class Point {
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}

	set(x, y = x) {
		this.x = x;
		this.y = y;
		return this;
	}
}

/** Minimal stand-in for PIXI.Container. */
export class StubContainer extends StubEmitter {
	constructor() {
		super();
		this.position = new Point(0, 0);
		this.scale = new Point(1, 1);
		this.rotation = 0;
		this.visible = true;
		this.alpha = 1;
		this.children = [];
		this.parent = null;
		this.destroyed = false;
		this.filters = null;
		this.eventMode = "none";
		this.cursor = null;
		this.hitArea = null;
		this.cullable = false;
	}

	addChild(child) {
		child.parent = this;
		this.children.push(child);
		return child;
	}

	removeChild(child) {
		this.children = this.children.filter(c => c !== child);
		if (child) child.parent = null;
		return child;
	}

	destroy() {
		this.destroyed = true;
	}
}

/**
 * A parent whose toLocal() applies a fixed offset, so tests can distinguish
 * "global coordinates" from "local ones" instead of both being identity.
 */
export class StubParent extends StubContainer {
	constructor({ offsetX = 0, offsetY = 0 } = {}) {
		super();
		this.offsetX = offsetX;
		this.offsetY = offsetY;
	}

	toLocal(global) {
		return { x: global.x - this.offsetX, y: global.y - this.offsetY };
	}
}

/** Records gsap calls rather than animating. Tween targets are kept by identity. */
export function makeGsapRecorder() {
	const calls = [];
	const record = name => (...args) => {
		calls.push({ name, target: args[0], vars: args[1] });
		return { kill() {} };
	};
	return {
		calls,
		names: () => calls.map(c => c.name),
		of: name => calls.filter(c => c.name === name),
		reset: () => { calls.length = 0; },
		to: record("to"),
		from: record("from"),
		fromTo: (target, from, to) => {
			calls.push({ name: "fromTo", target, vars: to, fromVars: from });
			return { kill() {} };
		},
		killTweensOf: record("killTweensOf"),
		timeline: () => {
			const tl = { to: () => tl };
			calls.push({ name: "timeline" });
			return tl;
		},
	};
}

/**
 * A PIXI pointer event shaped the way the handlers read it: `global` for
 * coordinates, and a button reachable through data.originalEvent /
 * nativeEvent / the event itself.
 */
export function makePointerEvent({ button = 0, x = 0, y = 0, native = true } = {}) {
	const event = {
		global: { x, y },
		stopped: 0,
		prevented: 0,
		stopPropagation() { this.stopped++; },
	};
	const original = {
		button,
		preventDefault() { event.prevented++; },
	};
	if (native) event.nativeEvent = original;
	else event.data = { originalEvent: original };
	return event;
}

/** Minimal DOM element, enough for menu/overlay builders. */
export class StubElement {
	constructor(tag) {
		this.tagName = tag.toUpperCase();
		this.id = "";
		this.className = "";
		this.innerHTML = "";
		this.style = { cssText: "" };
		this.children = [];
		this.parent = null;
		this.listeners = {};
	}

	appendChild(child) {
		child.parent = this;
		this.children.push(child);
		return child;
	}

	remove() {
		if (!this.parent) return;
		this.parent.children = this.parent.children.filter(c => c !== this);
		this.parent = null;
	}

	contains(node) {
		return node === this || this.children.some(c => c.contains(node));
	}

	addEventListener(type, fn) {
		(this.listeners[type] ??= []).push(fn);
	}

	removeEventListener(type, fn) {
		this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn);
	}

	dispatch(type, event = {}) {
		for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
	}

	/** Visible text, with the icon markup stripped. */
	get label() {
		return this.innerHTML.replace(/<[^>]*>/g, "").trim();
	}
}

/**
 * Install a document stub. Separate from installCanvasGlobals because only
 * the DOM-building paths (context menus, overlays) need it.
 */
export function installDom() {
	const body = new StubElement("body");
	const doc = {
		body,
		listeners: {},
		createElement: tag => new StubElement(tag),
		getElementById(id) {
			const walk = node => {
				if (node.id === id) return node;
				for (const child of node.children) {
					const hit = walk(child);
					if (hit) return hit;
				}
				return null;
			};
			return walk(body);
		},
		addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
		removeEventListener(type, fn) {
			this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn);
		},
		reset() { body.children = []; this.listeners = {}; },
	};
	globalThis.document = doc;
	return doc;
}

/**
 * Install the ambient globals the canvas modules read. Call BEFORE importing
 * the module under test — these are read at class-definition and call time.
 *
 * Returns handles for assertions plus a `setGsap` switch, so the no-gsap
 * fallback paths can be exercised in the same file.
 */
export function installCanvasGlobals({ isGM = true, gsap = makeGsapRecorder() } = {}) {
	const notifications = { warn: [], error: [], info: [] };
	const journals = new Map();
	const rendered = [];

	globalThis.PIXI = {
		Container: StubContainer,
		Graphics: class extends StubContainer {},
		Sprite: class extends StubContainer {},
		Text: class extends StubContainer {},
	};

	globalThis.foundry = {
		utils: {
			deepClone: value => JSON.parse(JSON.stringify(value ?? null)),
			getProperty: (obj, key) => key.split(".").reduce((o, k) => o?.[k], obj),
			mergeObject: (a, b) => Object.assign(a, b),
			randomID: () => "test-id",
			escapeHTML: value => String(value)
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#x27;"),
		},
	};

	globalThis.game = {
		user: { isGM, id: "user-1" },
		journal: {
			get: id => journals.get(id) ?? null,
		},
		settings: { get: () => undefined },
		socket: { emit() {} },
	};

	globalThis.ui = {
		notifications: {
			warn: msg => notifications.warn.push(msg),
			error: msg => notifications.error.push(msg),
			info: msg => notifications.info.push(msg),
		},
	};

	globalThis.canvas = {
		scene: { id: "scene-1" },
		app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
		ping() {},
		animatePan() {},
	};

	globalThis.window = globalThis.window ?? {};
	globalThis.window.gsap = gsap;
	globalThis.gsap = gsap;

	return {
		notifications,
		rendered,
		gsap,
		/** Register a journal whose sheet.render() records its arguments. */
		addJournal(id, { pages = [] } = {}) {
			const journal = {
				id,
				pages,
				sheet: {
					render: (...args) => rendered.push({ id, args }),
				},
			};
			journals.set(id, journal);
			return journal;
		},
		setGM(value) {
			globalThis.game.user.isGM = value;
		},
		/** Swap gsap out (undefined exercises the non-animated fallbacks). */
		setGsap(next) {
			globalThis.window.gsap = next;
			globalThis.gsap = next;
		},
	};
}
