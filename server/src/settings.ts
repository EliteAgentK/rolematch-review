// Per-organisation settings: workflow statuses, wording, fair-use limits, review thresholds and panel display.
// Everything here is something an organisation may reasonably want different from another. The SCORING RULES are deliberately not here:
// they are frozen in ruleset.ts and identical for everyone. Settings are validated, capped by platform ceilings, versioned and audited.
import { z } from "zod";
import { CONFIGURABLE, defaultEditing } from "./editPolicy";
import { config } from "./config";
import { audit, platformSql, sql } from "./db";
import { sameJson } from "./sameJson";

const STATUS_COLOURS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "cyan", "purple", "pink"] as const;

/** Nobody can set a limit above these, whatever they type: they protect the shared service. */
export const PLATFORM_CEILINGS = { documentsPerDay: 5000, storageMb: 102_400, inProgress: 1000, matchesPerHour: 50_000, maxPages: 50, maxFileMb: 100, processFileMb: 50 } as const;

const Status = z.object({
  key: z.string().regex(/^[a-z][a-z0-9 -]{0,29}$/, "A status key is lower-case letters, numbers, spaces or dashes."),
  label: z.string().trim().min(1).max(30),
  colour: z.enum(STATUS_COLOURS),
  active: z.boolean(),
});
const Noun = z.object({ one: z.string().trim().min(1).max(30), many: z.string().trim().min(1).max(30) });

const SettingsSchema = z.object({
  statuses: z.array(Status).min(2).max(20).superRefine((list, ctx) => {
    const keys = list.map((s) => s.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Each status needs its own key." });
    const first = list.find((s) => s.key === "new");
    if (!first || !first.active) ctx.addIssue({ code: "custom", message: 'The status "new" must exist and stay active: it is what every new candidate starts as.' });
  }),
  labels: z.object({ candidate: Noun, job: Noun, notes: z.string().trim().min(1).max(40) }),
  limits: z.object({
    documentsPerDay: z.number().int().min(1).max(PLATFORM_CEILINGS.documentsPerDay),
    storageMb: z.number().int().min(10).max(PLATFORM_CEILINGS.storageMb),
    inProgress: z.number().int().min(1).max(PLATFORM_CEILINGS.inProgress),
    matchesPerHour: z.number().int().min(1).max(PLATFORM_CEILINGS.matchesPerHour),
    maxPages: z.number().int().min(1).max(PLATFORM_CEILINGS.maxPages),
    maxFileMb: z.number().int().min(1).max(PLATFORM_CEILINGS.maxFileMb),
    processFileMb: z.number().int().min(1).max(PLATFORM_CEILINGS.processFileMb),
  }),
  review: z.object({
    lowConfidence: z.number().min(0.1).max(0.9),
    minSkills: z.number().int().min(0).max(10),
    flagNoContact: z.boolean(),
    flagNoEducation: z.boolean(), // flag a CV in which no education or certification could be found (otherwise it is only noted)
    flagNoWorkHistory: z.boolean(),
  }),
  // What a person may change in a candidate or a job (see editPolicy.ts). Only fields read from a document are listed; the recruiter's own notes and
  // workflow status are always editable, and what the platform works out is never editable.
  editing: z.object({
    candidate: z.object(Object.fromEntries(Object.keys(CONFIGURABLE.candidate).map((k) => [k, z.boolean()]))).strict(), // strict: a field that cannot be unlocked cannot be named here
    job: z.object(Object.fromEntries(Object.keys(CONFIGURABLE.job).map((k) => [k, z.boolean()]))).strict(),
  }),
  // How documents are read (see inspect.ts). Hidden text is text a person cannot see (white on white, invisible, fully transparent, tiny): by default it is
  // left out of the evidence and flagged. A PDF whose permissions forbid copying is read and flagged, or held for a person to look at first.
  reading: z.object({
    hiddenTinyPoints: z.number().min(0).max(3).default(1),
    hiddenText: z.enum(["exclude_and_flag", "flag_only"]),
    forbiddenCopy: z.enum(["read_and_flag", "hold_for_review"]),
    pageSeconds: z.number().int().min(5).max(120), // time allowed for reading one page before it is given up and reported
    maxBatchFiles: z.number().int().min(1).max(200), // files accepted in one batch upload
  }),
  // How the organisation is named in its own portal: under the RoleMatch logo in the header. An empty display name means the registered organisation name.
  branding: z.object({
    showOrgName: z.boolean(),
    orgDisplayName: z.string().trim().max(60).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "The display name cannot contain control characters."),
  }),
  panels: z.object({
    cardSkills: z.number().int().min(1).max(6),
    panelSkills: z.number().int().min(3).max(40),
    panelRoles: z.number().int().min(1).max(15),
    panelListItems: z.number().int().min(1).max(20), // certifications, projects and "worth noting": items shown before "View more"
    summaryFallback: z.boolean(),
    finishedBatchesOnBoard: z.boolean(), // keep a finished batch's panel on the board until someone closes it; otherwise it goes straight to Settings, History
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> | Settings[K] };

export const defaultSettings = (): Settings => ({
  statuses: [
    // Owner, 9 Nov 2026: New, Shortlisted, Not suitable, Interviewed, Hired. Listed in the order a person moves through them (the furthest one is the
    // candidate's headline). The earlier statuses stay, switched off, so a record that still carries one reads properly and an organisation can switch it back on.
    // Shown as "Not yet reviewed" (owner, 11 Nov 2026: "then the next day they're no longer new, or did you just add it to add it?"): it means nobody has
    // acted on the person yet, however long ago they were added. The key stays "new"; an organisation can rename it in Settings.
    { key: "new", label: "Not yet reviewed", colour: "blue", active: true },
    { key: "reviewed", label: "Reviewed", colour: "green", active: false },
    { key: "shortlisted", label: "Shortlisted", colour: "teal", active: true },
    { key: "awaiting interview", label: "Awaiting interview", colour: "orange", active: false },
    { key: "interviewing", label: "Interviewing", colour: "purple", active: false },
    { key: "interviewed", label: "Interviewed", colour: "cyan", active: true },
    { key: "hired", label: "Hired", colour: "green", active: true },
    { key: "declined", label: "Not suitable", colour: "red", active: true },
    { key: "archived", label: "Archived", colour: "gray", active: false },
  ],
  labels: { candidate: { one: "Candidate", many: "Candidates" }, job: { one: "Job", many: "Jobs" }, notes: "Recruiter notes" },
  limits: {
    documentsPerDay: Math.min(config.limitDocsPerDay, PLATFORM_CEILINGS.documentsPerDay),
    storageMb: Math.min(config.limitStorageMb, PLATFORM_CEILINGS.storageMb),
    inProgress: Math.min(config.limitInProgress, PLATFORM_CEILINGS.inProgress),
    matchesPerHour: Math.min(config.limitMatchesPerHour, PLATFORM_CEILINGS.matchesPerHour),
    maxPages: Math.min(config.maxPages, PLATFORM_CEILINGS.maxPages),
    maxFileMb: Math.min(Math.round(config.maxFileBytes / 1048576), PLATFORM_CEILINGS.maxFileMb),
    processFileMb: Math.min(Math.round(config.processFileBytes / 1048576), PLATFORM_CEILINGS.processFileMb),
  },
  // Review is for what could lead someone to the wrong person or leave them unable to act, so a short skills list or a thin reading sends nothing to a person unless an organisation asks for that here.
  review: { lowConfidence: 0.1, minSkills: 0, flagNoContact: true, flagNoWorkHistory: true, flagNoEducation: false },
  reading: { hiddenText:"exclude_and_flag",forbiddenCopy:"read_and_flag",pageSeconds:20,maxBatchFiles:50,hiddenTinyPoints:1 },
  panels: { cardSkills: 3, panelSkills: 8, panelRoles: 3, panelListItems: 4, summaryFallback: true, finishedBatchesOnBoard: false },
  branding: { showOrgName: true, orgDisplayName: "" },
  editing: defaultEditing(),
});

/** A status label an organisation never chose: the platform's own earlier wording, saved with the rest when the organisation saved its settings. Read as
 *  today's wording, so a change of default reaches every organisation that kept the default (owner, 11 Nov 2026: cards still read "New"). A label the
 *  organisation typed itself is never changed. */
const FORMER_DEFAULT_LABELS: Record<string, string[]> = { new: ["New"] };
function withCurrentDefaults(settings: Settings): Settings {
  const now = new Map(defaultSettings().statuses.map((x) => [x.key, x.label]));
  return { ...settings, statuses: settings.statuses.map((x) => (FORMER_DEFAULT_LABELS[x.key]?.includes(x.label) ? { ...x, label: now.get(x.key) ?? x.label } : x)) };
}

/** Sections replace wholesale when they are arrays (statuses) and merge field by field when they are objects. */
function merge(base: Settings, patch: SettingsPatch): unknown {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const current = (base as any)[k];
    out[k] = Array.isArray(v) || typeof v !== "object" || v === null ? v : { ...current, ...v };
  }
  return out;
}

export interface StoredSettings { version: number; settings: Settings; updatedAt: string | null; updatedBy: string | null }
const cache = new Map<string, { at: number; value: StoredSettings }>();
const TTL_MS = 10_000;

export async function getSettings(orgId: string, fresh = false): Promise<StoredSettings> {
  const hit = cache.get(orgId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [row] = await sql`select version, settings, updated_at, updated_by from org_settings where org_id = ${orgId}`;
  let value: StoredSettings;
  if (!row) value = { version: 0, settings: defaultSettings(), updatedAt: null, updatedBy: null };
  else {
    // Anything added to the settings later is filled in from the defaults, so old rows keep working.
    const parsed = SettingsSchema.safeParse(merge(defaultSettings(), row.settings));
    value = { version: row.version, settings: parsed.success ? withCurrentDefaults(parsed.data) : defaultSettings(), updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by };
  }
  cache.set(orgId, { at: Date.now(), value });
  return value;
}

export class SettingsError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

/** Describes what changed, in a form that is safe and short enough for the audit trail. */
function diff(before: Settings, after: Settings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const section of Object.keys(after) as (keyof Settings)[]) {
    if (sameJson(before[section], after[section])) continue;
    if (section === "statuses") { out.statuses = { before: before.statuses.map((s) => `${s.key}:${s.label}:${s.colour}:${s.active ? "on" : "off"}`), after: after.statuses.map((s) => `${s.key}:${s.label}:${s.colour}:${s.active ? "on" : "off"}`) }; continue; }
    const b: any = before[section], a: any = after[section], fields: Record<string, unknown> = {};
    for (const f of Object.keys(a)) if (!sameJson(b[f], a[f])) fields[f] = { from: b[f], to: a[f] };
    out[section] = fields;
  }
  return out;
}

export async function saveSettings(orgId: string, actorId: string, patch: SettingsPatch, expectedVersion: number, correlationId?: string): Promise<StoredSettings> {
  const result = await sql.begin(async (q) => {
    await q`select pg_advisory_xact_lock(hashtext(${"settings:" + orgId}))`; // two simultaneous saves cannot both pass the version check
    const [row] = await q`select version, settings from org_settings where org_id = ${orgId}`;
    const version = row?.version ?? 0;
    if (expectedVersion !== version) throw new SettingsError("CONF-002", "Someone else changed the settings. Reload them and try again.", 409);
    const before = SettingsSchema.parse(merge(defaultSettings(), row?.settings ?? {}));
    const parsed = SettingsSchema.safeParse(merge(before, patch));
    if (!parsed.success) throw new SettingsError("VAL-003", parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).slice(0, 4).join(" "));
    const after = parsed.data;
    // A status that people already use cannot simply vanish: switch it off instead, and it stays readable on existing records. In use means held by
    // anyone, on their headline or for any job (production review, 12 Nov 2026: "Not suitable" is never a headline, so looking at headlines alone let
    // an organisation delete it while people still held it for jobs).
    // Settings are the organisation's, so every portal of it counts: read as the platform (the request runs as one portal, whose rules would hide the
    // others; review 16 Nov 2026, A-M1), held to this organisation by the query itself.
    const used = await platformSql`select distinct status from (select data->>'status' as status from candidates where org_id = ${orgId}
      union select status from applications where org_id = ${orgId}) held`;
    const keys = new Set(after.statuses.map((s) => s.key));
    const orphan = used.map((r: any) => r.status).filter((k: string | null) => k && !keys.has(k));
    if (orphan.length) throw new SettingsError("VAL-004", `Candidates still use the status "${orphan[0]}". Switch it off instead of removing it.`);
    const change = diff(before, after);
    if (!Object.keys(change).length) return { version, settings: after, updatedAt: null, updatedBy: null, unchanged: true };
    const next = version + 1;
    await q`insert into org_settings (org_id, version, settings, updated_by, updated_at) values (${orgId}, ${next}, ${q.json(after as any)}, ${actorId}, now())
            on conflict (org_id) do update set version = ${next}, settings = ${q.json(after as any)}, updated_by = ${actorId}, updated_at = now()`;
    await q`insert into org_settings_history (org_id, version, settings, change, changed_by) values (${orgId}, ${next}, ${q.json(after as any)}, ${q.json(change as any)}, ${actorId})`;
    await audit(q, orgId, actorId, "settings.changed", "settings", orgId, { version: next, change }, correlationId);
    return { version: next, settings: after, updatedAt: new Date().toISOString(), updatedBy: actorId, unchanged: false };
  });
  cache.delete(orgId);
  return result as StoredSettings;
}

export async function settingsHistory(orgId: string, limit = 20) {
  const rows = await sql`select h.version, h.change, h.created_at, m.name as changed_by from org_settings_history h left join members m on m.user_id = h.changed_by where h.org_id = ${orgId} order by h.version desc limit ${limit}`;
  return rows.map((r: any) => ({ version: r.version, change: r.change, at: new Date(r.created_at).toISOString(), by: r.changed_by ?? (r.change?.platform ? "RoleMatch" : "unknown") }));   // a platform update (migration 043) is made by no person
}
