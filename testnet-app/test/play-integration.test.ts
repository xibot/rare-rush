import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicClient, createWalletClient, http, parseEther, toHex, type Address, type EIP1193Provider, type Hash } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import deployment from '../src/shared/deployment.json' with { type: 'json' };
import { artifact } from '../../infra/testnet/src/artifacts.mjs';
import { currentEngineVersion } from '../../infra/testnet/src/engine-version.ts';
import { recordPilot } from '../../infra/testnet/test/pilot.ts';
import { verifyAndSignCore } from '../generated/infra/testnet/src/verifier-core.ts';
import { createVerifierHandlers, RunVerificationRejected } from '../server/handler.ts';
import { AUTH_GAME, AUTH_SITE, createAuthorization, authorizationTypedData } from '../src/shared/authorization.ts';
import { createRecorder, advanceRecorder, queueControls, exportReplay, snapshotRun } from '../src/play/recorder.ts';
import { TESTNET_CHAIN, PLAY_CONTRACTS, ENGINE_VERSION, verifyPlayContracts, approveEntry, startRun, claimRun, type PlayContext } from '../src/play/chain.ts';
import { loadPlayState, savePlayState, validateVerifiedClaim } from '../src/play/storage.ts';

/** Explicit opt-in. This starts a fresh loopback EVM, never a public-chain connection.
 * The public deployment addresses are reproduced via CREATE nonces so the actual
 * pinned browser/auth domain can be exercised without relaxing production guards.
 */
test('local V2 recorder → authenticated handler → confirmed mint for both collections in every mode', {
  skip: process.env.RUSH_RUN_PLAY_INTEGRATION !== '1', timeout: 120_000,
}, async () => {
  const root = fileURLToPath(new URL('../../infra/testnet/', import.meta.url));
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject).listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      server.close(() => resolve(address.port));
    });
  });
  const rpc = `http://127.0.0.1:${port}`;
  assert.equal(new URL(rpc).hostname, '127.0.0.1');
  const node = spawn(process.execPath, ['node_modules/hardhat/dist/src/cli.js', 'node', '--chain-id', '46630', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, DO_NOT_TRACK: '1' },
  });
  let mining: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => { if (mining) clearInterval(mining); node.kill(); };
  process.once('SIGTERM', cleanup); process.once('SIGINT', cleanup);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (node.exitCode !== null) throw new Error('Isolated integration EVM exited before startup.');
      try {
        const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
        if ((await response.json()).result === '0xb626') { ready = true; break; }
      } catch { /* Wait only for the spawned local process. */ }
      await delay(100);
    }
    assert.ok(ready, 'Fresh loopback EVM must be ready');
    const client = createPublicClient({ chain: TESTNET_CHAIN, transport: http(rpc), pollingInterval: 30, cacheTime: 0 });
    assert.equal(await client.getChainId(), 46630);
    const devRpc = (method: string, params: unknown[] = []) => client.request({ method, params } as any);
    // Public Hardhat fixture identities; never real credentials or account secrets.
    const mnemonic = 'test test test test test test test test test test test junk';
    const player = mnemonicToAccount(mnemonic, { addressIndex: 0 });
    const verifier = mnemonicToAccount(mnemonic, { addressIndex: 2 });
    const attacker = mnemonicToAccount(mnemonic, { addressIndex: 4 });
    const deployer = '0x6fD155b9D52F80E8A73a8A2537268602978486e2' as Address;
    await devRpc('hardhat_impersonateAccount', [deployer]);
    await devRpc('hardhat_setBalance', [deployer, toHex(parseEther('100'))]);
    await devRpc('hardhat_setNonce', [deployer, toHex(deployment.deploymentNonces.rf)]);
    const ownerWallet = createWalletClient({ account: deployer, chain: TESTNET_CHAIN, transport: http(rpc) });
    const playerWallet = createWalletClient({ account: player, chain: TESTNET_CHAIN, transport: http(rpc) });
    const [rfArtifact, nftArtifact, gameArtifact, tokenArtifact] = await Promise.all(['TestRF', 'TestFriends', 'RareRushGame', 'RareRushToken'].map(artifact));
    const engineVersion = await currentEngineVersion();
    assert.equal(engineVersion, ENGINE_VERSION, 'Generated browser engine must match compiled contract metadata');
    async function mined(hash: Hash) {
      const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 20 });
      assert.equal(receipt.status, 'success'); return receipt;
    }
    async function deploy(data: any, args: unknown[] = []) {
      const receipt = await mined(await ownerWallet.deployContract({ abi: data.abi, bytecode: data.bytecode, args }));
      assert.ok(receipt.contractAddress); return receipt.contractAddress;
    }
    const rf = await deploy(rfArtifact);
    const genesis = await deploy(nftArtifact, [true]);
    const generations = await deploy(nftArtifact, [false]);
    const launch = 102_400_000n * 1_000_000n;
    await devRpc('hardhat_setNonce', [deployer, toHex(deployment.deploymentNonces.game)]);
    const game = await deploy(gameArtifact, [deployer, verifier.address, deployer, rf, genesis, generations, engineVersion, launch]);
    await devRpc('hardhat_setNonce', [deployer, toHex(deployment.deploymentNonces.rewardToken)]);
    const rewardToken = await deploy(tokenArtifact, [deployer, deployer, game, launch]);
    for (const [key, deployed] of Object.entries({ rf, genesis, generations, game, rewardToken })) {
      assert.equal(deployed.toLowerCase(), PLAY_CONTRACTS[key as keyof typeof PLAY_CONTRACTS]);
    }
    assert.equal(game.toLowerCase(), AUTH_GAME.toLowerCase());
    await mined(await ownerWallet.writeContract({ address: game, abi: gameArtifact.abi, functionName: 'bindRewardToken', args: [rewardToken] }));
    await devRpc('hardhat_stopImpersonatingAccount', [deployer]);
    await verifyPlayContracts(client); // Actual runtime hashes and economics; no mocked RPC result.
    // Keep explicit awaiting of transaction hashes; no public or custom transport routing.
    const playerWrite = async (address: Address, abi: any, functionName: string, args: unknown[] = []) => mined(await playerWallet.writeContract({ address, abi, functionName, args }));
    await playerWrite(rf, rfArtifact.abi, 'faucet');
    await playerWrite(generations, nftArtifact.abi, 'mint');
    await playerWrite(genesis, nftArtifact.abi, 'mint');
    const records = new Map<string, string>();
    const store = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); } };
    const provider = { request: async ({ method, params }: { method: string; params?: unknown[] }) => method === 'eth_accounts' ? [player.address] : devRpc(method, params) } as EIP1193Provider;
    const ctx: PlayContext = { client, provider, account: player.address, store };
    // Two actual local blocks confirm each browser-helper transaction.
    let miningBusy = false;
    mining = setInterval(() => {
      if (miningBusy) return; miningBusy = true;
      void devRpc('evm_mine').catch(() => undefined).finally(() => { miningBusy = false; });
    }, 150);
    // Fast-forward service time with the local chain. Six complete runs would
    // otherwise arrive within one real minute and correctly hit the wallet limiter.
    let verificationClock = Math.floor(Date.now() / 1000);
    const now = () => verificationClock;
    let verificationCalls = 0;
    const handlers = createVerifierHandlers({
      now,
      status: async () => {
        const currentSigner = await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'verifier' });
        assert.equal(currentSigner, verifier.address);
        return { ready: true, chainId: 46630, game, engineVersion, verifier: verifier.address, reason: 'ready' };
      },
      verify: async ({ runId, replay, expectedPlayer }) => {
        verificationCalls++;
        try {
          return await verifyAndSignCore({ client, chainId: 46630, game, runId, replay, expectedPlayer,
            privateKey: toHex(verifier.getHdKey().privateKey!), confirmations: 2,
            gameAbi: gameArtifact.abi, nftAbi: nftArtifact.abi, engineVersion,
          });
        } catch (error) { throw new RunVerificationRejected(error instanceof Error ? error.message : 'Rejected'); }
      },
    });
    function request(body: unknown) { return new Request(`${AUTH_SITE}/api/verify-run`, { method: 'POST', headers: { origin: AUTH_SITE, 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
    const balance = () => client.readContract({ address: rewardToken, abi: tokenArtifact.abi, functionName: 'balanceOf', args: [player.address] }) as Promise<bigint>;
    let expectedBalance = 0n;
    for (const collection of [0, 1] as const) {
     for (const difficulty of [0, 1, 2] as const) {
      const mode = (['easy', 'normal', 'degen'] as const)[difficulty];
      const duration = [120, 90, 60][difficulty];
      const beforeRF = await client.readContract({ address: rf, abi: rfArtifact.abi, functionName: 'balanceOf', args: [player.address] }) as bigint;
      if (collection === 0) {
        const approved = await approveEntry(ctx);
        assert.equal(approved.pending, null); assert.equal(approved.history.at(-1)?.kind, 'approve');
      }
      const started = await startRun(ctx, { collection, tokenId: '1', difficulty });
      assert.equal(started.savedRun?.status, 'ready'); assert.equal(started.pending, null);
      const run = started.savedRun!.run;
      const controls = recordPilot(run.seed, difficulty);
      let recorder = createRecorder(run.seed, mode);
      for (const input of controls.frames) {
        queueControls(recorder, { jump: input.jump, slide: input.slide, pace: input.pace }); advanceRecorder(recorder);
        if (recorder.run._tick === 5400) {
          recorder = createRecorder(run.seed, mode, exportReplay(recorder), snapshotRun(recorder).completedTicks);
        }
      }
      assert.equal(recorder.run.finishReason, 'time', 'Legal pilot must survive this fixture course');
      assert.ok(recorder.run.hearts > 0); assert.ok(recorder.run.coins > 0);
      const replay = exportReplay(recorder); const snapshot = snapshotRun(recorder);
      assert.deepEqual(replay, controls, 'Browser recorder resumes and emits the canonical verifier input stream');
      const state = loadPlayState(store, player.address);
      state.savedRun!.replay = replay; state.savedRun!.completedTicks = snapshot.completedTicks; state.savedRun!.status = 'survived'; savePlayState(store, state);
      const authorization = createAuthorization({ player: player.address, runId: run.runId, replay, expiresAt: now() + 240 });
      const signature = await player.signTypedData(authorizationTypedData(authorization));
      const badSignature = await attacker.signTypedData(authorizationTypedData(authorization));
      const callsBefore = verificationCalls;
      assert.equal((await handlers.verify(request({ authorization, signature: badSignature, replay }))).status, 401);
      assert.equal(verificationCalls, callsBefore, 'Wrong wallet never reaches replay verification');
      const tampered = { ...replay, frames: replay.frames.map((frame, index) => index === 0 ? { ...frame, jump: !frame.jump } : frame) };
      assert.equal((await handlers.verify(request({ authorization, signature, replay: tampered }))).status, 400);
      await devRpc('evm_increaseTime', [duration + 1]);
      verificationClock += duration + 1;
      await devRpc('hardhat_mine', ['0x3']);
      const response = await handlers.verify(request({ authorization, signature, replay }));
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      const claim = validateVerifiedClaim(body, run, replay);
      const reward = await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'quoteReward', args: [claim.pickupKinds, collection, difficulty] }) as bigint;
      assert.ok(reward > 0n);
      if (collection === 1) {
        const ordinary = await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'quoteReward', args: [claim.pickupKinds, 0, difficulty] }) as bigint;
        assert.equal(reward, ordinary * 100n);
      }
      const claimed = await claimRun(ctx, claim);
      assert.equal(claimed.savedRun?.status, 'claimed'); assert.equal(claimed.savedRun?.reward, String(reward));
      assert.equal(claimed.pending, null); expectedBalance += reward;
      assert.equal(await balance(), expectedBalance);
      const afterRF = await client.readContract({ address: rf, abi: rfArtifact.abi, functionName: 'balanceOf', args: [player.address] }) as bigint;
      assert.equal(beforeRF - afterRF, collection === 0 ? 110n * 10n ** 18n : 0n);
      await devRpc('hardhat_mine', ['0x3']);
      assert.equal((await handlers.verify(request({ authorization, signature, replay }))).status, 422, 'Finalized runs cannot obtain another reward receipt');
     }
    }
    assert.equal(await client.readContract({ address: game, abi: gameArtifact.abi, functionName: 'prizePoolBalance' }), 300n * 10n ** 18n);
    assert.equal(await client.readContract({ address: rf, abi: rfArtifact.abi, functionName: 'balanceOf', args: [deployer] }), 30n * 10n ** 18n);
    assert.equal(await client.readContract({ address: rewardToken, abi: tokenArtifact.abi, functionName: 'totalSupply' }), launch + expectedBalance);
  } finally {
    cleanup(); process.removeListener('SIGTERM', cleanup); process.removeListener('SIGINT', cleanup);
    await new Promise<void>(resolve => { if (node.exitCode !== null) resolve(); else { node.once('exit', () => resolve()); setTimeout(resolve, 1000).unref(); } });
  }
});
