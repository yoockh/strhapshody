/**
 * In-app "How to play" guide.
 *
 * The first real-webcam run showed that nothing in the app explained where to
 * put your hands, so the calibration recorded resting hands and the player
 * didn't know how to play. This card opens on first use — before calibration
 * starts — and any time from the panel button or the H key.
 *
 * `helpSections` (the content, worded for the player's handedness) is pure and
 * unit-tested; `mountHelp` is thin DOM glue (nothing touched at import).
 */

export const HELP_SEEN_STORAGE_KEY = "strhapshody.help-seen.v1";

export interface HelpItem {
  readonly icon: string;
  readonly text: string;
}

export interface HelpSection {
  readonly title: string;
  readonly items: readonly HelpItem[];
}

/** The guide's content, naming the hands for the player's handedness. */
export function helpSections(leftHanded = false): HelpSection[] {
  const chord = leftHanded ? "right" : "left";
  const strum = leftHanded ? "left" : "right";
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  return [
    {
      title: "Get in position",
      items: [
        { icon: "📏", text: "Sit about an arm's length from the laptop, in good light." },
        {
          icon: "🙌",
          text: "Raise both hands to shoulder height, palms facing the camera — both must be in the picture.",
        },
        {
          icon: "🪞",
          text: `The picture is a mirror: your ${chord} hand plays the ${chord} side of the screen.`,
        },
      ],
    },
    {
      title: `${cap(chord)} hand — pick the chord`,
      items: [
        { icon: "⬡", text: "Move your palm over a hexagon to choose the chord's letter." },
        { icon: "☝️", text: "Index finger up = major (C)" },
        { icon: "✌️", text: "Index + middle up = minor (Cm)" },
        { icon: "🤟", text: "Index + middle + ring up = 7th (C7) — keep the little finger down." },
        { icon: "⚡", text: "Move up into the fret strip for power chords; drop back down for normal chords." },
      ],
    },
    {
      title: `${cap(strum)} hand — strum`,
      items: [
        {
          icon: "↕️",
          text: "Sweep your hand down or up across the six string lines — the middle of your palm has to cross them.",
        },
        {
          icon: "🤏",
          text: "Strum with a relaxed, half-closed hand, like holding a pick. A fully open flat palm means palm mute.",
        },
        { icon: "💨", text: "Faster sweeps play louder." },
        { icon: "✊", text: "Make a fist to silence all strings." },
      ],
    },
    {
      title: "Good to know",
      items: [
        { icon: "🎵", text: "A new chord starts on your next strum, like on a real guitar." },
        { icon: "🧭", text: "Calibration (20 s) fits the zones to your reach — move freely while it runs." },
        { icon: "⌨️", text: "No camera? Keys A–G pick a chord (Shift = minor), Space strums." },
      ],
    },
  ];
}

export interface HelpBinding {
  /** "Start calibration" was pressed (the card has already closed). */
  onStartCalibration(): void;
  /** The card closed (by any route). */
  onClose(): void;
}

export interface HelpHandle {
  open(leftHanded: boolean): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Build the (initially hidden) guide card into `parent`. */
export function mountHelp(parent: HTMLElement, binding: HelpBinding): HelpHandle {
  const backdrop = document.createElement("div");
  backdrop.id = "help";
  backdrop.hidden = true;
  const card = document.createElement("section");
  card.className = "help-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "help-title");
  backdrop.append(card);

  let isOpen = false;

  function render(leftHanded: boolean): void {
    card.replaceChildren();
    const title = document.createElement("h2");
    title.id = "help-title";
    title.textContent = "🎸 How to play";
    card.append(title);

    const grid = document.createElement("div");
    grid.className = "help-grid";
    for (const section of helpSections(leftHanded)) {
      const box = document.createElement("div");
      box.className = "help-section";
      const h = document.createElement("h3");
      h.textContent = section.title;
      const list = document.createElement("ul");
      for (const item of section.items) {
        const li = document.createElement("li");
        const icon = document.createElement("span");
        icon.className = "help-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = item.icon;
        const text = document.createElement("span");
        text.textContent = item.text;
        li.append(icon, text);
        list.append(li);
      }
      box.append(h, list);
      grid.append(box);
    }
    card.append(grid);

    const actions = document.createElement("div");
    actions.className = "help-actions";
    const start = document.createElement("button");
    start.type = "button";
    start.className = "primary";
    start.textContent = "Start calibration";
    start.addEventListener("click", () => {
      close();
      binding.onStartCalibration();
    });
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "Got it";
    ok.addEventListener("click", () => close());
    const hint = document.createElement("span");
    hint.className = "help-hint";
    hint.textContent = "Reopen any time with H or the How to play button.";
    actions.append(start, ok, hint);
    card.append(actions);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    backdrop.hidden = true;
    binding.onClose();
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  parent.append(backdrop);

  return {
    open(leftHanded: boolean): void {
      render(leftHanded);
      isOpen = true;
      backdrop.hidden = false;
      (card.querySelector("button.primary") as HTMLButtonElement | null)?.focus();
    },
    close,
    get isOpen() {
      return isOpen;
    },
  };
}
