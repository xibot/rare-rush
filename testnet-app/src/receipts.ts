import { parseEventLogs, zeroAddress, type Address, type Hash, type TransactionReceipt } from 'viem';
import { nftAbi, tokenAbi } from './abi.ts';
export type PendingMint = { hash: Hash; account: Address; contract: Address; kind: 'rf' | 'genesis' | 'generations' };

export function mintedIds(receipt: TransactionReceipt, pending: PendingMint): string[] {
  if (receipt.status !== 'success') throw new Error('The transaction reverted. No test assets were minted.');
  if (receipt.to?.toLowerCase() !== pending.contract.toLowerCase()) throw new Error('Transaction confirmed without the requested mint. It may have been replaced or cancelled.');
  if (pending.kind === 'rf') {
    const events = parseEventLogs({ abi: tokenAbi, eventName: 'FaucetClaimed', logs: receipt.logs });
    if (!events.some(event => event.address.toLowerCase() === pending.contract.toLowerCase() && event.args.recipient.toLowerCase() === pending.account.toLowerCase() && event.args.amount === 1100n * 10n ** 18n)) {
      throw new Error('Transaction confirmed without the expected test RF faucet event. No mint is credited by this page.');
    }
    return [];
  }
  const events = parseEventLogs({ abi: nftAbi, eventName: 'Transfer', logs: receipt.logs });
  const ids = events.filter(event => event.address.toLowerCase() === pending.contract.toLowerCase() && event.args.from === zeroAddress && event.args.to.toLowerCase() === pending.account.toLowerCase()).map(event => event.args.tokenId.toString());
  if (!ids.length) throw new Error('Transaction confirmed without the expected test NFT mint event. No mint is credited by this page.');
  return ids;
}
