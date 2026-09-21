import { parseAbi } from 'viem';
export const tokenAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function CAP() view returns (uint256)',
  'function game() view returns (address)',
  'function faucet()',
  'function FAUCET_AMOUNT() view returns (uint256)',
  'function lastFaucetDayPlusOne(address) view returns (uint256)',
  'event FaucetClaimed(address indexed recipient, uint256 indexed utcDay, uint256 amount)',
]);
export const nftAbi = parseAbi([
  'function mint() returns (uint256)',
  'function isGenesis() view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
export const gameAbi = parseAbi([
  'function rf() view returns (address)',
  'function genesis() view returns (address)',
  'function generations() view returns (address)',
  'function token() view returns (address)',
  'function ENTRY_FEE() view returns (uint256)',
  'function PRIZE_POOL_SHARE() view returns (uint256)',
  'function TREASURY_SHARE() view returns (uint256)',
  'function MAX_DAILY_RUNS() view returns (uint256)',
]);
