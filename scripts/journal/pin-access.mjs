/**
 * Resolve the journal documents a pin targets and the current user's access.
 * This is an internal leaf: it deliberately imports nothing from the pin
 * cluster so CRUD, rendering, lists, and interactions can share one policy.
 */
export function resolvePinTarget(pinLike) {
	const pin = pinLike?.pinData ?? pinLike;
	const journal = pin?.journalId ? game.journal.get(pin.journalId) : null;
	const page = journal && pin?.pageId ? journal.pages?.get?.(pin.pageId) ?? null : null;
	const isGM = !!game.user?.isGM;
	const canSeeEntryName = !!journal
		&& (isGM || !!journal.testUserPermission?.(game.user, "LIMITED"));
	const canSeePageName = !!page
		&& (isGM || !!page.testUserPermission?.(game.user, "LIMITED"));
	const openTarget = pin?.pageId ? page : journal;
	const canOpen = !!openTarget
		&& (isGM || !!openTarget.testUserPermission?.(game.user, "LIMITED"));

	return { pin, journal, page, isGM, canSeeEntryName, canSeePageName, canOpen };
}

/** The journal/page-derived candidate used by the pin display-name chain. */
export function getAccessiblePinTargetName(pin) {
	const access = resolvePinTarget(pin);
	if (access.pin?.pageId) {
		if (access.canSeePageName) return access.page?.name || "";
		return access.isGM && !access.page ? access.journal?.name || "" : "";
	}
	return access.canSeeEntryName ? access.journal?.name || "" : "";
}

/** Build the independently permission-checked Entry • Page list subtitle. */
export function getPinJournalSubtitle(pin) {
	const access = resolvePinTarget(pin);
	const parts = [];
	if (access.canSeeEntryName && access.journal?.name) parts.push(access.journal.name);
	if (access.pin?.pageId && access.canSeePageName && access.page?.name) {
		parts.push(access.page.name);
	}
	return parts.join(" • ");
}

/** Open a pin's exact target, silently refusing unlinked or unreadable pins. */
export function openPinTarget(pinLike) {
	const access = resolvePinTarget(pinLike);
	if (!access.pin?.journalId) return false;
	if (!access.journal) {
		ui.notifications.warn("Journal not found");
		return false;
	}
	if (!access.canOpen) return false;

	if (access.pin.pageId) access.journal.sheet.render(true, { pageId: access.pin.pageId });
	else access.journal.sheet.render(true);
	return true;
}
