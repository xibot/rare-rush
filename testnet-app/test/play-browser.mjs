import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, toHex } from 'viem';
import { PLAY_CONTRACTS, ENGINE_VERSION, DEPLOYMENT_BLOCK } from '../src/play/types.ts';
import { PLAY_GAME_ABI } from '../src/play/chain.ts';
import { emptyPlayState, stateKey } from '../src/play/storage.ts';
import { tokenAbi, nftAbi } from '../src/abi.ts';
import { REWARD_CAP, LAUNCH_ALLOCATION, GAMEPLAY_ALLOCATION, RPC_URL } from '../src/safety.ts';
import runtimes from './fixtures/play-runtimes.json' with { type: 'json' };
const origin = process.env.TESTNET_APP_URL ?? 'http://127.0.0.1:4176';
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const account = `0x${'1'.repeat(40)}`, other = `0x${'2'.repeat(40)}`;
const seed = keccak256(toHex('browser-recording-fixture'));
const hash = `0x${'3'.repeat(64)}`, blockHash = `0x${'4'.repeat(64)}`;
const head = DEPLOYMENT_BLOCK + 10n, now = BigInt(Math.floor(Date.now() / 1000));
const fullTokenAbi = [...tokenAbi, ...parseAbi(['function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)'])];
const fullNftAbi = [...nftAbi, ...parseAbi(['function generation(uint256) view returns(uint256)'])];
const runFixture = (collection = 0) => ({ runId: '5', player: account, tokenId: '1', seed, startedAt: String(now), claimUntil: String(now + 990n), collection, difficulty: 1, claimed: false, verifierEpoch: '1', abandoned: false });
function readyState(collection = 0) { return { ...emptyPlayState(account), friends: [{ collection: 0, tokenId: '1' }, { collection: 1, tokenId: '2' }], savedRun: { run: runFixture(collection), replay: { version: 'rare-rush-input-v1', frames: [] }, completedTicks: 0, status: 'ready' } }; }
function pendingState(hashKnown = true) { return { ...emptyPlayState(account), friends: [{ collection: 0, tokenId: '1' }], pending: { kind: 'start', to: PLAY_CONTRACTS.game, data: encodeFunctionData({ abi: PLAY_GAME_ABI, functionName: 'startRun', args: [0, 1n, 1] }), value: '0', nonce: 9, hash: hashKnown ? hash : null, createdAt: Number(now) * 1000, selection: { collection: 0, tokenId: '1', difficulty: 1 } } }; }
for (const key of Object.keys(PLAY_CONTRACTS)) {
    assert.equal(runtimes.contracts[key], PLAY_CONTRACTS[key]);
    assert.equal(keccak256(runtimes.code[key]), runtimes.hashes[key]);
}
const browser = await chromium.launch({ headless: true });
const errors = [];
async function setup({ state = null, mobile = false, chain = '0xb626', authorized = false, runtimeMismatch = false, serverReady = true } = {}) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    const page = await context.newPage();
    await context.route('**/*', r => new URL(r.request().url()).origin === new URL(origin).origin ? r.continue() : r.abort());
    const requests = [], unexpected = [];
    const currentRun = state?.savedRun?.run ?? runFixture(), pending = state?.pending ?? pendingState().pending;
    await context.addInitScript(({ state, key, account, chain, authorized }) => {
        // New tabs initially run this script on about:blank, which has no origin storage.
        if (!/^https?:$/.test(location.protocol)) return;
        if (!localStorage.getItem('play-test-initialized')) {
            if (state) localStorage.setItem(key, JSON.stringify(state));
            localStorage.setItem('play-test-initialized', '1');
            localStorage.setItem('play-test-wallet', JSON.stringify({ account, chain, authorized, prompts: 0 }));
        }
        const read = () => JSON.parse(localStorage.getItem('play-test-wallet'));
        const update = patch => localStorage.setItem('play-test-wallet', JSON.stringify({ ...read(), ...patch }));
        window.mockWallet = {
            get account() { return read().account; }, set account(value) { update({ account: value }); },
            get chain() { return read().chain; }, set chain(value) { update({ chain: value }); },
            get authorized() { return read().authorized; }, set authorized(value) { update({ authorized: value }); },
            get prompts() { return read().prompts; }, writes: [], requests: [], listeners: {},
        };
        window.ethereum = { on(name, fn) { (window.mockWallet.listeners[name] ??= []).push(fn); }, removeListener(name, fn) { window.mockWallet.listeners[name] = (window.mockWallet.listeners[name] ?? []).filter(v => v !== fn); }, async request({ method, params }) {
                window.mockWallet.requests.push({ method, params });
                if (method === 'eth_requestAccounts') {
                    update({ authorized: true, prompts: read().prompts + 1 });
                    return [window.mockWallet.account];
                }
                if (method === 'eth_accounts')
                    return window.mockWallet.authorized ? [window.mockWallet.account] : [];
                if (method === 'eth_chainId')
                    return window.mockWallet.chain;
                if (method === 'wallet_switchEthereumChain') {
                    window.mockWallet.chain = params[0].chainId;
                    return null;
                }
                window.mockWallet.writes.push({ method, params });
                throw Object.assign(new Error('User rejected fixture wallet operation'), { code: 4001 });
            } };
    }, { state, key: stateKey(account), account, chain, authorized });
    await context.route('**/api/status', r => r.fulfill({ json: { ready: serverReady, chainId: 46630, game: PLAY_CONTRACTS.game } }));
    await context.route('**/api/verify-run', r => { unexpected.push('Unexpected verification request'); return r.fulfill({ status: 503, json: { error: 'Verification fixture unavailable' } }); });
    const nft = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [currentRun.collection, BigInt(currentRun.tokenId)]));
    const startedLog = { address: PLAY_CONTRACTS.game, topics: encodeEventTopics({ abi: PLAY_GAME_ABI, eventName: 'RunStarted', args: { runId: 5n, player: account, nft } }), data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint256' }], [currentRun.collection, BigInt(currentRun.tokenId), 1, seed, BigInt(currentRun.startedAt), BigInt(currentRun.claimUntil), 1n]), blockNumber: toHex(head - 1n), blockHash, transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false };
    const tx = { hash, from: account, to: PLAY_CONTRACTS.game, nonce: '0x9', chainId: '0xb626', value: '0x0', input: pending.data, blockHash, blockNumber: toHex(head - 1n), transactionIndex: '0x0', type: '0x2', gas: '0x50000', gasPrice: '0x1', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1', v: '0x1', r: `0x${'5'.repeat(64)}`, s: `0x${'6'.repeat(64)}`, accessList: [] };
    const receipt = { transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: toHex(head - 1n), from: account, to: PLAY_CONTRACTS.game, cumulativeGasUsed: '0x21000', gasUsed: '0x21000', effectiveGasPrice: '0x1', contractAddress: null, logs: [startedLog], status: '0x1', type: '0x2', logsBloom: `0x${'00'.repeat(256)}` };
    function contractCall(item) {
        const key = Object.keys(PLAY_CONTRACTS).find(k => PLAY_CONTRACTS[k] === item.params[0].to.toLowerCase());
        assert.ok(key, `Unknown contract ${item.params[0].to}`);
        const abi = key === 'game' ? PLAY_GAME_ABI : ['genesis', 'generations'].includes(key) ? fullNftAbi : fullTokenAbi;
        const { functionName } = decodeFunctionData({ abi, data: item.params[0].data });
        const values = { game: { rf: PLAY_CONTRACTS.rf, genesis: PLAY_CONTRACTS.genesis, generations: PLAY_CONTRACTS.generations, token: PLAY_CONTRACTS.rewardToken, ENTRY_FEE: 110n * 10n ** 18n, PRIZE_POOL_SHARE: 100n * 10n ** 18n, TREASURY_SHARE: 10n * 10n ** 18n, MAX_DAILY_RUNS: 3n, engineVersion: ENGINE_VERSION, paused: false, expectedLaunchAllocation: LAUNCH_ALLOCATION, INITIAL_COIN_REWARD: 10000000n, MIN_COIN_REWARD: 1000000n, HALVING_INTERVAL: 10000n, runs: [currentRun.player, BigInt(currentRun.tokenId), currentRun.seed, BigInt(currentRun.startedAt), BigInt(currentRun.claimUntil), currentRun.collection, currentRun.difficulty, currentRun.claimed, 1n, currentRun.abandoned], nftKey: nft, dailyStarts: 1n, activeRunByNft: state?.savedRun ? 5n : 0n }, rewardToken: { CAP: REWARD_CAP, rewardMinter: PLAY_CONTRACTS.game, decimals: 6, launchAllocation: LAUNCH_ALLOCATION, rewardAllocation: GAMEPLAY_ALLOCATION, rewardsMinted: 0n, totalSupply: LAUNCH_ALLOCATION, balanceOf: 0n }, rf: { FAUCET_AMOUNT: 1100n * 10n ** 18n, lastFaucetDayPlusOne: 0n, balanceOf: 1100n * 10n ** 18n, allowance: 110n * 10n ** 18n }, genesis: { isGenesis: true, ownerOf: account, balanceOf: 1n }, generations: { isGenesis: false, ownerOf: account, generation: 1n, balanceOf: 1n } };
        assert.ok(functionName in values[key], `Unexpected ${key}.${functionName}`);
        return encodeFunctionResult({ abi, functionName, result: values[key][functionName] });
    }
    function respond(item) {
        requests.push(item);
        try {
            let result;
            if (item.method === 'eth_chainId')
                result = '0xb626';
            else if (item.method === 'eth_blockNumber')
                result = toHex(head);
            else if (item.method === 'eth_getBalance')
                result = toHex(10n ** 18n);
            else if (item.method === 'eth_getCode') {
                const key = Object.keys(PLAY_CONTRACTS).find(k => PLAY_CONTRACTS[k] === item.params[0].toLowerCase());
                assert.ok(key);
                result = runtimeMismatch ? '0x6000' : runtimes.code[key];
            }
            else if (item.method === 'eth_call')
                result = contractCall(item);
            else if (item.method === 'eth_getLogs')
                result = [];
            else if (item.method === 'eth_getTransactionByHash')
                result = tx;
            else if (item.method === 'eth_getTransactionReceipt')
                result = receipt;
            else if (item.method === 'eth_getBlockByNumber')
                result = { number: item.params[0] === 'latest' ? toHex(head) : item.params[0], hash: blockHash, timestamp: toHex(now + 5n), transactions: [], parentHash: `0x${'0'.repeat(64)}`, gasLimit: '0x1000000', gasUsed: '0x21000', baseFeePerGas: '0x1' };
            else
                throw new Error(`Unexpected RPC ${item.method}`);
            return { jsonrpc: '2.0', id: item.id, result };
        }
        catch (e) {
            unexpected.push(e.message);
            return { jsonrpc: '2.0', id: item.id, error: { code: -32603, message: e.message } };
        }
    }
    await context.route(`${RPC_URL}/**`, r => { const data = r.request().postDataJSON(); return r.fulfill({ json: Array.isArray(data) ? data.map(respond) : respond(data) }); });
    await context.route('**/testnet-config.json', r => r.fulfill({ json: { version: 1, chainId: 46630, contracts: PLAY_CONTRACTS, deploymentConsoleUrl: null } }));
    await page.goto(`${origin}/play/`);
    await page.getByRole('heading', { name: /MAKE YOUR RUN COUNT/ }).waitFor();
    return { page, context, requests, unexpected };
}
async function connect(page) {
    await page.getByRole('button', { name: /CONNECT WALLET|DISCONNECT/ }).waitFor();
    if (await page.getByRole('button', { name: 'CONNECT WALLET' }).isVisible()) await page.getByRole('button', { name: 'CONNECT WALLET' }).click();
    await page.getByRole('button', { name: 'REFRESH' }).waitFor();
}
async function screenshot(page, name) { await page.screenshot({ path: fileURLToPath(new URL(name, output)), fullPage: true, animations: 'disabled' }); }
async function saved(page, who = account) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), stateKey(who)); }
async function noWrites(page) { assert.deepEqual(await page.evaluate(() => window.mockWallet.writes), []); }
try {
    // An already authorized injected wallet restores without opening a permission prompt.
    const authorized = await setup({ authorized: true });
    await authorized.page.getByRole('button', { name: 'DISCONNECT', exact: true }).waitFor();
    assert.equal(await authorized.page.evaluate(() => window.mockWallet.prompts), 0);
    await noWrites(authorized.page);
    assert.deepEqual(authorized.unexpected, []);
    await authorized.context.close();

    const session = await setup();
    await session.page.getByRole('button', { name: 'CONNECT WALLET' }).waitFor();
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 0, 'silent restoration must never request account permissions');
    await connect(session.page);
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 1);
    await session.page.getByRole('link', { name: 'TEST KIT', exact: true }).click();
    await session.page.locator('#disconnect').waitFor();
    assert.match(await session.page.locator('.wallet-panel').innerText(), /0x1111…1111/);
    await session.page.reload();
    await session.page.locator('#disconnect').waitFor();
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 1, 'test kit navigation and reload must retain authorization silently');
    await session.page.getByRole('link', { name: 'ARCADE' }).click();
    await session.page.getByRole('button', { name: 'DISCONNECT', exact: true }).waitFor();
    await session.page.reload();
    await session.page.getByRole('button', { name: 'DISCONNECT', exact: true }).waitFor();
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 1, 'arcade navigation and reload must retain authorization silently');

    const secondTab = await session.context.newPage();
    await secondTab.goto(origin);
    await secondTab.locator('#disconnect').waitFor();
    await session.page.getByRole('button', { name: 'DISCONNECT', exact: true }).click();
    await session.page.getByRole('button', { name: 'CONNECT WALLET' }).waitFor();
    await secondTab.locator('#connect').waitFor();
    assert.equal(await secondTab.locator('#disconnect').count(), 0, 'explicit disconnect must clear the other open testnet page');
    await session.page.reload();
    await secondTab.reload();
    await session.page.getByRole('button', { name: 'CONNECT WALLET' }).waitFor();
    await secondTab.locator('#connect').waitFor();
    await session.page.evaluate(other => {
        window.mockWallet.account = other;
        for (const listener of [...window.mockWallet.listeners.accountsChanged]) listener([other]);
    }, other);
    assert.equal(await session.page.getByRole('button', { name: 'DISCONNECT', exact: true }).count(), 0, 'wallet account changes must not override an explicit app disconnect');
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 1);
    await session.page.getByRole('link', { name: 'TEST KIT', exact: true }).click();
    await session.page.locator('#connect').waitFor();
    await session.page.locator('#connect').click();
    await session.page.locator('#disconnect').waitFor();
    assert.match(await session.page.locator('.wallet-panel').innerText(), /0x2222…2222/);
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 2, 'only an explicit reconnect may request permissions after disconnect');
    await secondTab.close();
    await session.page.getByRole('link', { name: 'ARCADE' }).click();
    await session.page.locator('.play-wallet').filter({ hasText: '0x2222…2222' }).waitFor();

    // Revoking account access clears the connected UI, including after reload.
    await session.page.evaluate(() => {
        window.mockWallet.authorized = false;
        for (const listener of [...window.mockWallet.listeners.accountsChanged]) listener([]);
    });
    await session.page.getByRole('button', { name: 'CONNECT WALLET' }).waitFor();
    await session.page.reload();
    await session.page.getByRole('button', { name: 'CONNECT WALLET' }).waitFor();
    assert.equal(await session.page.getByRole('button', { name: 'DISCONNECT', exact: true }).count(), 0, 'cached account must never restore revoked wallet access');
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 2);
    // Unlocking/re-authorizing in the provider may restore a session silently.
    await session.page.evaluate(account => {
        window.mockWallet.account = account;
        window.mockWallet.authorized = true;
        for (const listener of [...window.mockWallet.listeners.accountsChanged]) listener([account]);
    }, account);
    await session.page.locator('.play-wallet').filter({ hasText: '0x1111…1111' }).waitFor();
    await session.page.evaluate(() => {
        window.mockWallet.chain = '0x1';
        for (const listener of [...window.mockWallet.listeners.chainChanged]) listener('0x1');
    });
    await session.page.getByRole('button', { name: 'SWITCH TO TESTNET' }).waitFor();
    await session.page.reload();
    await session.page.getByRole('button', { name: 'SWITCH TO TESTNET' }).waitFor();
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 2, 'wrong-chain restoration must not request accounts or silently switch chains');
    assert.equal(await session.page.evaluate(() => window.mockWallet.chain), '0x1');
    await session.page.getByRole('button', { name: 'SWITCH TO TESTNET' }).click();
    await session.page.getByRole('button', { name: 'REFRESH' }).waitFor();
    await session.page.getByRole('link', { name: 'TEST KIT', exact: true }).click();
    await session.page.locator('#disconnect').waitFor();
    await session.page.evaluate(() => {
        window.mockWallet.authorized = false;
        for (const listener of [...window.mockWallet.listeners.accountsChanged]) listener([]);
    });
    await session.page.locator('#connect').waitFor();
    assert.equal(await session.page.locator('#claim-rf').isDisabled(), true);
    assert.equal(await session.page.evaluate(() => window.mockWallet.prompts), 2);
    await noWrites(session.page);
    assert.deepEqual(session.unexpected, []);
    await session.context.close();

    const d = await setup({ state: readyState() });
    await connect(d.page);
    await d.page.getByRole('button', { name: 'PLAY RUN' }).waitFor();
    await screenshot(d.page, 'play-app-saved-desktop.png');
    await d.page.getByRole('button', { name: 'PLAY RUN' }).click();
    await d.page.getByRole('button', { name: 'LET’S RUSH' }).click();
    await d.page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.savedRun?.completedTicks >= 120, stateKey(account));
    await d.page.keyboard.down('ArrowRight');
    await d.page.keyboard.press('Space');
    await d.page.keyboard.up('ArrowRight');
    await d.page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).savedRun.replay.frames.some(f => f.jump), stateKey(account));
    await screenshot(d.page, 'play-app-running-desktop.png');
    await d.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await d.page.getByText('RUN PAUSED', { exact: true }).waitFor();
    const tick = (await saved(d.page)).savedRun.completedTicks;
    await d.page.waitForTimeout(100);
    assert.equal((await saved(d.page)).savedRun.completedTicks, tick);
    await d.page.getByRole('button', { name: 'KEEP RUNNING' }).click();
    await d.page.waitForFunction(({ key, tick }) => JSON.parse(localStorage.getItem(key)).savedRun.completedTicks > tick, { key: stateKey(account), tick });
    await d.page.getByRole('button', { name: 'Ⅱ PAUSE' }).click();
    const checkpoint = (await saved(d.page)).savedRun;
    await d.page.reload();
    await connect(d.page);
    await d.page.getByRole('button', { name: 'RESUME RUN' }).click();
    await d.page.getByText('RUN PAUSED', { exact: true }).waitFor();
    assert.equal((await saved(d.page)).savedRun.completedTicks, checkpoint.completedTicks);
    await d.page.getByRole('button', { name: 'KEEP RUNNING' }).click();
    await d.page.waitForFunction(({ key, tick }) => JSON.parse(localStorage.getItem(key)).savedRun.completedTicks > tick, { key: stateKey(account), tick: checkpoint.completedTicks });
    const external = await saved(d.page);
    external.savedRun.status = 'interrupted';
    await d.page.evaluate(({ key, value }) => { const oldValue = localStorage.getItem(key); const newValue = JSON.stringify(value); localStorage.setItem(key, newValue); window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage })); }, { key: stateKey(account), value: external });
    await d.page.getByRole('button', { name: 'RESUME RUN' }).waitFor();
    assert.equal(await d.page.locator('.rush-run').count(), 0);
    assert.deepEqual((await saved(d.page)).savedRun, external.savedRun, 'unmount must not overwrite another tab’s checkpoint');
    await d.page.getByRole('button', { name: 'RESUME RUN' }).click();
    await d.page.getByRole('button', { name: 'KEEP RUNNING' }).click();
    await d.page.waitForFunction(({ key, tick }) => JSON.parse(localStorage.getItem(key)).savedRun.completedTicks > tick, { key: stateKey(account), tick: external.savedRun.completedTicks });
    await d.page.evaluate(other => { window.mockWallet.account = other; for (const listener of [...window.mockWallet.listeners.accountsChanged])
        listener([other]); }, other);
    await d.page.locator('.play-wallet').filter({ hasText: '0x2222…2222' }).waitFor();
    assert.equal(await d.page.locator('.rush-run').count(), 0);
    await d.page.getByRole('button', { name: 'REFRESH' }).waitFor();
    await d.page.waitForFunction(key => localStorage.getItem(key) !== null, stateKey(other));
    assert.equal((await saved(d.page, other)).savedRun, null);
    assert.ok((await saved(d.page)).savedRun.completedTicks >= checkpoint.completedTicks);
    await noWrites(d.page);
    assert.deepEqual(d.unexpected, []);
    const codeReads = d.requests.filter(i => i.method === 'eth_getCode');
    assert.ok(codeReads.length >= 5);
    assert.ok(codeReads.every(i => i.params[1] === toHex(head)));
    await d.context.close();
    const m = await setup({ state: readyState(1), mobile: true });
    await connect(m.page);
    await m.page.getByRole('button', { name: 'PLAY RUN' }).click();
    await screenshot(m.page, 'play-app-ready-mobile.png');
    assert.equal(await m.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await m.page.getByRole('button', { name: 'LET’S RUSH' }).tap();
    await m.page.getByRole('button', { name: 'Jump; tap twice to double jump' }).tap();
    await m.page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).savedRun.replay.frames.some(f => f.jump), stateKey(account));
    assert.equal(await m.page.locator('[data-genesis-art]').count(), 1);
    await screenshot(m.page, 'play-app-running-mobile.png');
    await noWrites(m.page);
    assert.deepEqual(m.unexpected, []);
    await m.context.close();
    for (const hashKnown of [true, false]) {
        const p = await setup({ state: pendingState(hashKnown), mobile: !hashKnown });
        await connect(p.page);
        await p.page.getByRole('heading', { name: 'START PENDING' }).waitFor();
        assert.equal(await p.page.getByRole('button', { name: 'START RUN · 110 tRF' }).isDisabled(), true);
        if (!hashKnown)
            await p.page.getByLabel('Paste the transaction hash from your wallet').fill(hash);
        await screenshot(p.page, `play-app-pending-${hashKnown ? 'desktop' : 'mobile'}.png`);
        await p.page.getByRole('button', { name: 'CHECK CONFIRMATION' }).click();
        await p.page.getByRole('button', { name: 'PLAY RUN' }).waitFor();
        const value = await saved(p.page);
        assert.equal(value.pending, null);
        assert.equal(value.savedRun.run.seed, seed);
        assert.equal(value.savedRun.status, 'ready');
        assert.equal(value.history.at(-1).hash, hash);
        await noWrites(p.page);
        assert.deepEqual(p.unexpected, []);
        await p.context.close();
    }
    const c = await setup({ state: { ...emptyPlayState(account), friends: readyState().friends } });
    await connect(c.page);
    await c.page.locator('.friend-card').first().waitFor();
    await c.page.getByRole('button', { name: /GENESIS #2/ }).click();
    await c.page.getByRole('button', { name: 'DEGEN' }).click();
    await c.page.getByRole('button', { name: /START FREE RUN/ }).waitFor();
    assert.equal(await c.page.getByRole('button', { name: 'DEGEN' }).getAttribute('aria-pressed'), 'true');
    await screenshot(c.page, 'play-app-chooser-desktop.png');
    await noWrites(c.page);
    assert.deepEqual(c.unexpected, []);
    await c.context.close();
    const bad = await setup({ state: readyState(), runtimeMismatch: true });
    await connect(bad.page);
    await bad.page.getByText(/Unexpected .* runtime/).waitFor();
    assert.equal(await bad.page.getByRole('button', { name: 'PLAY RUN' }).isDisabled(), true);
    await noWrites(bad.page);
    await bad.context.close();
    const off = await setup({ state: { ...emptyPlayState(account), friends: readyState().friends }, serverReady: false });
    await connect(off.page);
    await off.page.getByText(/Run verification is temporarily unavailable/).waitFor();
    assert.equal(await off.page.getByRole('button', { name: 'START RUN · 110 tRF' }).isDisabled(), true);
    await noWrites(off.page);
    assert.deepEqual(off.unexpected, []);
    await off.context.close();
    assert.deepEqual(errors, []);
    console.log('Play browser checks passed: desktop/mobile UI, silent wallet restoration across test kit/arcade/reload, persistent cross-tab disconnect, provider revocation and account/network changes, pinned runtime verification, saved play/reload, keyboard/touch, pause/resume, external-tab checkpoint isolation, account isolation, known/hashless recovery, NFT/mode choice, runtime and unavailable-verifier gating. All RPC/wallet/API traffic mocked; no transactions submitted.');
}
finally {
    await browser.close();
}
