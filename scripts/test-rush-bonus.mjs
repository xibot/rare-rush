import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { testGame } from '@rarefriends/friendsdk/testing';

await mkdir('artifacts', { recursive: true });

const cases = [
  { label: 'desktop-normal', width: 1100, height: 820, difficulty: 'normal', rate: 10, startSpeed: 255, maxSpeed: 305 },
  { label: 'phone-easy', width: 390, height: 844, difficulty: 'easy', rate: 7.5, startSpeed: 215, maxSpeed: 255 },
  { label: 'phone-degen', width: 390, height: 844, difficulty: 'degen', rate: 20, startSpeed: 295, maxSpeed: 355 },
];

for (const device of cases) {
  const result = await testGame('games/rare-rush', {
    width: device.width,
    height: device.height,
    timeout: 45000,
    check: async ({ page, game }) => {
      const root = game.locator('.rare-rush');
      const start = game.getByRole('button', { name: /LET’S RUSH/ });
      await start.waitFor();
      await game.getByRole('button', { name: `${device.difficulty} difficulty`, exact: false }).click();
      const enableMotion = game.getByRole('button', { name: 'FX OFF', exact: true });
      if (await enableMotion.count()) await enableMotion.click();

      // Observe rendered DOM only. No engine, wallet, or economy state is changed.
      await root.evaluate(element => {
        const read = () => {
          const character = element.querySelector('[data-character="friend"]');
          const transform = character?.getAttribute('transform') ?? '';
          const scale = Number(transform.match(/scale\(([^ ]+)/)?.[1] ?? 4) / 4;
          const top = Number(transform.match(/translate\([^ ]+ ([^)]+)\)/)?.[1] ?? 340);
          const slide = character?.getAttribute('data-slide') === 'true';
          const duration = Number(element.getAttribute('data-run-duration'));
          const progress = parseFloat(element.querySelector('.run-progress i')?.style.width ?? '0') / 100;
          return {
            screen: element.getAttribute('data-screen'),
            coins: parseInt(element.querySelector('.run-score small')?.textContent ?? '0'),
            bonus: Number(element.getAttribute('data-bonus-coins')),
            reward: parseFloat((element.querySelector('.token-hud strong')?.textContent ?? '0').replaceAll(',', '')),
            growth: Number(character?.getAttribute('data-growth') ?? 1),
            renderedGrowth: scale,
            feet: top + (slide ? 30 : 60 * scale),
            slide,
            hearts: parseInt(element.querySelector('.life-hud strong')?.getAttribute('aria-label') ?? '3'),
            elapsed: progress * duration,
            progress,
            viewWidth: Number(element.querySelector('.world-svg')?.getAttribute('viewBox')?.split(' ')[2] ?? 960),
            bonuses: [...element.querySelectorAll('g[data-bonus-coin]')].map(node => ({
              id: node.getAttribute('data-bonus-coin'),
              x: Number(node.getAttribute('data-bonus-x')),
              y: Number(node.getAttribute('data-bonus-y')),
            })),
            hazards: [...element.querySelectorAll('[data-canonical-prop]')].map(node => ({
              kind: node.getAttribute('data-canonical-prop'),
              x: Number(node.getAttribute('x')),
              width: Number(node.getAttribute('width')),
            })).filter(node => ['crystal', 'crate', 'bridge'].includes(node.kind)),
          };
        };
        const observations = { last: read(), collections: [] };
        const observer = new MutationObserver(() => {
          const next = read();
          if (next.bonus > observations.last.bonus) observations.collections.push({ before: observations.last, after: next });
          observations.last = next;
        });
        observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
        element.bonusDomTest = { read, observations, observer };
      });

      const read = () => root.evaluate(element => element.bonusDomTest.read());
      const jump = async () => {
        if (device.width < 500) await game.getByRole('button', { name: 'Jump, tap twice to double jump' }).click();
        else await page.keyboard.press('Space');
      };
      let sliding = false;
      const slide = async held => {
        if (held === sliding) return;
        if (device.width < 500) {
          if (held) {
            const bounds = await game.getByRole('button', { name: 'Hold to slide', exact: true }).boundingBox();
            assert(bounds && bounds.width >= 44 && bounds.height >= 44);
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            await page.mouse.down();
          } else await page.mouse.up();
        } else if (held) await page.keyboard.down('ArrowDown');
        else await page.keyboard.up('ArrowDown');
        sliding = held;
      };

      await start.click();
      let latest = await read();
      let previousFeet = latest.feet;
      let jumps = 0;
      let lastJumpAt = -10;
      let inspectedFlight = false;
      const trajectories = new Map();
      const deadline = Date.now() + 35000;
      while (latest.bonus === 0 && Date.now() < deadline) {
        assert.equal(latest.screen, 'running', `${device.label}: pilot must remain in a live run until it catches a bonus`);
        if (latest.feet >= 399.5 && latest.elapsed - lastJumpAt > 0.2) jumps = 0;
        for (const bonus of latest.bonuses) {
          const path = trajectories.get(bonus.id) ?? [];
          path.push({ x: bonus.x, y: bonus.y });
          trajectories.set(bonus.id, path);
        }
        const bonus = latest.bonuses.find(coin => coin.x + 48 > 165);
        if (!inspectedFlight && bonus && bonus.x < latest.viewWidth - 90 && bonus.x > 350) {
          await slide(false);
          const bonusArt = game.locator(`g[data-bonus-coin="${bonus.id}"]`);
          const token = bonusArt.locator('[data-token-design="1"]');
          assert.equal(await token.getAttribute('width'), '60', 'Bonus art must be twice the normal30px coin');
          assert.equal(await token.getAttribute('height'), '60');
          assert.equal(await token.getAttribute('data-canonical-face'), '08', 'Bonus must retain the canonical bear face');
          const ordinaryWidth = await game.locator('.world-svg > svg[data-token-design="1"]').first().getAttribute('width');
          assert.equal(ordinaryWidth, '30');
          const path = trajectories.get(bonus.id);
          assert(path.length > 1 && path[0].x > bonus.x, 'Bonus travels from right to left');
          assert(Math.max(...path.map(point => point.y)) - Math.min(...path.map(point => point.y)) > 0.3, 'Bonus visibly bobs in the air');
          await page.locator('.rf-game-frame').screenshot({ path: `artifacts/${device.label}-bonus-flying.png` });
          await game.getByRole('button', { name: 'Pause game', exact: true }).click();
          await game.getByRole('heading', { name: 'PAUSED', exact: true }).waitFor();
          const paused = await read();
          const frozen = paused.bonuses.find(coin => coin.id === bonus.id);
          assert(frozen, 'Flying bonus remains visible when paused');
          await page.waitForTimeout(350);
          const still = await read();
          assert.deepEqual(still.bonuses.find(coin => coin.id === bonus.id), frozen, 'Pause freezes both horizontal flight and vertical bob');
          assert.equal(still.elapsed, paused.elapsed, 'Pause freezes the timer');
          inspectedFlight = true;
          await game.getByRole('button', { name: /KEEP RUNNING/ }).click();
          latest = await read();
          continue;
        }

        const speed = device.startSpeed + (device.maxSpeed - device.startSpeed) * latest.progress;
        const nearest = latest.hazards.filter(hazard => hazard.x + hazard.width > 165).sort((a, b) => a.x - b.x)[0];
        const hazardTime = nearest ? (nearest.x - 203) / speed : Infinity;
        const bonusTime = bonus ? (bonus.x - 203) / (speed * 1.15 + 25) : Infinity;
        const chasingBonus = bonus && bonusTime < 0.48 && bonusTime > -0.2;
        const shouldSlide = !chasingBonus && nearest?.kind === 'bridge' && hazardTime < 0.6;
        await slide(Boolean(shouldSlide));
        if (!shouldSlide && jumps < 2 && latest.elapsed - lastJumpAt > 0.15) {
          const groundJump = jumps === 0 && latest.feet >= 399.5 && nearest?.kind !== 'bridge' && hazardTime < 0.28;
          const bonusJump = chasingBonus && (jumps === 0 || (jumps === 1 && latest.feet > 290));
          const secondJump = jumps === 1 && nearest?.kind !== 'bridge' && hazardTime < 0.3 &&
            latest.elapsed - lastJumpAt > 0.3 && latest.feet >= previousFeet - 1;
          if (groundJump || bonusJump || secondJump) {
            await jump();
            jumps += 1;
            lastJumpAt = latest.elapsed;
          }
        }
        previousFeet = latest.feet;
        await page.waitForTimeout(30);
        latest = await read();
      }

      await slide(false);
      assert(inspectedFlight, `${device.label}: flight, artwork and pause checks ran`);
      assert(latest.bonus > 0, `${device.label}: legal controls must catch a flying bonus`);
      const captures = await root.evaluate(element => element.bonusDomTest.observations.collections);
      assert(captures.length > 0, 'A rendered bonus collection transition was observed');
      const { before, after } = captures[0];
      assert.equal(after.bonus - before.bonus, 1);
      assert.equal(after.coins - before.coins, 1, 'One bonus is one pickup, not ten normal coins');
      assert.equal(after.reward - before.reward, 10 * device.rate, 'The bonus pays ten times the mode reward');
      assert.equal(after.hearts, before.hearts, 'The measured collection is not mixed with damage');
      assert(before.growth < 1.7, 'Growth measurement is below the cap');
      assert(Math.abs(after.growth - before.growth - 0.035) < 0.001, 'A bonus adds one growth step');
      assert.equal(after.reward, (after.coins + 9 * after.bonus) * device.rate, 'HUD total includes every normal and weighted bonus pickup exactly once');
      await page.waitForTimeout(100);
      const animated = await read();
      assert(animated.renderedGrowth > before.renderedGrowth, 'The SVG transform visibly responds to the bonus growth');
      await page.locator('.rf-game-frame').screenshot({ path: `artifacts/${device.label}-bonus-collected.png` });
      await game.getByRole('button', { name: 'Pause game', exact: true }).click();
      const banked = await read();
      assert.equal(banked.reward, (banked.coins + 9 * banked.bonus) * device.rate);
      console.log(`${device.label}: canonical2x art, flight, pause and10x collection passed`, {
        coins: after.coins, bonus: after.bonus, reward: after.reward,
        growthBefore: before.growth, growthAfter: after.growth,
      });
    },
  });
  console.log(`${device.label}: bonus integration complete`, result);
}
