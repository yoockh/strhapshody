/**
 * Sound controls (task 5.3): instrument toggle (on-screen + keyboard),
 * volume, reverb amount.
 *
 * A small DOM panel in the bottom-right corner, over the canvas (DOM rather
 * than canvas-drawn so the sliders are real, accessible `<input type=range>`
 * elements that work with mouse, touch and keyboard). Keyboard shortcuts:
 * `1` / `2` / `3` pick Acoustic / Electric Clean / Electric Dist, `I` cycles.
 * They avoid the keyboard-fallback keys of task 6.4 (A–G, Shift, Space).
 *
 * ADR-0002 split: the key mapping and instrument cycling are pure and
 * unit-tested; `mountControls` is thin DOM glue (no DOM touched at import).
 */

import { INSTRUMENT_LABELS, INSTRUMENTS, type Instrument } from "./audio.ts";

/** The instrument after `current` in toggle order (wraps around). */
export function nextInstrument(current: Instrument): Instrument {
  const i = INSTRUMENTS.indexOf(current);
  return INSTRUMENTS[(i + 1) % INSTRUMENTS.length]!;
}

/**
 * Instrument a key press selects, or `null` if the key isn't an instrument
 * shortcut. Modifier chords (Ctrl/Meta/Alt) are never shortcuts, so browser
 * shortcuts like Ctrl+1 keep working.
 */
export function instrumentForKey(
  key: string,
  current: Instrument,
  modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
): Instrument | null {
  if (modifiers.ctrl || modifiers.meta || modifiers.alt) return null;
  switch (key) {
    case "1":
      return "acoustic";
    case "2":
      return "clean";
    case "3":
      return "distortion";
    case "i":
    case "I":
      return nextInstrument(current);
    default:
      return null;
  }
}

/** Callbacks + initial values the panel is wired to. */
export interface ControlsBinding {
  readonly instrument: Instrument;
  readonly volume: number;
  readonly reverb: number;
  onInstrument(instrument: Instrument): void;
  onVolume(volume: number): void;
  onReverb(amount: number): void;
}

/** Handle for keeping the panel in sync when state changes elsewhere. */
export interface ControlsHandle {
  setInstrument(instrument: Instrument): void;
  destroy(): void;
}

const SHORTCUT_HINT: Readonly<Record<Instrument, string>> = {
  acoustic: "1",
  clean: "2",
  distortion: "3",
};

/** Build the panel into `parent` and install the keyboard shortcuts. */
export function mountControls(parent: HTMLElement, binding: ControlsBinding): ControlsHandle {
  const panel = document.createElement("section");
  panel.id = "controls";
  panel.setAttribute("aria-label", "Sound controls");

  const group = document.createElement("div");
  group.className = "instrument-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Instrument");
  const buttons = new Map<Instrument, HTMLButtonElement>();
  for (const inst of INSTRUMENTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.instrument = inst;
    b.textContent = INSTRUMENT_LABELS[inst];
    b.title = `${INSTRUMENT_LABELS[inst]} (${SHORTCUT_HINT[inst]})`;
    b.addEventListener("click", () => {
      select(inst);
      b.blur(); // keep Space for strumming, not re-clicking
    });
    buttons.set(inst, b);
    group.append(b);
  }
  panel.append(group);

  const slider = (label: string, id: string, value: number, onInput: (v: number) => void) => {
    const row = document.createElement("label");
    row.className = "slider-row";
    row.htmlFor = id;
    const text = document.createElement("span");
    text.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(value);
    input.addEventListener("input", () => onInput(Number(input.value)));
    row.append(text, input);
    panel.append(row);
  };
  slider("Volume", "volume", binding.volume, (v) => binding.onVolume(v));
  slider("Reverb", "reverb", binding.reverb, (v) => binding.onReverb(v));

  let current = binding.instrument;
  const render = (): void => {
    for (const [inst, b] of buttons) b.setAttribute("aria-pressed", String(inst === current));
  };
  function select(inst: Instrument): void {
    current = inst;
    render();
    binding.onInstrument(inst);
  }
  render();

  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.target instanceof HTMLInputElement) return; // slider has focus
    const inst = instrumentForKey(e.key, current, {
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      alt: e.altKey,
    });
    if (inst) select(inst);
  };
  window.addEventListener("keydown", onKey);
  parent.append(panel);

  return {
    setInstrument(inst: Instrument): void {
      current = inst;
      render();
    },
    destroy(): void {
      window.removeEventListener("keydown", onKey);
      panel.remove();
    },
  };
}
