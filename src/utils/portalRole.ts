export interface PortalChoice { id: string; name: string; role: string }

/**
 * What the board offers the signed-in person in the portal they are working in. "change" for a recruiter or an administrator; "view" for a hiring
 * manager, who reads shortlists only (the server refuses every change from them, server/src/hiringManager.ts). "unknown" while their role there is not
 * known (not loaded yet, failed to load, or the portal is not in their list): then nothing that changes a record is offered either, so a failed request
 * can never put recruiter actions in front of someone the server will refuse (code review, 16 Nov 2026, E-M4). The server decides in every case; this only
 * decides what is shown.
 */
export function boardAccess(portals: PortalChoice[] | null, selected: string | null): "change" | "view" | "unknown" {
  const active = portals?.find((p) => p.id === selected) ?? (selected ? undefined : portals?.[0]);   // no choice yet: the first, as the portal selector shows
  if (!active?.role) return "unknown";
  if (active.role === "hiring_manager") return "view";
  return active.role === "recruiter" || active.role === "admin" ? "change" : "unknown";
}
