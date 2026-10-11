// The system's applyDamage fires its HP update without awaiting or returning it.
// Keep the update observable to callers while using the Enhancer's optional pool API.
export async function applyDamageWithTempHp(actor, damage, maxHp) {
	let remainder = damage;
	const poolApi = game.shadowdarkEnhancer?.tempHp;
	if (damage > 0 && poolApi?.of && poolApi?.set) {
		const pool = poolApi.of(actor);
		if (pool > 0) {
			const spent = Math.min(pool, damage);
			await poolApi.set(actor, pool - spent);
			remainder -= spent;
		}
	}
	if (remainder === 0 && damage > 0) return;
	const currentHp = actor.system?.attributes?.hp?.value ?? 0;
	const nextHp = Math.max(0, currentHp - remainder);
	await actor.update({ "system.attributes.hp.value": maxHp === undefined ? nextHp : Math.min(maxHp, nextHp) });
}
