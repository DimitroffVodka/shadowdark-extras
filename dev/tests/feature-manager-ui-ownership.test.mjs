import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MODULE_ID = "shadowdark-extras";
const ROOT = new URL("../../", import.meta.url);

let disabledFeatureIds = [];
globalThis.game = {
	settings: {
		get: (_namespace, key) => key === "disabledFeatures" ? disabledFeatureIds : false,
	},
	i18n: { localize: key => key },
};
globalThis.foundry = {
	utils: {
		mergeObject: (base, updates) => ({ ...base, ...updates }),
	},
	// weapon-bonus-ui imports getCreatureTypes from CreatureTypesApp, whose
	// module scope builds an ApplicationV2 subclass. Only the import needs to
	// survive here; the editor app itself is never opened by these tests.
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: Base => class extends Base {},
		},
	},
};

const { FEATURE_IDS } = await import("../../scripts/settings/feature-gates.mjs");
const { injectWeaponBonusTab } = await import("../../scripts/combat/weapon-bonus-ui.mjs");

class Query {
	constructor(dom, selector, length = 1) {
		this.dom = dom;
		this.selector = selector;
		this.length = length;
	}

	find(selector) {
		this.dom.queries.push(`${this.selector} ${selector}`);
		if (selector === '[data-tab="tab-bonuses"]') {
			return new Query(this.dom, `${this.selector} ${selector}`, this.dom.nativeTab ? 1 : 0);
		}
		if (selector === '[data-tab="tab-source"]') {
			return new Query(this.dom, `${this.selector} ${selector}`, 0);
		}
		if (selector === ".sdx-weapon-animation-btn") {
			return new Query(this.dom, `${this.selector} ${selector}`, 0);
		}
		return new Query(this.dom, `${this.selector} ${selector}`);
	}

	on(event, selectorOrHandler, maybeHandler) {
		this.dom.bindings.push({
			selector: this.selector,
			event,
			delegatedSelector: typeof selectorOrHandler === "string" ? selectorOrHandler : null,
			handler: maybeHandler ?? selectorOrHandler,
		});
		return this;
	}

	before(html) {
		this.dom.fragments.push(String(html));
		return this;
	}

	after(html) {
		this.dom.fragments.push(String(html));
		return this;
	}

	append(html) {
		this.dom.fragments.push(String(html));
		return this;
	}

	removeClass() {
		return this;
	}
}

function makeWeaponSheet({ nativeTab = false, disabled = [] } = {}) {
	disabledFeatureIds = disabled;
	const dom = {
		nativeTab,
		bindings: [],
		fragments: [],
		queries: [],
	};
	const html = {
		find(selector) {
			dom.queries.push(selector);
			return new Query(dom, selector);
		},
	};
	const item = {
		type: "Weapon",
		flags: { [MODULE_ID]: { weaponBonus: { enabled: true, itemMacro: { triggers: [] } } } },
		getFlag: () => "",
	};

	injectWeaponBonusTab({ _tabs: [] }, html, item);
	return dom;
}

function hasBinding(dom, delegatedSelector) {
	return dom.bindings.some(binding => binding.delegatedSelector === delegatedSelector);
}

test("disabled Weapon Sprites owns no animation control in native weapon sheets", () => {
	const dom = makeWeaponSheet({
		nativeTab: true,
		disabled: [FEATURE_IDS.WEAPON_SPRITES],
	});

	assert.equal(dom.fragments.join(""), "", "native bonus sheets should receive no animation markup");
	assert.equal(dom.queries.some(selector => selector.includes(".sdx-weapon-animation-btn")), false);
	assert.equal(dom.bindings.some(binding => binding.selector.includes("sdx-weapon-animation-btn")), false);
});

test("disabled Weapon Sprites and Item Macros stay absent from fallback weapon sheets", () => {
	const dom = makeWeaponSheet({
		disabled: [FEATURE_IDS.WEAPON_SPRITES, FEATURE_IDS.ITEM_MACROS],
	});
	const rendered = dom.fragments.join("");

	assert.match(rendered, /data-tab="tab-bonuses"/, "Weapon Bonuses remains enabled in the fallback branch");
	assert.doesNotMatch(rendered, /sdx-weapon-animation-btn/);
	assert.doesNotMatch(rendered, /sdx-item-macro-fieldset/);
	assert.equal(dom.queries.some(selector => selector.includes(".sdx-weapon-animation-btn")), false);
	assert.equal(hasBinding(dom, ".sdx-macro-run-as-gm"), false);
	assert.equal(hasBinding(dom, ".sdx-item-macro-command"), false);
	assert.equal(hasBinding(dom, ".sdx-macro-trigger-checkbox"), false);
});

test("enabled-by-default fallback weapon sheets retain animation and Item Macro behavior", () => {
	const dom = makeWeaponSheet();
	const rendered = dom.fragments.join("");

	assert.match(rendered, /sdx-weapon-animation-btn/);
	assert.match(rendered, /sdx-item-macro-fieldset/);
	assert.equal(hasBinding(dom, ".sdx-macro-run-as-gm"), true);
	assert.equal(hasBinding(dom, ".sdx-item-macro-command"), true);
	assert.equal(hasBinding(dom, ".sdx-macro-trigger-checkbox"), true);
});

function splitExpression(expression) {
	const parts = [];
	let start = 0;
	let depth = 0;
	let quote = null;
	for (let index = 0; index < expression.length; index++) {
		const char = expression[index];
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
		}
		else if (char === "(") depth++;
		else if (char === ")") depth--;
		else if (/\s/.test(char) && depth === 0) {
			if (start < index) parts.push(expression.slice(start, index));
			start = index + 1;
		}
	}
	if (start < expression.length) parts.push(expression.slice(start));
	return parts;
}

function unwrap(expression) {
	let value = expression.trim();
	while (value.startsWith("(") && value.endsWith(")")) {
		let depth = 0;
		let wrapsAll = true;
		let quote = null;
		for (let index = 0; index < value.length; index++) {
			const char = value[index];
			if (quote) {
				if (char === quote) quote = null;
				continue;
			}
			if (char === "'" || char === '"') quote = char;
			else if (char === "(") depth++;
			else if (char === ")" && --depth === 0 && index !== value.length - 1) {
				wrapsAll = false;
				break;
			}
		}
		if (!wrapsAll) break;
		value = value.slice(1, -1).trim();
	}
	return value;
}

function resolvePath(path, contexts) {
	const expression = path.trim();
	if ((expression.startsWith("'") && expression.endsWith("'"))
		|| (expression.startsWith('"') && expression.endsWith('"'))) {
		return expression.slice(1, -1);
	}
	if (expression === "true") return true;
	if (expression === "false") return false;
	if (expression === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(expression)) return Number(expression);

	let currentIndex = contexts.length - 1;
	let remaining = expression;
	while (remaining.startsWith("../")) {
		currentIndex--;
		remaining = remaining.slice(3);
	}
	if (remaining === "this") return contexts[currentIndex];
	if (remaining.startsWith("this.")) remaining = remaining.slice(5);
	const value = remaining.split(".").reduce((current, key) => current?.[key], contexts[currentIndex]);
	return value;
}

function evaluate(expression, contexts) {
	const parts = splitExpression(unwrap(expression));
	if (parts.length === 1) return resolvePath(parts[0], contexts);
	const [operator, ...arguments_] = parts;
	if (operator === "and") return arguments_.every(argument => evaluate(argument, contexts));
	if (operator === "or") return arguments_.some(argument => evaluate(argument, contexts));
	if (operator === "not") return !evaluate(arguments_[0], contexts);
	if (operator === "eq") return evaluate(arguments_[0], contexts) === evaluate(arguments_[1], contexts);
	return undefined;
}

function parseTemplate(template) {
	const root = { type: "root", children: [], inverse: [], inElse: false };
	const stack = [root];
	const tokenPattern = /{{([\s\S]*?)}}/g;
	let textStart = 0;
	for (const match of template.matchAll(tokenPattern)) {
		const current = stack.at(-1);
		const target = current.inElse ? current.inverse : current.children;
		if (match.index > textStart) target.push({ type: "text", value: template.slice(textStart, match.index) });
		const token = match[1].trim();
		if (token.startsWith("!--") || token.startsWith("!")) {
			textStart = match.index + match[0].length;
			continue;
		}
		if (token.startsWith("#")) {
			const [type, ...expression] = splitExpression(token.slice(1));
			const node = { type, expression: expression.join(" "), children: [], inverse: [], inElse: false };
			target.push(node);
			stack.push(node);
		}
		else if (token === "else") {
			current.inElse = true;
		}
		else if (token.startsWith("/")) {
			stack.pop();
		}
		else {
			target.push({ type: "value", expression: token });
		}
		textStart = match.index + match[0].length;
	}
	const current = stack.at(-1);
	const target = current.inElse ? current.inverse : current.children;
	if (textStart < template.length) target.push({ type: "text", value: template.slice(textStart) });
	assert.equal(stack.length, 1, "scene template fixture parser must close every block");
	return root.children;
}

function renderNodes(nodes, contexts) {
	return nodes.map(node => {
		if (node.type === "text") return node.value;
		if (node.type === "value") {
			const value = resolvePath(node.expression, contexts);
			return value == null ? "" : String(value);
		}
		if (node.type === "if" || node.type === "unless") {
			const active = !!evaluate(node.expression, contexts) !== (node.type === "unless");
			return renderNodes(active ? node.children : node.inverse, contexts);
		}
		if (node.type === "each") {
			const values = resolvePath(node.expression, contexts);
			if (!Array.isArray(values) || values.length === 0) return renderNodes(node.inverse, contexts);
			return values.map(value => renderNodes(node.children, [...contexts, value])).join("");
		}
		throw new Error(`Unsupported scene template block: ${node.type}`);
	}).join("");
}

function renderSceneTemplate(template, context) {
	const start = template.indexOf("{{#if (and isGM features.tomScenes)}}");
	const end = template.indexOf("<!-- PARTY TAB -->", start);
	assert.ok(start >= 0 && end > start, "scene template block must be present");
	return renderNodes(parseTemplate(template.slice(start, end)), [context]);
}

function tomContext(playerView) {
	const scene = { id: "folder-scene", name: "Folder Scene", background: "folder.jpg", folderId: "folder-1" };
	return {
		isGM: true,
		viewMode: "scenes",
		features: { tomScenes: true, tomSceneEditor: true, tomPlayerView: playerView, tomVideoOverlays: false },
		tomActiveSceneId: scene.id,
		tomFolders: [{ id: "folder-1", name: "Folder", collapsed: false, scenes: [scene] }],
		tomScenes: [scene, { id: "loose-scene", name: "Loose Scene", background: "loose.jpg" }],
		tomOverlayOptions: [],
		tomOverlaysCollapsed: false,
		tomOverlayCount: 0,
	};
}

test("disabled ToM Player View removes broadcast affordances but preserves scene browsing and editor controls", async () => {
	const template = await readFile(new URL("templates/sdx-tray/tray.hbs", ROOT), "utf8");
	const rendered = renderSceneTemplate(template, tomContext(false));

	assert.equal((rendered.match(/data-action="stop-broadcast"/g) ?? []).length, 0);
	assert.equal((rendered.match(/scene-card-activate/g) ?? []).length, 0);
	assert.equal((rendered.match(/scene-card-preview/g) ?? []).length, 2);
	assert.equal((rendered.match(/class="scene-card /g) ?? []).length, 2);
	assert.match(rendered, /data-action="create-scene"/);
	assert.match(rendered, /data-action="edit-scene"/);
});

test("enabled-by-default ToM Player View retains stop and scene activation affordances", async () => {
	const template = await readFile(new URL("templates/sdx-tray/tray.hbs", ROOT), "utf8");
	const rendered = renderSceneTemplate(template, tomContext(true));

	assert.match(rendered, /data-action="stop-broadcast"/);
	assert.equal((rendered.match(/scene-card-activate/g) ?? []).length, 2);
	assert.equal((rendered.match(/scene-card-preview/g) ?? []).length, 0);
});
