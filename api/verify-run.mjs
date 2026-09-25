import { agentTestnetProxy } from '../server/generated/agent-testnet-proxy.mjs';
export default { fetch: request => agentTestnetProxy(request, 'verify-run') };
