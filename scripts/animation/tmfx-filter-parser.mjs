/**
 * Parse the literal filter-parameter array emitted by TokenMagic macros.
 *
 * This deliberately accepts only JSON-like data (with optional unquoted object
 * keys and single-quoted strings). It never resolves identifiers or evaluates
 * expressions, so macro text cannot execute code in the Foundry client.
 */

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class LiteralParser {
	constructor(source) {
		this.source = source;
		this.index = 0;
	}

	parse() {
		this.skipWhitespace();
		const value = this.parseValue();
		this.skipWhitespace();
		if (this.index !== this.source.length) this.fail("unexpected trailing input");
		return value;
	}

	parseValue() {
		this.skipWhitespace();
		const char = this.source[this.index];
		if (char === "[") return this.parseArray();
		if (char === "{") return this.parseObject();
		if (char === '"' || char === "'") return this.parseString();
		if (char === "-" || /\d/.test(char ?? "")) return this.parseNumber();
		return this.parseKeyword();
	}

	parseArray() {
		this.index += 1;
		const result = [];
		this.skipWhitespace();
		if (this.consume("]")) return result;
		while (true) {
			result.push(this.parseValue());
			this.skipWhitespace();
			if (this.consume("]")) return result;
			if (!this.consume(",")) this.fail("expected ',' or ']'");
			this.skipWhitespace();
			if (this.source[this.index] === "]") this.fail("trailing comma is not allowed");
		}
	}

	parseObject() {
		this.index += 1;
		const result = {};
		this.skipWhitespace();
		if (this.consume("}")) return result;
		while (true) {
			this.skipWhitespace();
			const key = this.source[this.index] === '"' || this.source[this.index] === "'"
				? this.parseString()
				: this.parseIdentifier();
			if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) this.fail("invalid object key");
			this.skipWhitespace();
			if (!this.consume(":")) this.fail("expected ':' after object key");
			result[key] = this.parseValue();
			this.skipWhitespace();
			if (this.consume("}")) return result;
			if (!this.consume(",")) this.fail("expected ',' or '}'");
			this.skipWhitespace();
			if (this.source[this.index] === "}") this.fail("trailing comma is not allowed");
		}
	}

	parseString() {
		const quote = this.source[this.index];
		this.index += 1;
		let value = "";
		while (this.index < this.source.length) {
			const char = this.source[this.index++];
			if (char === quote) return value;
			if (char === "\\") {
				const escaped = this.source[this.index++];
				const escapes = { "\\": "\\", "\"": "\"", "'": "'", "n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "v": "\v", "0": "\0" };
				if (escaped === "u") {
					const hex = this.source.slice(this.index, this.index + 4);
					if (!/^[0-9a-f]{4}$/i.test(hex)) this.fail("invalid unicode escape");
					value += String.fromCharCode(Number.parseInt(hex, 16));
					this.index += 4;
				}
				else if (escaped in escapes) value += escapes[escaped];
				else this.fail("unsupported string escape");
			}
			else {
				if (char === "\n" || char === "\r") this.fail("unterminated string");
				value += char;
			}
		}
		this.fail("unterminated string");
	}

	parseNumber() {
		NUMBER.lastIndex = this.index;
		const match = NUMBER.exec(this.source);
		if (!match) this.fail("invalid number");
		this.index += match[0].length;
		const value = Number(match[0]);
		if (!Number.isFinite(value)) this.fail("number is not finite");
		return value;
	}

	parseIdentifier() {
		IDENTIFIER.lastIndex = this.index;
		const match = IDENTIFIER.exec(this.source);
		if (!match) this.fail("expected identifier");
		this.index += match[0].length;
		return match[0];
	}

	parseKeyword() {
		const identifier = this.parseIdentifier();
		if (identifier === "true") return true;
		if (identifier === "false") return false;
		if (identifier === "null") return null;
		this.fail(`unsupported identifier '${identifier}'`);
	}

	skipWhitespace() {
		while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
	}

	consume(expected) {
		if (this.source.startsWith(expected, this.index)) {
			this.index += expected.length;
			return true;
		}
		return false;
	}

	fail(message) {
		throw new Error(`Invalid TokenMagic filter literal at offset ${this.index}: ${message}`);
	}
}

function extractArrayLiteral(source) {
	const start = source.indexOf("[");
	if (start < 0) throw new Error("TokenMagic macro does not contain a filter array");
	let depth = 0;
	let quote = null;
	let escaped = false;
	for (let index = start; index < source.length; index += 1) {
		const char = source[index];
		if (quote) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === "[") depth += 1;
		else if (char === "]") {
			depth -= 1;
			if (depth === 0) return source.slice(start, index + 1);
		}
	}
	throw new Error("TokenMagic filter array is not closed");
}

export function parseTMFXFilterParams(source) {
	if (typeof source !== "string") throw new Error("TokenMagic filter source must be text");
	const value = new LiteralParser(extractArrayLiteral(source)).parse();
	if (!Array.isArray(value)) throw new Error("TokenMagic filter literal must be an array");
	if (!value.every(entry => entry && typeof entry === "object" && !Array.isArray(entry))) {
		throw new Error("TokenMagic filter array must contain objects");
	}
	return value;
}
