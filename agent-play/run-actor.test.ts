import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRunActor, runningLabel } from './run-actor.ts';

test('explicit saved actor takes precedence over legacy names and job metadata', () => {
  for (const [actor, label] of [['human', 'HUMAN RUN'], ['autopilot', 'AUTOPILOT RUN'], ['agentic', 'AGENT RUN']] as const) {
    assert.equal(runningLabel(resolveRunActor({ actor, agent: 'Rare Rush autopilot', agentJobId: 'old-job' })), label);
  }
});

test('legacy CLI imports remain agentic even with the old shared Autopilot name', () => {
  assert.equal(resolveRunActor({ agentJobId: 'daily-run', agent: 'Rare Rush autopilot' }), 'agentic');
  assert.equal(resolveRunActor({ agent: 'Rare Rush autopilot' }), 'autopilot');
  assert.equal(resolveRunActor({ agent: 'Deterministic autopilot' }), 'autopilot');
  assert.equal(resolveRunActor({ agent: 'Human player' }), 'human');
  assert.equal(resolveRunActor({ agent: 'Agentic player' }), 'agentic');
});

test('missing or unrecognized metadata never guesses a player type', () => {
  for (const record of [undefined, null, {}, { actor: 'bot', agent: 'Custom agent', agentJobId: ' ' }]) {
    assert.equal(runningLabel(resolveRunActor(record)), 'RUNNING');
  }
});
