import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { OrgSettings, SettingsResponse, StatusColour } from "./types";

interface Ctx {
  loaded: boolean;
  /** The settings could not be loaded at all: what shows meanwhile are defaults (raw status names, no status choices), and the page should say so. */
  failed: boolean;
  response: SettingsResponse | null;
  settings: OrgSettings | null;
  reload: () => Promise<void>;
  /** Display label of a status key; an unknown key (say, from an old record) is shown as it is. */
  statusLabel: (key: string) => string;
  statusColour: (key: string) => StatusColour;
  /** The statuses a recruiter may choose now, plus the one the record already has. */
  statusChoices: (current?: string) => { key: string; label: string }[];
  /** Wording for candidates and jobs, so another organisation can say "Applicants" or "Requisitions". */
  nouns: { candidate: { one: string; many: string }; job: { one: string; many: string }; notes: string };
  /** The file types the server accepts, from the server, so the file picker and the checks never drift from what it really does. */
  formats: { extensions: string[]; accept: string; description: string };
  /** May a recruiter change this field of a candidate or a job? The server enforces the same answer; this only decides what the panel offers. */
  canEdit: (kind: "candidate" | "job", field: string) => boolean;
  /** Why a locked field is locked, in words for a person. */
  lockReason: (kind: "candidate" | "job", field: string) => string;
  /** The organisation's name as shown under the RoleMatch logo, or "" when the organisation has switched it off (or settings are not loaded yet). */
  orgLabel: string;
}

const FALLBACK_FORMATS = [{ label: "PDF", extensions: [".pdf"] }, { label: "Word (.docx)", extensions: [".docx"] }, { label: "Photo (JPEG)", extensions: [".jpg", ".jpeg"] }, { label: "Photo or scan (PNG)", extensions: [".png"] }];
function describeFormats(list: { label: string; extensions: string[] }[]) {
  const labels = list.map((f) => f.label);
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

const FALLBACK_NOUNS = { candidate: { one: "Candidate", many: "Candidates" }, job: { one: "Job", many: "Jobs" }, notes: "Recruiter notes" };
const SettingsContext = createContext<Ctx | null>(null);

/** Loads the signed-in organisation's settings once, and again whenever they are saved. Until then, nothing here invents values. */
/** The settings after a load. A failed first load is marked as failed, so a page can say so instead of looking like an organisation with no settings; a
 *  failed reload (after a save) keeps the settings that had loaded instead of wiping them (code review, 16 Nov 2026, G-M5). */
export function afterLoad(prev: { response: SettingsResponse | null; failed: boolean }, result: { ok: true; response: SettingsResponse } | { ok: false }) {
  if (result.ok) return { response: result.response, failed: false };
  return prev.response ? { response: prev.response, failed: false } : { response: null, failed: true };
}

export function SettingsProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [{ response, failed }, setState] = useState<{ response: SettingsResponse | null; failed: boolean }>({ response: null, failed: false });
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    let result: Parameters<typeof afterLoad>[1];
    try { result = { ok: true, response: await api.settings() }; } catch { result = { ok: false }; }
    setState((prev) => afterLoad(prev, result)); setLoaded(true);
  }, []);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);
  const value = useMemo<Ctx>(() => {
    const settings = response?.settings ?? null;
    const find = (key: string) => settings?.statuses.find((s) => s.key === key);
    return {
      loaded, failed, response, settings, reload,
      statusLabel: (key) => find(key)?.label ?? key,
      statusColour: (key) => find(key)?.colour ?? "gray",
      statusChoices: (current) => (settings?.statuses ?? []).filter((s) => s.active || s.key === current).map((s) => ({ key: s.key, label: s.label })),
      nouns: settings?.labels ?? FALLBACK_NOUNS,
      canEdit: (kind, field) => {
        const policy = response?.editPolicy;
        if (!policy || !settings) return policy ? false : ["recruiterNotes", "status"].includes(field);   // until the policy is known, only the recruiter's own work
        if (policy.always[kind].includes(field)) return true;
        if (policy.never[kind].includes(field)) return false;
        return settings.editing?.[kind]?.[field] ?? policy.configurable[kind][field]?.defaultEditable ?? false;
      },
      lockReason: (kind, field) => response?.editPolicy?.never[kind].includes(field) ? "Worked out from the document by the platform." : (response?.editPolicy?.configurable[kind][field]?.why ?? "Read from the document."),
      orgLabel: settings?.branding?.showOrgName === false ? "" : (settings?.branding?.orgDisplayName?.trim() || response?.orgName || ""),
      formats: (() => { const list = response?.formats ?? FALLBACK_FORMATS; const extensions = list.flatMap((f) => f.extensions); return { extensions, accept: extensions.join(","), description: describeFormats(list) }; })(),
    };
  }, [response, failed, loaded, reload]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** For components also shown outside a settings provider (the header on the profile page): null there instead of an error. */
export const useOptionalSettings = (): Ctx | null => useContext(SettingsContext);

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
