/**
 * Adding Party to the actor-creation flow.
 *
 * Extracted from the composition root in Phase 3. The cluster patches the
 * creation dialog so a Party type can be chosen, then wraps `Actor.create` so
 * the choice survives into the created document.
 *
 * THIS MODULE CARRIES REGISTRATIONS, and one of them is contended.
 * `extendActorCreationDialog` installs four `Hooks.on` handlers, and
 * `renderApplication` is registered twice more by the root, both later. The
 * four register when this function is CALLED, not when the module is
 * evaluated, so ordering is decided entirely by where the root calls it —
 * which is unchanged. Do not convert these to module-eval side effects, and
 * do not move the call site, or the relative order silently reverses with
 * every gate still green.
 */

/**
 * Add Party option to actor creation dialog
 */
export function extendActorCreationDialog() {
	// Hook into various dialog rendering events to catch the Create Actor dialog

	// For Foundry v13+ with ApplicationV2
	Hooks.on("renderDocumentSheetConfig", (app, html, data) => {
		addPartyOptionToSelect(html);
	});

	// For standard Dialog
	Hooks.on("renderDialog", (app, html, data) => {
		addPartyOptionToSelect(html);
	});

	// For Application render
	Hooks.on("renderApplication", (app, html, data) => {
		addPartyOptionToSelect(html);
	});

	// For Foundry v13 - hook into the folder context or creation
	Hooks.on("renderActorDirectory", (app, html, data) => {
		// The create button opens a dialog - we need to intercept when it renders
	});

	// Use MutationObserver to catch dynamically created dialogs
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) {
					const select = node.querySelector?.('select[name="type"]');
					if (select) {
						addPartyOptionToSelect($(node));
					}
				}
			}
		}
	});

	// Start observing the document body for dialog additions
	observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Add the Party option to a type select if it's in a Create Actor dialog
 */
function addPartyOptionToSelect(html) {
	// Convert to jQuery if needed
	const $html = html instanceof jQuery ? html : $(html);

	// Look for actor type select
	const typeSelect = $html.find('select[name="type"]');
	if (typeSelect.length === 0) return;

	// Check if this select has actor types (Light, NPC, Player)
	const hasActorTypes = typeSelect.find('option[value="NPC"]').length > 0 ||
		typeSelect.find('option[value="Player"]').length > 0;
	if (!hasActorTypes) return;

	// Check if Party option already exists
	if (typeSelect.find('option[value="Party"]').length > 0) return;

	// Add Party option
	const npcOption = typeSelect.find('option[value="NPC"]');
	if (npcOption.length > 0) {
		npcOption.after(`<option value="Party">${game.i18n.localize("SHADOWDARK_EXTRAS.party.name")}</option>`);
		//console.log(`${MODULE_ID} | Added Party option to actor type select`);
	} else {
		// Fallback: append to the end
		typeSelect.append(`<option value="Party">${game.i18n.localize("SHADOWDARK_EXTRAS.party.name")}</option>`);
		//console.log(`${MODULE_ID} | Added Party option to actor type select (appended)`);
	}

	// Also intercept form submission to convert Party to NPC before it's sent
	const form = typeSelect.closest('form');
	if (form.length > 0 && !form.data('party-intercepted')) {
		form.data('party-intercepted', true);
		form.on('submit', function (e) {
			const select = $(this).find('select[name="type"]');
			if (select.val() === 'Party') {
				select.val('NPC');
				// Store that this should be a party
				let hiddenInput = $(this).find('input[name="flags.shadowdark-extras.isParty"]');
				if (hiddenInput.length === 0) {
					$(this).append('<input type="hidden" name="flags.shadowdark-extras.isParty" value="true">');
				}
			}
		});
	}
}

/**
 * Wrap Actor.create to intercept Party type
 */
export function wrapActorCreate() {
	const originalCreate = CONFIG.Actor.documentClass.create;

	CONFIG.Actor.documentClass.create = async function (data, options = {}) {
		// Handle single or array of data
		const createData = Array.isArray(data) ? data : [data];

		for (const d of createData) {
			if (d.type === "Party") {
				d.type = "NPC";
				d.img = d.img || "icons/environment/people/group.webp";
				foundry.utils.setProperty(d, "flags.shadowdark-extras.isParty", true);
				foundry.utils.setProperty(d, "prototypeToken.actorLink", true);

				// Set default prototype token settings (no vision/light like standard Shadowdark actors)
				foundry.utils.setProperty(d, "prototypeToken.sight", {
					enabled: true,
					range: 0,
					angle: 360,
					visionMode: "basic",
					color: null,
					attenuation: 0.1,
					brightness: 0,
					saturation: 0,
					contrast: 0
				});
				foundry.utils.setProperty(d, "prototypeToken.light", {
					negative: false,
					priority: 0,
					alpha: 0.2,
					angle: 360,
					bright: 0,
					color: "#d1c846",
					coloration: 1,
					dim: 0,
					attenuation: 0.5,
					luminosity: 0.5,
					saturation: 0,
					contrast: 0,
					shadows: 0,
					animation: {
						type: "torch",
						speed: 1,
						intensity: 1,
						reverse: false
					},
					darkness: {
						min: 0,
						max: 1
					}
				});
			}
		}

		return originalCreate.call(this, Array.isArray(data) ? createData : createData[0], options);
	};

	//console.log(`${MODULE_ID} | Wrapped Actor.create to handle Party type`);
}

/**
 * Handle Party actor creation - convert to flagged NPC
 */
async function handlePartyCreation(actor, options, userId) {
	// This runs after the actor is created
	// We can't intercept the type change before creation in a clean way,
	// so we'll handle it via the preCreateActor hook
}
