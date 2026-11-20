/**
 * Static webcam placeholder (task 0.1).
 *
 * Until task 0.4 wires up getUserMedia, we draw a simple, deterministic test
 * pattern where the live mirrored webcam feed will later go. It is split into
 * two parts so the mirroring behaviour matches the real feed:
 *
 *  - `drawFeedPattern` is drawn through Stage.withMirroredFeed, i.e. flipped
 *    left-to-right, exactly as the webcam frames will be. It paints vertical
 *    colour bars plus a corner "mirror check" wedge so the horizontal flip is
 *    visually obvious.
 *  - `drawZoneOverlay` is drawn un-mirrored on top: the left/right zone
 *    divider and labels, so text stays readable.
 */

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

  // Zone labels (PRD §5: left hand = chords, right hand = strum).
  ctx.fillStyle = "rgba(232, 234, 237, 0.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(height * 0.035)}px system-ui, sans-serif`;
  ctx.fillText("LEFT HAND · chords", midX / 2, height * 0.5);
  ctx.fillText("RIGHT HAND · strum", midX + midX / 2, height * 0.5);

  // Status caption.
  ctx.fillStyle = "rgba(232, 234, 237, 0.55)";
  ctx.font = `${Math.round(height * 0.022)}px system-ui, sans-serif`;
  ctx.fillText(
    "webcam placeholder — real camera arrives in task 0.4",
    midX,
    height * 0.92,
  );
}
