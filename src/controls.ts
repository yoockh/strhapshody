/**
 * Control panel: sound controls (task 5.3: instrument toggle on-screen + by
 * keyboard, volume, reverb), the Calibrate button (6.1), and a collapsible
 * Settings section (6.2: left-handed swap, power-chord octave, strum
 * threshold, smoothing, hex size, reset).
 *
 * A small DOM panel in the bottom-right corner, over the canvas (DOM rather
 * than canvas-drawn so the controls are real, accessible buttons, checkboxes
 * and `<input type=range>` sliders). Every change is reported as a partial
 * `Settings` patch; `main.ts` applies and persists it. Keyboard shortcuts:
 * `1` / `2` / `3` pick Acoustic / Electric Clean / Electric Dist, `I` cycles.
 * They avoid the keyboard-fallback keys of task 6.4 (A–G, Shift, Space).
 *
 * ADR-0002 split: the key mapping and instrument cycling are pure and
 * unit-tested; `mountControls` is thin DOM glue (no DOM touched at import).
 */

import { INSTRUMENT_LABELS, INSTRUMENTS, type Instrument } from "./audio.ts";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import { KEYBOARD_HELP } from "./keyboard.ts";

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

/** What the panel is wired to. */
export interface ControlsBinding {
  /** Initial values. */
  readonly settings: Settings;
  /** A setting changed (only the changed fields). */
  onChange(patch: Partial<Settings>): void;
  /** Rerun calibration (task 6.1); omit to hide the button. */
  onCalibrate?: () => void;
  /** Forget the saved calibration (zones back to the defaults). */
  onResetCalibration?: () => void;
}

/** Handle for keeping the panel in sync when state changes elsewhere. */
export interface ControlsHandle {
  /** Re-sync every control to `settings` (e.g. after a reset). */
  update(settings: Settings): void;
  destroy(): void;
}

const SHORTCUT_HINT: Readonly<Record<Instrument, string>> = {
  acoustic: "1",
  clean: "2",
  distortion: "3",
};

type UnitKey = "volume" | "reverb" | "strumThreshold" | "smoothing" | "hexSize";
type BoolKey = "leftHanded" | "powerOctave";

/** Build the panel into `parent` and install the keyboard shortcuts. */
export function mountControls(parent: HTMLElement, binding: ControlsBinding): ControlsHandle {
  let current: Settings = binding.settings;
  const change = (patch: Partial<Settings>): void => {
    current = { ...current, ...patch };
    binding.onChange(patch);
    sync();
  };

  const panel = document.createElement("section");
  panel.id = "controls";
  panel.setAttribute("aria-label", "Controls");

  // Instrument buttons.
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
      selectInstrument(inst);
      b.blur(); // keep Space for strumming, not re-clicking
    });
    buttons.set(inst, b);
    group.append(b);
  }
  panel.append(group);

  const sliders = new Map<UnitKey, HTMLInputElement>();
  const slider = (container: HTMLElement, label: string, key: UnitKey, hint?: string): void => {
    const row = document.createElement("label");
    row.className = "slider-row";
    row.htmlFor = `setting-${key}`;
    const text = document.createElement("span");
    text.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.id = `setting-${key}`;
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(current[key]);
    if (hint) input.title = hint;
    input.addEventListener("input", () => change({ [key]: Number(input.value) }));
    row.append(text, input);
    container.append(row);
    sliders.set(key, input);
  };

  const checks = new Map<BoolKey, HTMLInputElement>();
  const checkbox = (container: HTMLElement, label: string, key: BoolKey): void => {
    const row = document.createElement("label");
    row.className = "check-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `setting-${key}`;
    input.checked = current[key];
    input.addEventListener("change", () => {
      change({ [key]: input.checked });
      input.blur();
    });
    const text = document.createElement("span");
    text.textContent = label;
    row.append(input, text);
    container.append(row);
    checks.set(key, input);
  };

  slider(panel, "Volume", "volume");
  slider(panel, "Reverb", "reverb");

  // Calibrate + Settings toggle.
  const actions = document.createElement("div");
  actions.className = "action-row";
  if (binding.onCalibrate) {
    const onCalibrate = binding.onCalibrate;
    const cal = document.createElement("button");
    cal.type = "button";
    cal.className = "calibrate";
    cal.textContent = "Calibrate";
    cal.title = "Re-measure your hands' comfortable reach (~20 s, Esc cancels)";
    cal.addEventListener("click", () => {
      onCalibrate();
      cal.blur();
    });
    actions.append(cal);
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "settings-toggle";
  toggle.textContent = "Settings";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "settings-section");
  actions.append(toggle);
  panel.append(actions);

  // Collapsible settings section.
  const section = document.createElement("div");
  section.id = "settings-section";
  section.hidden = true;
  checkbox(section, "Left-handed (chords with right hand)", "leftHanded");
  checkbox(section, "Power chords: add octave", "powerOctave");
  slider(section, "Strum threshold", "strumThreshold", "Higher ignores slower hand movement");
  slider(section, "Smoothing", "smoothing", "Higher = steadier chord cursor, more lag");
  slider(section, "Hex size", "hexSize");
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "reset";
  reset.textContent = "Reset to defaults";
  reset.addEventListener("click", () => {
    change({ ...DEFAULT_SETTINGS });
    reset.blur();
  });
  section.append(reset);
  if (binding.onResetCalibration) {
    const onResetCalibration = binding.onResetCalibration;
    const resetCal = document.createElement("button");
    resetCal.type = "button";
    resetCal.className = "reset-calibration";
    resetCal.textContent = "Reset calibration";
    resetCal.title = "Forget your saved hand ranges and go back to the default zones";
    resetCal.addEventListener("click", () => {
      onResetCalibration();
      resetCal.blur();
    });
    section.append(resetCal);
  }
  const help = document.createElement("p");
  help.className = "hint";
  help.textContent = KEYBOARD_HELP;
  section.append(help);
  panel.append(section);
  toggle.addEventListener("click", () => {
    section.hidden = !section.hidden;
    toggle.setAttribute("aria-expanded", String(!section.hidden));
    toggle.blur();
  });

  function sync(): void {
    // Keep the panel on the strum side so it never covers the chord flower.
    panel.classList.toggle("strum-left", current.leftHanded);
    for (const [inst, b] of buttons) {
      b.setAttribute("aria-pressed", String(inst === current.instrument));
    }
    for (const [key, input] of sliders) input.value = String(current[key]);
    for (const [key, input] of checks) input.checked = current[key];
  }
  function selectInstrument(inst: Instrument): void {
    change({ instrument: inst });
  }
  sync();

  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.target instanceof HTMLInputElement) return; // a control has focus
    const inst = instrumentForKey(e.key, current.instrument, {
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      alt: e.altKey,
    });
    if (inst) selectInstrument(inst);
  };
  window.addEventListener("keydown", onKey);
  parent.append(panel);

  return {
    update(settings: Settings): void {
      current = settings;
      sync();
    },
    destroy(): void {
      window.removeEventListener("keydown", onKey);
      panel.remove();
    },
  };
}
