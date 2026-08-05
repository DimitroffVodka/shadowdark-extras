// Harness for the tray/sheet applications, which are ApplicationV2 classes
// whose behaviour lives almost entirely in _onRender: several hundred
// `elem.querySelector(sel)?.addEventListener(type, handler)` pairs.
//
// Two things stand between those handlers and a test. The first is the ambient
// Foundry API the modules touch at load time (foundry.*, CONFIG, CONST,
// Hooks); installAppGlobals covers it with namespaces that vivify on access,
// so a module extending foundry.canvas.layers.CanvasLayer gets a real base
// class without anyone having to enumerate the namespace first.
//
// The second is the DOM. Rather than implement a CSS selector engine, the DOM
// here is keyed BY SELECTOR STRING: querySelector(".foo") always returns the
// same node for ".foo", whether or not anything resembling that element would
// exist. That inversion is what makes the interesting assertions cheap:
//
//   - every (selector, event) pair a render binds is recorded, so the full
//     binding manifest can be frozen and compared across a refactor;
//   - a handler can be pulled out by the selector that owns it and invoked
//     directly, so routing can be tested without synthesising a page.
//
// The cost is that presence checks always succeed. Selectors listed in
// `absent` return null instead, which is how the "element missing" branches
// get exercised.

/**
 * A namespace whose members vivify on access as extendable classes, so code
 * can extend or call something this file never had to know about.
 *
 * @param {Object} [overrides] - Members to serve as-is instead of vivifying.
 */
export function stubNamespace(overrides = {}) {
	const cache = new Map();
	const base = class SdxStub {};
	// A subclass calling super.someMethod() must find something callable, so
	// unknown instance members resolve to no-ops. `then` is excluded, or
	// awaiting an instance would treat it as a thenable and hang.
	const OPAQUE = new Set(["then", "toJSON", "inspect", "nodeType"]);
	Object.setPrototypeOf(base.prototype, new Proxy({}, {
		get(target, key) {
			if (typeof key === "symbol" || OPAQUE.has(key)) return Reflect.get(target, key);
			return function stubMethod() {};
		},
		has() {
			return true;
		},
	}));
	return new Proxy(base, {
		get(target, key) {
			if (Object.hasOwn(overrides, key)) return overrides[key];
			// Functions have non-configurable own properties (prototype, name,
			// length); a proxy must serve those unchanged or the get trap throws.
			if (typeof key === "symbol" || Object.hasOwn(target, key)) return Reflect.get(target, key);
			if (!cache.has(key)) cache.set(key, stubNamespace());
			return cache.get(key);
		},
		has() {
			return true;
		},
	});
}

class StubClassList {
	constructor(node) {
		this.node = node;
		this.tokens = new Set();
	}

	add(...names) {
		for (const name of names) this.tokens.add(name);
		this.node.classLog.push(["add", ...names]);
	}

	remove(...names) {
		for (const name of names) this.tokens.delete(name);
		this.node.classLog.push(["remove", ...names]);
	}

	toggle(name, force) {
		const on = force === undefined ? !this.tokens.has(name) : !!force;
		if (on) this.tokens.add(name);
		else this.tokens.delete(name);
		this.node.classLog.push(["toggle", name, on]);
		return on;
	}

	contains(name) {
		return this.tokens.has(name);
	}
}

/**
 * One node in the selector-keyed DOM. `path` is the selector chain that
 * reached it, which is what the binding manifest is keyed on.
 */
export class SelectorNode {
	constructor(dom, path) {
		this.dom = dom;
		this.path = path;
		this.dataset = {};
		this.style = {};
		this.classList = new StubClassList(this);
		this.classLog = [];
		this.listeners = new Map();
		this.children = [];
		this.parentElement = null;
		this.textContent = "";
		this.innerHTML = "";
		this.value = "";
		this.checked = false;
		// Select-element shape. A node stands in for any element, and code that
		// reads the selected <option> must find an empty list rather than throw.
		this.options = [];
		this.selectedIndex = -1;
		this.name = "";
		this.removed = false;
		this.appended = [];
		this._queries = new Map();
	}

	querySelector(selector) {
		return this.dom._resolve(this, selector);
	}

	querySelectorAll(selector) {
		return this.dom._resolveAll(this, selector);
	}

	addEventListener(type, handler) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(handler);
		this.dom.bindings.push({ selector: this.path, event: type, handler });
	}

	removeEventListener(type, handler) {
		const list = this.listeners.get(type) ?? [];
		this.listeners.set(type, list.filter(h => h !== handler));
	}

	/** Invoke every handler registered for `type`, in registration order. */
	dispatch(type, event = {}) {
		const results = [];
		for (const handler of [...(this.listeners.get(type) ?? [])]) {
			results.push(handler.call(this, this.dom.makeEvent(event, this)));
		}
		return results;
	}

	/** The nearest ancestor whose path ends with `selector`, or null. */
	closest(selector) {
		let node = this;
		while (node) {
			if (node.path === selector || node.path.endsWith(` ${selector}`)) return node;
			node = node.parentElement;
		}
		return this.dom.closestResults.get(selector) ?? null;
	}

	contains(node) {
		if (node === this) return true;
		return this.children.some(child => child.contains?.(node));
	}

	appendChild(child) {
		if (child) child.parentElement = this;
		this.children.push(child);
		this.appended.push(child);
		return child;
	}

	append(...items) {
		this.appended.push(...items);
	}

	remove() {
		this.removed = true;
		this.dom.removed.push(this.path);
	}

	focus() {}

	select() {}
}

/**
 * A DOM keyed by selector string.
 *
 * @param {Object} [options]
 * @param {string[]} [options.absent] - Selectors that resolve to null.
 * @param {Object} [options.lists] - Seeded querySelectorAll results, as
 *   `{ selector: [{ dataset, value, ... }] }`. Each entry becomes a node.
 * @param {boolean} [options.seedAll] - Give every unseeded querySelectorAll a
 *   single node, so a render's per-element bindings reach the manifest without
 *   each collection having to be enumerated first.
 * @param {Object} [options.closest] - Fallback closest() results by selector.
 */
export function makeSelectorDom({ absent = [], lists = {}, seedAll = false, closest = {} } = {}) {
	const absentSet = new Set(absent);

	const dom = {
		bindings: [],
		removed: [],
		nodes: new Map(),
		closestResults: new Map(Object.entries(closest)),
		listSeeds: new Map(Object.entries(lists)),

		_node(path) {
			if (!this.nodes.has(path)) this.nodes.set(path, new SelectorNode(this, path));
			return this.nodes.get(path);
		},

		_resolve(parent, selector) {
			if (absentSet.has(selector)) return null;
			const path = parent ? `${parent.path} ${selector}` : selector;
			if (absentSet.has(path)) return null;
			const node = this._node(path);
			if (parent && !node.parentElement) node.parentElement = parent;
			return node;
		},

		_resolveAll(parent, selector) {
			const path = parent ? `${parent.path} ${selector}` : selector;
			const seeds = this.listSeeds.get(selector) ?? this.listSeeds.get(path) ?? (seedAll ? [{}] : null);
			if (!seeds) return [];
			return seeds.map((seed, index) => {
				const node = this._node(`${path}[${index}]`);
				if (parent && !node.parentElement) node.parentElement = parent;
				Object.assign(node.dataset, seed.dataset ?? {});
				for (const [key, value] of Object.entries(seed)) {
					if (key !== "dataset") node[key] = value;
				}
				return node;
			});
		},

		makeEvent(event, target) {
			return {
				target,
				currentTarget: target,
				preventDefault() {},
				stopPropagation() {},
				...event,
			};
		},

		/** Every (selector, event) pair bound so far, sorted and deduplicated. */
		manifest() {
			return [...new Set(this.bindings.map(b => `${b.selector} :: ${b.event}`))].sort();
		},

		/** Handlers registered for a selector path and event type. */
		handlers(selector, event) {
			return this.bindings.filter(b => b.selector === selector && b.event === event)
				.map(b => b.handler);
		},

		/** The single handler for a selector path and event type. */
		handler(selector, event) {
			const found = this.handlers(selector, event);
			if (found.length !== 1) {
				throw new Error(`expected exactly one ${event} handler on "${selector}", found ${found.length}`);
			}
			return found[0];
		},

		/** Fire a selector's handler with an event, awaiting an async one. */
		fire(selector, event, eventInit = {}) {
			const node = this.nodes.get(selector);
			return this.handler(selector, event).call(node, this.makeEvent(eventInit, node));
		},

		node(selector) {
			return this._node(selector);
		},

		reset() {
			this.bindings.length = 0;
			this.removed.length = 0;
			this.nodes.clear();
		},
	};

	const document = {
		querySelector: selector => dom._resolve(null, selector),
		querySelectorAll: selector => dom._resolveAll(null, selector),
		createElement: tag => {
			const node = new SelectorNode(dom, `<${tag}>`);
			node.tagName = tag.toUpperCase();
			return node;
		},
		body: dom._node("body"),
		listeners: new Map(),
		addEventListener(type, handler) {
			if (!this.listeners.has(type)) this.listeners.set(type, []);
			this.listeners.get(type).push(handler);
		},
		removeEventListener(type, handler) {
			const list = this.listeners.get(type) ?? [];
			this.listeners.set(type, list.filter(h => h !== handler));
		},
	};

	dom.document = document;
	return dom;
}

/**
 * A jQuery stand-in for the AppV1 sheets, whose activateListeners(html) binds
 * through `html.find(selector).click(handler)` rather than addEventListener.
 *
 * Same idea as makeSelectorDom: find() is keyed by selector string and records
 * what gets bound to it, so activateListeners yields a manifest of the same
 * shape and handlers stay reachable by selector.
 *
 * @param {Object} [dom] - Backing selector DOM, so html.get(0) and any
 *   querySelector calls resolve against the same node set.
 */
export function makeJquery(dom = makeSelectorDom()) {
	const EVENTS = ["click", "change", "contextmenu", "submit", "input", "focus", "blur",
		"dblclick", "mousedown", "mouseup", "keydown", "keyup", "dragstart", "dragover", "drop"];

	const wrap = (selector, node) => {
		const api = {
			selector,
			get: index => (index === 0 ? node : undefined),
			find: inner => wrap(`${selector} ${inner}`, dom.node(`${selector} ${inner}`)),
			each(fn) {
				fn.call(node, 0, node);
				return api;
			},
			on(event, handler) {
				dom.bindings.push({ selector, event, handler });
				return api;
			},
			addClass: () => api,
			removeClass: () => api,
			attr: () => api,
			val: () => node.value,
			length: 1,
			0: node,
		};
		for (const event of EVENTS) {
			api[event] = handler => {
				dom.bindings.push({ selector, event, handler });
				return api;
			};
		}
		return api;
	};

	const root = wrap(".sheet", dom.node(".sheet"));
	root.find = inner => wrap(inner, dom.node(inner));
	root.dom = dom;
	return root;
}

/**
 * Install the ambient globals an ApplicationV2 module reads at load and render
 * time. Call BEFORE importing the module under test.
 *
 * `foundry.utils` and `foundry.data` are preserved from installCanvasGlobals
 * when it has already run, so the two harnesses compose.
 *
 * @param {Object} [options]
 * @param {Object} [options.dom] - A makeSelectorDom() result to install as
 *   globalThis.document.
 * @param {Object} [options.applications] - Extra foundry.applications members.
 * @returns {{hooks: Array, helpers: Map, dom: Object}} recorded registrations.
 */
export function installAppGlobals({ dom = makeSelectorDom(), applications = {} } = {}) {
	const hooks = [];
	const helpers = new Map();

	globalThis.Hooks = {
		on: (name, fn) => {
			hooks.push({ kind: "on", name, fn });
			return hooks.length;
		},
		once: (name, fn) => {
			hooks.push({ kind: "once", name, fn });
			return hooks.length;
		},
		off() {},
		call() {},
		callAll() {},
	};

	globalThis.Handlebars = {
		registerHelper: (name, fn) => helpers.set(name, fn),
		registerPartial() {},
	};

	globalThis.CONFIG = stubNamespace();
	globalThis.CONST = stubNamespace({
		GRID_TYPES: { GRIDLESS: 0, SQUARE: 1, HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 },
		DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
	});

	// Keep whatever installCanvasGlobals put on foundry.utils / foundry.data.
	const utils = globalThis.foundry?.utils ?? {};
	const data = globalThis.foundry?.data ?? {};

	class StubApplicationV2 {
		static DEFAULT_OPTIONS = {};

		static PARTS = {};

		constructor(options = {}) {
			this.options = options;
			this.renderCount = 0;
			this.closeCount = 0;
		}

		render() {
			this.renderCount++;
			return this;
		}

		async close() {
			this.closeCount++;
			return this;
		}

		_onRender() {}
	}

	globalThis.foundry = stubNamespace({
		utils,
		data,
		applications: stubNamespace({
			api: stubNamespace({
				ApplicationV2: StubApplicationV2,
				HandlebarsApplicationMixin: Base => class extends Base {},
				DialogV2: class StubDialogV2 {
					constructor(config = {}) {
						this.config = config;
					}

					async render() {
						return this;
					}
				},
			}),
			apps: stubNamespace(),
			...applications,
		}),
	});

	globalThis.document = dom.document;
	globalThis.window = globalThis.window ?? {};
	globalThis.requestAnimationFrame = fn => {
		fn(0);
		return 0;
	};
	globalThis.cancelAnimationFrame = () => {};

	return { hooks, helpers, dom };
}
