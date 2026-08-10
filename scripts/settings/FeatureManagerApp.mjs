import { MODULE_ID } from "../shared/module-id.mjs";
import {
	FEATURE_CATALOG,
	FEATURE_GROUPS,
	FEATURE_SETTING_KEY,
	getDisabledFeatureIds,
	getFeatureState,
	normalizeDisabledFeatureIds,
} from "./feature-gates.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class FeatureManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "sdx-feature-manager",
		classes: ["shadowdark-extras", "sdx-feature-manager-app"],
		tag: "form",
		window: {
			title: "Feature Manager",
			resizable: true,
		},
		position: {
			width: 720,
			height: 760,
		},
		form: {
			handler: FeatureManagerApp.formHandler,
			submitOnChange: false,
			closeOnSubmit: false,
		},
	};

	static PARTS = {
		form: {
			template: `modules/${MODULE_ID}/templates/feature-manager.hbs`,
		},
	};

	async _prepareContext() {
		const disabled = getDisabledFeatureIds();
		const disabledSet = new Set(disabled);
		const names = new Map(FEATURE_CATALOG.map(entry => [entry.id, entry.name]));

		return {
			groups: FEATURE_GROUPS.map(group => ({
				...group,
				features: FEATURE_CATALOG.filter(entry => entry.group === group.id).map(entry => {
					const state = getFeatureState(entry.id, disabled);
					return {
						...entry,
						checked: !disabledSet.has(entry.id),
						blocked: state.reason === "dependency",
						blockedByName: state.blockedBy ? names.get(state.blockedBy) : null,
					};
				}),
			})),
		};
	}

	_onRender() {
		const html = this.element;
		if (!html) return;

		html.querySelectorAll("[data-feature-group-action]").forEach(button => {
			button.addEventListener("click", event => {
				event.preventDefault();
				const group = button.closest("[data-feature-group]");
				const enabled = button.dataset.featureGroupAction === "enable";
				group?.querySelectorAll('input[name="features"]')
					.forEach(input => {
						input.checked = enabled;
					});
			});
		});

		html.querySelector("[data-feature-action='enable-all']")?.addEventListener("click", event => {
			event.preventDefault();
			html.querySelectorAll('input[name="features"]').forEach(input => {
				input.checked = true;
			});
		});

		html.querySelector("[data-feature-action='disable-all']")?.addEventListener("click", event => {
			event.preventDefault();
			html.querySelectorAll('input[name="features"]').forEach(input => {
				input.checked = false;
			});
		});
	}

	static async formHandler(_event, form) {
		const enabled = new Set(
			[...form.querySelectorAll('input[name="features"]:checked')].map(input => input.value)
		);
		const disabled = normalizeDisabledFeatureIds(
			FEATURE_CATALOG.filter(entry => !enabled.has(entry.id)).map(entry => entry.id)
		);
		const current = getDisabledFeatureIds();
		if (JSON.stringify(disabled) === JSON.stringify(current)) return;

		await game.settings.set(MODULE_ID, FEATURE_SETTING_KEY, disabled);
		ui.notifications.info("Shadowdark Extras feature settings saved. Reload required.", { permanent: true });
	}
}

export function registerFeatureManagerSettings() {
	game.settings.register(MODULE_ID, "disabledFeatures", {
		name: "Disabled Features",
		scope: "world",
		config: false,
		type: Array,
		default: [],
		requiresReload: true,
	});

	game.settings.registerMenu(MODULE_ID, "featureManagerMenu", {
		name: "Feature Manager",
		label: "Configure Features",
		hint: "Completely disable Shadowdark Extras features, including hidden hooks and background behavior.",
		icon: "fas fa-toggle-on",
		type: FeatureManagerApp,
		restricted: true,
	});
}
