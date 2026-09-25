import { agentTestnetProxy } from '../server/agent-testnet-proxy.ts';
export default { fetch:(request:Request)=>agentTestnetProxy(request,'verify-run') };
