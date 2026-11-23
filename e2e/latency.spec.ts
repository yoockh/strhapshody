/**
 * Latency measurement harness (task 7.2 / PRD §10: < 100 ms, ideally < 60).
 *
 * Plays 60 keyboard strums (cycling C → G → Am → F so voicing changes are
 * included) and reads the app's own latency log through the debug hook: for
 * each strum, key-event timestamp → the moment the first voice is audible,
 * where "audible" maps the voice's audio-clock start through
 * `AudioContext.getOutputTimestamp()` (device output buffering included) or,
 * failing that, scheduling delay + base/output latency. Prints p50/p95 and
 * writes `test-results/latency.json`; fails if p95 misses the 100 ms target.
 *
 * This measures detection → sound. The camera → detection part (frame
 * capture, MediaPipe inference) needs a real webcam: open the app with
 * `?latency` and the on-screen readout reports camera → sound p50/p95 from
 * real hand strums (README manual checklist).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const STRUMS = 60;
const CHORDS: Array<[string, boolean]> = [
  ["c", false],
  ["g", false],
  ["a", true],
  ["f", false],
];

type Summary = { n: number; p50: number; p95: number; max: number; mean: number } | null;
type Report = { strum: Summary; endToEnd: Summary; processing: Summary; count: number };

test("strum → sound latency is within the PRD target", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.__strhapshody!.state().engineReady), { timeout: 15_000 })
    .toBe(true);

  for (let i = 0; i < STRUMS; i++) {
    if (i % 4 === 0) {
      const [key, minor] = CHORDS[(i / 4) % CHORDS.length]!;
      if (minor) await page.keyboard.down("Shift");
      await page.keyboard.press(key);
      if (minor) await page.keyboard.up("Shift");
    }
    await page.keyboard.press("Space");
    await page.waitForTimeout(120);
  }

  const report = (await page.evaluate(() => window.__strhapshody!.latency())) as Report;
  const clock = await page.evaluate(() => window.__strhapshody!.state().clock);
  const result = {
    measuredAt: new Date().toISOString(),
    browser: (await page.context().browser()?.version()) ?? "unknown",
    strums: STRUMS,
    clock,
    ...report,
  };
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/latency.json", JSON.stringify(result, null, 2));
  const fmt = (s: Summary) =>
    s ? `p50 ${s.p50.toFixed(1)} ms · p95 ${s.p95.toFixed(1)} ms · max ${s.max.toFixed(1)} ms (n=${s.n})` : "—";
  console.log(`[latency] strum→sound  ${fmt(report.strum)}`);
  console.log(`[latency] processing   ${fmt(report.processing)}`);
  console.log(`[latency] camera→sound ${fmt(report.endToEnd)} (needs a real camera)`);
  console.log(`[latency] audio clock  ${JSON.stringify(clock)}`);

  expect(report.count).toBe(STRUMS);
  expect(report.strum).not.toBeNull();
  expect(report.strum!.p95).toBeLessThan(100);
});
