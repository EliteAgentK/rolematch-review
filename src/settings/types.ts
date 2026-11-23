// The shape of an organisation's settings, as the server sends it. The server owns the defaults and the limits; nothing here repeats them.
export type StatusColour = "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "cyan" | "purple" | "pink";
interface StatusSetting { key: string; label: string; colour: StatusColour; active: boolean }
interface Noun { one: string; many: string }
export interface OrgSettings {
  statuses: StatusSetting[];
  labels: { candidate: Noun; job: Noun; notes: string };
  limits: { documentsPerDay: number; storageMb: number; inProgress: number; matchesPerHour: number; maxPages: number; maxFileMb: number; processFileMb: number };
  review: { lowConfidence: number; minSkills: number; flagNoContact: boolean; flagNoWorkHistory: boolean; flagNoEducation: boolean };
  editing: { candidate: Record<string, boolean>; job: Record<string, boolean> };
  reading: { hiddenText: "exclude_and_flag" | "flag_only"; forbiddenCopy: "read_and_flag" | "hold_for_review"; pageSeconds: number; maxBatchFiles: number };
  panels: { cardSkills: number; panelSkills: number; panelRoles: number; panelListItems: number; summaryFallback: boolean; finishedBatchesOnBoard: boolean };
  branding: { showOrgName: boolean; orgDisplayName: string };   // the organisation's name under the RoleMatch logo; an empty display name means the registered name
}
interface FieldRule { label: string; group: string; defaultEditable: boolean; why: string }
interface EditPolicy { configurable: { candidate: Record<string, FieldRule>; job: Record<string, FieldRule> }; always: { candidate: string[]; job: string[] }; never: { candidate: string[]; job: string[] } }
export interface SettingsResponse { version: number; settings: OrgSettings; orgName: string; updatedAt: string | null; updatedBy: string | null; defaults: OrgSettings; ceilings: Record<string, number>; editPolicy: EditPolicy; formats: { kind: string; label: string; contentType: string; extensions: string[]; image: boolean }[]; canEdit: boolean }
