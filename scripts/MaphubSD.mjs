/**
 * MaphubSD.mjs
 * Watches for sdx-maphub-map placeholder divs via MutationObserver and
 * replaces them with inline iframes pointing to the locally-served maphub
 * generator pages.  express.static does not add X-Frame-Options, so the
 * iframes load freely.  Falls back to the external watabou.github.io URL
 * if the local files are not present.
 */

const MODULE_ID = "shadowdark-extras";
const LOCAL_MAPHUB_BASE = `modules/${MODULE_ID}/scripts/maphub`;

// Guards against processing the same placeholder twice
const _processing = new WeakSet();

// Same-origin Blob wrappers we hand to iframes when Foundry serves the bundled
// module .html as text/plain (FV14 does). Tracked blobUrl → iframe so each can be
// freed: on the iframe's `load` (its earliest safe point — once consumed, the
// generator's sub-resources resolve via the injected <base> to real URLs and the
// blob is dead weight) and, as a backstop, whenever a host iframe leaves the DOM
// (journal page close/re-render).
const _blobFrames = new Map();

function _revokeBlob(url) {
	if (!_blobFrames.delete(url)) return;
	try { URL.revokeObjectURL(url); } catch {}
}

function _sweepDetachedBlobs() {
	for (const [url, frame] of _blobFrames)
		if (!frame.isConnected) _revokeBlob(url);
}

// ── Placeholder → inline iframe ──────────────────────────────────────────────

async function replacePlaceholder(div) {
	if (_processing.has(div)) return;
	_processing.add(div);
	if (!div.isConnected) return;

	const type    = div.dataset.maphubType;
	const qs      = div.dataset.maphubParams;
	const extBase = div.dataset.maphubExternal;
	if (!type || !qs || !extBase) return;

	// Try the local maphub files first (express.static has no X-Frame-Options).
	// Fall back to the external watabou URL if the local files aren't present.
	const localUrl = `${window.location.origin}${foundry.utils.getRoute(`/${LOCAL_MAPHUB_BASE}/to/${type}/index.html`)}?${qs}`;
	let dirRoute = foundry.utils.getRoute(`/${LOCAL_MAPHUB_BASE}/to/${type}`);
	if (!dirRoute.endsWith("/")) dirRoute += "/";
	const localDirUrl = `${window.location.origin}${dirRoute}`;

	let src = `${extBase}?${qs}`;
	let blobUrl = null;
	try {
		const r = await fetch(localUrl, { method: "HEAD" });
		if (r.ok) {
			const contentType = r.headers.get("content-type") ?? "";
			if (contentType.includes("text/html")) {
				// Foundry serves it as real HTML — embed the file directly.
				src = localUrl;
			} else {
				// FV14 serves module .html as `text/plain`, so a direct iframe src
				// would render the page's SOURCE instead of running the generator.
				// Fetch the page and wrap it in a same-origin Blob with an injected
				// <base> (so relative ../../js and ../../fonts assets resolve) plus a
				// shim that feeds our query string to the generator — a blob: URL
				// carries no ?query, so the seed would otherwise be random.
				const res = await fetch(localUrl);
				let html = await res.text();
				if (/^\s*<!doctype html/i.test(html) || /^\s*<html/i.test(html)) {
					const qsInject = qs
						? `<script>(function(){var q=${JSON.stringify(qs).replace(/</g, "\\u003c")};var N=window.URLSearchParams;window.URLSearchParams=function(i){if((i==null||i===""||i===window.location.search)&&q)i=q;return new N(i);};window.URLSearchParams.prototype=N.prototype;})();</script>`
						: "";
					html = html
						.replace(/<head([^>]*)>/i, (_m, a) => `<head${a}><base href="${localDirUrl}">${qsInject}`)
						.replace(/(\.\.\/\.\.\/js\/[^"]+\.js)(")/g, (_m, p, q2) => `${p}?cb=${Date.now()}${q2}`);
					blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
					src = blobUrl;
				} else {
					console.warn(`${MODULE_ID} | maphub local file was not HTML, using external:`, type);
				}
			}
		}
	} catch (_) { /* network error — use external */ }

	// The journal may have re-rendered while we awaited the probe/fetch.
	if (!div.isConnected) {
		if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch {} }
		return;
	}

	const iframe = document.createElement("iframe");
	iframe.title = "Settlement Map";
	iframe.style.cssText = "width:100%;height:500px;border:none;display:block;border-radius:6px;margin:0.5em 0 1em;";
	if (blobUrl) {
		_blobFrames.set(blobUrl, iframe);
		iframe.addEventListener("load", () => _revokeBlob(blobUrl), { once: true });
	}
	iframe.src = src;
	div.replaceWith(iframe);
}

function scanAndReplace(root) {
	if (!(root instanceof Element)) return;
	if (root.matches(".sdx-maphub-map[data-maphub-type]")) replacePlaceholder(root);
	for (const div of root.querySelectorAll(".sdx-maphub-map[data-maphub-type]")) replacePlaceholder(div);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function registerMaphubHooks() {
	const observer = new MutationObserver((mutations) => {
		for (const m of mutations)
			for (const node of m.addedNodes)
				scanAndReplace(node);
		// Free Blob wrappers whose iframe was detached (journal close/re-render).
		// Cheap: the map is empty except in the brief window before an iframe loads.
		if (_blobFrames.size) _sweepDetachedBlobs();
	});

	Hooks.once("ready", () => {
		observer.observe(document.body, { childList: true, subtree: true });
		scanAndReplace(document.body);
	});
}
