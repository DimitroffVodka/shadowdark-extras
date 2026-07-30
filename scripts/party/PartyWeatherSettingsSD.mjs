/**
 * Party Weather RollTable Settings
 * Lets the GM select a world or compendium RollTable for the Party sheet.
 */

const MODULE_ID = "shadowdark-extras";
const SETTING_KEY = "partyWeatherTableUuid";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Test whether a resolved Foundry document is a RollTable.
 * @param {Document|null} document
 * @returns {boolean}
 */
export function isRollTableDocument(document) {
	return document?.documentName === "RollTable"
		|| document?.constructor?.documentName === "RollTable";
}

/**
 * Get the configured Party weather RollTable UUID.
 * @returns {string}
 */
export function getPartyWeatherTableUuid() {
	try {
		return String(game.settings.get(MODULE_ID, SETTING_KEY) ?? "").trim();
	} catch {
		return "";
	}
}

/**
 * Resolve the configured Party weather RollTable.
 * @returns {Promise<RollTable|null>}
 */
export async function getConfiguredPartyWeatherTable() {
	const uuid = getPartyWeatherTableUuid();
	if (!uuid) return null;

	try {
		const table = await fromUuid(uuid);
		return isRollTableDocument(table) ? table : null;
	} catch (error) {
		console.warn(`${MODULE_ID} | Could not resolve Party weather RollTable ${uuid}`, error);
		return null;
	}
}

export class PartyWeatherSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "sdx-party-weather-settings",
		classes: ["shadowdark", "shadowdark-extras", "party-weather-settings-app"],
		tag: "form",
		window: {
			title: "SHADOWDARK_EXTRAS.party_weather.title",
			resizable: true
		},
		position: {
			width: 560,
			height: "auto"
		},
		form: {
			handler: PartyWeatherSettingsApp.formHandler,
			submitOnChange: false,
			closeOnSubmit: true
		}
	};

	static PARTS = {
		form: {
			template: `modules/${MODULE_ID}/templates/party-weather-settings.hbs`
		}
	};

	async _prepareContext(options) {
		const selectedUuid = getPartyWeatherTableUuid();
		const tableGroups = [];
		let selectedAvailable = !selectedUuid;

		const worldTables = [...(game.tables?.contents ?? [])]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(table => {
				const selected = table.uuid === selectedUuid;
				if (selected) selectedAvailable = true;
				return {
					uuid: table.uuid,
					name: table.name,
					resultCount: table.results?.size ?? table.results?.length ?? 0,
					selected
				};
			});
		if (worldTables.length) {
			tableGroups.push({
				label: game.i18n.localize("SHADOWDARK_EXTRAS.party_weather.world_tables"),
				tables: worldTables
			});
		}

		const packs = [...game.packs]
			.filter(pack => pack.metadata.type === "RollTable")
			.sort((a, b) => a.metadata.label.localeCompare(b.metadata.label));
		for (const pack of packs) {
			try {
				const index = await pack.getIndex();
				if (!index.size) continue;

				const tables = [...index]
					.sort((a, b) => a.name.localeCompare(b.name))
					.map(entry => {
						const selected = entry.uuid === selectedUuid;
						if (selected) selectedAvailable = true;
						return {
							uuid: entry.uuid,
							name: entry.name,
							selected
						};
					});
				tableGroups.push({ label: pack.metadata.label, tables });
			} catch (error) {
				console.warn(`${MODULE_ID} | Could not index RollTable pack ${pack.collection}`, error);
			}
		}

		return {
			tableGroups,
			useDefault: !selectedUuid,
			missingSelection: selectedUuid && !selectedAvailable ? selectedUuid : "",
			hasTables: tableGroups.length > 0
		};
	}

	static async formHandler(event, form, formData) {
		const uuid = String(formData.object.tableUuid ?? "").trim();
		if (uuid) {
			let table = null;
			try {
				table = await fromUuid(uuid);
			} catch (error) {
				console.warn(`${MODULE_ID} | Could not resolve selected Party weather RollTable`, error);
			}

			if (!isRollTableDocument(table)) {
				ui.notifications.error(
					game.i18n.localize("SHADOWDARK_EXTRAS.party_weather.invalid_table")
				);
				return;
			}
		}

		await game.settings.set(MODULE_ID, SETTING_KEY, uuid);
		ui.notifications.info(
			game.i18n.localize("SHADOWDARK_EXTRAS.party_weather.saved")
		);
	}
}

/**
 * Register the Party weather RollTable world setting and configuration menu.
 */
export function registerPartyWeatherSettings() {
	game.settings.register(MODULE_ID, SETTING_KEY, {
		name: "Party Weather RollTable UUID",
		scope: "world",
		config: false,
		type: String,
		default: ""
	});

	game.settings.registerMenu(MODULE_ID, "partyWeatherTableMenu", {
		name: game.i18n.localize("SHADOWDARK_EXTRAS.settings.party_weather.name"),
		label: game.i18n.localize("SHADOWDARK_EXTRAS.settings.party_weather.label"),
		hint: game.i18n.localize("SHADOWDARK_EXTRAS.settings.party_weather.hint"),
		icon: "fas fa-cloud-sun-rain",
		type: PartyWeatherSettingsApp,
		restricted: true
	});
}
