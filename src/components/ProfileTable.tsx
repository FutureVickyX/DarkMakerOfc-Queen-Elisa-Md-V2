"use client";

import Link from "next/link";
import { slotLabel, type FingerSlot } from "@/lib/core/types";
import { formatMm, formatMm2 } from "@/lib/core/format";
import type { NailRecord, Scan } from "@/lib/scan/model";
import { buildProfile } from "@/lib/scan/scanService";
import { CalibrationBadge, ProfileStatusBadge, ReviewBadge, SourceBadge } from "./StatusBadges";

/**
 * Ten-nail profile. Slots without exactly one confirmed, valid measurement are
 * shown as incomplete/unconfirmed/conflict — never filled in.
 */
export function ProfileTable({ scan, onReassign }: { scan: Scan; onReassign?: (nail: NailRecord, slot: FingerSlot | null) => void }) {
  const profile = buildProfile(scan);
  const unassigned = scan.nails.filter((n) => !n.slot && n.reviewStatus !== "rejected");

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Ten-nail measurement profile in millimetres</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">Finger</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Width</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Length</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Area</th>
              <th scope="col" className="py-2 pr-3 font-medium">Status</th>
              <th scope="col" className="py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {profile.map((e) => {
              const n = e.nail ?? (e.candidates.length === 1 ? e.candidates[0]! : null);
              const m = n?.measurement;
              const shown = e.status === "measured" || e.status === "unconfirmed";
              return (
                <tr key={`${e.slot.hand}-${e.slot.finger}`} className="border-b border-line/70 align-top">
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium">
                    {slotLabel(e.slot)}
                  </th>
                  <td className={`tabular py-2.5 pr-3 text-right ${e.status === "unconfirmed" ? "text-muted" : ""}`}>{shown && m ? formatMm(m.widthMm) : "—"}</td>
                  <td className={`tabular py-2.5 pr-3 text-right ${e.status === "unconfirmed" ? "text-muted" : ""}`}>{shown && m ? formatMm(m.lengthMm) : "—"}</td>
                  <td className="tabular py-2.5 pr-3 text-right text-muted">{shown && m ? formatMm2(m.areaMm2) : "—"}</td>
                  <td className="py-2.5 pr-3">
                    <ProfileStatusBadge status={e.status} />
                  </td>
                  <td className="py-2.5">
                    {e.candidates.length === 0 ? (
                      <span className="text-xs text-muted">No nail assigned</span>
                    ) : (
                      <ul className="space-y-1.5">
                        {e.candidates.map((c) => {
                          const cap = scan.captures.find((x) => x.id === c.captureId);
                          return (
                            <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                              <Link href={`/scan/${scan.id}/capture/${c.captureId}`} className="text-xs underline">
                                Photo {scan.captures.findIndex((x) => x.id === c.captureId) + 1}
                              </Link>
                              <CalibrationBadge status={cap?.calibration?.status} />
                              <SourceBadge source={c.contourSource} edited={c.manuallyEdited} />
                              <ReviewBadge status={c.reviewStatus} />
                              {e.candidates.length > 1 && c.measurement && (
                                <span className="tabular text-xs text-muted">
                                  {formatMm(c.measurement.widthMm)} × {formatMm(c.measurement.lengthMm)}
                                </span>
                              )}
                              {onReassign && (
                                <select
                                  aria-label={`Reassign nail from photo ${scan.captures.findIndex((x) => x.id === c.captureId) + 1}`}
                                  className="rounded border border-line bg-white px-1 py-0.5 text-xs"
                                  value={`${e.slot.hand}-${e.slot.finger}`}
                                  onChange={(ev) => {
                                    const v = ev.target.value;
                                    if (v === "none") onReassign(c, null);
                                    else {
                                      const [hand, finger] = v.split("-") as [FingerSlot["hand"], FingerSlot["finger"]];
                                      onReassign(c, { hand, finger });
                                    }
                                  }}
                                >
                                  {profile.map((p) => (
                                    <option key={`${p.slot.hand}-${p.slot.finger}`} value={`${p.slot.hand}-${p.slot.finger}`}>
                                      {slotLabel(p.slot)}
                                    </option>
                                  ))}
                                  <option value="none">Unassign</option>
                                </select>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {unassigned.length > 0 && (
        <p className="text-sm text-warn">
          {unassigned.length} measured nail{unassigned.length === 1 ? " is" : "s are"} not assigned to a finger yet. Open the photo and choose the finger.
        </p>
      )}
    </div>
  );
}
