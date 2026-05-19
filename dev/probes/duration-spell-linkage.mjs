// PROBE: Verify template.id round-trips through the duration-spell pipeline.
// Catches regressions of the `placedTemplateId` write/read mismatch where
// the global was nulled but reads still queried the global instead of the local.
//
// Replace actorId / itemId with a spell that has trackDuration:true + a template.

const actorId = "<ACTOR_ID>";
const itemId  = "<SPELL_ITEM_ID>";

const actor = game.actors.get(actorId);
const item  = actor?.items.get(itemId);
const SDX   = game.modules.get("shadowdark-extras");
if (!actor || !item || !SDX?.api) return { pass: false, reason: "actor/item/api missing — set ids" };

const preKeys = Object.keys(actor.flags?.["shadowdark-extras"]?.activeDurationSpells ?? {});

// 1. Place a template directly (bypasses interactive UI)
const created = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
  t: "rect", x: 4000, y: 4000, distance: 15, direction: 0,
  user: game.user.id,
  flags: { "shadowdark-extras": { __linkageProbe: true } }
}]);
const template = created[0];
await new Promise(r => setTimeout(r, 100));

// 2. Build trackerConfig exactly like injectDamageCard does after the v6.10.16 fix
const trackerConfig = {
  perTurnTrigger: "start",
  perTurnDamage: "",
  reapplyEffects: false,
  damageType: "",
  effects: [],
  templateId: template.id,  // <-- the routed local-scoped value
};

// 3. Call startDurationSpell
const instance = await SDX.api.startDurationSpell(actor, item, [], trackerConfig);
await new Promise(r => setTimeout(r, 100));

// 4. Read back actor flag — entry must contain matching templateId
const after = actor.flags?.["shadowdark-extras"]?.activeDurationSpells ?? {};
const newKey = Object.keys(after).find(k => !preKeys.includes(k));
const entry = newKey ? after[newKey] : null;
const roundTrip = entry?.templateId === template.id;

// Cleanup
await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [template.id]);
if (entry?.instanceId) await SDX.api.endDurationSpell(actor, entry.instanceId);

return {
  pass: roundTrip,
  placedTemplateId: template.id,
  storedTemplateId: entry?.templateId,
  templateIdRoundTrip: roundTrip,
  instanceId: instance?.instanceId,
};
