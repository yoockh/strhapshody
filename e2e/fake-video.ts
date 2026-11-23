/**
 * Generates the fake webcam video for the e2e suite (task 7.1): a small
 * Y4M (YUV4MPEG2, 4:2:0) clip Chrome plays through
 * `--use-file-for-fake-video-capture`, so `getUserMedia` returns a real,
 * deterministic video stream with no camera attached. Generated on demand
 * into the OS temp dir rather than committed, to keep binaries out of git.
 *
 * Content: a soft grey gradient with a bright bar sweeping across — enough
 * structure that the feed visibly renders and moves (no hands in it, so the
 * tests drive the app through the keyboard fallback, per TESTING.md).
 */

import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const W = 160;
const H = 120;
const FRAMES = 30;

export function ensureFakeVideo(): string {
  const path = join(tmpdir(), `strhapshody-fake-${W}x${H}x${FRAMES}.y4m`);
  if (existsSync(path)) return path;

  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`, "ascii");
  const frameTag = Buffer.from("FRAME\n", "ascii");
  const ySize = W * H;
  const cSize = (W / 2) * (H / 2);
  const parts: Buffer[] = [header];
  for (let f = 0; f < FRAMES; f++) {
    const y = Buffer.alloc(ySize);
    const barX = Math.floor((f / FRAMES) * W);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const base = 70 + Math.floor((col / W) * 60) + Math.floor((row / H) * 30);
        y[row * W + col] = Math.abs(col - barX) < 6 ? 235 : base;
      }
    }
    const u = Buffer.alloc(cSize, 128);
    const v = Buffer.alloc(cSize, 128);
    parts.push(frameTag, y, u, v);
  }
  writeFileSync(path, Buffer.concat(parts));
  return path;
}
