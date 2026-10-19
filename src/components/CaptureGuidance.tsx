"use client";

export const CHECKLIST = [
  { id: "obstructions", label: "Rings, polish, tips or other obstructions removed where possible" },
  { id: "flat", label: "Hand flat and relaxed, fingers separated" },
  { id: "card", label: "Card beside the fingertips, raised to roughly nail height, arrow pointing the same way as the fingers" },
  { id: "camera", label: "Camera held directly above (perpendicular to) the nails, 20–30 cm away" },
  { id: "light", label: "Even lighting, no flash glare on nails or card" },
  { id: "visible", label: "All nail plates and all four card markers fully in the frame and in focus" },
] as const;

export type ChecklistState = Record<(typeof CHECKLIST)[number]["id"], boolean>;

export const emptyChecklist = (): ChecklistState =>
  Object.fromEntries(CHECKLIST.map((c) => [c.id, false])) as ChecklistState;

/**
 * Capture checklist. These are the user's own confirmations; the app checks
 * markers, resolution, sharpness and glare automatically only after capture.
 */
export function CaptureGuidance({ value, onChange }: { value: ChecklistState; onChange: (v: ChecklistState) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">Before you take the photo</legend>
      <p className="mt-1 text-xs text-muted">Your confirmation — the photo is checked automatically after capture.</p>
      <ul className="mt-3 space-y-2">
        {CHECKLIST.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={value[c.id]}
                onChange={(e) => onChange({ ...value, [c.id]: e.target.checked })}
              />
              <span>{c.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export function GuidanceIllustration() {
  return (
    <svg viewBox="0 0 240 160" className="w-full max-w-sm" role="img" aria-label="Illustration: hand flat with fingers apart, calibration card just beyond the fingertips">
      <rect x="0" y="0" width="240" height="160" fill="#f4f5f7" />
      <g fill="#e8c4ae" stroke="#9a6b55" strokeWidth="1.2">
        <rect x="60" y="70" width="90" height="80" rx="18" />
        <rect x="64" y="34" width="16" height="48" rx="8" />
        <rect x="86" y="22" width="16" height="58" rx="8" />
        <rect x="108" y="26" width="16" height="54" rx="8" />
        <rect x="130" y="38" width="15" height="44" rx="7.5" />
        <rect x="150" y="84" width="40" height="15" rx="7.5" transform="rotate(-25 150 92)" />
      </g>
      <g fill="#f6d6d8" stroke="#9a6b55" strokeWidth="0.8">
        <rect x="67" y="36" width="10" height="9" rx="4" />
        <rect x="89" y="24" width="10" height="9" rx="4" />
        <rect x="111" y="28" width="10" height="9" rx="4" />
        <rect x="132.5" y="40" width="10" height="9" rx="4" />
      </g>
      <g>
        <rect x="160" y="8" width="70" height="44" fill="#fff" stroke="#111" strokeWidth="0.8" />
        <rect x="164" y="12" width="10" height="10" fill="#111" />
        <rect x="216" y="12" width="10" height="10" fill="#111" />
        <rect x="164" y="38" width="10" height="10" fill="#111" />
        <rect x="216" y="38" width="10" height="10" fill="#111" />
        <path d="M195 14 l-4 6 h3 v8 h2 v-8 h3 z" fill="#111" />
      </g>
      <text x="195" y="64" fontSize="8" textAnchor="middle" fill="#5b6470">
        card at nail height
      </text>
    </svg>
  );
}
