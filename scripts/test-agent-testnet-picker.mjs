import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem';
import deployment from '../testnet-app/src/shared/deployment.json' with { type: 'json' };
const account = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const start = BigInt(deployment.assetDeploymentBlock);
let head = start + 8n, mintBlock = start + 1n;
const abi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function ownerOf(uint256) view returns(address)',
  'function generation(uint256) view returns(uint256)', 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{TestnetFriendPicker}from'./agent-play/TestnetFriendPicker.tsx';
const root=createRoot(document.getElementById('root'));let props={account:null,chainId:null,collection:1,selectedId:'',disabled:false,onSelect:id=>{window.selected=id;props.selectedId=id;draw();},onConnect:()=>{window.connected=true},onSwitch:()=>{window.switched=true}};function draw(){root.render(<TestnetFriendPicker key={String(props.account)+":"+props.collection} {...props}/>)}window.updatePicker=p=>{props={...props,...p};draw()};draw();`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', target: 'es2022', jsx: 'automatic' });
const script = bundle.outputFiles[0].text;
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/picker.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/picker.js' ? script : '<!doctype html><html><body><div id="root"></div><script type="module" src="/picker.js"></script></body></html>');
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.RUSH_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin, 'All NFT reads remain on our origin');
    if (url.pathname !== '/api/rpc') return route.continue();
    const body = route.request().postDataJSON();
    const result = call => {
      calls.push(call.method);
      if (call.method === 'eth_chainId') return '0xb626';
      if (call.method === 'eth_blockNumber') return `0x${head.toString(16)}`;
      if (call.method === 'eth_getLogs') {
        const [filter] = call.params;
        assert.ok(BigInt(filter.toBlock) - BigInt(filter.fromBlock) < 10_000n, 'Testnet provider range cap');
        assert.ok(filter.topics[2]?.endsWith(account.slice(2)), 'Incoming history is owner filtered');
        if (filter.topics[1] || BigInt(filter.fromBlock) > mintBlock || BigInt(filter.toBlock) < mintBlock) return [];
        return Array.from({ length: 10 }, (_, i) => ({ address: filter.address, blockNumber: `0x${mintBlock.toString(16)}`,
          blockHash: `0x${'aa'.repeat(32)}`, transactionHash: `0x${'bb'.repeat(32)}`, transactionIndex: '0x0', logIndex: `0x${i.toString(16)}`,
          removed: false, data: '0x', topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: other, to: account, tokenId: BigInt(i + 1) } }) }));
      }
      assert.equal(call.method, 'eth_call');
      const { functionName, args } = decodeFunctionData({ abi, data: call.params[0].data });
      calls.push(functionName);
      if (functionName === 'ownerOf') return encodeAbiParameters([{ type: 'address' }], [account]);
      if (functionName === 'generation') return encodeAbiParameters([{ type: 'uint256' }], [1n]);
      assert.equal(functionName, 'balanceOf');
      return encodeAbiParameters([{ type: 'uint256' }], [args[0].toLowerCase() === account ? 10n : 0n]);
    };
    const response = call => ({ jsonrpc: '2.0', id: call.id, result: result(call) });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(response) : response(body)) });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'CONNECT WALLET', exact: true }).click();
  assert.equal(await page.evaluate(() => window.connected), true);
  assert.equal(calls.length, 0, 'Disconnected picker does not request RPC');
  await page.evaluate(account => window.updatePicker({ account, chainId: 4663 }), account);
  await page.getByRole('button', { name: 'SWITCH TO TESTNET' }).click();
  assert.equal(await page.evaluate(() => window.switched), true);
  assert.equal(calls.length, 0, 'Wrong-network picker does not request NFT data');
  await page.evaluate(() => window.updatePicker({ chainId: 46630 }));
  await page.getByRole('button', { name: /TEST GENESIS #8/ }).waitFor();
  assert.equal(await page.locator('.arcade-friend-card').count(), 8);
  assert.equal(calls.filter(name => name === 'ownerOf').length, 8);
  assert.equal(await page.locator('.arcade-friend-card svg').count(), 8);
  await page.getByRole('button', { name: /TEST GENESIS #1\D/ }).click();
  assert.equal(await page.evaluate(() => window.selected), '1');
  assert.equal(await page.getByRole('button', { name: /TEST GENESIS #1\D/ }).getAttribute('aria-pressed'), 'true');
  const logReads = calls.filter(name => name === 'eth_getLogs').length;
  await page.getByRole('button', { name: 'MORE FRIENDS ↓' }).click();
  await page.getByRole('button', { name: /TEST GENESIS #10/ }).waitFor();
  assert.equal(await page.locator('.arcade-friend-card').count(), 10);
  assert.equal(calls.filter(name => name === 'eth_getLogs').length, logReads);
  head = start + 85_000n; mintBlock = start + 82_000n;
  const beforeLateHistory = calls.filter(name => name === 'eth_getLogs').length;
  await page.evaluate(() => window.updatePicker({ collection: 0, selectedId: '' }));
  await page.getByRole('button', { name: /TEST GENERATIONS #8/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^TEST GENESIS/ }).count(), 0);
  assert.equal(calls.filter(name => name === 'eth_getLogs').length - beforeLateHistory, 9, 'First empty history page auto-continues to find later mints');
  await page.evaluate(account => window.updatePicker({ account, selectedId: '' }), other);
  await page.getByText('No playable test Generations NFTs found in this wallet.', { exact: false }).waitFor();
  assert.equal(await page.locator('.arcade-friend-card').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Testnet picker: connection, network, private reads, both art grids, selection, eight-card pagination, and wallet invalidation passed.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
