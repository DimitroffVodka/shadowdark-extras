// An in-memory stand-in for the browser's IndexedDB, enough of it for SDXCache.
//
// SDXCache talks to IndexedDB through the request/onsuccess callback style, so
// the fake has to resolve on a later tick rather than returning values directly —
// code under test that forgets to await would otherwise pass here and fail in a
// browser.

/**
 * Install a fake `globalThis.indexedDB` backed by plain Maps.
 *
 * @returns {{stores: Map<string, Map<string, any>>}} The backing stores, for
 *   tests that need to seed or inspect raw records.
 */
export function installMemoryIndexedDB() {
	const stores = new Map();

	function requestFor(action) {
		const request = {};
		queueMicrotask(() => {
			try {
				request.result = action();
				request.onsuccess?.();
			}
			catch(error) {
				request.error = error;
				request.onerror?.();
			}
		});
		return request;
	}

	globalThis.indexedDB = {
		open() {
			const request = {};
			queueMicrotask(() => {
				const db = {
					objectStoreNames: { contains: name => stores.has(name) },
					createObjectStore(name) {
						stores.set(name, new Map());
					},
					transaction() {
						return {
							objectStore(name) {
								const store = stores.get(name);
								return {
									get: key => requestFor(() => store.get(key)),
									put: (value, key) => requestFor(() => store.set(key, value)),
								};
							},
						};
					},
				};
				const event = { target: { result: db } };
				request.onupgradeneeded?.(event);
				request.onsuccess?.(event);
			});
			return request;
		},
	};

	return { stores };
}
