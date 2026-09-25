import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('built feed functions start without TypeScript source loading', () => {
  const env = { ...process.env };
  delete env.BLOB_STORE_ID;
  delete env.BLOB_READ_WRITE_TOKEN;
  // Run the exact deploy entry points with TS loading disabled. This catches
  // mixed MJS/TS imports that pass local tests but fail in the function bundle.
  const output = execFileSync(process.execPath, ['--no-experimental-strip-types', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import list from './api/runs.mjs';
    import detail from './api/runs/[id].mjs';
    for (const [handler, path] of [[list, '/api/runs'], [detail, '/api/runs/' + 'a'.repeat(64)]]) {
      const response = await handler.fetch(new Request('https://rarerush.app' + path));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'Public replay storage is not configured.');
    }
    console.log('Function entry points loaded successfully.');
  `], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
  assert.match(output, /loaded successfully/);
});
