export const GENESIS_CHAIN_ID = 4663 as const;
export const GENESIS_CONTRACT = '0x116EaA62241751E0c98dA43d458600c6C17cD361' as const;
export const GENESIS_IMAGE_MAX_LENGTH = 200 * 1024;

export type GenesisIdentity = Readonly<{
  collection: 'genesis';
  chainId: typeof GENESIS_CHAIN_ID;
  contract: typeof GENESIS_CONTRACT;
  tokenId: string;
  label: string;
  image: string;
  owner: string;
  walletAddress: string;
  blockNumber: string;
}>;

const MAX_UINT256 = (1n << 256n) - 1n;
const address = (value: unknown): value is string => typeof value === 'string'
  && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
const uint256 = (value: unknown): value is string => typeof value === 'string'
  && /^(?:0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) <= MAX_UINT256;

/** Validate the public identity envelope; only the trusted host proves ownership. */
export function parseGenesisIdentity(value: unknown): GenesisIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const identity = value as Record<string, unknown>;
  if (identity.collection !== 'genesis' || identity.chainId !== GENESIS_CHAIN_ID
    || typeof identity.contract !== 'string'
    || identity.contract.toLowerCase() !== GENESIS_CONTRACT.toLowerCase()
    || !uint256(identity.tokenId) || !uint256(identity.blockNumber)
    || !address(identity.owner) || !address(identity.walletAddress)
    || typeof identity.label !== 'string' || !identity.label.trim() || identity.label.length > 80
    || typeof identity.image !== 'string' || identity.image.length > GENESIS_IMAGE_MAX_LENGTH
    || !/^data:image\/svg\+xml;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(identity.image)
    || identity.image === 'data:image/svg+xml;base64,') return null;
  return Object.freeze({
    collection: 'genesis', chainId: GENESIS_CHAIN_ID, contract: GENESIS_CONTRACT,
    tokenId: identity.tokenId, label: identity.label.trim(), image: identity.image,
    owner: identity.owner, walletAddress: identity.walletAddress, blockNumber: identity.blockNumber,
  });
}
