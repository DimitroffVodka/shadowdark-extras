// Characterization tests for the journal pin context menu, captured BEFORE the
// Phase 5.3.5 extraction of _renderContextMenu out of JournalPinGraphics.
//
// The menu is built with raw DOM calls, so this file carries a small DOM stub
// rather than a full jsdom dependency. It records what the builder does:
// singleton behavior, item wiring, and the deferred dismissal listeners.

import assert from "node:assert/strict";
import test from "node:test";

// --- Minimal DOM ------------------------------------------------------------

class StubElement {
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
		if (node === this) return true;
		return this.children.some(c => c.contains(node));
	}

	addEventListener(type, fn) {
		(this.listeners[type] ??= []).push(fn);
	}

	removeEventListener(type, fn) {
		this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn);
	}

	dispatch(type, event) {
		for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
	}
}

const body = new StubElement("body");

globalThis.document = {
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
	addEventListener(type, fn) {
		(this.listeners[type] ??= []).push(fn);
	},
	removeEventListener(type, fn) {
		this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn);
	},
	dispatch(type, event) {
		for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
	},
	listenerCount(type) {
		return (this.listeners[type] ?? []).length;
	},
};

globalThis.PIXI = { Container: class {} };

globalThis.foundry = {
	utils: {
		escapeHTML: value => String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#x27;"),
	},
};

const { renderPinContextMenu } = await import("../../scripts/journal/pin-context-menu.mjs");

// The builder defers listener registration by 10ms; this waits past that.
const settle = () => new Promise(resolve => {
	setTimeout(resolve, 25);
});

function reset() {
	body.children = [];
	document.listeners = {};
}

function items(...names) {
	return names.map(name => {
		const calls = [];
		return { name, icon: "<i class=\"fa-solid fa-book\"></i>", calls, callback: () => calls.push(name) };
	});
}

const menuEl = () => document.getElementById("sdx-journal-pin-context-menu");

// --- Structure --------------------------------------------------------------

test("the menu mounts on document.body with a fixed id and position", async () => {
	reset();
	renderPinContextMenu(items("Open"), 120, 340);

	const menu = menuEl();
	assert.notEqual(menu, null);
	assert.equal(menu.parent, body);
	assert.equal(menu.className, "sdx-journal-pin-context-menu");
	assert.match(menu.style.cssText, /position:fixed/);
	assert.match(menu.style.cssText, /left:120px/);
	assert.match(menu.style.cssText, /top:340px/);

	await settle();
});

test("the menu is a singleton — rendering again replaces the previous one", async () => {
	reset();
	renderPinContextMenu(items("First"), 0, 0);
	renderPinContextMenu(items("Second"), 0, 0);

	const menus = body.children.filter(c => c.id === "sdx-journal-pin-context-menu");
	assert.equal(menus.length, 1);
	assert.match(menus[0].children[0].innerHTML, /Second/);

	await settle();
});

test("one row is rendered per menu item, in order", async () => {
	reset();
	renderPinContextMenu(items("Open", "Edit", "Delete"), 0, 0);

	const rows = menuEl().children;
	assert.equal(rows.length, 3);
	assert.ok(rows.every(r => r.className === "sdx-journal-pin-menu-item"));
	assert.match(rows[0].innerHTML, /Open/);
	assert.match(rows[1].innerHTML, /Edit/);
	assert.match(rows[2].innerHTML, /Delete/);

	await settle();
});

test("row markup is the item icon followed by its name", async () => {
	reset();
	const [item] = items("Open");
	renderPinContextMenu([item], 0, 0);

	assert.equal(menuEl().children[0].innerHTML, `${item.icon} Open`);

	await settle();
});

// A pin's menu row carries a journal page title, which is not caller-authored
// markup — so it is escaped. The icon beside it stays raw on purpose.
test("item names are escaped before reaching innerHTML", async () => {
	reset();
	const item = { name: "<img src=x onerror=alert(1)>", icon: "", callback: () => {} };
	renderPinContextMenu([item], 0, 0);

	const html = menuEl().children[0].innerHTML;
	assert.doesNotMatch(html, /<img/);
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);

	await settle();
});

test("escaping covers quotes and ampersands without touching the icon markup", async () => {
	reset();
	const icon = "<i class=\"fa-solid fa-book\"></i>";
	renderPinContextMenu([{ name: "Bell & \"Candle\"", icon, callback: () => {} }], 0, 0);

	const html = menuEl().children[0].innerHTML;
	assert.ok(html.startsWith(icon), "icon markup should pass through untouched");
	assert.match(html, /Bell &amp; &quot;Candle&quot;/);

	await settle();
});

// --- Interaction ------------------------------------------------------------

test("clicking a row fires its callback and dismisses the menu", async () => {
	reset();
	const list = items("Open", "Edit");
	renderPinContextMenu(list, 0, 0);

	menuEl().children[1].dispatch("click", {});

	assert.deepEqual(list[1].calls, ["Edit"]);
	assert.deepEqual(list[0].calls, []);
	assert.equal(menuEl(), null);

	await settle();
});

test("dismissal listeners are registered only after a deferral", async () => {
	reset();
	renderPinContextMenu(items("Open"), 0, 0);

	// Synchronously after render, the outside-click guard is not yet armed —
	// this is what stops the opening right-click from closing the menu.
	assert.equal(document.listenerCount("click"), 0);
	assert.equal(document.listenerCount("keydown"), 0);

	await settle();

	assert.equal(document.listenerCount("click"), 1);
	assert.equal(document.listenerCount("keydown"), 1);
});

test("a click inside the menu does not dismiss it", async () => {
	reset();
	renderPinContextMenu(items("Open"), 0, 0);
	await settle();

	const menu = menuEl();
	document.dispatch("click", { target: menu.children[0] });

	assert.notEqual(menuEl(), null);
});

test("a click outside dismisses the menu and unregisters both listeners", async () => {
	reset();
	renderPinContextMenu(items("Open"), 0, 0);
	await settle();

	document.dispatch("click", { target: new StubElement("div") });

	assert.equal(menuEl(), null);
	assert.equal(document.listenerCount("click"), 0);
	assert.equal(document.listenerCount("keydown"), 0);
});

test("Escape dismisses the menu and unregisters both listeners", async () => {
	reset();
	renderPinContextMenu(items("Open"), 0, 0);
	await settle();

	document.dispatch("keydown", { key: "Escape" });

	assert.equal(menuEl(), null);
	assert.equal(document.listenerCount("click"), 0);
	assert.equal(document.listenerCount("keydown"), 0);
});

test("a non-Escape key leaves the menu open", async () => {
	reset();
	renderPinContextMenu(items("Open"), 0, 0);
	await settle();

	document.dispatch("keydown", { key: "a" });

	assert.notEqual(menuEl(), null);
	assert.equal(document.listenerCount("keydown"), 1);
});
