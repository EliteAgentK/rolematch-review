import { Badge, Box, Dialog, Flex, HStack, Portal, Stack, Text, Textarea } from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { api, ROLE_LABEL, type PortalMembers } from "../api/client";
import { toaster } from "./ui/toaster";
import { Button } from "./ui/button";
import { DialogHeader } from "./ui/dialog";
import { useEveryFiveMinutes } from "./useEveryFiveMinutes";

// Team: who is in a portal, the invitations sent from it and what happened to each e-mail, and the "Send invite" pop-up (recipients -> portals and role -> review).
// "Accepted by mail server" means the mail server took the message; delivery to the inbox is not confirmed (no bounce feedback is read yet), and the screen does not claim it.
const ROLES = [{ v: "recruiter", label: ROLE_LABEL.recruiter, hint: "Uploads, reviews and matches" }, { v: "hiring_manager", label: ROLE_LABEL.hiring_manager, hint: "Read-only: sees shortlisted candidates" }, { v: "admin", label: ROLE_LABEL.admin, hint: "Manages members and settings" }];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// In the viewer's own time zone, named: RoleMatch may be used from anywhere (owner, 12 Nov 2026).
const localTime = (iso: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
const EMAIL_STATE: Record<string, { label: string; colour: string }> = { queued: { label: "E-mail queued", colour: "gray" }, accepted: { label: "Accepted by mail server", colour: "blue" }, previewed: { label: "Preview only: nothing sent", colour: "orange" }, failed: { label: "E-mail failed: resend or correct the address", colour: "red" }, expired: { label: "E-mail expired unsent", colour: "gray" }, not_sent: { label: "No e-mail sent", colour: "gray" } };
const OUTCOME: Record<string, string> = { invited: "Invitation queued", already_member: "Already a member", already_invited: "Already invited", invalid: "Not a valid address" };

type PortalRow = { id: string; name: string; role: string };

function SendInvite({ open, portals, defaultPortal, onClose, onDone }: { open: boolean; portals: PortalRow[]; defaultPortal: string; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [raw, setRaw] = useState(""); const [chosen, setChosen] = useState<string[]>([]); const [role, setRole] = useState("recruiter");
  const [busy, setBusy] = useState(false); const [results, setResults] = useState<{ portal: string; email: string; status: string }[]>([]);
  useEffect(() => { if (open) { setStep(1); setRaw(""); setChosen([defaultPortal]); setRole("recruiter"); setResults([]); } }, [open, defaultPortal]);
  const all = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = all.filter((e) => !EMAIL.test(e)), good = all.filter((e) => EMAIL.test(e));
  const name = (id: string) => portals.find((p) => p.id === id)?.name ?? "";
  const send = async () => {
    setBusy(true); const out: typeof results = [];
    for (const pid of chosen) {
      try { for (const r of await api.invite(pid, good, role)) out.push({ portal: name(pid), email: r.email, status: r.status }); }
      catch (e: any) { for (const m of good) out.push({ portal: name(pid), email: m, status: "error:" + (e?.message ?? "failed") }); }
    }
    setResults(out); setStep(4); setBusy(false); onDone();
  };
  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) onClose(); }} placement="center" scrollBehavior="inside">
      <Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content maxW="560px" borderRadius="2xl">
        <DialogHeader fontSize="lg" fontWeight="bold">Send invite{step < 4 ? ` · step ${step} of 3` : ""}</DialogHeader>
        <Dialog.Body>
          {step === 1 && (<Stack gap={2}>
            <Text fontSize="sm">Who should be invited? Each person gets their own e-mail and their own link; recipients never see each other.</Text>
            <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5} placeholder="name@company.com, another@company.com" aria-label="Recipient e-mail addresses" />
            <Text fontSize="xs" color="gray.500">{good.length} valid address{good.length === 1 ? "" : "es"}{good.length > 50 ? " — at most 50 at a time" : ""}</Text>
            {bad.length > 0 && <Text fontSize="xs" color="red.500">Not valid: {bad.slice(0, 5).join(", ")}{bad.length > 5 ? "…" : ""}</Text>}
          </Stack>)}
          {step === 2 && (<Stack gap={4}>
            <Stack gap={1}><Text fontWeight="semibold" fontSize="sm">Portals</Text>
              {portals.map((p) => (<label key={p.id}><HStack gap={2}><input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} /><Text fontSize="sm">{p.name}</Text></HStack></label>))}
              <Text fontSize="xs" color="gray.500">Only portals you administer are listed. Being invited to a portal gives no access to any other.</Text></Stack>
            <Stack gap={1}><Text fontWeight="semibold" fontSize="sm">Role</Text>
              {ROLES.map((r) => (<label key={r.v}><HStack gap={2}><input type="radio" name="role" checked={role === r.v} onChange={() => setRole(r.v)} /><Text fontSize="sm"><b>{r.label}</b> · {r.hint}</Text></HStack></label>))}</Stack>
          </Stack>)}
          {step === 3 && (<Stack gap={2} fontSize="sm">
            <Text>You are about to send <b>{good.length}</b> separate e-mail{good.length === 1 ? "" : "s"}{chosen.length > 1 ? ` for each of ${chosen.length} portals` : ""}:</Text>
            <Box borderWidth="1px" borderRadius="md" p={3} maxH="140px" overflowY="auto">{good.map((e) => <Text key={e}>{e}</Text>)}</Box>
            <Text>Portal{chosen.length === 1 ? "" : "s"}: <b>{chosen.map(name).join(", ")}</b> · Role: <b>{ROLES.find((r) => r.v === role)?.label}</b></Text>
            <Text color="gray.500">Links expire after 7 days and work only for the address they were sent to.</Text>
          </Stack>)}
          {step === 4 && (<Stack gap={2} fontSize="sm">
            <Text fontWeight="semibold">Done. E-mails are queued and sent in the background; the Team list shows the state of each.</Text>
            <Box borderWidth="1px" borderRadius="md" p={3} maxH="200px" overflowY="auto">{results.map((r, i) => <Text key={i}>{r.email} · {r.portal} · {r.status.startsWith("error:") ? r.status.slice(6) : OUTCOME[r.status] ?? r.status}</Text>)}</Box>
          </Stack>)}
        </Dialog.Body>
        <Dialog.Footer gap={2}>
          {step === 4 ? <Button onClick={onClose}>Close</Button> : (<>
            {step > 1 && <Button variant="outline" onClick={() => setStep((step - 1) as 1 | 2)}>Back</Button>}
            {step === 1 && <Button disabled={!good.length || good.length > 50 || bad.length > 0} onClick={() => setStep(2)}>Next</Button>}
            {step === 2 && <Button disabled={!chosen.length} onClick={() => setStep(3)}>Review</Button>}
            {step === 3 && <Button loading={busy} onClick={send}>Send {good.length} invite{good.length === 1 ? "" : "s"}</Button>}
          </>)}
        </Dialog.Footer>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  );
}

export default function TeamPanel() {
  const [portals, setPortals] = useState<PortalRow[]>([]); const [pid, setPid] = useState(""); const [data, setData] = useState<PortalMembers | null>(null);
  const [open, setOpen] = useState(false); const [problem, setProblem] = useState(""); const [removing, setRemoving] = useState("");
  useEffect(() => { api.portals().then((p) => { setPortals(p); setPid((cur) => cur || p[0]?.id || ""); }).catch(() => setProblem("Your portals could not be loaded.")); }, []);
  const [updated, setUpdated] = useState("");
  const load = useCallback(() => { if (pid) api.portalMembers(pid).then((d) => { setData(d); setUpdated(new Date().toISOString()); }).catch(() => setProblem("The team could not be loaded.")); }, [pid]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEveryFiveMinutes(() => { if (pid) api.portalMembers(pid).then((d) => { setData(d); setUpdated(new Date().toISOString()); }).catch(() => {}); });   // a missed refresh keeps what is on screen; the time below says how old it is
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toaster.create({ title: ok, type: "success", closable: true }); } catch (e: any) { toaster.create({ title: "Not done", description: e?.message ?? "That did not work", type: "error", closable: true }); } load(); };   // reload either way: a refused change shows the real state again
  if (problem) return <Text color="red.500">{problem}</Text>;
  if (!portals.length) return <Text fontSize="sm">You are not in a portal yet. Ask an administrator to invite you to one.</Text>;
  const canManage = !!data?.canManage, ownedPortals = portals.filter((p) => p.role === "admin");   // everyone reads the team and its invitations; changing them stays with administrators, and the server enforces that whatever this page shows
  return (
    <Stack gap={4}>
      <Flex justify="space-between" align="center" gap={3} flexWrap="wrap">
        <HStack gap={2}><Text fontWeight="semibold">Portal</Text>
          <select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Portal" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #CBD5E1" }}>{portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></HStack>
        {canManage && <Button onClick={() => setOpen(true)}>Send invite</Button>}
      </Flex>
      {data?.mail?.state === "unavailable" && <Text fontSize="sm" color="red.500">E-mail is not available on this server, so invitations are saved and will wait. Nothing has been sent.</Text>}
      {data?.mail?.state === "preview" && <Text fontSize="sm" color="orange.500">E-mail is in preview mode: messages are written to files and nothing is sent.</Text>}
      {data?.mail?.appUrlLocalOnly && <Text fontSize="sm" color="orange.500">Invitation links point to a local address and work only on the computer running RoleMatch. Real recipients need a configured application address.</Text>}
      <Box><Text fontWeight="semibold" mb={1}>In the portal now{data ? ` (${data.members.filter((m) => m.hereNow).length})` : ""}</Text>
        {data && <Text fontSize="sm">{data.members.filter((m) => m.hereNow).map((m) => m.name || m.email).join(", ") || "Nobody right now."}</Text>}
        <Text fontSize="xs" color="gray.500" mt={1}>Anyone active in the last 6 minutes. {updated ? `Updated ${localTime(updated)}; ` : ""}refreshes every 5 minutes.</Text></Box>
      <Box><Text fontWeight="semibold" mb={1}>Members{data ? ` (${data.members.length})` : ""}</Text>
        {data?.members.map((m) => (
          <Flex key={m.userId} justify="space-between" align="center" gap={3} py={2} fontSize="sm" borderBottomWidth="1px" wrap="wrap">
            <Box minW={0}><Text truncate title={m.name}>{m.name || m.email}</Text>{m.name && <Text color="gray.500" fontSize="xs" truncate title={m.email}>{m.email}</Text>}</Box>
            <HStack gap={2}>
              {!canManage ? <Text fontSize="sm">{ROLES.find((r) => r.v === m.role)?.label ?? m.role}</Text> : <select aria-label={`Role of ${m.name || m.email} in this portal`} value={m.role} onChange={(e) => act(() => api.setMemberRole(pid, m.userId, e.target.value), "Role changed")}
                style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid #CBD5E1", background: "transparent", color: "inherit", fontSize: 13 }}>
                {ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>}
              <Text color="gray.500" fontSize="xs" whiteSpace="nowrap">{m.hereNow ? "In the portal now" : m.lastSeen ? `last here ${localTime(m.lastSeen)}` : "not here yet"} · since {localTime(m.since)}</Text>
              {!canManage ? null : removing === m.userId
                ? <HStack gap={1} className="rm-reveal"><Text fontSize="xs">Remove from {data.portal.name}?</Text><Button size="xs" onClick={() => { setRemoving(""); return act(() => api.removeMember(pid, m.userId), "Removed from the portal"); }}>Yes</Button><Button size="xs" variant="ghost" onClick={() => setRemoving("")}>Cancel</Button></HStack>
                : <Button size="xs" variant="outline" onClick={() => setRemoving(m.userId)}>Remove</Button>}
            </HStack>
          </Flex>))}
        <Text fontSize="xs" color="gray.500" mt={2}>A portal always keeps at least one administrator. Removing someone keeps everything they added, under their name.</Text></Box>
      <Box><Text fontWeight="semibold" mb={1}>Invitations</Text>
        {data && !data.invitations.length && <Text fontSize="sm" color="gray.500">None yet.</Text>}
        {data?.invitations.map((i) => { const es = EMAIL_STATE[i.emailState] ?? EMAIL_STATE.not_sent; return (
          <Flex key={i.id} justify="space-between" align="center" gap={2} py={2} fontSize="sm" borderBottomWidth="1px" flexWrap="wrap">
            <Box><Text>{i.email} <Text as="span" color="gray.500">· {ROLE_LABEL[i.role] ?? i.role} · by {i.invitedBy} · {localTime(i.createdAt)}</Text></Text>
              <HStack gap={2} mt={1}><Badge colorPalette={i.status === "pending" ? "green" : "gray"}>{i.status}</Badge>{i.status === "pending" && <Badge colorPalette={es.colour}>{es.label}</Badge>}{i.status === "pending" && <Text fontSize="xs" color="gray.500">expires {localTime(i.expiresAt)}</Text>}</HStack></Box>
            {canManage && i.status === "pending" && <HStack gap={2}>
              <Button size="xs" variant="outline" onClick={() => act(() => api.resendInvitation(pid, i.id), "New link e-mailed; the old link no longer works")}>Resend</Button>
              <Button size="xs" variant="outline" onClick={() => act(() => api.revokeInvitation(pid, i.id), "Invitation withdrawn")}>Revoke</Button></HStack>}
          </Flex>); })}</Box>
      <SendInvite open={open} portals={ownedPortals} defaultPortal={pid} onClose={() => setOpen(false)} onDone={load} />
    </Stack>
  );
}
