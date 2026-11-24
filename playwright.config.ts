import { defineConfig, devices } from "@playwright/test";
import { ensureFakeVideo } from "./e2e/fake-video.ts";

/**
 * End-to-end suite (task 7.1, TESTING.md): the production build served by
 * `vite preview`, opened in Chromium with a fake camera fed from a generated
 * video file, driven through the keyboard fallback, asserting on real Web
 * Audio output. Run with `npm run test:e2e` (builds the engine first).
 */
const fakeVideo = ensureFakeVideo();
const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-video-capture=${fakeVideo}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
