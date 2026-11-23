// How every record panel and every board card looks, in one place (owner, 11 Nov 2026: "We need to configure these panels to look the same, no matter
// how the CVs look. Same font, same sizes, same bullet points, same kind of header, same everything ... It must be clean, slick, corporate level"; and
// "even the panels on the side need the same treatment"). The panel and card files say which data goes where; how it looks is only here, and a test
// fails a panel or card file that sets a size or colour of its own (server/test/panel-config.test.ts). Plan: docs/architecture/PLAN_PANEL_CONFIGURATION.md.

/** Every colour a panel or card uses, light and dark, by what it means. Registered as the theme's panel.* colours (src/theme/semantic-tokens.ts). */
export const PANEL_COLOURS = {
  ink: ["gray.800", "gray.100"],        // a record's name, an entry's title, a fact's value
  body: ["gray.700", "gray.300"],       // the document's own words: duties, requirements, a summary
  muted: ["gray.600", "gray.400"],      // a line under a title, a label, a date
  faint: ["gray.500", "gray.400"],      // a note about the panel itself
  surface: ["white", "gray.800"],       // the panel and the card
  ground: ["gray.50", "gray.700"],      // the box a section sits in
  entry: ["white", "gray.800"],         // an entry inside a section box
  line: ["gray.200", "gray.700"],       // borders and dividers
  rule: ["blue.200", "blue.700"],       // the rule under a section heading
  bar: ["blue.400", "blue.500"],        // the band across the top of a panel
  marker: ["teal.500", "teal.300"],     // a bullet
  accent: ["teal.600", "teal.300"],     // a contact line's icon
  link: ["blue.600", "blue.300"],       // "View 3 more", "Read more"
  chosen: ["blue.400", "blue.500"],     // a selected card's border
  hover: ["blue.300", "blue.400"],      // a card's border under the pointer
  dropping: ["blue.50", "blue.900"],    // a card something is being dragged onto
  emptyChip: ["gray.100", "gray.700"],  // "No skills found"
  veil: ["rgba(255,255,255,0.86)", "rgba(22,26,37,0.88)"],   // over a card being read again
  noticeGround: ["orange.50", "orange.900"], noticeLine: ["orange.200", "orange.700"], noticeInk: ["orange.900", "orange.100"],
  // The tab bar of every panel.
  tabWell: ["gray.100", "whiteAlpha.50"], tabInk: ["gray.600", "gray.400"], tabHover: ["gray.900", "white"], tabChosenInk: ["teal.600", "teal.300"], tabRing: ["teal.400", "teal.400"],
  pill: ["gray.200", "whiteAlpha.200"], pillOn: ["teal.100", "teal.800"], pillInk: ["gray.700", "gray.200"],
  focus: ["blue.400", "blue.300"],      // the keyboard's focus ring
  // A match assessment: each evidence state's mark and its bar, the box of next steps, and the bar's empty track.
  evMet: ["green.600", "green.300"], evPartial: ["orange.600", "orange.300"], evMissing: ["gray.600", "gray.400"], evContra: ["red.600", "red.300"],
  barMet: ["green.500", "green.400"], barPartial: ["orange.400", "orange.300"], barMissing: ["gray.400", "gray.500"], barContra: ["red.500", "red.400"],
  nextGround: ["blue.50", "rgba(66,153,225,0.08)"], track: ["gray.100", "gray.700"], quote: ["gray.300", "gray.600"],
  // A list of matches (a shortlist, or the results of Find matches): its header, alternate rows, the row under the pointer, the brand band.
  listHead: ["gray.100", "gray.800"], rowAlt: ["gray.50", "gray.700"], rowHover: ["blue.50", "blue.900"], band: ["blue.600", "blue.700"], bandInk: ["white", "white"],
  heroGround: ["blue.50", "blue.900"], heroInk: ["blue.800", "blue.100"], caution: ["orange.700", "orange.300"],
  backdrop: ["blackAlpha.300", "blackAlpha.500"],   // behind an open window
} as const satisfies Record<string, readonly [string, string]>;
export type PanelColour = keyof typeof PANEL_COLOURS;
export const colour = (c: PanelColour) => `panel.${c}`;

/** The one spacing scale for panels and cards (Chakra steps of 4 px): the panel and card files space their blocks only with these. */
export const SPACE = { hair: 0.5, xxs: 1, xs: 1.5, sm: 2, md: 3, lg: 4, xl: 5, xxl: 6 } as const;

/** Headings and tab names in Title Case, every one, whatever an organisation types: the main words capitalised, the small ones not. */
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
export const titleCase = (s: string) => s.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w) || !w ? w : i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1))).join("");

/** The one look of a panel: type, spacing, bullets, entries, chips, facts, buttons and the footer. */
export const PANEL_LOOK = {
  frame: { padding: { base: 4, xl: 5 }, radius: "xl", bar: "5px", shadow: "0 4px 12px rgba(0, 0, 0, 0.08)" },
  title: { fontSize: "xl", fontWeight: "bold", lineHeight: "1.25" },         // the record's name, the same on a CV and a job
  subtitle: { fontSize: "sm", fontWeight: "medium", lineHeight: "1.5" },     // role or company, then the rest, joined by DOT
  section: {
    gap: 6,                                                                 // space above each section
    heading: { fontSize: "md", fontWeight: "bold", rule: "2px", gapBelow: 3 },
    box: { padding: 4, radius: "md" },
    caption: { fontSize: "xs", fontWeight: "semibold", letterSpacing: "wide" },   // a group's own heading inside a section, in capitals
  },
  text: { fontSize: "sm", lineHeight: "1.6", weight: "normal", strong: "medium" },
  note: { fontSize: "xs" },
  /** A line of the document's own words. "bullets": a list with one marker; "cards": each line on its own card. Changing it changes every list at once. */
  items: { style: "bullets" as "bullets" | "cards", gap: 2, marker: { size: "6px", top: "0.62em" }, indent: 5 },
  /** Something with a title of its own: a role, a qualification, a competency. */
  entry: { padding: 3, radius: "md", rule: "3px", gap: 3, title: { fontSize: "md", fontWeight: "bold" }, meta: { fontSize: "sm", fontWeight: "medium" } },
  chip: { size: "sm" as const, palette: "blue", paddingX: 3, paddingY: 1.5, radius: "md" },
  facts: { minColumn: "200px", wide: 60, label: { fontSize: "xs", fontWeight: "medium", letterSpacing: "wider" } },
  contact: { padding: { x: 3, y: 2 }, radius: "md", gap: 2, iconSize: 14 },
  more: { size: "sm" as const, palette: "blue" },
  footer: { fontSize: "xs", gap: 3 },
  avatar: { size: "xl" as const, ring: "3px" }, tag: "sm" as const, badge: { status: "lg" as const, label: "sm" as const }, button: "sm" as const,
  tabs: { fontSize: "sm", pill: "xs" },
  lead: { fontSize: "md" }, fold: { fontSize: "md", fontWeight: "semibold" },
  stars: "lg" as const, table: { assessment: "sm" as const, list: "md" as const },
  dialog: { size: "xl" as const, close: "sm" as const, button: "lg" as const, logo: "24px" }, listLogo: "36px",
} as const;
/** What a coloured label says, the same everywhere: a person moving forward for a job, a person not suitable, a summary written by the AI or by the document. */
export const LABEL_PALETTE = { forward: "teal", declined: "red", writtenByAi: "purple", fromDocument: "green", department: "purple" } as const;
/** What each colour of an entry's rule means, the same everywhere. */
export const TONES = { role: "green", requirement: "blue", preferred: "teal", responsibility: "green", competency: "purple", project: "blue", other: "gray" } as const;
/** Where a match stands on place and working arrangement (shown beside the score, never inside it): the colour of each standing. */
export const LOGISTICS_PALETTE = { compatible: "green", to_confirm: "blue", conflict: "red", none: "gray" } as const;
/** Between the parts of one line (a role's employer and its dates; a card's place and type). */
export const DOT = " · ";

/** The board's cards: one look for a candidate card and a job card. */
export const CARD_LOOK = {
  padding: 3, radius: "lg", avatar: { size: "sm" as const, ring: "2px" }, button: "xs" as const,
  // One fixed height per list, so every candidate card matches every other candidate card and every job card every other job card.
  height: { candidate: "290px", job: "292px" },   // the candidate card grew 22px on 17 Nov 2026 for its "Shortlisted for" line
  title: { fontSize: "15px", fontWeight: "bold", lineHeight: "20px", lines: 2 },
  subtitle: { fontSize: "sm", fontWeight: "medium", lineHeight: "1.3", lines: 2 },
  detail: { fontSize: "xs", lineHeight: "1.35" },
  stageJob: { fontWeight: "medium" },   // the job named in a card's "Shortlisted for" line
  chip: { size: "sm" as const, palette: "blue" },
  badge: { fontSize: "0.65em" },
  footer: { fontSize: "xs", fontWeight: "medium" },
} as const;

/** The five evidence states of a match (CLAUDE.md rule 7), each with a mark and words, so colour is never the only signal. Missing evidence is neutral grey,
 *  not red: it is not proof of a lack. */
export type EvidenceKind = "verified" | "partial" | "not_demonstrated" | "contradicted" | "not_applicable";
export const EVIDENCE: Record<EvidenceKind, { label: string; mark: string; palette: string; ink: PanelColour; bar?: PanelColour }> = {
  verified: { label: "Met", mark: "✓", palette: "green", ink: "evMet", bar: "barMet" },
  partial: { label: "Partly met", mark: "◐", palette: "orange", ink: "evPartial", bar: "barPartial" },
  not_demonstrated: { label: "Not shown in the CV", mark: "?", palette: "gray", ink: "evMissing", bar: "barMissing" },
  contradicted: { label: "CV says otherwise", mark: "✕", palette: "red", ink: "evContra", bar: "barContra" },
  not_applicable: { label: "Does not apply", mark: "–", palette: "gray", ink: "evMissing" },
};

// Qualifications: what each kind and state is called and its colour (the CV's own words decide which; nothing here is judged).
export type QualType = "degree" | "diploma" | "school" | "certificate" | "other";
export type QualStatus = "completed" | "listed" | "in_progress" | "not_completed" | "not_stated";
export type QualValidity = "current" | "expired" | "unknown";
export const QUALIFICATION = {
  order: ["degree", "diploma", "school", "certificate", "other"] as QualType[],
  typeColour: { degree: "purple", diploma: "blue", school: "teal", certificate: "cyan", other: "gray" } as Record<QualType, string>,
  status: {
    completed: { label: "Completed", colour: "green", rule: "green" }, listed: { label: "Completed (as listed)", colour: "green", rule: "green" },
    in_progress: { label: "In progress", colour: "orange", rule: "orange" }, not_completed: { label: "Not completed", colour: "red", rule: "red" },
    not_stated: { label: "No record of completion", colour: "gray", rule: "gray" },
  } as Record<QualStatus, { label: string; colour: string; rule: string }>,
  // Whether a certificate still stands, kept apart from whether it was finished. Shown only when the CV says (owner, 9 Nov 2026).
  validity: {
    current: { label: "Current", colour: "green", variant: "subtle", why: "The CV states this is still valid. This has not been checked with the issuer." },
    expired: { label: "Expired", colour: "red", variant: "subtle", why: "The CV shows this has expired. It is history and does not meet a requirement for a current certificate." },
    unknown: { label: "Validity unknown", colour: "gray", variant: "outline", why: "The CV does not say whether this is still valid." },
  } as Record<QualValidity, { label: string; colour: string; variant: "subtle" | "outline"; why: string }>,
};

/** Each panel's tabs in order (section headings in Title Case, every one), and each tab's sections in order with their headings and what they say when the document has nothing. A section always
 *  stands in its place, so a panel keeps its shape whatever the document was. "counted" sections make up the tab's count. */
export interface SectionSpec { id: string; title?: string; empty?: string; counted?: boolean }
export interface TabSpec { id: string; label: string; sections: SectionSpec[] }
export const PANEL_LAYOUT: Record<"candidate" | "job", TabSpec[]> = {
  candidate: [
    { id: "overview", label: "Overview", sections: [
      { id: "contact" },
      { id: "summary", title: "Professional Summary", empty: "No summary provided." },
      { id: "notes", title: "Worth Noting", empty: "Nothing further noted in this CV." },
    ] },
    { id: "experience", label: "Experience", sections: [
      { id: "work", title: "Work History", empty: "No work history could be read from this CV. Check the original.", counted: true },
      { id: "projects", title: "Projects and Delivery", empty: "No projects listed in this CV." },
    ] },
    { id: "education", label: "Education", sections: [{ id: "education", title: "Education", empty: "No qualifications found in this CV.", counted: true }] },
    { id: "skills", label: "Skills", sections: [{ id: "skills", title: "Skills", empty: "No skills found in this CV.", counted: true }] },
    { id: "notes", label: "Recruiter notes", sections: [{ id: "recruiter-notes", counted: true }] },
  ],
  job: [
    { id: "overview", label: "Overview", sections: [
      { id: "facts", title: "Key Facts", empty: "The job description gives no location, employment type, pay or reporting line." },
      { id: "summary", title: "Summary", empty: "No summary: the job description has none, and none could be written from it." },
    ] },
    { id: "requirements", label: "Requirements", sections: [
      { id: "requirements", title: "Requirements", empty: "No requirements could be read from this job. Add them before matching.", counted: true },
      { id: "preferred", title: "Advantageous", counted: true },
    ] },
    { id: "responsibilities", label: "Responsibilities", sections: [{ id: "responsibilities", title: "Responsibilities", empty: "No responsibilities found in this job.", counted: true }] },
    { id: "skills", label: "Skills", sections: [
      { id: "skills", title: "Skills", empty: "No skills named in this job.", counted: true },
      { id: "competencies", title: "Competencies", counted: true },
    ] },
    { id: "more", label: "More", sections: [{ id: "extras", title: "Also in the Job Description", empty: "Nothing else in this job description.", counted: true }] },
  ],
};
