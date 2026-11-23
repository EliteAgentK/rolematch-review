import { Alert, Badge, Box, Container, Field, Flex, Heading, HStack, Input, NumberInput, SimpleGrid, Stack, Tabs, Text } from "@chakra-ui/react";
import { AlertIcon, AlertRoot } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { IconButton } from "../components/ui/icon-button";
import { ArrowDownIcon, ArrowUpIcon, SmallAddIcon } from "../components/ui/icons";
import { Select } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { toaster } from "../components/ui/toaster";
import { useColorModeValue } from "../theme/color-mode";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiArrowLeft } from "react-icons/fi";
import { api, ApiError } from "../api/client";
import HistoryPanel from "../components/HistoryPanel";
import TeamPanel from "../components/TeamPanel";
import PeoplePanel from "../components/PeoplePanel";
import PasskeysPanel from "../components/PasskeysPanel";
import DashboardNavbar from "../components/DashboardNavbar";
import BrandLoader from "../components/BrandLoader";
import { useSettings } from "../settings/SettingsContext";
import type { OrgSettings, StatusColour } from "../settings/types";
import { rolematchConfig } from "../config/rolematch.config";

const COLOURS: StatusColour[] = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "cyan", "purple", "pink"];
const NUMBER_LABELS: Record<string, [string, string]> = {
  documentsPerDay: ["Uploads per day", "How many documents each portal may upload in 24 hours."],
  storageMb: ["Storage (MB)", "Total size of all the documents a portal stores."],
  inProgress: ["Documents waiting at once", "How many of a portal's documents may be waiting to be processed before its uploads pause."],
  matchesPerHour: ["Matches per hour", "How many candidate-and-job comparisons a portal may run in an hour."],
  maxPages: ["Longest job description PDF (pages)", "A job description PDF with more pages than this is refused with a clear reason. CVs have no page limit: every CV is read in full."],
  maxFileMb: ["Largest upload (MB)", "Files above this size are refused before they are stored."],
  processFileMb: ["Largest file we will read (MB)", "A bigger file is made smaller first; if it is still above this, it is refused."],
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function SettingsPage() {
  const { loaded, response, reload, nouns } = useSettings();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // only the open tab's contents exist, as with Chakra 2's lazy tabs (Chakra 3 removes a closed tab's contents a moment later)
  const [tab, setTab] = useState("statuses");
  const border = useColorModeValue("gray.200", "gray.700");
  const bg = useColorModeValue("white", "gray.800");

  const [myEmail, setMyEmail] = useState("");
  useEffect(() => { api.me().then(({ user }) => setMyEmail(user.email)).catch((e) => { if (e instanceof ApiError && e.status === 401) navigate(e.code === "AUTH-005" ? "/login?ended=1" : "/login"); }); }, [navigate]);
  useEffect(() => { if (response) setDraft(structuredClone(response.settings)); }, [response]);

  const dirty = useMemo(() => !!response && !!draft && !sameJson(response.settings, draft), [response, draft]);
  if (!loaded) return <BrandLoader label="Opening settings" />;   // the RoleMatch loading screen, not a blank page
  if (!response || !draft) return <Container py={20}><AlertRoot status="error"><AlertIcon />Settings could not be loaded. Sign in again and retry.</AlertRoot></Container>;

  const canEdit = response.canEdit, d = draft;
  const setSection = <K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) => setDraft({ ...d, [key]: value });
  const resetSection = (key: keyof OrgSettings) => setDraft({ ...d, [key]: structuredClone(response.defaults[key]) } as OrgSettings);

  const save = async () => {
    setSaving(true); setProblem(null);
    try {
      const patch: Record<string, unknown> = { version: response.version };
      for (const key of Object.keys(d) as (keyof OrgSettings)[]) if (!sameJson(d[key], response.settings[key])) patch[key] = d[key];
      await api.saveSettings(patch);
      await reload();
      toaster.create({ title: "Settings saved", description: "The change applies straight away and is recorded in the history.", type: "success" });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "The server could not be reached.";
      setProblem(message);
      if (e instanceof ApiError && e.status === 409) await reload();
    } finally { setSaving(false); }
  };

  const move = (i: number, by: -1 | 1) => { const list = [...d.statuses]; const j = i + by; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; setSection("statuses", list); };
  const sectionHead = (title: string, key: keyof OrgSettings, note: string) => (
    <Flex justify="space-between" align="flex-start" mb={4} gap={4} wrap="wrap">
      <Box maxW="640px"><Heading size="md">{title}</Heading><Text fontSize="sm" color="gray.500" mt={1}>{note}</Text></Box>
      {canEdit && <Button size="sm" variant="ghost" onClick={() => resetSection(key)}>Reset this section to the platform defaults</Button>}
    </Flex>
  );

  return (
    <Box minH="100vh" bg={useColorModeValue("gray.50", "gray.900")}>
      <DashboardNavbar onHelpClick={() => {}} />
      <Container maxW="5xl" py={8}>
        {/* the way back, where people look first (owner, 9 Nov 2026: "there should be a return to dashboard") */}
        <Button variant="outline" size="sm" mb={4} leftIcon={<FiArrowLeft />} onClick={() => navigate("/dashboard")} data-testid="back-to-board">Back to the board</Button>
        <Flex justify="space-between" align="center" mb={2} wrap="wrap" gap={3}>
          <Box>
            <Heading size="lg">Settings</Heading>
            <Text color="gray.500" fontSize="sm">Your organisation's workflow, wording and limits. Version {response.version}{response.updatedAt ? `, last changed ${new Date(response.updatedAt).toLocaleString()}` : ", still on the platform defaults"}.</Text>
          </Box>
          <HStack>
            {canEdit && <Button colorPalette="blue" disabled={!dirty} loading={saving} onClick={save}>Save changes</Button>}
          </HStack>
        </Flex>
        <AlertRoot status="info" borderRadius="md" mb={5} fontSize="sm"><AlertIcon /><Alert.Description>
          How candidates are scored is the same for every organisation and cannot be changed here: that is what keeps matching fair. Everything below is yours to set. Every change is kept as a numbered version with who made it.
        </Alert.Description></AlertRoot>
        {!canEdit && <AlertRoot status="warning" borderRadius="md" mb={5}><AlertIcon />You can read these settings, but only an administrator can change them.</AlertRoot>}
        {problem && <AlertRoot status="error" borderRadius="md" mb={5} role="alert"><AlertIcon /><Alert.Description>{problem}</Alert.Description></AlertRoot>}

        <Tabs.Root variant="enclosed" value={tab} onValueChange={(e) => setTab(e.value)}>
          <Tabs.List overflowX="auto">
            <Tabs.Trigger value="security">Security</Tabs.Trigger><Tabs.Trigger value="organisation">Organisation</Tabs.Trigger><Tabs.Trigger value="people">People</Tabs.Trigger><Tabs.Trigger value="statuses">Statuses</Tabs.Trigger><Tabs.Trigger value="wording">Wording</Tabs.Trigger>{rolematchConfig.settings.showLimits && <Tabs.Trigger value="limits">Limits</Tabs.Trigger>}{rolematchConfig.review.showPrompts && <Tabs.Trigger value="review">Review rules</Tabs.Trigger>}<Tabs.Trigger value="team">Team</Tabs.Trigger><Tabs.Trigger value="editing">What can be edited</Tabs.Trigger><Tabs.Trigger value="history">History</Tabs.Trigger>
          </Tabs.List>
          {/* The Reading and Panels sections are not offered (owner, 9 Nov 2026: "more room for error"): how documents are read and what the cards show stay at the platform's defaults. */}
          <Tabs.ContentGroup bg={bg} borderWidth="1px" borderTopWidth="0" borderColor={border} borderBottomRadius="md">
            <Tabs.Content value="security" p={6}>{tab === "security" && <PasskeysPanel />}</Tabs.Content>

            <Tabs.Content value="statuses" p={6}>{tab === "statuses" && (<>
              {sectionHead("Workflow statuses", "statuses", "The steps a candidate moves through. The key is permanent; the label and colour can change. A status people already use can be switched off but not removed. \"new\" is required: it is where every new candidate starts.")}
              <Stack gap={3}>
                {d.statuses.map((s, i) => (
                  <Flex key={s.key} gap={3} align="center" wrap="wrap" borderWidth="1px" borderColor={border} borderRadius="md" p={3}>
                    <Badge colorPalette={s.colour} px={2} py={1} minW="120px" textAlign="center">{s.label || "(no label)"}</Badge>
                    <Input size="sm" maxW="220px" value={s.label} disabled={!canEdit} aria-label={`Label for ${s.key}`} onChange={(e) => setSection("statuses", d.statuses.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
                    <Select size="sm" maxW="140px" value={s.colour} disabled={!canEdit} aria-label={`Colour for ${s.key}`} onChange={(e) => setSection("statuses", d.statuses.map((x, k) => (k === i ? { ...x, colour: e.target.value as StatusColour } : x)))}>
                      {COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                    <Text fontSize="xs" color="gray.500" minW="130px">key: {s.key}</Text>
                    <HStack><Text fontSize="sm">In use</Text><Switch checked={s.active} disabled={!canEdit || s.key === "new"} aria-label={`${s.label} is in use`} onCheckedChange={(e) => setSection("statuses", d.statuses.map((x, k) => (k === i ? { ...x, active: e.checked } : x)))} /></HStack>
                    {canEdit && <HStack ml="auto"><IconButton size="xs" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUpIcon /></IconButton><IconButton size="xs" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === d.statuses.length - 1}><ArrowDownIcon /></IconButton></HStack>}
                  </Flex>
                ))}
              </Stack>
              {canEdit && <NewStatus existing={d.statuses.map((s) => s.key)} onAdd={(s) => setSection("statuses", [...d.statuses, s])} />}
            </>)}</Tabs.Content>

            <Tabs.Content value="organisation" p={6}>{tab === "organisation" && (<>
              {sectionHead("Organisation", "branding", "How your organisation is named in its own portal, under the RoleMatch logo at the top of every page. E-mails are not affected.")}
              <Stack gap={5} maxW="520px">
                <Field.Root display="flex" alignItems="center"><Field.Label mb={0} flex={1}>Show the organisation's name under the RoleMatch logo</Field.Label><Switch checked={d.branding.showOrgName} disabled={!canEdit} onCheckedChange={(e) => setSection("branding", { ...d.branding, showOrgName: e.checked })} /></Field.Root>
                <TextField label={`Name to show (leave empty to use "${response?.orgName ?? ""}")`} value={d.branding.orgDisplayName} disabled={!canEdit || !d.branding.showOrgName} onChange={(v) => setSection("branding", { ...d.branding, orgDisplayName: v.slice(0, 60) })} />
              </Stack>
            </>)}</Tabs.Content>

            <Tabs.Content value="wording" p={6}>{tab === "wording" && (<>
              {sectionHead("Wording", "labels", "What your organisation calls things. An agency might say Applicants and Requisitions.")}
              <SimpleGrid columns={{ base: 1, md: 2 }} gap={5}>
                <TextField label="Candidate (singular)" value={d.labels.candidate.one} disabled={!canEdit} onChange={(v) => setSection("labels", { ...d.labels, candidate: { ...d.labels.candidate, one: v } })} />
                <TextField label="Candidates (plural)" value={d.labels.candidate.many} disabled={!canEdit} onChange={(v) => setSection("labels", { ...d.labels, candidate: { ...d.labels.candidate, many: v } })} />
                <TextField label="Job (singular)" value={d.labels.job.one} disabled={!canEdit} onChange={(v) => setSection("labels", { ...d.labels, job: { ...d.labels.job, one: v } })} />
                <TextField label="Jobs (plural)" value={d.labels.job.many} disabled={!canEdit} onChange={(v) => setSection("labels", { ...d.labels, job: { ...d.labels.job, many: v } })} />
                <TextField label="Name of the notes area" value={d.labels.notes} disabled={!canEdit} onChange={(v) => setSection("labels", { ...d.labels, notes: v })} />
              </SimpleGrid>
            </>)}</Tabs.Content>

            <Tabs.Content value="limits" p={6}>{tab === "limits" && (<>
              {sectionHead("Fair-use limits", "limits", "Every portal has these in full, whatever its size: what one portal uses never counts against another. Each can be set up to the platform maximum shown beside it.")}
              <SimpleGrid columns={{ base: 1, md: 2 }} gap={5}>
                {Object.entries(NUMBER_LABELS).map(([key, [label, help]]) => (
                  <Field.Root key={key}>
                    <Field.Label fontSize="sm">{label}</Field.Label>
                    <NumberInput.Root min={1} max={response.ceilings[key]} value={String((d.limits as any)[key])} disabled={!canEdit} onValueChange={({ valueAsNumber: n }) => setSection("limits", { ...d.limits, [key]: Number.isFinite(n) ? n : 1 })}><NumberInput.Input /></NumberInput.Root>
                    <Field.HelperText>{help} Platform maximum: {response.ceilings[key]?.toLocaleString()}.</Field.HelperText>
                  </Field.Root>
                ))}
              </SimpleGrid>
            </>)}</Tabs.Content>

            <Tabs.Content value="review" p={6}>{tab === "review" && (<>
              {sectionHead("When a record needs a person to check it", "review", "After a document is read, records that look weak get a yellow flag so someone compares them with the original. These are the thresholds.")}
              <Stack gap={5} maxW="560px">
                <Field.Root>
                  <Field.Label fontSize="sm">Flag when extraction confidence is below</Field.Label>
                  <NumberInput.Root min={10} max={90} step={5} value={String(Math.round(d.review.lowConfidence * 100))} disabled={!canEdit} onValueChange={({ valueAsNumber: n }) => setSection("review", { ...d.review, lowConfidence: Math.min(0.9, Math.max(0.1, (Number.isFinite(n) ? n : 50) / 100)) })}><NumberInput.Input /></NumberInput.Root>
                  <Field.HelperText>Percent. Higher means more records get flagged.</Field.HelperText>
                </Field.Root>
                <Field.Root>
                  <Field.Label fontSize="sm">Flag a CV that lists fewer than this many skills</Field.Label>
                  <NumberInput.Root min={0} max={10} value={String(d.review.minSkills)} disabled={!canEdit} onValueChange={({ valueAsNumber: n }) => setSection("review", { ...d.review, minSkills: Number.isFinite(n) ? n : 0 })}><NumberInput.Input /></NumberInput.Root>
                </Field.Root>
                <Field.Root display="flex" alignItems="center"><Field.Label mb={0} flex={1}>Flag a CV with no email or phone number</Field.Label><Switch checked={d.review.flagNoContact} disabled={!canEdit} onCheckedChange={(e) => setSection("review", { ...d.review, flagNoContact: e.checked })} /></Field.Root>
                <Field.Root display="flex" alignItems="center"><Field.Label mb={0} flex={1}>Flag a CV with no education or certifications</Field.Label><Switch checked={d.review.flagNoEducation} disabled={!canEdit} onCheckedChange={(e) => setSection("review", { ...d.review, flagNoEducation: e.checked })} /></Field.Root>
                <Field.Root display="flex" alignItems="center"><Field.Label mb={0} flex={1}>Flag a CV with no readable work history</Field.Label><Switch checked={d.review.flagNoWorkHistory} disabled={!canEdit} onCheckedChange={(e) => setSection("review", { ...d.review, flagNoWorkHistory: e.checked })} /></Field.Root>
              </Stack>
            </>)}</Tabs.Content>



            <Tabs.Content value="editing" p={6}>{tab === "editing" && (<>
              {sectionHead("What a recruiter may edit", "editing", "A recruiter's own notes, and each person's status for a job, are always theirs to change. Everything below is read from a document: choose what a person may correct. A locked field is shown as the document states it. What the platform works out (years of experience, evidence, confidence) can never be edited. Every edit that is allowed is recorded with what it was and what it became.")}
              {(["candidate", "job"] as const).map((kind) => {
                const rules = response.editPolicy.configurable[kind];
                const groups = [...new Set(Object.values(rules).map((r) => r.group))];
                return (
                  <Box key={kind} mb={6} data-testid={`edit-policy-${kind}`}>
                    <Heading size="sm" mb={3}>{kind === "candidate" ? nouns.candidate.one : nouns.job.one} fields</Heading>
                    {groups.map((group) => (
                      <Box key={group} mb={4}>
                        <Text fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="gray.500" mb={2}>{group}</Text>
                        <Stack gap={2}>
                          {Object.entries(rules).filter(([, r]) => r.group === group).map(([field, r]) => (
                            <Field.Root key={field} display="flex" alignItems="center" gap={3}>
                              <Box flex={1}><Field.Label mb={0} htmlFor={`edit-${kind}-${field}`}>{r.label}</Field.Label><Text fontSize="xs" color="gray.500">{r.why}</Text></Box>
                              <Text fontSize="xs" color="gray.500" minW="64px" textAlign="right">{d.editing[kind][field] ? "Editable" : "Locked"}</Text>
                              <Switch id={`edit-${kind}-${field}`} checked={!!d.editing[kind][field]} disabled={!canEdit} onCheckedChange={(e) => setSection("editing", { ...d.editing, [kind]: { ...d.editing[kind], [field]: e.checked } })} />
                            </Field.Root>
                          ))}
                        </Stack>
                      </Box>
                    ))}
                  </Box>
                );
              })}
            </>)}</Tabs.Content>

            <Tabs.Content value="history" p={6}>{tab === "history" && (<>
              <Heading size="md" mb={1}>History</Heading>
              <Text fontSize="sm" color="gray.500" mb={4}>What happened in the portal, what was uploaded and which invitations were sent. Finished upload batches are kept here.</Text>
              <HistoryPanel isOrgAdmin={canEdit} />
            </>)}</Tabs.Content>
          <Tabs.Content value="team" p={6}>{tab === "team" && <TeamPanel />}</Tabs.Content>
          <Tabs.Content value="people" p={6}>{tab === "people" && <PeoplePanel isOrgAdmin={canEdit} myEmail={myEmail} />}</Tabs.Content>
          </Tabs.ContentGroup>
        </Tabs.Root>
      </Container>
    </Box>
  );
}

function TextField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return <Field.Root><Field.Label fontSize="sm">{label}</Field.Label><Input value={value} disabled={disabled} maxLength={40} onChange={(e) => onChange(e.target.value)} /></Field.Root>;
}

function NewStatus({ existing, onAdd }: { existing: string[]; onAdd: (s: { key: string; label: string; colour: StatusColour; active: boolean }) => void }) {
  const [label, setLabel] = useState("");
  const [colour, setColour] = useState<StatusColour>("blue");
  const key = label.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, " ").slice(0, 30);
  const clash = existing.includes(key);
  return (
    <Flex mt={5} gap={3} align="flex-end" wrap="wrap">
      <Field.Root maxW="260px"><Field.Label fontSize="sm">Add a status</Field.Label><Input value={label} placeholder="For example: Offer made" onChange={(e) => setLabel(e.target.value)} /></Field.Root>
      <Select maxW="140px" value={colour} aria-label="Colour for the new status" onChange={(e) => setColour(e.target.value as StatusColour)}>{COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
      <Button leftIcon={<SmallAddIcon />} disabled={!key || clash || !/^[a-z]/.test(key)} onClick={() => { onAdd({ key, label: label.trim(), colour, active: true }); setLabel(""); }}>Add</Button>
      {clash && <Text fontSize="sm" color="red.500">A status with that key already exists.</Text>}
    </Flex>
  );
}
