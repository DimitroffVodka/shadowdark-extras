/**
 * Scanner: template-literal interpolations that land inside an HTML attribute
 * value without being escaped.
 *
 * WHY IT EXISTS. The gate this replaces was a single grep:
 *
 *     src="\$\{[A-Za-z_$][A-Za-z0-9_$]*\.(img|image)\}"
 *
 * It required the interpolation to be exactly `${identifier.img}`. Every one of
 * the ~90 unescaped sites found in #125 fails that shape, so it matched nothing
 * and reported the class clean, which is worse than no gate: it reads as green.
 * A chat card renders on every connected client, so a player who renames a spell
 * to `x" onerror="alert(1)` gets script execution in the GM's session.
 *
 * WHY THIS IS A PARSER AND NOT A TEXT SCANNER ANY MORE. The first three
 * versions counted brace depth over text and decided escaping by matching the
 * expression string. Review found eight distinct false negatives across two
 * rounds, and they were all one defect wearing different clothes — a textual
 * guess about JavaScript structure. Each fix bought one shape and left the
 * class:
 *
 *   - `<` and `>` inside a quoted value read as an unterminated quote, so
 *     `title="level > ${doc.name}"` was skipped in silence
 *   - `${x || "{"}` raised the depth count and never brought it back down
 *   - a value whose first interpolation sat past a length cap vanished
 *   - `${(escapeHTML(raw))}` and an escape call followed by a comment reported,
 *     because parens and comments are not part of a call expression's extent
 *   - an apostrophe inside a double-quoted string read as a mismeasured value
 *
 * All of those are free here: acorn already knows where an expression starts
 * and ends, what is a comment, and what is a string. The only thing still done
 * textually is walking the HTML inside the template's literal chunks, which
 * really is text.
 *
 * WHAT IT MATCHES. Any interpolation inside a quoted value — single or double —
 * of one of ATTRIBUTES or any `data-*`, with any whitespace around the `=`,
 * across any number of lines. A template literal nested inside an interpolation
 * is visited in its own right, so its attributes are covered too.
 *
 * WHAT IT SKIPS, and only this:
 *
 *   1. An expression that IS a call to a named escape helper (ESCAPE_NAMES), or
 *      an identifier resolving to a declaration initialised from one. The
 *      resolution is real scope analysis — see declaredEscapedNames — because
 *      the versions that guessed produced a user-visible double-escaping bug and
 *      six unsound shadowing shapes.
 *   2. An expression that can only produce module-owned text: a literal, or a
 *      `game.i18n.localize` / `game.i18n.format` call over literals.
 *
 * Everything else reports. A false negative here ships an XSS past a green gate,
 * so where the two are in tension this errs loudly.
 */

import * as acorn from "acorn";

/** Attributes this tree interpolates user data into, plus any `data-*`. */
const ATTRIBUTES = new Set(["src", "alt", "title", "value", "href", "placeholder"]);

/**
 * Escape helpers BY NAME, exhaustively.
 *
 * This used to be `/\besc[A-Za-z]*\(/`, which accepts `escalate(doc.name)` and
 * `service.escalate(doc.name)` — ordinary verbs that escape nothing. A prefix
 * pattern is name-trust with extra steps; an explicit list is the only version
 * of this that means anything. Extend it deliberately.
 */
const ESCAPE_NAMES = new Set([
	"escapeHTML", "escapeHtml", "esc", "escapeAttr", "escapeAttribute",
	// skills-box.mjs defines its own, and it is a full five-character escape.
	"escapeHtmlSkills",
]);

/** Does this callee name an escape helper — bare, or as a member call? */
function isEscapeCallee(callee) {
	if (!callee) return false;
	if (callee.type === "Identifier") return ESCAPE_NAMES.has(callee.name);
	if (callee.type === "MemberExpression" && !callee.computed && callee.property?.type === "Identifier") {
		return ESCAPE_NAMES.has(callee.property.name);
	}
	return false;
}

const isEscapeCall = (node) => node?.type === "CallExpression" && isEscapeCallee(node.callee);

/** Walk every node in an ESTree tree. */
function visit(node, enter) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) { for (const child of node) visit(child, enter); return; }
	if (typeof node.type !== "string") return;
	enter(node);
	for (const key of Object.keys(node)) {
		if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
		visit(node[key], enter);
	}
}

/**
 * Which names are bound to an escape call at any given offset.
 *
 * REAL SCOPE ANALYSIS, because six review findings came from approximating it.
 * `var` hoists to the nearest FUNCTION; `let`/`const`/`class`, parameters and a
 * catch binding belong to the nearest BLOCK. Blocks include switch bodies, class
 * static blocks, loop heads and catch clauses — every one of those was a hole.
 *
 * Any write that is not itself an escape call marks the name unescaped,
 * destructuring assignment included. Flow-insensitive on purpose: it can only
 * turn an accept into a report, never the reverse, which is the only direction
 * this gate can afford to be wrong in.
 */
function declaredEscapedNames(ast) {
	const scopes = [];
	const makeScope = (node, kind, parent) => {
		const scope = { start: node.start, end: node.end, kind, parent, names: new Map() };
		scopes.push(scope);
		return scope;
	};

	const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
	const BLOCKS = new Set([
		"BlockStatement", "StaticBlock", "SwitchStatement", "CatchClause",
		"ForStatement", "ForOfStatement", "ForInStatement", "ClassBody",
	]);

	const root = makeScope(ast, "function", null);

	/** The nearest enclosing function scope, for `var`. */
	const functionScope = (scope) => {
		let current = scope;
		while (current && current.kind !== "function") current = current.parent;
		return current ?? root;
	};

	const declarePattern = (pattern, scope, escaped) => {
		if (!pattern) return;
		switch (pattern.type) {
			case "Identifier": scope.names.set(pattern.name, escaped); break;
			case "ObjectPattern":
				for (const property of pattern.properties) {
					declarePattern(property.type === "Property" ? property.value : property, scope, false);
				}
				break;
			case "ArrayPattern": for (const element of pattern.elements) declarePattern(element, scope, false); break;
			case "AssignmentPattern": declarePattern(pattern.left, scope, false); break;
			case "RestElement": declarePattern(pattern.argument, scope, false); break;
			case "MemberExpression": break; // `obj.x = …` binds nothing
			default: break;
		}
	};

	/** Mark a write against the scope that DECLARES the name, not the current one. */
	const assignPattern = (pattern, scope, escaped) => {
		if (!pattern) return;
		if (pattern.type === "Identifier") {
			let owner = scope;
			while (owner && !owner.names.has(pattern.name)) owner = owner.parent;
			// Never declared in this file: record on the root so it still poisons.
			(owner ?? root).names.set(pattern.name, escaped);
			return;
		}
		// Any other target is a pattern; nothing it binds can be considered escaped.
		declarePattern(pattern, scope, false);
	};

	const walk = (node, scope) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) { for (const child of node) walk(child, scope); return; }
		if (typeof node.type !== "string") return;

		let current = scope;
		if (FUNCTIONS.has(node.type)) {
			current = makeScope(node, "function", scope);
			for (const param of node.params ?? []) declarePattern(param, current, false);
		}
		else if (BLOCKS.has(node.type)) {
			current = makeScope(node, "block", scope);
			if (node.type === "CatchClause") declarePattern(node.param, current, false);
		}

		if (node.type === "VariableDeclaration") {
			for (const declarator of node.declarations) {
				const target = node.kind === "var" ? functionScope(current) : current;
				declarePattern(declarator.id, target, isEscapeCall(declarator.init));
			}
		}

		// An assignment WRITES an existing binding; it does not create one in the
		// scope where it happens. Declaring it locally let `{ x = raw; }` inside a
		// block leave an escaped outer `x` still marked escaped.
		if (node.type === "AssignmentExpression") assignPattern(node.left, current, isEscapeCall(node.right));
		if (node.type === "UpdateExpression") assignPattern(node.argument, current, false);

		for (const key of Object.keys(node)) {
			if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
			walk(node[key], current);
		}
	};
	walk(ast, root);

	return (offset, name) => {
		// The innermost scope containing the offset that knows this name wins, so
		// a shadowing raw declaration beats an escaped outer one.
		const containing = scopes
			.filter((scope) => scope.start <= offset && offset < scope.end && scope.names.has(name))
			.sort((a, b) => (b.end - b.start) - (a.end - a.start));
		const innermost = containing[containing.length - 1];
		return innermost ? innermost.names.get(name) : false;
	};
}

/** Can this expression only ever produce text this module owns? */
function isModuleOwned(node) {
	if (!node) return false;
	if (node.type === "Literal") return true;
	if (node.type === "TemplateLiteral") return node.expressions.every(isModuleOwned);
	if (node.type === "BinaryExpression" && node.operator === "+") {
		return isModuleOwned(node.left) && isModuleOwned(node.right);
	}
	// `game.i18n.localize(K) || "fallback"` — both sides module text.
	if (node.type === "LogicalExpression") {
		return isModuleOwned(node.left) && isModuleOwned(node.right);
	}
	if (node.type === "ConditionalExpression") {
		return isModuleOwned(node.consequent) && isModuleOwned(node.alternate);
	}
	if (node.type === "CallExpression") {
		const callee = node.callee;
		const isI18n = callee?.type === "MemberExpression"
			&& callee.object?.type === "MemberExpression"
			&& callee.object.object?.name === "game"
			&& callee.object.property?.name === "i18n"
			&& ["localize", "format"].includes(callee.property?.name);
		return isI18n && node.arguments.every(isModuleOwned);
	}
	return false;
}

/**
 * Which interpolations of a template literal sit inside a matched attribute.
 *
 * The chunks between interpolations are genuinely HTML text, so this part is a
 * character walk — but only over text acorn has already identified as text,
 * never over code.
 *
 * @returns {Map<number, string>} expression index -> attribute name
 */
function attributeInterpolations(template) {
	const inside = new Map();
	let attribute = null;   // attribute whose value is being read
	let quote = null;       // the quote that opened that value
	let pending = "";       // token being accumulated, for the name
	let lastToken = "";     // the completed token before any whitespace
	// Attributes count inside a tag — and also in a bare FRAGMENT, because this
	// tree builds them: `` `data-item-id="${entry.id}"` `` is assembled on its own
	// and interpolated into a tag elsewhere (containers.mjs:767). Requiring a `<`
	// dropped those, which is a false negative.
	//
	// What must stay excluded is a SELECTOR — `.row[data-token-id="${t.id}"]`,
	// `[data-action="${A}"]` — which is not markup at all. Selector syntax
	// announces itself with `[`, `.` or `#` before any tag, so a fragment counts
	// only until one of those appears. The old text scanner got this right by
	// accident, gluing the selector prefix onto the name; this states the rule.
	let inTag = false;
	let sawTag = false;
	let sawSelector = false;

	for (let i = 0; i < template.quasis.length; i += 1) {
		const text = template.quasis[i].value.cooked ?? template.quasis[i].value.raw;

		for (let c = 0; c < text.length; c += 1) {
			const char = text[c];

			if (quote) {
				if (char === quote) { quote = null; attribute = null; }
				continue;
			}

			if (char === "<") { inTag = true; sawTag = true; pending = ""; lastToken = ""; attribute = null; continue; }
			if (char === ">") { inTag = false; pending = ""; lastToken = ""; attribute = null; continue; }

			if (!sawTag && (char === "[" || char === "." || char === "#")) {
				sawSelector = true;
				pending = "";
				lastToken = "";
				attribute = null;
				continue;
			}

			if (char === "=" && (inTag || (!sawTag && !sawSelector))) {
				// `title = "…"` is legal: whitespace ends the NAME token but must not
				// discard it, so fall back to the last completed token.
				const name = (pending || lastToken).trim().toLowerCase();
				attribute = (ATTRIBUTES.has(name) || /^data-[a-z][a-z0-9-]*$/.test(name)) ? name : null;
				pending = "";
				lastToken = "";
				continue;
			}

			if (char === '"' || char === "'") {
				if (attribute) quote = char;
				pending = "";
				lastToken = "";
				continue;
			}

			if (/[\s/]/.test(char)) {
				if (pending) lastToken = pending;
				pending = "";
				// Deliberately does NOT clear `attribute`: between `title =` and its
				// opening quote there is whitespace, and clearing here dropped the
				// match. It is cleared on `<`, `>`, a closing quote, and a `=` whose
				// name does not match.
				continue;
			}
			pending += char;
		}

		// The interpolation that follows this chunk.
		if (i < template.expressions.length && quote && attribute) inside.set(i, attribute);
	}

	return inside;
}

/**
 * Find unescaped attribute interpolations in one file's source.
 *
 * @param {string} source
 * @returns {Array<{attr: string, expr: string, line: number}>}
 * @throws if the source does not parse — the caller decides, as in flag-scan.
 */
export function scanUnescapedAttrs(source) {
	let ast;
	try {
		ast = acorn.parse(source, { ecmaVersion: 2023, sourceType: "module" });
	}
	catch (err) {
		throw new Error(`attr-escape-scan: parse failed, so nothing in this file was scanned — ${err.message}`);
	}

	const resolveEscaped = declaredEscapedNames(ast);
	const findings = [];

	visit(ast, (node) => {
		if (node.type !== "TemplateLiteral") return;

		for (const [index, attribute] of attributeInterpolations(node)) {
			const expression = node.expressions[index];
			if (!expression) continue;

			if (isEscapeCall(expression)) continue;
			if (expression.type === "Identifier" && resolveEscaped(expression.start, expression.name)) continue;
			if (isModuleOwned(expression)) continue;

			findings.push({
				attr: attribute,
				expr: source.slice(expression.start, expression.end).replace(/\s+/g, " "),
				line: source.slice(0, expression.start).split("\n").length,
			});
		}
	});

	return findings;
}

export { ATTRIBUTES, ESCAPE_NAMES };
