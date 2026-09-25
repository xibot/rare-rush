import path from 'node:path';

/** Reuse committed protocol sources without uploading generated contracts,
 * verifier credentials, or local Testnet build artifacts to the main site. */
export function publicTestnetSources(repository) {
  const prefix = path.join(repository, 'testnet-app/generated') + path.sep;
  const assets = {
    'infra/testnet/artifacts/RareRushGame.json': 'shared/testnet-game-abi.json',
    'genesis-portrait.json': 'shared/testnet-genesis-portrait.json',
    'engine-version.ts': 'shared/testnet-engine-version.ts',
  };
  return {
    name: 'public-testnet-sources',
    setup(build) {
      build.onResolve({ filter: /generated\// }, args => {
        const absolute = path.resolve(args.resolveDir, args.path);
        if (!absolute.startsWith(prefix)) return;
        const relative = absolute.slice(prefix.length);
        return { path: path.join(repository, assets[relative] ?? relative) };
      });
    },
  };
}
