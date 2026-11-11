import assert from "node:assert/strict";
import test from "node:test";

import "./helpers/foundry-loader.mjs";

const { enhancerOwnsParty } = await import("../../scripts/party/party-creation.mjs");

const world = ({ active, party }) => ({
	modules: new Map([["shadowdark-enhancer", { active }]]),
	shadowdarkEnhancer: party ? { party: {} } : {},
});

test("Extras offers its own Party alone", () => {
	assert.equal(enhancerOwnsParty({ modules: new Map() }), false);
});

test("an installed but inactive Enhancer does not take the Party entry", () => {
	assert.equal(enhancerOwnsParty(world({ active: false, party: true })), false);
});

test("an older Enhancer without a native Party does not take the Party entry", () => {
	assert.equal(enhancerOwnsParty(world({ active: true, party: false })), false);
});

test("an active Enhancer with a native Party owns the Party entry", () => {
	assert.equal(enhancerOwnsParty(world({ active: true, party: true })), true);
});
