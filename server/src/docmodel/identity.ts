// PROTOTYPE, isolated: name and contact ownership read from the document model. Nothing in the running application uses this.
// Every possible value is kept as a candidate with where it came from and every piece of evidence for and against it, and the decision is made from those. Evidence, not rules: a name can also
// be a place or a company, the largest heading can be an agency's, an e-mail address need not resemble its owner, and an agency document can legitimately hold several people. So nothing is
// excluded outright; a value that loses keeps its reasons, and a close call is left blank for a person. Evidence a reader cannot supply is listed as unavailable, not counted against the value.
import { extractionConfig as CFG, identityPatterns } from "../extractionConfig";
import { isPlaceName } from "../geo";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allLines, type DocModel, type Line } from "./model";
import { addressesIn, resolveAddress, resolveNumbers, wholeAddress, wrappedEnd } from "./contactReadings";
import { addressWithDigits } from "../ocr";

interface Evidence { id: string; weight: number }
interface Candidate { value: string; score: number; evidence: Evidence[]; sources: string[] }
type Owner = "candidate" | "agency" | "referee" | "unknown";
interface Contact { kind: "email" | "phone"; value: string; owner: Owner; score: number; evidence: Evidence[]; source: string; /** The readings of this row disagree, so this value is not published. What was read is told to a person. */ uncertain?: string[] }
export interface Decision { value: string; status: "selected" | "abstained"; score?: number; margin?: number; reason?: string; source?: string }
/** Who to speak to when a candidate came through an agency. Only what the document states; a part it does not state stays blank with its reason. */
interface AgencyDetails {
  name: Decision;
  /** The web domain of the agency's own e-mail as printed. Never turned into a name: that would be a guess. */
  domain: string;
  recruiter: { name: Decision; email: Decision; phone: Decision };
  office: { email: Decision; phone: Decision };
  nameCandidates: Candidate[]; recruiterCandidates: Candidate[];
}
export interface Identity {
  name: Decision; email: Decision; phone: Decision; location: Decision;
  nameCandidates: Candidate[]; contacts: Contact[];
  agencyDocument: boolean;
  /** Why it was or was not read as an agency's document: the evidence ids behind that. */
  agencyEvidence: string[];
  /** How the candidate can be reached: "direct" both own e-mail and phone, "partly-direct" one of them, "through-agency" neither but an agency's are given, "none-found" neither and no agency. */
  candidateContact: "direct" | "partly-direct" | "through-agency" | "none-found";
  /** Present only on an agency document. */
  agency?: AgencyDetails;
  unavailableEvidence: string[];
  reader: DocModel["reader"];
}
export interface IdentityOptions { useLayout?: boolean }

const ID = identityPatterns(), W = CFG.evidence.name, CW = CFG.evidence.contact;
const set = (words: string[]) => new Set(words);
const TITLES = set(CFG.evidence.titleWords), ORGS = set(CFG.evidence.organisationWords), HEADINGS = set(CFG.evidence.sectionHeadings), DUTIES = set(CFG.evidence.dutyVerbs), PARTICLES = set(CFG.identity.nameParticles);
const ORDINARY = new Set(readFileSync(join(import.meta.dirname, "ordinaryWords.txt"), "utf8").split("\n"));
export const isOrdinary = (w: string) => ORDINARY.has(w) || [w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ed$/, ""), w.replace(/d$/, ""), w.replace(/ing$/, ""), w.replace(/ing$/, "e"), w.replace(/([a-z])\1ing$/, "$1")].some((x) => x !== w && ORDINARY.has(x));
/** At least seven letters, not a common word, and one letter from one: a misreading is far likelier than a name. */
const oneLetterFromAWord = (word: string) => { const w = word.toLowerCase(); if (w.length < 7 || !/^[a-z]+$/.test(w) || isOrdinary(w)) return false; for (let i = 0; i <= w.length; i++) { if (i < w.length && ORDINARY.has(w.slice(0, i) + w.slice(i + 1))) return true; for (let c = 97; c <= 122; c++) { const l = String.fromCharCode(c); if (i < w.length && ORDINARY.has(w.slice(0, i) + l + w.slice(i + 1))) return true; if (ORDINARY.has(w.slice(0, i) + l + w.slice(i))) return true; } } return false; };
const flat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean);
const lowerWords = (s: string) => wordsOf(s).map((w) => w.toLowerCase().replace(/[^\p{L}'’-]/gu, ""));
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
const PHONE = /(?<![\d/-])\(?(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?(?![\d/-])/g;
// An employment entry's dates, not any date ("Date: 12 May 2024" on a form says nothing about the line above it).
const EMPLOYMENT_DATES = /(?:(?:19|20)\d{2}(?:-\d{2})?|\d{1,2}[/.-](?:19|20)\d{2})\s*(?:-|–|—|to|until)\s*(?:(?:[a-z]+\s*)?(?:19|20)\d{2}|present|current|date|now)|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:19|20)\d{2}\s*(?:-|–|—|to)/i;
const NOT_PHONE = /\b(id|identity|passport|licen[sc]e|registration|vat|tax|account|dob|born|birth)\b/i;
const LETTER_SPACED = /^(?:\p{L}{1,2}\s+){3,}\p{L}{1,2}$/u;
// Word by word, since a surname alone may be in capitals ("Tumelo HLONGWANE"). Two capitals are initials ("JP Smith") unless the whole name is in capitals.
const shoutingToTitle = (s: string) => { const titled = (w: string) => w.toLowerCase().replace(/(^|['’-])\p{L}/gu, (c) => c.toUpperCase()); return s.split(/(\s+)/).map((w) => (/^\p{Lu}[\p{Lu}'’-]+$/u.test(w) && (s === s.toUpperCase() || w.length >= 3) ? titled(w) : w)).join(""); };
/** Where the referees are: from the References heading to the next section's heading. Contact details printed after them are the person's own. */
const referencesRange = (lines: { text: string }[]) => {
  const at = lines.findIndex((l) => /^references?\b/i.test(l.text.trim()) && l.text.length < 30);
  if (at < 0) return () => false;
  const next = lines.findIndex((l, k) => k > at && HEADINGS.has(l.text.trim().toLowerCase().replace(/[:\s]+$/, "")) && !/^references?\b/i.test(l.text.trim())), end = next < 0 ? Infinity : next;
  return (i: number) => i > at && i < end;
};
const AGENCY_TERMS_HEAD = /^([\p{Lu}][\p{Lu}\s&.'-]{2,40}?)\s+TERMS AND CONDITIONS\s*$/u, AGENCY_TERMS_SENTENCE = /\bacceptance of\s+(\p{Lu}[\p{L}\s&.-]{2,40}?)['’]s standard terms\b/u;
const lookLikeName = (s: string) => { const w = wordsOf(s); return w.length >= 1 && w.length <= 6 && s.length <= 60 && !/[@\d]/.test(s) && /^[\p{L}\s'’.()-]+$/u.test(s); };
const capitalised = (s: string) => wordsOf(s).every((w) => /^\p{Lu}/u.test(w) || PARTICLES.has(w));
const titleLike = (s: string) => lowerWords(s).some((w) => TITLES.has(w));

/** An address broken across two lines by a narrow column: the first part ends the line above ("anathiramos." / "502@candidate.example"), or the last part starts the next ("...@candidate.exam" / "ple"). Only when the other line is nothing but that fragment's shape. */
function rejoinBrokenAddresses(lines: Line[]): Line[] {
  return lines.map((l, i) => {
    const m = l.text.match(/(^|\s)([A-Z0-9._%+-]*)@([A-Z0-9-]+(?:\.[A-Z0-9-]+)+)(?=\s|$)/i);
    if (!m) return l;
    let text = l.text;
    const before = lines[i - 1]?.text.trim() ?? "", near = lines.slice(i + 1, i + 5).map((x) => x.text.trim()), after = near.find((x) => /^[a-z]{1,6}$/.test(x)) ?? near[0] ?? "";   // rows beside the address can fall between it and its last letters
    const end = wrappedEnd(`${m[2]}@${m[3]}`, near);   // anything may sit beside it on the row; a real domain is the evidence the two pieces are one
    if (end) return { ...l, text: text.replace(`${m[2]}@${m[3]}`, `${m[2]}@${m[3]}${end}`) };
    const tail = before.match(/(?:^|\s)([A-Za-z0-9_-]+[._-])$/)?.[1];
    if (m.index === 0 || m[1] === "") if (/^\d*$/.test(m[2]) && tail) text = tail + text;
    if (text.endsWith(`${m[2]}@${m[3]}`) && /^[a-z]{1,6}$/.test(after) && !["com", "net", "org"].includes(m[3].split(".").at(-1)!) && m[3].split(".").at(-1)!.length >= 1 && !/\.(?:za|uk|za\.|co)$/.test(m[3])) text += after;
    return text === l.text ? l : { ...l, text };
  });
}

function contactOwnership(rawLines: Line[], name: string): Contact[] {
  const lines = rejoinBrokenAddresses(rawLines), out: Contact[] = [];
  const firstHeading = lines.findIndex((l) => HEADINGS.has(l.text.toLowerCase().replace(/[:\s]+$/, "")) && !/^(?:contact|contact details|details|personal details|profile|summary|career profile|curriculum vitae|resume|cv|disclaimer)$/i.test(l.text.trim()));
  const inReferencesAt = referencesRange(lines);
  const blockAt = lines.findIndex((l) => /\bplease contact\b|\bcontact:\s*$/i.test(l.text) && /candidate|interview|meeting/i.test(l.text));
  const nameIdx = name ? lines.findIndex((l) => flat(l.text).includes(flat(name))) : -1, nameWords = lowerWords(name).map(flat).filter((w) => w.length >= 3);
  // The same number on three or more pages is page furniture: usually the organisation's footer, unless the person's own name is with it.
  const pagesWith = new Map<string, Set<number>>(), withName = new Map<string, number>(), digits = (s: string) => s.replace(/\D/g, "");
  for (const l of lines) for (const m of l.text.matchAll(PHONE)) { const k = digits(m[0]).slice(-7); if (k.length === 7) { (pagesWith.get(k) ?? pagesWith.set(k, new Set()).get(k)!).add(l.page); if (nameWords.some((w) => flat(l.text).includes(w))) withName.set(k, (withName.get(k) ?? 0) + 1); } }
  // Where the candidate's own address is, so a phone number beside it counts as theirs.
  const ownAddressAt = lines.map((l, i) => { const m = l.text.match(EMAIL); EMAIL.lastIndex = 0; return m && !ID.agencyLabelValue.test(l.text.trim()) && !ID.agencyLabelOnly.test(lines[i - 1]?.text.trim() ?? "") && !/\bfax\b/i.test(l.text) && !(blockAt >= 0 && i > blockAt && i <= blockAt + 8 && lines[blockAt].page === l.page) && !(inReferencesAt(i)) ? i : -1; }).filter((i) => i >= 0);
  lines.forEach((line, i) => {
    const prior = lines[i - 1]?.text.trim() ?? "", text = line.text;
    let uncertain: string[] | undefined;
    const onLine = (kind: Contact["kind"], value: string, at: number) => {
      const ev: Evidence[] = [{ id: "base", weight: CW.base }], agency: Evidence[] = [], referee: Evidence[] = [];
      if (ID.agencyLabelValue.test(text.trim()) || ID.agencyLabelOnly.test(prior)) agency.push({ id: "agencyLabel", weight: CW.agencyLabel });
      if (blockAt >= 0 && i > blockAt && i <= blockAt + 8 && lines[blockAt].page === line.page) agency.push({ id: "agencyBlock", weight: CW.agencyBlock });
      const locals = (text.match(EMAIL) ?? []).map((e) => flat(e.split("@")[0])); EMAIL.lastIndex = 0;   // a phone on the same line as the person's own address is theirs too
      const carries = locals.some((local) => nameWords.some((w) => local.includes(w)));
      if (/\bfax\b/i.test(text) && !carries) agency.push({ id: "letterhead", weight: CW.letterhead });
      const numberKey = digits(value).slice(-7);
      if (kind === "phone" && (pagesWith.get(numberKey)?.size ?? 0) >= 3 && !withName.get(numberKey)) agency.push({ id: "repeatedOnPages", weight: CW.repeatedOnPages });
      if (kind === "phone" && ownAddressAt.some((k) => Math.abs(k - i) <= 3)) ev.push({ id: "nearOwnAddress", weight: CW.nearOwnAddress });
      if (inReferencesAt(i) || /\breferee\b|\breference\b/i.test(text)) referee.push({ id: "referee", weight: CW.referee });
      if (carries) ev.push({ id: "carriesName", weight: CW.carriesName });
      if (nameIdx >= 0 && Math.abs(i - nameIdx) <= 5) ev.push({ id: "nearName", weight: CW.nearName });
      if (firstHeading < 0 || i < firstHeading) ev.push({ id: "beforeFirstSection", weight: CW.beforeFirstSection });
      const sum = (e: Evidence[]) => e.reduce((a, x) => a + x.weight, 0), c = sum(ev), a = sum(agency), r = sum(referee);
      // A tie goes to the referee: under References, a shared first name is not enough to make someone the candidate.
      const owner: Owner = a > c && a >= r ? "agency" : r > 0 && r >= c ? "referee" : c >= 2 ? "candidate" : "unknown";
      out.push({ kind, value, owner, score: Math.round(Math.max(c, a, r) * 10) / 10, evidence: [...ev, ...agency, ...referee], source: line.id, ...(uncertain ? { uncertain } : {}) });
      void at;
    };
    // A row read more than once is decided from all its readings. A row read once, or not by OCR, is taken as printed.
    if (line.readings?.length) {
      const fullName = nameWords.filter((w) => /^[a-z]+$/.test(w)), email = resolveAddress(line.readings, fullName, oneLetterFromAWord);
      if (email) { uncertain = email.value ? undefined : [...email.readings, ...email.rejected]; onLine("email", addressWithDigits(withoutGluedStart(email.value || (email.readings[0] ?? email.rejected[0] ?? ""), nameWords)), 0); }
      if (!NOT_PHONE.test(text)) for (const n of resolveNumbers(line.readings)) { uncertain = n.value ? undefined : n.readings; onLine("phone", n.value || n.readings[0], 0); }
      uncertain = undefined;
      return;
    }
    // An address with no real ending has lost its end, whichever reader saw it. It is reported, not published.
    for (const m of text.matchAll(EMAIL)) { const value = withoutGluedStart(m[0].toLowerCase(), nameWords); uncertain = wholeAddress(value) ? undefined : [value]; onLine("email", value, m.index ?? 0); }
    uncertain = undefined;
    if (!NOT_PHONE.test(text)) for (const m of text.matchAll(PHONE)) { const d = m[0].replace(/\D/g, ""); if (d.length >= 9 && d.length <= 12 && !/^(?:19|20)\d{2}\D+(?:19|20)\d{2}$/.test(m[0].trim())) onLine("phone", m[0].trim(), m.index ?? 0); }
  });
  return out;
}

/** OCR can lose the separator before an address, joining a label or a town to it. Only removed when what follows holds a word of the person's own name, so "durbanjobs@" stays as printed. Experiment X3. */
export function withoutGluedStart(address: string, nameWords: string[]): string {
  const at = address.indexOf("@"); if (at < 8) return address;
  const local = address.slice(0, at), own = nameWords.filter((w) => /^[a-z]{3,}$/.test(w));
  if (!own.length) return address;
  for (let k = 3; k <= Math.min(20, local.length - 3); k++) {
    const start = local.slice(0, k), rest = local.slice(k);
    if (own.some((w) => start.includes(w)) || !own.some((w) => rest.startsWith(w))) continue;
    if (/^(?:email|e-mail|mail|contact)$/.test(start) || isPlaceName(start)) return rest + address.slice(at);
  }
  return address;
}

const AW = CFG.evidence.agencyName, RW = CFG.evidence.recruiter, FREE_MAIL = set(CFG.agency.freeMail), BUSINESS = new RegExp(`\\b(?:${CFG.agency.businessWords.join("|")})\\b`, "i"), PREPARED_BY = new RegExp(`^(?:${CFG.agency.preparedBy.join("|")})\\s+by\\s*[:|–-]\\s*(.+)$`, "i");
/** The agency and the recruiter are read the way the candidate is: candidates with evidence, select or leave blank. A contact is the recruiter's when it was labelled or listed as theirs, the office's when it comes from a letterhead or a repeated footer. */
function readAgency(model: DocModel, rawLines: Line[], contacts: Contact[], candidateName: string): AgencyDetails {
  const lines = rejoinBrokenAddresses(rawLines), mine = contacts.filter((c) => c.owner === "agency"), has = (c: Contact, ...ids: string[]) => c.evidence.some((e) => ids.includes(e.id));
  const personal = mine.filter((c) => has(c, "agencyLabel", "agencyBlock")), office = mine.filter((c) => !has(c, "agencyLabel", "agencyBlock"));
  const first = (list: Contact[], kind: Contact["kind"], who: string): Decision => { const c = list.find((x) => x.kind === kind); return c ? { value: c.value, status: "selected", score: c.score, source: c.source } : { value: "", status: "abstained", reason: `no ${kind === "email" ? "address" : "number"} given as the ${who}'s` }; };
  const domains = mine.filter((c) => c.kind === "email").map((c) => c.value.split("@")[1] ?? "").filter((d) => d && !FREE_MAIL.has(d.split(".")[0])), domain = domains[0] ?? "", stem = flat(domain.split(".")[0] ?? "");
  const recruiterMails = personal.filter((c) => c.kind === "email").map((c) => flat(c.value.split("@")[0]));
  const blockAt = lines.findIndex((l) => /\bplease contact\b|\bcontact:\s*$/i.test(l.text) && /candidate|interview|meeting/i.test(l.text)), inBlock = (i: number) => blockAt >= 0 && i > blockAt && i <= blockAt + 8 && lines[blockAt].page === lines[i].page;
  const pagesOf = new Map<string, Set<number>>(); for (const l of lines) { const k = flat(l.text); if (k) (pagesOf.get(k) ?? pagesOf.set(k, new Set()).get(k)!).add(l.page); }
  const people = new Map<string, Candidate>(), firms = new Map<string, Candidate>(), candidate = flat(candidateName);
  const indexOfLine = new Map(lines.map((l, k) => [l.id, k])), letterheadAt = new Set(mine.filter((c) => has(c, "letterhead")).map((c) => indexOfLine.get(c.source) ?? -1)), repeatedAt = new Set(mine.filter((c) => has(c, "repeatedOnPages")).map((c) => indexOfLine.get(c.source) ?? -1));
  const keep = (into: Map<string, Candidate>, value: string, line: Line, ev: Evidence[]) => { const k = flat(value), score = Math.round(ev.reduce((a, e) => a + e.weight, 0) * 10) / 10, had = into.get(k); if (!had || score > had.score) into.set(k, { value, score, evidence: ev, sources: [...new Set([line.id, ...(had?.sources ?? [])])] }); else had.sources.push(line.id); };
  const person = (raw: string, line: Line, base: Evidence[]) => {
    const value = shoutingToTitle(raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()), low = lowerWords(value), parts = low.map(flat).filter((w) => w.length >= 3);
    if (!lookLikeName(value) || !capitalised(value) || /^(?:name|number|phone|email|e-mail|contact|details)$/i.test(value)) return;
    const ev = [...base];
    if (low.length >= 2 && low.length <= 3) ev.push({ id: "twoOrThreeWords", weight: RW.twoOrThreeWords });
    if (parts.length && recruiterMails.some((m) => parts.some((w) => m.includes(w)))) ev.push({ id: "matchesTheirMail", weight: RW.matchesTheirMail });
    if (low.some((w) => TITLES.has(w))) ev.push({ id: "titleWord", weight: RW.titleWord });
    if (low.some((w) => ORGS.has(w)) || BUSINESS.test(value)) ev.push({ id: "organisationWord", weight: RW.organisationWord });
    if (candidate && flat(value) === candidate) ev.push({ id: "sameAsCandidate", weight: RW.sameAsCandidate });
    keep(people, value, line, ev);
  };
  const firm = (raw: string, line: Line, i: number, base: Evidence[]) => {
    // A name beside what a form prints after it: "Xcede Consultants Interview Feedback", "The Career Consortium (+27) 861".
    const value = raw.replace(/\s*\(?\+?\d[\d\s()-]{6,}.*$/, "").replace(new RegExp(`\\s+(?:${CFG.evidence.afterAgencyName.join("|")})\\s*$`, "i"), "").replace(/^[©\s|:–—-]+|[\s|:–—-]+$/g, "").replace(/\s+/g, " ").trim(), low = lowerWords(value);
    if (value.length < 3 || value.length > 60 || /[@\d]/.test(value) || /\.$/.test(value) || low.length > 7 || !/^\p{Lu}/u.test(value)) return;
    const ev = [...base], y = line.box && model.pages[0]?.height && line.page === 1 ? line.box.y0 / model.pages[0].height : null;
    if (stem.length >= 3 && (flat(value).includes(stem) || low.some((w) => flat(w).length >= 4 && stem.includes(flat(w))))) ev.push({ id: "matchesAgencyMail", weight: AW.matchesAgencyMail });
    if (BUSINESS.test(value)) ev.push({ id: "businessWord", weight: AW.businessWord });
    if (low.some((w) => ORGS.has(w))) ev.push({ id: "organisationWord", weight: AW.organisationWord });
    if (letterheadAt.has(i + 1)) ev.push({ id: "aboveLetterhead", weight: AW.aboveLetterhead });
    if (ev.length === base.length && !base.length) return;   // nothing says this line is an organisation at all
    if (inBlock(i)) ev.push({ id: "inContactBlock", weight: AW.inContactBlock });
    if ((pagesOf.get(flat(line.text))?.size ?? 0) >= 3) ev.push({ id: "onEveryPage", weight: AW.onEveryPage });
    if (y !== null ? y < 0.12 : line.page === 1 && i < 3) ev.push({ id: "atTop", weight: AW.atTop });
    if (candidate && flat(value) === candidate) ev.push({ id: "sameAsCandidate", weight: AW.sameAsCandidate });
    keep(firms, value, line, ev);
  };
  lines.forEach((line, i) => {
    const t = line.text.trim(), prior = lines[i - 1]?.text.trim() ?? "", labelled = t.match(/^(.+?)\s*[:|]\s*(.+)$/);
    // A form that says so outright: "CANDIDATE NAME: ... PRESENTED BY: AFFIRMATIVE PORTFOLIOS".
    // Or says whose terms apply: "AFFIRMATIVE PORTFOLIOS TERMS AND CONDITIONS", "acceptance of Network Recruitment's standard terms".
    const presented = t.match(/\bpresented by\s*:\s*(.{3,60})$/i) ?? t.match(AGENCY_TERMS_HEAD) ?? t.match(AGENCY_TERMS_SENTENCE); if (presented) { firm(presented[1], line, i, [{ id: "labelled", weight: AW.labelled }]); return; }
    if (ID.agencyLabelValue.test(t) && labelled) {
      const value = labelled[2].trim(), isFirm = /^(?:recruitment\s+)?agency\b|\b(?:agency|company)\s*(?:name)?$/i.test(labelled[1]);
      if (isFirm) firm(value, line, i, [{ id: "labelled", weight: AW.labelled }]);
      else if (!/\b(?:number|phone|telephone|tel|mobile|cell|e-?mail)\b/i.test(labelled[1])) person(value, line, [{ id: "labelled", weight: RW.labelled }]);
    } else if (ID.agencyLabelOnly.test(prior) && !/\b(?:number|phone|telephone|tel|mobile|cell|e-?mail)\b/i.test(prior)) {
      if (/\bagency\b/i.test(prior)) firm(t, line, i, [{ id: "labelled", weight: AW.labelled }]); else person(t, line, [{ id: "labelled", weight: RW.labelled }]);
    } else if (inBlock(i)) {
      person(t, line, [{ id: "inContactBlock", weight: RW.inContactBlock }]);
    }
    const prepared = t.match(PREPARED_BY);
    if (prepared) person(prepared[1].trim(), line, [{ id: "preparedBy", weight: RW.preparedBy }]);
    // A footer usually says whose number it is: the words before a number repeated on page after page.
    if (repeatedAt.has(i)) { const before = t.match(/^(.*?)\s*\(?\+?\d/)?.[1]; if (before) firm(before, line, i, [{ id: "beforeRepeatedNumber", weight: AW.beforeRepeatedNumber }]); }
    for (const part of t.split("|")) firm(part, line, i, []);
  });
  const order = new Map(lines.map((l, k) => [l.id, k])), orderOf = (s: string) => order.get(s) ?? 1e9, nameList = [...firms.values()].sort((a, b) => b.score - a.score).filter((c, k, all) => !all.slice(0, k).some((x) => flat(x.value).includes(flat(c.value)) || flat(c.value).includes(flat(x.value)))), peopleList = [...people.values()].sort((a, b) => b.score - a.score);
  return { name: pick(nameList, orderOf), domain, recruiter: { name: pick(peopleList, orderOf), email: first(personal, "email", "recruiter"), phone: first(personal, "phone", "recruiter") }, office: { email: first(office, "email", "office"), phone: first(office, "phone", "office") }, nameCandidates: nameList.slice(0, 6), recruiterCandidates: peopleList.slice(0, 6) };
}

const LOCATION_LABEL = /^(?:residential area|residential address|home address|area|location|address|city|based in|residence|current location)\s*[:|-]\s*(.+)$/i;
/** Where the candidate is, from their own contact lines only: an agency's or referee's address is never theirs. A piece beside their own e-mail or phone, or a labelled line, or a known place near the top. */
/** A place is a name: words that are not capitalised, beyond the small ones names can hold, or a full stop inside, make it a piece of a sentence from the column beside. */
export const couldBePlace = (value: string) => !/[.!?]\s/.test(value) && !wordsOf(value).some((w) => /^\p{Ll}/u.test(w) && !/^(?:de|la|le|du|van|von|der|den|of|on|the|upon|and)$/.test(w));
function readLocation(rawLines: Line[], contacts: Contact[], name: string): Decision {
  const lines = rejoinBrokenAddresses(rawLines), elsewhere = new Set(contacts.filter((c) => c.owner === "agency" || c.owner === "referee").map((c) => c.source)), own = new Set(contacts.filter((c) => c.owner === "candidate").map((c) => c.source));
  const person = flat(name), found: Candidate[] = [], nameWords = lowerWords(name).map(flat);
  const offer = (raw: string, line: Line, ev: Evidence[]) => {
    const value = raw.replace(/\s+/g, " ").replace(/^[,;\s]+|[,;\s]+$/g, "");
    if (!value || value.length > 60 || wordsOf(value).length > 6 || /[@]|https?:|www\.|linkedin/i.test(value) || !/^\p{Lu}/u.test(value) || flat(value) === person) return;
    if (!couldBePlace(value)) return;
    if (/:$/.test(value) || value.replace(/[^\d]/g, "").length > 4 || ID.formWord.test(value) || titleLike(value) || lowerWords(value).every((w) => nameWords.includes(flat(w)))) return;
    const e = [...ev]; if (isPlaceName(value) || isPlaceName(value.split(",")[0])) e.push({ id: "knownPlace", weight: 2 });
    found.push({ value, score: e.reduce((a, x) => a + x.weight, 0), evidence: e, sources: [line.id] });
  };
  const firstHeading = lines.findIndex((l) => HEADINGS.has(l.text.toLowerCase().replace(/[:\s]+$/, "")) && !/^(?:contact|contact details|details|personal details)$/i.test(l.text.trim()));
  lines.forEach((l, i) => {
    if (elsewhere.has(l.id)) return;
    const t = l.text.trim(), labelled = t.match(LOCATION_LABEL);
    // "Location: Durban" under a role is where that role was. Where the person lives is at the top, or among their personal details, wherever those are.
    let under = ""; if (labelled) for (let k = i - 1; k >= 0; k--) { const h = lines[k].text.toLowerCase().replace(/[:\s]+$/, ""); if (HEADINGS.has(h)) { under = h; break; } }
    if (labelled && under && !/personal|contact|details|about/.test(under)) return;
    if (labelled) { offer(labelled[1].replace(/^[|\s]+/, "").split("|")[0], l, [{ id: "labelled", weight: 5 }]); return; }
    if (own.has(l.id)) for (const piece of t.split(/\s*[|•·;]\s*/)) if (!EMAIL.test(piece) && !/\d{3}/.test(piece)) { EMAIL.lastIndex = 0; offer(piece, l, [{ id: "besideOwnContact", weight: 4 }]); }
    EMAIL.lastIndex = 0;
    if ((firstHeading < 0 ? i < 8 : i < firstHeading) && isPlaceName(t.split(",")[0])) offer(t, l, [{ id: "nearTop", weight: 2 }]);
    // on the line next to the person's own contact details, where a header stacks them
    else if ((own.has(lines[i + 1]?.id ?? "") || own.has(lines[i - 1]?.id ?? "")) && isPlaceName(t.split(",")[0])) offer(t, l, [{ id: "besideOwnContact", weight: 2 }]);
  });
  const best = found.sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 3 ? { value: best.value, status: "selected", score: best.score, source: best.sources[0] } : { value: "", status: "abstained", reason: "none beside the candidate's own contact details" };
}

/** "CURRICULUM Simphiwe Mashiane" with VITAE on the next line: a form's words printed beside a name are not part of it. At least two words must be left. */
function withoutFormWordsAtEdges(value: string): string {
  const words = wordsOf(value), isForm = (w: string) => ID.formWord.test(w);
  while (words.length > 2 && isForm(words[0])) words.shift();
  while (words.length > 2 && isForm(words[words.length - 1])) words.pop();
  return words.join(" ");
}
/** OCR can split a word or leave a stray mark, and the person's own address shows what the name really is: "Lese di Manyathi" with lesedimanyathi@, "RE Rochelle Domingo" with rochelledomingo@. Only spaces and stray marks change, never a letter of the name. */
function nameAgainstAddress(value: string, ownEmails: string[]): string {
  if (!value) return value;
  const words = wordsOf(value), carried = (ws: string[]) => ownEmails.some((e) => ws.length >= 2 && e.startsWith(ws.map(flat).join("")));
  if (words.length >= 3 && /^\p{Lu}{1,3}$/u.test(words[0]) && carried(words.slice(1))) return words.slice(1).join(" ");
  const joined: string[] = []; for (const w of words) { if (joined.length && /^\p{Ll}/u.test(w)) joined[joined.length - 1] += w; else joined.push(w); }
  return joined.length >= 2 && joined.length < words.length && carried(joined) ? joined.join(" ") : value;
}
function nameCandidates(model: DocModel, lines: Line[], useLayout: boolean): { list: Candidate[]; unavailable: string[] } {
  // What the file stores last can be printed first, so all of page one is considered wherever it falls in reading order.
  const first = model.pages[0]?.lines ?? [], top = [...new Set([...lines.slice(0, 70), ...first])], unavailable: string[] = [];
  const hasHeight = useLayout && first.some((l) => l.relativeHeight !== undefined), hasSize = useLayout && first.some((l) => l.style.sizePt !== undefined), hasBold = useLayout && !model.missing.includes("bold");
  if (!hasHeight && !hasSize) unavailable.push("text height"); if (!hasBold) unavailable.push("bold");
  const measure = (l: Line) => (hasHeight ? l.relativeHeight ?? 0 : hasSize ? l.style.sizePt ?? 0 : 0);
  const heights = first.map(measure).sort((a, b) => b - a), tallest = heights[0] ?? 0, typical = heights[Math.floor(heights.length / 2)] ?? 0;
  const distinct = [...new Set(heights)];
  const body = lines.map((l) => l.text);
  const ownEmails = [...new Set(lines.filter((l, i) => !ID.agencyLabelValue.test(l.text.trim()) && !ID.agencyLabelOnly.test(lines[i - 1]?.text.trim() ?? "") && !/\bfax\b/i.test(l.text)).flatMap((l) => [...(l.text.match(EMAIL) ?? []), ...[l.text, ...(l.readings ?? [])].flatMap(addressesIn)]))].map((e) => flat(e.split("@")[0]));
  const slugs = lines.flatMap((l) => [...l.text.matchAll(/linkedin\.[a-z.]+\/in\/([a-z0-9-]+)/gi)].map((m) => flat(m[1])));
  const blockAt = lines.findIndex((l) => /\bplease contact\b|\bcontact:\s*$/i.test(l.text) && /candidate|interview|meeting/i.test(l.text));
  const inReferencesAt = referencesRange(lines);
  const linkWords = lines.flatMap((l, k) => [...`${l.text} ${lines[k + 1]?.text ?? ""}`.matchAll(/linkedin\.[a-z.]+\/in\/([a-z]+)-([a-z]+)/gi)].map((m) => [flat(m[1]), m[2]]));
  const pageHeight = model.pages[0]?.height, hasPosition = useLayout && !!pageHeight && first.some((l) => l.box);
  const whereOnPage = (l: Line) => (hasPosition && l.page === 1 && l.box ? l.box.y0 / pageHeight! : null);
  const found = new Map<string, Candidate>();
  const indexOf = new Map(lines.map((l, k) => [l.id, k]));
  const add = (raw: string, line: Line, _i: number, base: Evidence[], opts: { label?: boolean } = {}) => {
    const i = indexOf.get(line.id) ?? _i;
    const cleaned = withoutFormWordsAtEdges(raw.replace(/\([^)]*\)/g, " ").replace(/^[|\s:–—-]+|[|\s:–—-]+$/g, "").replace(/\s+/g, " ").trim());
    // A sentence is not a name: a capital, then ordinary words in lower case, or a full stop after a whole word. A name may be all lower case, or carry initials and particles.
    const nameWords = wordsOf(cleaned), sentenceShaped = /\p{L}{2,}\.$/u.test(cleaned) || (nameWords.length >= 2 && /^\p{Lu}/u.test(nameWords[0]) && nameWords.slice(1).some((w) => /^\p{Ll}+$/u.test(w) && !PARTICLES.has(w)));
    if (!lookLikeName(cleaned) || sentenceShaped || /^\p{Ll}\p{L}*(?:\s+\p{L}+)*\.$/u.test(cleaned) || PARTICLES.has(lowerWords(cleaned).at(-1) ?? "")) return;
    const value = shoutingToTitle(cleaned), low = lowerWords(cleaned), ev: Evidence[] = [...base], push = (id: string) => ev.push({ id, weight: W[id] });
    if (low.length >= 2 && low.length <= 3) push("twoOrThreeWords"); if (low.length === 1) push("oneWord");
    if (!opts.label) {
      // Where it is printed when that is known, otherwise where it comes in the reading order.
      const y = whereOnPage(line);
      if (y !== null ? y < 0.12 : line.page === 1 && i < 3) push("firstLines"); else if (y !== null ? y < 0.3 : line.page === 1 && i < 10) push("nearTop");
      const h = line.page === 1 ? measure(line) : 0;   // heights are only compared within page one
      if (h && tallest > typical) { if (h === tallest) { push("tallest"); if (whereOnPage(line) !== null ? whereOnPage(line)! < 0.3 : i < 3) push("tallestAtTop"); } else if (distinct.indexOf(h) === 1 && h > typical) push("nearlyTallest"); }
      if (hasBold && line.style.bold) push("bold");
    }
    const f = flat(cleaned), parts = low.map(flat).filter((w) => w.length >= 3);
    if (parts.length >= 2 && ownEmails.some((e) => parts.every((w) => e.includes(w)))) push("emailAllWords"); else if (parts.some((w) => ownEmails.some((e) => e.includes(w)))) push("emailSomeWord");
    if (parts.length && slugs.some((s) => parts.some((w) => s.includes(w)))) push("linkSlug");
    // Away from the top of the first page, a line is a person only if something says so: its own label, the person's own address or link, or being the tallest line on page one. Being short and capitalised says nothing there.
    if (!opts.label && !ev.some((e) => ["firstLines", "nearTop", "tallest", "labelledCandidate", "summaryHeading", "emailAllWords", "linkSlug", "restoredFromLink"].includes(e.id))) push("awayFromTop");
    if (parts.some((w) => body.filter((t, k) => k !== i && !t.includes("@") && new RegExp(`^${w}\\b|[.!?]\\s+${w}\\b`, "i").test(t.normalize("NFD").replace(/[̀-ͯ]/g, ""))).length >= 1)) push("usedInBody");
    const next = lines[i + 1]?.text.trim() ?? "";
    if (next && next.length <= 70 && titleLike(next) && !/[.;]$/.test(next) && !titleLike(cleaned)) push("aboveTitle");
    if (next && (EMAIL.test(next) || /(?:\+?\d[\d\s()-]{8,})/.test(next))) push("aboveContact"); EMAIL.lastIndex = 0;
    // Against. All are weights: a person called Paris, or a surname that is also a job, can still win on other evidence.
    if (ID.formWord.test(cleaned)) push("formWord");
    if (low.some((w) => TITLES.has(w))) push("titleWord");
    if (low.some((w) => ORGS.has(w)) || BUSINESS.test(cleaned)) push("organisationWord");
    if (HEADINGS.has(low.join(" "))) push("sectionHeading");
    else if (low.some((w) => HEADINGS.has(w))) push("headingWord");   // OCR mangles headings: "Xperience Profile"
    if (low.length && low.every((w) => flat(w).length < 2)) push("lettersOnly");
    if (/\.$/.test(cleaned) || !capitalised(cleaned)) push("sentence");
    if (isPlaceName(cleaned)) push("wholeIsPlace");
    // Layout says where a line is, not who it is: "Application Form" is as tall as a name. People's names can be ordinary words too, so this is a weight that their own address or link can outweigh.
    const spoken = low.map(flat).filter((w) => w.length >= 2);
    if (spoken.length && spoken.every((w) => isOrdinary(w) || isPlaceName(w))) { if (ev.some((e) => e.id === "emailAllWords")) ev.push({ id: "ordinaryWords", weight: 0 }); else push("ordinaryWords"); }
    const isTallest = line.page === 1 && tallest > typical && measure(line) === tallest;
    if ((lines[i - 1]?.text.trim() ?? "").endsWith(":") && !opts.label && !isTallest) push("answerToLabel");   // "Working preference:" / "Office based", but not a name set large under "Curriculum vitae of:"
    if (!opts.label && (EMPLOYMENT_DATES.test(line.text) || EMPLOYMENT_DATES.test(next))) push("beside_dates");
    if (ID.agencyLabelOnly.test(lines[i - 1]?.text.trim() ?? "") || ID.agencyLabelValue.test(line.text.trim())) push("otherPersonLabel");
    if (blockAt >= 0 && i > blockAt && i <= blockAt + 8 && !opts.label) push("agencyBlock");
    if (DUTIES.has(low[0])) push("dutyVerb");
    if (inReferencesAt(i)) push("inReferences");
    // The order two words belong in, where the person's own address gives it: "Smith" over "Jessica", with jessicasmith@ in the document. Otherwise as printed.
    const twoWords = wordsOf(value), reversedInEmail = twoWords.length === 2 && ownEmails.some((e) => e.startsWith(flat(twoWords[1]) + flat(twoWords[0])));
    if (reversedInEmail) { const swapped = `${twoWords[1]} ${twoWords[0]}`, key2 = flat(swapped), score2 = ev.reduce((a, e) => a + e.weight, 0); ev.push({ id: "orderFromEmail", weight: 0 }); const prev = found.get(key2); if (!prev || score2 > prev.score) found.set(key2, { value: swapped, score: Math.round(score2 * 10) / 10, evidence: ev, sources: [...new Set([...(prev?.sources ?? []), line.id])] }); return; }
    const key = flat(cleaned), score = ev.reduce((a, e) => a + e.weight, 0), had = found.get(key);
    if (!had || score > had.score) found.set(key, { value, score: Math.round(score * 10) / 10, evidence: ev, sources: [...new Set([...(had?.sources ?? []), line.id])] });
    else had.sources = [...new Set([...had.sources, line.id])];
    void f;
  };
  top.forEach((line, i) => {
    const t = line.text.trim();
    const given = t.match(ID.givenLabel), surname = t.match(ID.surnameLabel);
    if (given) {
      const sur = top.slice(i + 1, i + 4).map((x) => x.text.trim().match(ID.surnameLabel)?.[1]).find(Boolean);
      const v = given[1].replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      add(sur && !flat(v).includes(flat(sur)) ? `${v} ${sur}` : v, line, i, [{ id: "labelledCandidate", weight: W.labelledCandidate }], { label: true });
      return;
    }
    if (surname) return;
    // An address and the name share a row, with no gap to make a bar of: what is left without the address is offered, and the address itself is the evidence.
    if (t.includes("@") && !t.includes("|")) { const rest = t.replace(/\S*@\S*/g, " ").replace(/\s+/g, " ").trim(); if (rest) add(rest, line, i, []); return; }
    const heading = t.match(ID.summaryHeading);
    if (heading) { add(heading[1], line, i, [{ id: "summaryHeading", weight: W.summaryHeading }], { label: true }); return; }   // where the heading sits is no evidence for what follows the dash
    if (t.includes("|")) {
      const parts = t.split("|").map((x) => x.trim()).filter(Boolean), beside = parts.slice(1).some((x) => /\S+@\S+/.test(x) || (/^[+\d\s()-]+$/.test(x) && x.replace(/\D/g, "").length >= 9));
      if (parts.length === 2 && parts.every((p) => /^\p{Lu}[\p{L}'’-]+$/u.test(p))) add(parts.join(" "), line, i, []);   // OCR reads a column rule as a bar: "Wandile | Sayed"
      if (parts[0]) add(parts[0], line, i, beside ? [{ id: "besideContact", weight: W.besideContact }] : []);
      return;
    }
    if (LETTER_SPACED.test(t)) {
      const collapsed = t.replace(/\s+/g, ""), f = flat(collapsed);
      add(collapsed, line, i, []);
      // The person's own address can give the boundary between the words: thandi.mokoena@ over "T H A N D I M O K O E N A". Its letters only say where to cut; the name's own letters, accents included, stay.
      const cut = lines.flatMap((l) => [...l.text.matchAll(/([\p{L}]+)[._-]([\p{L}]+)\d*@/gu)]).find((m) => flat(m[1] + m[2]) === f);
      if (cut) { const n = [...collapsed.toLowerCase()].slice(0, flat(cut[1]).length).length, low = [...collapsed.toLowerCase()], title = (x: string[]) => x.join("").replace(/^\p{L}/u, (c) => c.toUpperCase()); add(`${title(low.slice(0, n))} ${title(low.slice(n))}`, line, i, [{ id: "restoredFromLink", weight: W.restoredFromLink }]); }
      // The document's own link can give the rest: linkedin.com/in/Firstname-Surname. Its words are the document's, not a guess; the evidence says where they came from.
      const rest = linkWords.find((w) => w[0] === f)?.[1];
      if (rest) add(`${collapsed.charAt(0).toUpperCase()}${collapsed.slice(1).toLowerCase()} ${rest.charAt(0).toUpperCase()}${rest.slice(1).toLowerCase()}`, line, i, [{ id: "restoredFromLink", weight: W.restoredFromLink }]);
      return;
    }
    // A name set beside a column of contact details can share a row with them: what is left once the address and number are taken away.
    const beside = t.replace(EMAIL, " ").replace(PHONE, " ").replace(/\s+/g, " ").trim();
    if (beside && beside !== t) add(beside, line, i, [{ id: "besideContact", weight: W.besideContact }]);
    add(t, line, i, []);
    const next = top[i + 1]?.text.trim() ?? "", word = /^\p{Lu}[\p{L}'’-]+$/u;
    if (word.test(t) && word.test(next)) add(`${t} ${next}`, top[i + 1], i + 1, [{ id: "splitOverLines", weight: W.splitOverLines }]);
    // "Pieter van der" / "Merwe": a name does not end on van, der or de, so the line above was only part of it.
    const lastWord = lowerWords(t).at(-1) ?? "";
    if (PARTICLES.has(lastWord) && word.test(next)) add(`${t} ${next}`, top[i + 1], i + 1, [{ id: "splitOverLines", weight: W.splitOverLines }]);
  });
  return { list: [...found.values()].sort((a, b) => b.score - a.score), unavailable };
}

/** Two forms of one name ("Thandi N Mokoena", "Thandi Mokoena") are one person, not rivals: first and last words the same. The form printed first stands for both. */
function samePerson(x: Candidate, y: Candidate) { const a = lowerWords(x.value).map(flat), b = lowerWords(y.value).map(flat); return a.length >= 2 && b.length >= 2 && a[0] === b[0] && a.at(-1) === b.at(-1); }
const pick = (all: Candidate[], orderOf: (source: string) => number): Decision => {
  const list: Candidate[] = [];
  for (const c of all) { const same = list.find((x) => samePerson(x, c)); if (!same) list.push({ ...c }); else if (orderOf(c.sources[0]) < orderOf(same.sources[0])) { same.value = c.value; same.sources = [...c.sources, ...same.sources]; } }
  const [a, b] = list, { minScore, minMargin } = CFG.evidence.decision;
  if (!a) return { value: "", status: "abstained", reason: "no candidate" };
  const margin = Math.round((a.score - (b?.score ?? 0)) * 10) / 10;
  if (a.score < minScore) return { value: "", status: "abstained", score: a.score, margin, reason: "best candidate has too little evidence" };
  if (margin < minMargin) return { value: "", status: "abstained", score: a.score, margin, reason: "two candidates too close" };
  return { value: a.value, status: "selected", score: a.score, margin, source: a.sources[0] };
};
const contactDecision = (contacts: Contact[], kind: Contact["kind"]): Decision => {
  const all = contacts.filter((c) => c.kind === kind), mine = all.filter((c) => c.owner === "candidate" && !c.uncertain).sort((x, y) => y.score - x.score);
  if (mine[0]) return { value: mine[0].value, status: "selected", score: mine[0].score, source: mine[0].source };
  return { value: "", status: "abstained", reason: all.length ? `only ${[...new Set(all.map((c) => c.owner))].join(" and ")} ${kind === "email" ? "addresses" : "numbers"} found` : "none in the document" };
};

export function readIdentity(model: DocModel, opts: IdentityOptions = {}): Identity {
  const lines = allLines(model), order = new Map(lines.map((l, k) => [l.id, k])), { list, unavailable } = nameCandidates(model, lines, opts.useLayout ?? true), picked = pick(list, (s) => order.get(s) ?? 1e9), ocrRead = model.reader === "pdf-ocr" || model.reader === "image-ocr", addresses = ocrRead ? [...new Set(lines.flatMap((l) => [l.text, ...(l.readings ?? [])].flatMap(addressesIn)))].map((e) => flat(e.split("@")[0])) : [], name = ocrRead && picked.value ? { ...picked, value: nameAgainstAddress(picked.value, addresses) } : picked, contacts = contactOwnership(lines, name.value);
  const email = contactDecision(contacts, "email"), phone = contactDecision(contacts, "phone"), preparedByOther = lines.some((l) => { const m = l.text.trim().match(PREPARED_BY); return m && flat(m[1]) !== flat(name.value) && !lowerWords(name.value).map(flat).every((w) => flat(m[1]).includes(w)); }), agencyEvidence = [...new Set([...(lines.some((l) => AGENCY_TERMS_HEAD.test(l.text.trim()) || AGENCY_TERMS_SENTENCE.test(l.text) || /\bpresented by\s*:/i.test(l.text)) ? ["agencyTerms"] : []), ...contacts.filter((c) => c.owner === "agency").flatMap((c) => c.evidence.filter((e) => ["agencyLabel", "agencyBlock", "letterhead", "repeatedOnPages"].includes(e.id)).map((e) => e.id)), ...(preparedByOther ? ["preparedBy"] : [])])], agencyDocument = agencyEvidence.length > 0, own = [email, phone].filter((d) => d.status === "selected").length;
  return { name, email, phone, location: readLocation(lines, contacts, name.value), nameCandidates: list.slice(0, 8), contacts, agencyDocument, agencyEvidence, candidateContact: own === 2 ? "direct" : own === 1 ? "partly-direct" : agencyDocument ? "through-agency" : "none-found", ...(agencyDocument ? { agency: readAgency(model, lines, contacts, name.value) } : {}), unavailableEvidence: unavailable, reader: model.reader };
}
/** The adapter: the same three fields the current parser gives, so the record's shape does not change. */
export const identityFields = (i: Identity) => ({ fullName: i.name.value, email: i.email.value, phone: i.phone.value });
