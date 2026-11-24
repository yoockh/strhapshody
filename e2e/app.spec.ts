/**
 * End-to-end: the whole browser pipeline without a human (task 7.1).
 *
 * Real Chromium, real WASM engine, real Web Audio graph, fake camera from a
 * generated video file. Hands can't be faked convincingly, so the chord →
 * voicing → audio path is driven through the keyboard fallback (task 6.4),
 * and "it made sound" is asserted on the audio engine itself: voices started
 * and the RMS of the master output (an AnalyserNode tap), via the read-only
 * `window.__strhapshody.state()` hook.
 */

import { expect, test, type Page } from "@playwright/test";

type State = {
  engineReady: boolean;
  camera: string;
  sounding: string;
  mode: string;
  instrument: string | null;
  audioRunning: boolean;
  voicesStarted: number;
  level: number;
  chord: number[];
  leftHanded: boolean;
};

const state = (page: Page): Promise<State> =>
  page.evaluate(() => window.__strhapshody!.state() as unknown as State);

/** Collect page errors so every test can assert there were none. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect.poll(async () => (await state(page)).engineReady, { timeout: 15_000 }).toBe(true);
}

/** Select a chord from the keyboard (Shift for minor) and strum it down. */
async function playChord(page: Page, letter: string, minor = false): Promise<void> {
  if (minor) await page.keyboard.down("Shift");
  await page.keyboard.press(letter.toLowerCase());
  if (minor) await page.keyboard.up("Shift");
  await page.keyboard.press("Space");
}

const midiHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

// Most tests skip the first-run "How to play" guide (it's modal); the guide
// itself has its own test below, which opts back in.
test.beforeEach(async ({ page }, info) => {
  if (info.title.startsWith("first visit")) return;
  await page.addInitScript(() => localStorage.setItem("strhapshody.help-seen.v1", "true"));
});

test("camera starts from the fake video device and the engine loads", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await expect.poll(async () => (await state(page)).camera).toBe("live");
  expect(errors).toEqual([]);
});

test("C–G–Am–F via the keyboard sounds each chord", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);

  // [letter, minor, label, sounding strings, lowest note (MIDI)]
  const progression: Array<[string, boolean, string, number, number]> = [
    ["C", false, "C", 5, 48], // x32010: lowest C3 on the A string
    ["G", false, "G", 6, 43], // 320003: G2 on low E
    ["A", true, "Am", 5, 45], // x02210: open A2
    ["F", false, "F", 6, 41], // 133211 barre: F2
  ];

  for (const [letter, minor, label, strings, lowest] of progression) {
    const before = (await state(page)).voicesStarted;
    await playChord(page, letter, minor);

    // The strum committed the chord and loaded its voicing.
    await expect.poll(async () => (await state(page)).sounding).toBe(label);
    const s = await state(page);
    const sounding = s.chord.filter((f) => f > 0);
    expect(sounding).toHaveLength(strings);
    expect(Math.min(...sounding)).toBeCloseTo(midiHz(lowest), 1);

    // One voice per sounding string actually started…
    await expect
      .poll(async () => (await state(page)).voicesStarted - before)
      .toBe(strings);
    // …and the master output carries signal.
    await expect.poll(async () => (await state(page)).level, { timeout: 2_000 }).toBeGreaterThan(0.005);
    expect((await state(page)).audioRunning).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("a chord change waits for the next strum", async ({ page }) => {
  await openApp(page);
  await playChord(page, "G");
  await expect.poll(async () => (await state(page)).sounding).toBe("G");

  await page.keyboard.press("d"); // select D, no strum yet
  await page.waitForTimeout(150);
  expect((await state(page)).sounding).toBe("G");

  await page.keyboard.press("Space");
  await expect.poll(async () => (await state(page)).sounding).toBe("D");
});

test("upstroke and every instrument produce sound", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await playChord(page, "E");
  await expect.poll(async () => (await state(page)).sounding).toBe("E");

  for (const [key, instrument] of [
    ["1", "acoustic"],
    ["2", "clean"],
    ["3", "distortion"],
  ] as const) {
    await page.keyboard.press(key);
    expect((await state(page)).instrument).toBe(instrument);
    await page.waitForTimeout(400); // let the previous strum decay a bit
    const before = (await state(page)).voicesStarted;
    await page.keyboard.down("Shift");
    await page.keyboard.press("Space"); // upstroke
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await state(page)).voicesStarted - before).toBe(6);
    await expect.poll(async () => (await state(page)).level, { timeout: 2_000 }).toBeGreaterThan(0.005);
  }
  expect(errors).toEqual([]);
});

test("settings persist across a reload", async ({ page }) => {
  await openApp(page);
  await page.click("#controls .settings-toggle");
  await page.check("#setting-leftHanded");
  expect((await state(page)).leftHanded).toBe(true);
  await page.reload();
  await expect.poll(async () => (await state(page)).leftHanded).toBe(true);
  await expect(page.locator("#setting-leftHanded")).toBeChecked();
});

// Regression (DEVLOG 2026-11-23 "render loop used freed wasm objects on
// unload"): beforeunload frees the wasm objects; the render loop must stop
// first instead of throwing "null pointer passed to rust".
test("unload doesn't call into freed wasm objects", async ({ page }) => {
  const errors = trackErrors(page);
  await openApp(page);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

// Regression (2026-11-24, first real-webcam run): a calibration recorded with
// the hands resting near the bottom of the frame squeezed the strings into the
// bottom corner. Such ranges are now rejected, also when loaded from storage.
test("a resting-hand calibration is ignored; Reset calibration clears a good one", async ({
  page,
}) => {
  const KEY = "strhapshody.calibration.v1";
  await page.goto("/");
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        chord: { left: 0.34, top: 0.91, right: 0.36, bottom: 0.93 },
        strum: { left: 0.59, top: 0.92, right: 0.61, bottom: 0.94 },
        leftHanded: false,
      }),
    );
  }, KEY);
  await page.reload();
  await expect.poll(async () => (await state(page)).engineReady, { timeout: 15_000 }).toBe(true);
  expect((await page.evaluate(() => window.__strhapshody!.state().calibrated))).toBe(false);

  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        chord: { left: 0.08, top: 0.35, right: 0.38, bottom: 0.9 },
        strum: { left: 0.62, top: 0.3, right: 0.9, bottom: 0.75 },
        leftHanded: false,
      }),
    );
  }, KEY);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__strhapshody!.state().calibrated)).toBe(true);

  await page.click("#controls .settings-toggle");
  await page.click("#controls .reset-calibration");
  expect(await page.evaluate(() => window.__strhapshody!.state().calibrated)).toBe(false);
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull();
});

test("first visit shows the How to play guide; it closes, stays closed, and reopens with H", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openApp(page);
  const guide = page.locator("#help");
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Left hand — pick the chord");
  await expect(guide).toContainText("fully open flat palm means palm mute");

  // Keyboard play is blocked while the guide is open…
  await page.keyboard.press("c");
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  expect((await state(page)).sounding).toBe("—");

  // …and the guide is remembered.
  await page.reload();
  await expect.poll(async () => (await state(page)).engineReady, { timeout: 15_000 }).toBe(true);
  await expect(guide).toBeHidden();

  await page.keyboard.press("h");
  await expect(guide).toBeVisible();
  await page.click("#help button:has-text('Got it')");
  await expect(guide).toBeHidden();
  await page.click("#controls .help-button");
  await expect(guide).toBeVisible();
  expect(errors).toEqual([]);
});
