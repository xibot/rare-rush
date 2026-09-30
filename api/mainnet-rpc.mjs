import { privateRpcProxy } from '../server/generated/private-rpc.mjs';
export default { fetch: request => privateRpcProxy(request, 'mainnet') };
