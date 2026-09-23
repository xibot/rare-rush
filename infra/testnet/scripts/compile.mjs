import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import solc from 'solc';

const root = new URL('../', import.meta.url);
const sources = {};
for (const name of (await readdir(new URL('contracts/', root))).filter(name => name.endsWith('.sol')).sort()) {
  sources[`contracts/${name}`] = { content: await readFile(new URL(`contracts/${name}`, root), 'utf8') };
}
// Include this exact shared implementation, rather than a copied token or a general filesystem importer.
sources['doppler/contracts/RareRushDopplerPrototype.sol'] = {
  content: await readFile(new URL('../doppler/contracts/RareRushDopplerPrototype.sol', root), 'utf8'),
};
sources['test/fixtures/BindingCandidate.sol'] = {
  content: await readFile(new URL('test/fixtures/BindingCandidate.sol', root), 'utf8'),
};
const input = {
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), {
  import(path) {
    if (!path.startsWith('@openzeppelin/contracts/') || path.includes('..')) return { error: 'Import is not allowlisted' };
    try { return { contents: readFileSync(new URL(`node_modules/${path}`, root), 'utf8') }; }
    catch { return { error: `Missing dependency: ${path}` }; }
  },
}));
for (const error of output.errors ?? []) console.error(error.formattedMessage);
if (output.errors?.some(error => error.severity === 'error')) process.exit(1);
await mkdir(new URL('artifacts/', root), { recursive: true });
for (const [source, contracts] of Object.entries(output.contracts)) {
  if (!source.startsWith('contracts/') && source !== 'test/fixtures/BindingCandidate.sol') continue;
  for (const [name, artifact] of Object.entries(contracts)) {
    if (!artifact.evm.bytecode.object) continue;
    const bytes = artifact.evm.deployedBytecode.object.length / 2;
    if (bytes > 24_576) throw new Error(`${name} exceeds EIP-170 bytecode limit`);
    await writeFile(new URL(`artifacts/${name}.json`, root), JSON.stringify({
      contractName: name, sourceName: source, compiler: solc.version(),
      abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`,
      deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`, immutableReferences: artifact.evm.deployedBytecode.immutableReferences, metadata: JSON.parse(artifact.metadata),
    }, null, 2) + '\n');
    console.log(`${name}: ${bytes} deployed bytes`);
  }
}
// Resolved source input supports Blockscout verification without downloading a compiler.
for (const path of Object.keys(output.sources)) {
  if (!input.sources[path]) input.sources[path] = { content: readFileSync(new URL(`node_modules/${path}`, root), 'utf8') };
}
await writeFile(new URL('artifacts/standard-input.json', root), JSON.stringify(input, null, 2) + '\n');
