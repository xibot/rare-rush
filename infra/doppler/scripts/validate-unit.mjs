import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, stringToHex, zeroAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
const url = new URL(process.env.RUSH_DOPPLER_LOCAL_RPC ?? '');
assert.equal(url.hostname,'127.0.0.1');
const chain=defineChain({id:31337,name:'Isolated token tests',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[url.href]}}});
const p=createPublicClient({chain,transport:http(url.href),cacheTime:0});
const w=createWalletClient({chain,transport:http(url.href)});
assert.equal(await p.getChainId(),31337);
const [owner,player,attacker]=await w.getAddresses();
const signer=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:3});
const rogue=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:4});
const artifacts={};
for (const name of ['RareRushDopplerPrototype','RareRushDopplerFactoryPrototype','VerifiedClaimFixture']) artifacts[name]=JSON.parse(await readFile(new URL(`../artifacts/${name}.json`,import.meta.url),'utf8'));
async function deploy(name,args){const a=artifacts[name];const receipt=await p.waitForTransactionReceipt({hash:await w.deployContract({abi:a.abi,bytecode:a.bytecode,args,account:owner})});assert.equal(receipt.status,'success');return{address:receipt.contractAddress,abi:a.abi};}
async function read(c,functionName,args=[]){return p.readContract({...c,functionName,args});}
async function send(c,functionName,args=[],account=owner){const{request}=await p.simulateContract({...c,functionName,args,account});const receipt=await p.waitForTransactionReceipt({hash:await w.writeContract(request)});assert.equal(receipt.status,'success');return receipt;}
async function rejects(c,functionName,args,account,errorName){await assert.rejects(p.simulateContract({...c,functionName,args,account}),error=>{if(errorName)assert.equal(error.walk?.(x=>x?.data?.errorName)?.data?.errorName,errorName,error.shortMessage);return true;});}
const checks=[];let count=0;function check(name){count++;checks.push(name);console.log(`PASS ${name}`);}
const CAP=1_024_000_000n*1_000_000n;
const launch=CAP/10n;
const game=await deploy('VerifiedClaimFixture',[signer.address]);
for(const allocation of [0n,CAP,CAP+1n]) await assert.rejects(w.deployContract({abi:artifacts.RareRushDopplerPrototype.abi,bytecode:artifacts.RareRushDopplerPrototype.bytecode,args:[owner,owner,game.address,allocation],account:owner}));
check('Zero, full-cap and over-cap launch allocations rejected');
await assert.rejects(w.deployContract({abi:artifacts.RareRushDopplerPrototype.abi,bytecode:artifacts.RareRushDopplerPrototype.bytecode,args:[owner,owner,attacker,launch],account:owner}));
check('Reward minter must be a contract, not an EOA');
const token=await deploy('RareRushDopplerPrototype',[owner,owner,game.address,launch]);
assert.equal(await read(token,'CAP'),CAP);assert.equal(await read(token,'decimals'),6);assert.equal(await read(token,'totalSupply'),launch);assert.equal(await read(token,'rewardAllocation'),CAP-launch);
check('Only fixed launch allocation minted initially; six decimals and 1.024B cap');
await rejects(game,'bindToken',[token.address],attacker,'Unauthorized');await send(game,'bindToken',[token.address]);await rejects(game,'bindToken',[token.address],owner,'Unauthorized');
check('Only controller can bind token, exactly once');
for(const actor of[owner,player,attacker])await rejects(token,'mintReward',[player,1n],actor,'OnlyRewardMinter');
check('Token owner and arbitrary accounts cannot mint rewards');
const domain={name:'Rare Rush Doppler Fork Fixture',version:'1',chainId:31337,verifyingContract:game.address};
const types={Claim:[{name:'runId',type:'bytes32'},{name:'player',type:'address'},{name:'amount',type:'uint256'},{name:'deadline',type:'uint256'}]};
const deadline=(await p.getBlock()).timestamp+3600n;
async function sign(id,amount,receiptDeadline=deadline,account=signer,overrideDomain=domain){return account.signTypedData({domain:overrideDomain,types,primaryType:'Claim',message:{runId:id,player,amount,deadline:receiptDeadline}});}
const id=keccak256(stringToHex('unit-run'));const amount=2070n*1_000_000n;const signature=await sign(id,amount);
await rejects(game,'claim',[id,amount,deadline,signature],attacker,'Unauthorized');await rejects(game,'claim',[id,amount+1n,deadline,signature],player,'Unauthorized');await rejects(game,'claim',[id,amount,deadline,await sign(id,amount,deadline,rogue)],player,'Unauthorized');
check('Receipt binds player, amount and trusted verifier');
await rejects(game,'claim',[id,amount,deadline,await sign(id,amount,deadline,signer,{...domain,chainId:46630})],player,'Unauthorized');await rejects(game,'claim',[id,amount,deadline,await sign(id,amount,deadline,signer,{...domain,verifyingContract:token.address})],player,'Unauthorized');
check('Receipt cannot replay across chains or verifying contracts');
const expired=(await p.getBlock()).timestamp-1n;await rejects(game,'claim',[id,amount,expired,await sign(id,amount,expired)],player,'InvalidClaim');
check('Expired receipt rejected');
await send(game,'claim',[id,amount,deadline,signature],player);assert.equal(await read(token,'totalSupply'),launch+amount);assert.equal(await read(token,'balanceOf',[player]),amount);await rejects(game,'claim',[id,amount,deadline,signature],player,'InvalidClaim');
check('Valid claim mints once and rejects replay');
await rejects(token,'lockPool',[attacker],attacker,'OwnableUnauthorizedAccount');await send(token,'lockPool',[attacker]);await rejects(token,'transfer',[attacker,1n],player,'PoolLocked');await rejects(token,'lockPool',[player],owner,'PoolAlreadyLocked');await send(token,'unlockPool');await rejects(token,'unlockPool',[],owner,'PoolAlreadyUnlocked');await send(token,'transfer',[attacker,1n],player);
check('Doppler pool lock blocks deposits until authorized unlock');
await send(token,'transferOwnership',[attacker]);assert.equal((await read(token,'rewardMinter')).toLowerCase(),game.address.toLowerCase());await rejects(token,'mintReward',[player,1n],attacker,'OnlyRewardMinter');
check('Ownership transfer leaves immutable gameplay minter unchanged');
const boundary=keccak256(stringToHex('unit-cap-boundary'));const remaining=CAP-(await read(token,'totalSupply'));await send(game,'claim',[boundary,remaining,deadline,await sign(boundary,remaining)],player);assert.equal(await read(token,'totalSupply'),CAP);assert.equal(await read(token,'rewardsMinted'),CAP-launch);
check('Launch plus signed rewards can reach exact cap');
const overflow=keccak256(stringToHex('unit-overflow'));await rejects(game,'claim',[overflow,1n,deadline,await sign(overflow,1n)],player);assert.equal(await read(game,'claimed',[overflow]),false);assert.equal(await read(token,'totalSupply'),CAP);
check('Over-cap claim reverts without consuming receipt or altering supply');
const factory=await deploy('RareRushDopplerFactoryPrototype',[game.address,game.address,launch]);assert.equal(await read(factory,'launchAllocation'),launch);assert.equal((await read(factory,'rewardMinter')).toLowerCase(),game.address.toLowerCase());await rejects(factory,'create',[launch,game.address,game.address,keccak256(stringToHex('salt')),'0x'],attacker,'Unauthorized');assert.equal(await read(factory,'token'),zeroAddress);
check('Factory configuration immutable and create callable only through launch envelope');
await writeFile(new URL('../evidence/unit.json',import.meta.url),JSON.stringify({ scope: 'LOCAL ONLY; no upstream RPC', chainId:31337, generatedAt:new Date().toISOString(), checks },null,2)+'\n');
console.log(`\n${count} local unit checks passed. No upstream RPC.`);
