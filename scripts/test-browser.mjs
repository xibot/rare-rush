import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { testGame } from '@rarefriends/friendsdk/testing';

await mkdir('artifacts', { recursive: true });
for (const [width, difficulty] of [[1100, 'normal'], [390, 'normal'], [360, 'normal'], [390, 'easy'], [360, 'degen']]) {
  const device = width === 360 ? 'small-phone' : width < 500 ? 'phone' : 'desktop';
  const label = difficulty === 'normal' ? device : `${device}-${difficulty}`;
  const result = await testGame('games/rare-rush', {
    width, height: width === 360 ? 640 : width < 500 ? 844 : 820,
    screenshot: `artifacts/${label}-restart.png`,
    check: async ({ page, game }) => {
      const start = game.getByRole('button', { name: /LET’S RUSH/ });
      await start.waitFor();
      const pixelFontLoaded = await game.locator('.start-title h1').evaluate(async el => {
        await document.fonts.ready;
        return getComputedStyle(el).fontFamily.includes('Silkscreen') && [...document.fonts].some(font => font.family === 'Silkscreen' && font.weight === '400' && font.status === 'loaded');
      });
      assert(pixelFontLoaded, 'The Rare Friends pixel font loads inside the game sandbox');
      assert.equal(await game.locator('.arcade-logo small').innerText(), 'BY XIBOT');
      assert.equal(await game.locator('.arcade-logo [data-canonical-face="08"]').count(), 1, 'Arcade uses the same bear-token logo as the landing');
      for (const name of ['Rare Rush home', 'Back to Friend selection']) {
        const control = game.getByRole('button', { name, exact: true });
        const bounds = await control.boundingBox();
        assert(bounds && bounds.width >= 44 && bounds.height >= 44, `${name} has a usable touch target`);
        assert(await control.evaluate(button => {
          const action = button.getBoundingClientRect();
          const frame = document.querySelector('.rare-rush').getBoundingClientRect();
          return action.top >= frame.top && action.bottom <= frame.bottom
            && action.left >= frame.left && action.right <= frame.right;
        }), `${name} fits inside the sandbox at this viewport`);
      }
      assert(await game.locator('.arcade-logo').evaluate(logo => {
        const credit = logo.querySelector('small').getBoundingClientRect();
        const actions = document.querySelector('.top-actions').getBoundingClientRect();
        return credit.height > 0 && logo.getBoundingClientRect().right + 4 <= actions.left;
      }), 'Creator credit stays visible and the logo fits beside the controls');
      for (const [mode, seconds, rate] of [['easy', 120, '7.5'], ['normal', 90, '10'], ['degen', 60, '20']]) {
        const choice = game.getByRole('button', { name: `${mode} difficulty`, exact: false });
        await choice.click();
        assert.equal(await choice.getAttribute('aria-pressed'), 'true');
        assert.equal(await game.locator('.rare-rush').getAttribute('data-difficulty'), mode);
        assert.equal(await game.locator('.rare-rush').getAttribute('data-run-duration'), String(seconds));
        assert.equal(await game.locator('.economy-bar b').innerText(), rate);
        const bounds = await choice.boundingBox();
        assert(bounds.height >= 44 && bounds.width >= 44, 'Difficulty options have usable touch targets');
      }
      await game.getByRole('button', { name: `${difficulty} difficulty`, exact: false }).click();
      const islandPresets = await game.locator('[data-island-preset]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-island-preset')));
      assert(new Set(islandPresets).size >= 4, 'Background should contain distinct canonical island designs');
      assert(await game.locator('[data-token-design="1"]').count() > 0, 'Pickups should use the official bear token artwork');
      const enableMotion = game.getByRole('button', { name: 'FX OFF', exact: true });
      if (await enableMotion.count()) await enableMotion.click();
      const firstIslandX = Number(await game.locator('[data-island-slot="0"]').getAttribute('x'));
      await page.locator('.rf-game-frame').screenshot({ path: `artifacts/${label}-start.png` });
      const overflow = await game.locator('.rare-rush').evaluate(el => el.scrollWidth > el.clientWidth);
      assert.equal(overflow, false, 'Game must fit its viewport');
      const fits = await game.locator('.start-card').evaluate(card => {
        const footer = document.querySelector('.arcade-bottom').getBoundingClientRect();
        const rect = card.getBoundingClientRect();
        return rect.bottom <= footer.top && rect.top >= 150;
      });
      assert(fits, 'Start instructions and entry cost must fit above game controls');
      await game.getByRole('button', { name: 'How to play' }).click();
      await game.getByText('JUMP / DOUBLE JUMP', { exact: true }).waitFor();
      await game.getByText('CHASE THE 10× COIN', { exact: true }).waitFor();
      await game.getByRole('button', { name: 'Close' }).click();
      await game.getByRole('button', { name: /TOKEN LAB/ }).click();
      await game.getByRole('button', { name: '10K COINS' }).click();
      assert.equal((await game.locator('.lab-stat strong').innerText()).split(' ')[0], { easy: '3.75', normal: '5', degen: '10' }[difficulty]);
      await game.getByRole('button', { name: 'LAUNCH', exact: true }).click();
      await game.getByRole('button', { name: 'Close' }).click();
      await start.click();
      assert.equal(await game.getByRole('group', { name: 'Choose difficulty' }).count(), 0, 'Difficulty is locked for the active run');
      assert.equal(await game.locator('.rare-rush').getAttribute('data-difficulty'), difficulty);
      await game.locator('[data-character]').evaluate(el => {
        el.growthHistory = [Number(el.getAttribute('data-growth'))];
        const observer = new MutationObserver(() => el.growthHistory.push(Number(el.getAttribute('data-growth'))));
        observer.observe(el, { attributes: true, attributeFilter: ['data-growth'] });
      });
      await page.waitForTimeout(1400);
      assert.notEqual(await game.locator('.token-hud strong').innerText(), '0✦', 'Opening coins should award demo tokens');
      const openingCoins = Number((await game.locator('.run-score small').innerText()).match(/^\d+/)[0]);
      assert.equal(parseFloat(await game.locator('.token-hud strong').innerText()), openingCoins * { easy: 7.5, normal: 10, degen: 20 }[difficulty], 'Actual rewards use the run difficulty');
      assert(Number(await game.locator('[data-character]').getAttribute('data-growth')) > 1, 'Opening coins grow the Friend');
      const growingTransform = await game.locator('[data-character]').getAttribute('transform');
      assert(Number(growingTransform.match(/scale\(([^ ]+)/)[1]) > 4, 'Growth must enlarge the rendered sprite');
      assert(Number(await game.locator('[data-island-slot="0"]').getAttribute('x')) < firstIslandX, 'Varied islands scroll with motion enabled');
      await page.locator('.rf-game-frame').screenshot({ path: `artifacts/${label}-grown.png` });
      for (const [direction, name, sign] of [['ArrowRight', 'Hold to speed up', 1], ['ArrowLeft', 'Hold to slow down', -1]]) {
        if (width < 500) {
          const control = game.getByRole('button', { name, exact: true });
          const bounds = await control.boundingBox();
          assert(bounds.width >= 44 && bounds.height >= 44, 'Speed controls need usable touch targets');
          await page.mouse.move(bounds.x + bounds.width/2, bounds.y + bounds.height/2);
          await page.mouse.down();
        } else await page.keyboard.down(direction);
        await page.waitForTimeout(250);
        const pace = game.locator('[data-pace]');
        assert.equal(await pace.getAttribute('data-pace'), String(sign));
        assert(sign * (parseFloat(await pace.innerText()) - 1) > .1, 'Holding an arrow changes pace in the requested direction');
        if (width < 500) await page.mouse.up(); else await page.keyboard.up(direction);
        await page.waitForTimeout(50);
        assert.equal(await pace.getAttribute('data-pace'), '0', 'Releasing speed control returns to cruise input');
      }
      if (width < 500) {
        await game.getByRole('button', { name: 'Jump, tap twice to double jump' }).dispatchEvent('pointerdown', { pointerId: 1 });
      } else {
        await game.getByRole('button', { name: 'Turn sound on' }).click();
        await page.waitForTimeout(50);
        await page.keyboard.press('Space');
      }
      await page.waitForTimeout(150);
      const transform = await game.locator('[data-character]').getAttribute('transform');
      const characterY = Number(transform.match(/translate\([^ ]+ ([^)]+)\)/)[1]);
      assert(characterY < 335, 'Jump should move the character above standing position');
      await game.getByRole('button', { name: 'Pause game' }).click();
      await game.getByRole('heading', { name: 'PAUSED', exact: true }).waitFor();
      const time = await game.locator('.hud > div').first().innerText();
      await page.waitForTimeout(1100);
      assert.equal(await game.locator('.hud > div').first().innerText(), time, 'Paused timer must not change');
      await game.getByRole('button', { name: /KEEP RUNNING/ }).click();
      await page.waitForTimeout(800);
      if (width < 500) {
        const slide = game.getByRole('button', { name: 'Hold to slide' });
        const bounds = await slide.boundingBox();
        await page.mouse.move(bounds.x + bounds.width/2, bounds.y + bounds.height/2);
        await page.mouse.down();
        await page.waitForTimeout(80);
        assert.equal(await game.locator('[data-character]').getAttribute('data-slide'), 'true');
        await page.mouse.up();
      } else {
        await page.keyboard.down('ArrowDown');
        await page.waitForTimeout(80);
        assert.equal(await game.locator('[data-character]').getAttribute('data-slide'), 'true');
        await page.keyboard.up('ArrowDown');
      }
      await game.getByRole('button', { name: /TOKEN LAB/ }).click();
      const pausedByMenu = await game.locator('.hud > div').first().innerText();
      await page.waitForTimeout(1100);
      assert.equal(await game.locator('.hud > div').first().innerText(), pausedByMenu);
      assert.equal(await game.locator('.ledger > div').first().locator('dd').innerText(), '99');
      await game.getByRole('button', { name: 'Close' }).click();
      await page.locator('.rf-game-frame').screenshot({ path: `artifacts/${label}-playing.png` });
      // An unattended run must complete without trapping the player in a live state.
      await game.getByRole('button', { name: /RUN IT BACK/ }).waitFor({ timeout: 70000 });
      assert.match(await game.locator('.result-card').innerText(), /Nothing minted onchain/);
      assert.match(await game.locator('.result-card h2').innerText(), new RegExp(`NEW ${difficulty.toUpperCase()} BEST`));
      await page.locator('.rf-game-frame').screenshot({ path: `artifacts/${label}-results.png` });
      const sizes = await game.locator('[data-character]').evaluate(el => el.growthHistory);
      assert(sizes.some((size, index) => index > 0 && size < sizes[index-1]), 'An obstacle hit shrinks the Friend');

      const readLedger = async () => {
        await game.getByRole('button', { name: /TOKEN LAB/ }).click();
        await game.locator('.ledger').waitFor({ state: 'visible' });
        const values = await game.locator('.ledger > div').evaluateAll(rows => Object.fromEntries(rows.map(row => [
          row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim(),
        ])));
        await game.getByRole('button', { name: 'Close TOKEN LAB · SIMULATION', exact: true }).click();
        return values;
      };
      const numeric = value => Number(value.replaceAll(',', ''));
      const bankedLedger = await readLedger();
      assert(numeric(bankedLedger['Your collected demo $RUSH']) > 0, 'Transition tests preserve actual accumulated rewards');
      assert.equal(numeric(bankedLedger['Your demo RF']), 99);
      assert.equal(numeric(bankedLedger['Demo RF prize pool']), 1);

      const changeDifficulty = game.getByRole('button', { name: /CHANGE DIFFICULTY/ });
      const changeBounds = await changeDifficulty.boundingBox();
      assert(changeBounds && changeBounds.height >= 44, 'Change difficulty must remain an accessible touch target');
      const viewport = page.viewportSize();
      assert(changeBounds.x >= 0 && changeBounds.y >= 0 &&
        changeBounds.x + changeBounds.width <= viewport.width + 1 &&
        changeBounds.y + changeBounds.height <= viewport.height + 1,
      'The result difficulty action must fit in the real viewport, including360×640');
      assert(await changeDifficulty.evaluate(button => {
        const overlay = button.closest('.game-overlay').getBoundingClientRect();
        const action = button.getBoundingClientRect();
        return action.top >= overlay.top - 1 && action.bottom <= overlay.bottom + 1 &&
          action.left >= overlay.left - 1 && action.right <= overlay.right + 1;
      }), 'The entire change-difficulty action fits inside the result overlay');

      let nextDifficulty = difficulty;
      if (width >= 500) {
        // Preserve direct replay coverage without waiting for a second full run.
        await game.getByRole('button', { name: /RUN IT BACK/ }).click();
      } else {
        await changeDifficulty.click();
        await game.getByRole('group', { name: 'Choose difficulty' }).waitFor();
        assert.equal(await game.locator('.rare-rush').getAttribute('data-screen'), 'ready');
        assert.equal(await game.getByRole('button', { name: `${difficulty} difficulty`, exact: false }).getAttribute('aria-pressed'), 'true',
          'Returning from results preselects the completed run difficulty');
        assert.deepEqual(await readLedger(), bankedLedger,
          'Returning to the selector preserves RF, banked rewards, pool and pickup count without charging entry');

        nextDifficulty = { normal: 'easy', easy: 'degen', degen: 'normal' }[difficulty];
        const nextChoice = game.getByRole('button', { name: `${nextDifficulty} difficulty`, exact: false });
        await nextChoice.click();
        assert.equal(await nextChoice.getAttribute('aria-pressed'), 'true');
        assert.equal(await game.locator('.rare-rush').getAttribute('data-run-duration'), String({ easy: 120, normal: 90, degen: 60 }[nextDifficulty]));
        assert.equal(await game.locator('.economy-bar b').innerText(), { easy: '7.5', normal: '10', degen: '20' }[nextDifficulty],
          'The selector updates the actual next-run reward rate');
        assert.deepEqual(await readLedger(), bankedLedger,
          'Selecting another mode does not reset earnings or charge a play fee');
        await page.locator('.rf-game-frame').screenshot({ path: `artifacts/${label}-difficulty-select.png` });
        await start.click();
      }
      assert.equal(await game.locator('[data-character]').getAttribute('data-growth'), '1.000', 'A new run resets size');
      assert.equal(await game.locator('[data-pace]').getAttribute('data-pace'), '0', 'A new run resets pace');
      assert.equal(await game.locator('.rare-rush').getAttribute('data-difficulty'), nextDifficulty,
        width >= 500 ? 'Direct replay keeps the completed difficulty' : 'The new run uses the changed difficulty');
      assert.equal(await game.locator('.rare-rush').getAttribute('data-run-duration'), String({ easy: 120, normal: 90, degen: 60 }[nextDifficulty]));
      assert.equal(await game.getByRole('group', { name: 'Choose difficulty' }).count(), 0, 'The new run locks its selected mode');
      const enteredLedger = await readLedger();
      assert.equal(numeric(enteredLedger['Your demo RF']), numeric(bankedLedger['Your demo RF']) - 1,
        'Starting the next run charges exactly one additional demo RF');
      assert.equal(numeric(enteredLedger['Demo RF prize pool']), numeric(bankedLedger['Demo RF prize pool']) + 1,
        'Exactly that one entry fee reaches the accumulated prize pool');
    },
  });
  console.log(`${label}: runtime gate, artwork, controls, rewards, pause, results and difficulty transitions passed`, result);
}
