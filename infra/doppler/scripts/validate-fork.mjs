import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseAbiParameters, encodeAbiParameters, encodeDeployData, getContractAddress, keccak256, stringToHex, parseEther, formatUnits, toHex, zeroAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
const url = new URL(process.env.RUSH_DOPPLER_LOCAL_RPC ?? '');
assert.equal(url.hostname, '127.0.0.1', 'Writes may only target the spawned loopback fork');
const chain = defineChain({ id: 31337, name: 'Doppler isolated fork', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [url.href] } } });
const p = createPublicClient({ chain, transport: http(url.href), cacheTime: 0 });
const w = createWalletClient({ chain, transport: http(url.href) });
assert.equal(await p.getChainId(), 31337);
// Mine a local block so execution uses the configured EVM, not unknown upstream hardfork history.
await p.request({ method: 'evm_mine', params: [] });
const [launcher, player, attacker] = await w.getAddresses();
// Published Hardhat fixture mnemonic. Never fund these accounts on a public chain.
const signer = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 3 });
const constants = {
  sourceChainId: 4663, localChainId: 31337, forkBlock: Number(process.env.RUSH_DOPPLER_FORK_BLOCK),
  dopplerCommit: 'bda077cf05c834f3bb5eb311f5b86376910d7912',
  airlock: '0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862',
  initializer: '0xde8886a0019ea060b8378ee37b8a23b8117f29a3',
  governance: '0x85f37f74ef2478a770318bc810177a9835911ad7',
  migrator: '0xba2f330edb16cd8056f5988d8ce19bbc63475a0e',
  rf: '0x0779369854d3EcdEA927206718FFD7730C67B71f',
};
const erc20 = parseAbi(['function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)', 'function symbol() view returns(string)', 'function approve(address,uint256) returns(bool)', 'function transfer(address,uint256) returns(bool)']);
const airlockAbi = parseAbi(['function owner() view returns(address)', 'function getModuleState(address) view returns(uint8)', 'function setModuleState(address[],uint8[])', 'function getAssetData(address) view returns(address numeraire,address timelock,address governance,address migrator,address initializer,address pool,address migrationPool,uint256 numTokensToSell,uint256 totalSupply,address integrator)', 'error WrongModuleState(address,uint8,uint8)']);
const poolAbi = parseAbi(['function token0() view returns(address)', 'function token1() view returns(address)', 'function liquidity() view returns(uint128)']);
const airlock = { address: constants.airlock, abi: airlockAbi };
const rf = { address: constants.rf, abi: erc20 };
const evidence = { ...constants, scope: 'LOCAL FORK ONLY; no public transaction, no actual Doppler approval', allocationStatus: '10% launch / 90% gameplay is only a configurable test fixture, not an approved final allocation', checks: [], codeHashes: {} };
function check(name) { evidence.checks.push(name); console.log(`PASS ${name}`); }
async function artifact(name) { return JSON.parse(await readFile(new URL(`../artifacts/${name}.json`, import.meta.url), 'utf8')); }
async function read(c, fn, args = []) { return p.readContract({ ...c, functionName: fn, args }); }
async function send(c, fn, args = [], account = launcher) {
  const { request } = await p.simulateContract({ ...c, functionName: fn, args, account });
  const receipt = await p.waitForTransactionReceipt({ hash: await w.writeContract(request) });
  assert.equal(receipt.status, 'success'); return receipt;
}
async function deploy(name, args) {
  const a = await artifact(name);
  const receipt = await p.waitForTransactionReceipt({ hash: await w.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account: launcher }) });
  assert.equal(receipt.status, 'success'); return { address: receipt.contractAddress, abi: a.abi };
}
async function rejects(c, fn, args, account, name) {
  await assert.rejects(p.simulateContract({ ...c, functionName: fn, args, account }), error => {
    const cause = error.walk?.(x => x?.data?.errorName);
    if (name) assert.equal(cause?.data?.errorName, name, error.shortMessage);
    return true;
  });
}
async function impersonate(account) {
  await p.request({ method: 'hardhat_impersonateAccount', params: [account] });
  await p.request({ method: 'hardhat_setBalance', params: [account, toHex(parseEther('100'))] });
}
for (const name of ['airlock', 'initializer', 'governance', 'migrator', 'rf']) {
  const code = await p.getCode({ address: constants[name] }); assert.ok(code && code !== '0x');
  evidence.codeHashes[name] = keccak256(code);
}
evidence.forkBlockHash = (await p.getBlock({ blockNumber: BigInt(constants.forkBlock) })).hash;
check('Pinned canonical Robinhood contracts have deployed code on the fork');
assert.equal(await read(rf, 'decimals'), 18);
evidence.rfSymbol = await read(rf, 'symbol');
check('Canonical RF uses 18 decimals; custom RARERUSH uses 6');
const owner = await read(airlock, 'owner'); evidence.airlockOwner = owner;
for (const [module, expected] of [[constants.initializer, 3], [constants.governance, 2], [constants.migrator, 4]]) assert.equal(await read(airlock, 'getModuleState', [module]), expected);
check('Existing pool, governance and migrator modules are approved at the pinned block');
const game = await deploy('VerifiedClaimFixture', [signer.address]);
const cap = 1_024_000_000n * 1_000_000n;
const launchAmount = 102_400_000n * 1_000_000n;
const factory = await deploy('RareRushDopplerFactoryPrototype', [constants.airlock, game.address, launchAmount]);
const tokenArtifact = await artifact('RareRushDopplerPrototype');
const salt = keccak256(stringToHex('rare-rush-local-doppler-proof-v1'));
const predicted = getContractAddress({ from: factory.address, opcode: 'CREATE2', salt, bytecode: encodeDeployData({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode, args: [constants.airlock, constants.airlock, game.address, launchAmount] }) });
const assetIsToken0 = BigInt(predicted) < BigInt(constants.rf);
// Illustrative launch price ~0.001 RF/RARERUSH, adjusted for 6 versus 18 decimals.
// Tick ranges, share, fee and beneficiaries are testing parameters, not final economics.
const lower = assetIsToken0 ? 207240 : -230280;
const upper = assetIsToken0 ? 230280 : -207240;
const beneficiaries = [{ beneficiary: owner, shares: 50_000_000_000_000_000n }, { beneficiary: launcher, shares: 950_000_000_000_000_000n }].sort((a,b) => BigInt(a.beneficiary) < BigInt(b.beneficiary) ? -1 : 1);
const params = {
  initialSupply: launchAmount, numTokensToSell: launchAmount, numeraire: constants.rf,
  tokenFactory: factory.address, tokenFactoryData: '0x', governanceFactory: constants.governance, governanceFactoryData: '0x',
  poolInitializer: constants.initializer,
  poolInitializerData: encodeAbiParameters(parseAbiParameters('(uint24 fee,int24 tickLower,int24 tickUpper,uint16 numPositions,uint256 maxShareToBeSold,(address beneficiary,uint256 shares)[] beneficiaries)'), [{ fee: 3000, tickLower: lower, tickUpper: upper, numPositions: 10, maxShareToBeSold: 800_000_000_000_000_000n, beneficiaries }]),
  liquidityMigrator: constants.migrator, liquidityMigratorData: '0x', integrator: launcher, salt,
};
assert.equal(await read(airlock, 'getModuleState', [factory.address]), 0);
await rejects({ ...factory, abi: [...factory.abi, ...airlockAbi.filter(item => item.type === 'error')] }, 'launch', [params], launcher, 'WrongModuleState');
assert.equal(await read(factory, 'token'), zeroAddress);
check('Unapproved custom factory cannot launch through real Airlock');
await rejects(factory, 'launch', [params], attacker, 'Unauthorized');
await rejects(factory, 'create', [launchAmount, constants.airlock, constants.airlock, salt, '0x'], attacker, 'Unauthorized');
check('Third parties cannot consume or bypass the single-launch factory');
await impersonate(owner);
await send(airlock, 'setModuleState', [[factory.address], [1]], owner);
await p.request({ method: 'hardhat_stopImpersonatingAccount', params: [owner] });
evidence.approval = 'Airlock owner impersonated on LOCAL fork only to set module state 1; public approval NOT obtained';
check('Factory approval simulated ONLY on local fork');
const creation = await send(factory, 'launch', [params]);
const token = { address: await read(factory, 'token'), abi: tokenArtifact.abi };
assert.equal(token.address.toLowerCase(), predicted.toLowerCase());
const data = await read(airlock, 'getAssetData', [token.address]);
const pool = { address: data[5], abi: poolAbi };
assert.equal(data[0].toLowerCase(), constants.rf.toLowerCase());
assert.equal(data[8], launchAmount, 'Airlock stores initial issuance, not eventual CAP');
assert.ok(await p.getCode({ address: pool.address }));
assert.equal(await read(token, 'totalSupply'), launchAmount);
assert.equal(await read(token, 'CAP'), cap);
assert.equal(await read(token, 'decimals'), 6);
assert.equal((await read(token, 'rewardMinter')).toLowerCase(), game.address.toLowerCase());
assert.equal((await read(token, 'owner')).toLowerCase(), constants.airlock.toLowerCase());
assert.equal(await read(token, 'isPoolLocked'), true);
await rejects(factory, 'launch', [params], launcher, 'InvalidLaunch');
check('Airlock launches capped custom token and a real RF V3 market; second launch denied');
evidence.launch = { token: token.address, factory: factory.address, claimFixture: game.address, pool: pool.address, transaction: creation.transactionHash, initialSupply: formatUnits(launchAmount,6), cap: formatUnits(cap,6), ticks: [lower,upper], poolLiquidity: String(await read(pool, 'liquidity')) };
// Use RF already held by the real token contract on the fork. No storage edits to RF,
// no public holder keys, no public transfers and no claim of an available RF faucet.
await impersonate(constants.rf);
await send(rf, 'transfer', [player, parseEther('1000')], constants.rf);
await p.request({ method: 'hardhat_stopImpersonatingAccount', params: [constants.rf] });
evidence.rfFunding = 'Local-only impersonation of the RF contract transferred 1,000 existing fork RF to a disposable player; RF code/storage otherwise unmodified';
const router = await deploy('V3SwapFixture', []);
await send(rf, 'approve', [router.address, parseEther('1000')], player);
const token0 = await read(pool, 'token0');
const buyZeroForOne = token0.toLowerCase() === constants.rf.toLowerCase();
const minSqrt = 4_295_128_740n;
const maxSqrt = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n;
const rfBefore = await read(rf, 'balanceOf', [player]);
await send(router, 'swap', [pool.address, buyZeroForOne, parseEther('100'), buyZeroForOne ? minSqrt : maxSqrt], player);
const bought = await read(token, 'balanceOf', [player]);
const spent = rfBefore - await read(rf, 'balanceOf', [player]);
assert.ok(bought > 0n && spent > 0n);
check('Buy custom six-decimal RARERUSH with canonical 18-decimal RF');
await send(token, 'approve', [router.address, bought], player);
const beforeSell = await read(rf, 'balanceOf', [player]);
await send(router, 'swap', [pool.address, !buyZeroForOne, bought / 2n, !buyZeroForOne ? minSqrt : maxSqrt], player);
const returned = await read(rf, 'balanceOf', [player]) - beforeSell;
assert.ok(returned > 0n);
check('Sell custom RARERUSH back into the same RF pool');
evidence.trades = { spentRF: formatUnits(spent,18), boughtRARERUSH: formatUnits(bought,6), soldRARERUSH: formatUnits(bought/2n,6), receivedRF: formatUnits(returned,18) };
await send(game, 'bindToken', [token.address]);
await rejects(game, 'bindToken', [token.address], launcher, 'Unauthorized');
await rejects(token, 'mintReward', [player, 1n], launcher, 'OnlyRewardMinter');
await rejects(token, 'mintReward', [player, 1n], attacker, 'OnlyRewardMinter');
await rejects(token, 'mintReward', [player, 1n], constants.airlock, 'OnlyRewardMinter');
await rejects(token, 'mintReward', [player, 1n], owner, 'OnlyRewardMinter');
check('Launcher, attacker, Airlock contract and its owner have no reward mint privilege');
const deadline = (await p.getBlock()).timestamp + 3600n;
const types = { Claim: [{ name:'runId',type:'bytes32' },{name:'player',type:'address'},{name:'amount',type:'uint256'},{name:'deadline',type:'uint256'}] };
async function claimSig(runId, amount, who=player, signerAccount=signer) {
  return signerAccount.signTypedData({ domain: { name:'Rare Rush Doppler Fork Fixture',version:'1',chainId:31337,verifyingContract:game.address }, types, primaryType:'Claim',message:{runId,player:who,amount,deadline} });
}
const id = keccak256(stringToHex('run-proof-1')); const reward = 2070n * 1_000_000n;
const sig = await claimSig(id,reward);
await rejects(game,'claim',[id,reward,deadline,sig],attacker,'Unauthorized');
await rejects(game,'claim',[id,reward+1n,deadline,sig],player,'Unauthorized');
await send(game,'claim',[id,reward,deadline,sig],player);
await rejects(game,'claim',[id,reward,deadline,sig],player,'InvalidClaim');
assert.equal(await read(token,'totalSupply'),launchAmount+reward);
check('Player-bound signed receipt mints once; theft, tampering and replay rejected');
await send(token,'approve',[router.address,reward],player);
const beforeRewardSell = await read(rf,'balanceOf',[player]);
await send(router,'swap',[pool.address,!buyZeroForOne,reward,!buyZeroForOne?minSqrt:maxSqrt],player);
const rewardSaleRF = (await read(rf,'balanceOf',[player])) - beforeRewardSell;
assert.ok(rewardSaleRF > 0n);
evidence.rewardClaim = { mintedRARERUSH: formatUnits(reward, 6), saleReceivedRF: formatUnits(rewardSaleRF, 18), scope: 'Trusted signed-receipt fixture only, not full game replay' };
check('Newly reward-minted tokens trade in the existing RF market');
const finalId=keccak256(stringToHex('cap-boundary-fixture'));
const remaining=cap-(await read(token,'totalSupply'));
await send(game,'claim',[finalId,remaining,deadline,await claimSig(finalId,remaining)],player);
assert.equal(await read(token,'totalSupply'),cap);
assert.equal(await read(token,'rewardsMinted'),cap-launchAmount);
const overflowId=keccak256(stringToHex('overflow-fixture'));
await assert.rejects(p.simulateContract({...game,functionName:'claim',args:[overflowId,1n,deadline,await claimSig(overflowId,1n)],account:player}));
assert.equal(await read(game,'claimed',[overflowId]),false);
assert.equal(await read(token,'totalSupply'),cap);
check('Combined launch and reward issuance reaches exact 1.024B cap and cannot exceed it');
// Exercise the migration token interface independently of the no-op migration route.
// This impersonation is local and does not claim that a production migration was tested.
await impersonate(constants.airlock);
await send(token,'unlockPool',[],constants.airlock);
await send(token,'transferOwnership',[attacker],constants.airlock);
await p.request({method:'hardhat_stopImpersonatingAccount',params:[constants.airlock]});
await rejects(token,'mintReward',[player,1n],attacker,'OnlyRewardMinter');
await send(token,'lockPool',[launcher],attacker);
await rejects(token,'transfer',[launcher,1n],player,'PoolLocked');
await send(token,'unlockPool',[],attacker);
await send(token,'transfer',[launcher,1n],player);
assert.equal((await read(token,'rewardMinter')).toLowerCase(),game.address.toLowerCase());
check('Doppler lock/unlock/ownership interface works; ownership changes cannot change the minter');
evidence.indexing = { airlockRecordedInitialSupply: formatUnits(data[8], 6), eventualTokenCap: formatUnits(cap, 6), note: 'Airlock getAssetData.totalSupply is an initial-supply snapshot. SDK/indexer/FDV handling of future reward issuance still needs validation.' };
evidence.claimScope='Signed receipt fixture only. No physics replay, NFT ownership, quotas or existing RareRushGame adapter exercised here.';
evidence.limitations=['No public deployment or Airlock approval','No public Robinhood-testnet Doppler modules in official deployments list','No production migration exercised: locked V3 market with NoOpMigrator fixture','No final launch allocation, price, fee beneficiaries or emission schedule decided','No end-to-end integration with existing RareRushGame; it currently creates its own token','Prototype is unaudited and intentionally rejects mainnet chain ID'];
evidence.generatedAt=new Date().toISOString();
await writeFile(new URL('../evidence/robinhood-fork.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(`\n${evidence.checks.length} compatibility checks passed. LOCAL fork only.`);
