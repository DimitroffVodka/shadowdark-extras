import { MODULE_ID } from "../shared/module-id.mjs";
import {
	FEATURE_SETTING_KEY,
	getDisabledFeatureIds,
	getFeatureState,
	normalizeDisabledFeatureIds,
} from "./feature-gates.mjs";
import {
	VISIBLE_FEATURE_CHOICES,
	VISIBLE_FEATURE_GROUPS,
	applyVisibleFeatureChoiceState,
	getAdvancedFeatureGroups,
	getVisibleFeatureChoiceState,
} from "./feature-manager-choices.mjs";

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
			width: 920,
			height: 820,
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
		const advancedGroups = getAdvancedFeatureGroups();
		const names = new Map(
			advancedGroups.flatMap(group => group.features).map(entry => [entry.id, entry.name])
		);
		for (const choice of VISIBLE_FEATURE_CHOICES) {
			for (const id of choice.members) names.set(id, choice.name);
		}

		const prepareChoice = entry => {
			const state = getVisibleFeatureChoiceState(entry.id, disabled);
			return {
				...entry,
				...state,
				blockedByName: state.blockedBy ? names.get(state.blockedBy) : null,
			};
		};

		const prepareFeature = entry => {
			const state = getFeatureState(entry.id, disabled);
			return {
				...entry,
				checked: !disabledSet.has(entry.id),
				blocked: state.reason === "dependency",
				blockedByName: state.blockedBy ? names.get(state.blockedBy) : null,
			};
		};

		return {
			masterChoice: prepareChoice(
				VISIBLE_FEATURE_CHOICES.find(entry => entry.group === "master")
			),
			visibleGroups: VISIBLE_FEATURE_GROUPS.map(group => ({
				...group,
				features: VISIBLE_FEATURE_CHOICES
					.filter(entry => entry.group === group.id)
					.map(prepareChoice),
			})),
			advancedGroups: advancedGroups.map(group => ({
				...group,
				features: group.features.map(prepareFeature),
			})),
			advancedCount: advancedGroups.reduce(
				(total, group) => total + group.features.length,
				0
			),
		};
	}

	_onRender() {
		const html = this.element;
		if (!html) return;

		html.querySelectorAll("[data-feature-group-action]").forEach(button => {
			button.addEventListener("click", event => {
				event.preventDefault();
				const group = button.closest("[data-feature-section]");
				const enabled = button.dataset.featureGroupAction === "enable";
				group?.querySelectorAll("[data-feature-input]")
					.forEach(input => {
						input.checked = enabled;
						input.indeterminate = false;
					});
			});
		});

		html.querySelectorAll('[data-partial="true"]').forEach(input => {
			input.indeterminate = true;
		});

		html.querySelector("[data-feature-action='enable-all']")?.addEventListener("click", event => {
			event.preventDefault();
			html.querySelectorAll("[data-feature-input]").forEach(input => {
				input.checked = true;
				input.indeterminate = false;
			});
		});

		html.querySelector("[data-feature-action='disable-all']")?.addEventListener("click", event => {
			event.preventDefault();
			html.querySelectorAll("[data-feature-input]").forEach(input => {
				input.checked = false;
				input.indeterminate = false;
			});
		});
	}

	static async formHandler(_event, form) {
		const current = getDisabledFeatureIds();
		let next = current;
		for (const input of form.querySelectorAll('input[name="featureChoices"]')) {
			next = applyVisibleFeatureChoiceState(next, input.value, input.checked);
		}

		const advancedEnabled = new Set(
			[...form.querySelectorAll('input[name="features"]:checked')].map(input => input.value)
		);
		const advancedIds = [...form.querySelectorAll('input[name="features"]')].map(input => input.value);
		const disabledSet = new Set(next);
		for (const id of advancedIds) {
			if (advancedEnabled.has(id)) disabledSet.delete(id);
			else disabledSet.add(id);
		}
		const disabled = normalizeDisabledFeatureIds([...disabledSet]);
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
