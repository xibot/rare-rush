import type { PublicRunActor } from '../shared/replay-publication.ts';

type ActorMetadata = { actor?: unknown; agentJobId?: unknown; agent?: unknown };

/** Older local jobs shared the Autopilot name; their job ID preserves the origin. */
export function resolveRunActor(record?: ActorMetadata | null): PublicRunActor | undefined {
  if (record?.actor === 'human' || record?.actor === 'autopilot' || record?.actor === 'agentic') return record.actor;
  if (typeof record?.agentJobId === 'string' && record.agentJobId.trim()) return 'agentic';
  switch (record?.agent) {
    case 'Human player': return 'human';
    case 'Agentic player': return 'agentic';
    case 'Deterministic autopilot':
    case 'Rare Rush autopilot': return 'autopilot';
    default: return undefined;
  }
}

export function runningLabel(actor?: PublicRunActor): string {
  switch (actor) {
    case 'human': return 'HUMAN RUN';
    case 'autopilot': return 'AUTOPILOT RUN';
    case 'agentic': return 'AGENT RUN';
    default: return 'RUNNING';
  }
}
