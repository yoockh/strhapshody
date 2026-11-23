/**
 * Webcam placeholder + overlays (tasks 0.1 / 0.4).
 *
 * `drawFeedPattern` is the deterministic stand-in feed used whenever there is
 * no live camera frame to show yet — while the camera is still starting, or
 * after it failed. As of task 0.4 the real mirrored webcam feed (see
 * `videoframe.drawVideoCover`) replaces it on the happy path.
 *
 *  - `drawFeedPattern` is drawn through Stage.withMirroredFeed, i.e. flipped
 *    left-to-right, exactly as the webcam frames are. It paints vertical
 *    colour bars plus a corner "mirror check" wedge so the horizontal flip is
 *    visually obvious.
 *  - `drawZoneOverlay` is drawn un-mirrored on top: the left/right zone
 *    divider, labels, and an optional status caption, so text stays readable.
 *  - `drawErrorBanner` is drawn un-mirrored on top of everything: a centred
 *    message box for the graceful "no camera / permission denied" path.
 */

import { statusBarHeight } from "./hud.ts";

const BAR_COLORS = [
  "#3a4a5a",
  "#44566a",
  "#4e6274",
  "#586e80",
  "#627a8c",
  "#6c8698",
  "#7892a4",
];

/** Draw the mirrored test-pattern layer (stand-in for the webcam frame). */
export function drawFeedPattern(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  // Vertical colour bars across the full width.
  const barWidth = width / BAR_COLORS.length;
  for (let i = 0; i < BAR_COLORS.length; i++) {
    ctx.fillStyle = BAR_COLORS[i]!;
    ctx.fillRect(i * barWidth, 0, Math.ceil(barWidth) + 1, height);
  }

  // A corner wedge in the logical top-left. After the horizontal flip this
  // lands on the top-right of the screen, making the mirror obvious.
  const wedge = Math.min(width, height) * 0.08;
  ctx.fillStyle = "#e8a13a";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(wedge, 0);
  ctx.lineTo(0, wedge);
  ctx.closePath();
  ctx.fill();
}

/** Draw the un-mirrored zone divider and labels on top of the feed. */
export function drawZoneOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  caption?: string,
  leftHanded = false,
): void {
  const midX = width / 2;

  // Centre divider between the left (chord) and right (strum) zones.
  ctx.strokeStyle = "rgba(232, 234, 237, 0.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(midX, 0);
  ctx.lineTo(midX, height);
  ctx.stroke();
  ctx.setLineDash([]);

  // Zone labels (PRD §5: left hand = chords, right hand = strum; swapped for
  // left-handed players). Small, just under the status bar, so they never sit
  // on top of the hex flower or the strings.
  ctx.fillStyle = "rgba(232, 234, 237, 0.6)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.max(10, Math.round(height * 0.02))}px system-ui, sans-serif`;
  const labelY = statusBarHeight(height) + Math.max(10, height * 0.025);
  const [leftLabel, rightLabel] = leftHanded
    ? ["LEFT HAND · strum", "RIGHT HAND · chords"]
    : ["LEFT HAND · chords", "RIGHT HAND · strum"];
  ctx.fillText(leftLabel, midX / 2, labelY);
  ctx.fillText(rightLabel, midX + midX / 2, labelY);

  // Optional status caption (e.g. "starting camera…"). Omitted once the live
  // feed is showing, so we don't label a real camera frame as a placeholder.
  if (caption) {
    ctx.fillStyle = "rgba(232, 234, 237, 0.55)";
    ctx.font = `${Math.round(height * 0.022)}px system-ui, sans-serif`;
    ctx.fillText(caption, midX, height * 0.92);
  }
}

/**
 * Draw a centred, un-mirrored error banner (graceful camera-failure path,
 * task 0.4). Word-wraps `message` to fit the box. Uses ctx.measureText, so it
 * only runs at render time against a real 2D context.
 */
export function drawErrorBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  message: string,
): void {
  const boxW = Math.min(width * 0.82, 560);
  const pad = Math.max(16, boxW * 0.05);
  const titleSize = Math.round(Math.min(width, height) * 0.038);
  const bodySize = Math.round(Math.min(width, height) * 0.026);
  const lineGap = bodySize * 1.4;

  // Wrap the message to the inner width.
  ctx.font = `${bodySize}px system-ui, sans-serif`;
  const lines = wrapText(ctx, message, boxW - pad * 2);

  const contentH = titleSize + lineGap * 0.6 + lines.length * lineGap;
  const boxH = contentH + pad * 2;
  const boxX = (width - boxW) / 2;
  const boxY = (height - boxH) / 2;

  // Panel.
  ctx.fillStyle = "rgba(20, 10, 10, 0.88)";
  ctx.strokeStyle = "rgba(232, 92, 92, 0.9)";
  ctx.lineWidth = 2;
  roundedRect(ctx, boxX, boxY, boxW, boxH, 12);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Title.
  ctx.fillStyle = "rgba(255, 180, 180, 0.95)";
  ctx.font = `700 ${titleSize}px system-ui, sans-serif`;
  let y = boxY + pad;
  ctx.fillText(title, width / 2, y);
  y += titleSize + lineGap * 0.6;

  // Body.
  ctx.fillStyle = "rgba(232, 234, 237, 0.92)";
  ctx.font = `${bodySize}px system-ui, sans-serif`;
  for (const line of lines) {
    ctx.fillText(line, width / 2, y);
    y += lineGap;
  }
}

/** Greedy word-wrap against the given max width using the ctx's current font. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [text];
}

/** Trace a rounded rectangle path (fill/stroke left to the caller). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
