/** Browse Foundry-managed assets only when the current user has GM permission. */
export async function browseAssetsAsGM(source, path) {
	if (!game.user?.isGM) return null;
	return foundry.applications.apps.FilePicker.implementation.browse(source, path);
}
