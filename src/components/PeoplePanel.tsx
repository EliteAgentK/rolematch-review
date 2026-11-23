import { Badge, Box, Flex, HStack, Stack, Table, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, selectedPortal, selectPortal, type OrgPeople } from "../api/client";
import { useColorModeValue } from "../theme/color-mode";
import { toaster } from "./ui/toaster";
import { Button } from "./ui/button";

// Settings, People. Everyone: their own access (portals and roles) and how to leave a portal or the organisation. Organisation administrators also see
// the organisation, its portals (counts only, never their records) and everyone in it, with name as entered, e-mail, roles and portals; they can remove
// someone from the organisation and appoint a portal administrator (the recovery route when a portal has lost its administrators).
// The server decides every one of these (server/src/team.ts); a refusal is shown as it is given.
// Dates in the viewer's own time zone and way of writing them: RoleMatch may be used from anywhere (owner, 12 Nov 2026).
const localTime = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
const ROLE: Record<string, string> = { admin: "Administrator", recruiter: "Recruiter", hiring_manager: "Hiring manager / HR" };

/** A two-step button: the first press asks, the second does it. No browser pop-up. */
function Confirm({ label, ask, onYes, size = "xs" }: { label: string; ask: string; onYes: () => Promise<void>; size?: "xs" | "sm" }) {
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false);
  if (!asking) return <Button size={size} variant="outline" onClick={() => setAsking(true)}>{label}</Button>;
  return (
    <HStack gap={2} className="rm-reveal" role="group" aria-label={ask}>
      <Text fontSize="xs">{ask}</Text>
      <Button size={size} loading={busy} onClick={async () => { setBusy(true); try { await onYes(); } finally { setBusy(false); setAsking(false); } }}>Yes</Button>
      <Button size={size} variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
    </HStack>
  );
}

export default function PeoplePanel({ isOrgAdmin, myEmail }: { isOrgAdmin: boolean; myEmail: string }) {
  const navigate = useNavigate();
  const [mine, setMine] = useState<{ id: string; name: string; role: string }[] | null>(null);
  const [org, setOrg] = useState<OrgPeople | null>(null), [problem, setProblem] = useState("");
  const [appoint, setAppoint] = useState<Record<string, string>>({});
  const muted = useColorModeValue("gray.600", "gray.400"), border = useColorModeValue("gray.200", "gray.700");
  const load = useCallback(() => {
    api.portals().then(setMine).catch(() => setProblem("Your portals could not be loaded."));
    if (isOrgAdmin) api.orgPeople().then(setOrg).catch((e) => setProblem(e instanceof ApiError ? e.message : "The organisation's people could not be loaded."));
  }, [isOrgAdmin]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    try { await fn(); toaster.create({ title: ok, type: "success", closable: true }); (after ?? load)(); }
    catch (e) { toaster.create({ title: "Not done", description: e instanceof ApiError ? e.message : "The server could not be reached.", type: "error", closable: true }); }
  };

  return (
    <Stack gap={8}>
      <Box>
        <Text fontWeight="semibold" fontSize="lg">Your access</Text>
        <Text fontSize="sm" color={muted} mb={3}>The portals you can work in and your role in each. Leaving takes away your access at once; what you added stays with the portal, under your name.</Text>
        {problem && <Text color="red.500" fontSize="sm" mb={2}>{problem}</Text>}
        {mine?.length === 0 && <Text fontSize="sm">You are not in any portal. Ask an administrator to invite you.</Text>}
        <Stack gap={0}>{mine?.map((p) => (
          <Flex key={p.id} justify="space-between" align="center" gap={3} py={2} borderBottomWidth="1px" borderColor={border} wrap="wrap">
            <Text fontSize="sm">{p.name} <Text as="span" color={muted}>· {ROLE[p.role] ?? p.role}</Text></Text>
            <Confirm label="Leave this portal" ask={`Leave ${p.name}?`} onYes={() => act(() => api.leavePortal(p.id), `You have left ${p.name}`, () => { if (selectedPortal() === p.id) selectPortal(null); load(); })} />
          </Flex>))}</Stack>
        <Flex mt={4} justify="flex-end">
          <Confirm size="sm" label="Leave the organisation" ask="Leave the organisation and every portal in it? You will be signed out."
            onYes={() => act(() => api.leaveOrganisation(), "You have left the organisation", () => navigate("/login"))} />
        </Flex>
      </Box>

      {isOrgAdmin && org && (
        <Box>
          <Text fontWeight="semibold" fontSize="lg">{org.organisation.name}</Text>
          <Text fontSize="sm" color={muted} mb={3}>On RoleMatch since {localTime(org.organisation.since)} · {org.people.length} {org.people.length === 1 ? "person" : "people"} · {org.portals.length} portal{org.portals.length === 1 ? "" : "s"}. Visible to organisation administrators only.</Text>
          <HStack gap={2} wrap="wrap" mb={5}>{org.portals.map((p) => (
            <Badge key={p.id} variant="outline" colorPalette={p.admins === 0 ? "orange" : "gray"} px={2} py={1} title={p.admins === 0 ? "This portal has no administrator: appoint one below" : undefined}>
              {p.name} · {p.members} member{p.members === 1 ? "" : "s"}{p.admins === 0 ? " · no administrator" : ""}</Badge>))}</HStack>
          <Box overflowX="auto"><Table.Root size="sm" variant="line">
            <Table.Header><Table.Row><Table.ColumnHeader>Name and surname</Table.ColumnHeader><Table.ColumnHeader>E-mail</Table.ColumnHeader><Table.ColumnHeader>Organisation role</Table.ColumnHeader><Table.ColumnHeader>Portals</Table.ColumnHeader><Table.ColumnHeader>Joined</Table.ColumnHeader><Table.ColumnHeader><Box as="span" srOnly>Actions</Box></Table.ColumnHeader></Table.Row></Table.Header>
            <Table.Body>{org.people.map((p) => {
              const notAdminOf = org.portals.filter((x) => !p.portals.some((y) => y.id === x.id && y.role === "admin"));
              return (
                <Table.Row key={p.userId}>
                  <Table.Cell minW="160px" maxW="240px"><Text overflowWrap="anywhere">{p.name || "(no name given)"}</Text></Table.Cell>
                  <Table.Cell maxW="240px"><Text truncate title={p.email}>{p.email}</Text></Table.Cell>
                  <Table.Cell whiteSpace="nowrap">{ROLE[p.orgRole] ?? p.orgRole}{p.orgRole !== "admin" && p.canCreatePortals ? " · may create portals" : ""}</Table.Cell>
                  <Table.Cell>{p.portals.length === 0 ? <Text color={muted}>None</Text> : p.portals.map((x) => <Text key={x.id} fontSize="sm">{x.name} · {ROLE[x.role] ?? x.role}</Text>)}</Table.Cell>
                  <Table.Cell whiteSpace="nowrap">{localTime(p.since)}</Table.Cell>
                  <Table.Cell>
                    <Stack gap={2} align="flex-start">
                      {notAdminOf.length > 0 && (
                        <HStack gap={2}>
                          <select aria-label={`Portal to make ${p.name || p.email} an administrator of`} value={appoint[p.userId] ?? ""} onChange={(e) => setAppoint({ ...appoint, [p.userId]: e.target.value })}
                            style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--chakra-colors-border, #cbd5e0)", background: "transparent", color: "inherit", fontSize: 13 }}>
                            <option value="">Make administrator of…</option>
                            {notAdminOf.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                          <Button size="xs" variant="outline" disabled={!appoint[p.userId]} onClick={() => act(() => api.appointPortalAdmin(appoint[p.userId], p.userId), "Portal administrator appointed", () => { setAppoint((cur) => ({ ...cur, [p.userId]: "" })); load(); })}>Appoint</Button>
                        </HStack>)}
                      {p.email !== myEmail && <Confirm label="Remove from organisation" ask={`Remove ${p.name || p.email}?`} onYes={() => act(() => api.removeFromOrganisation(p.userId), "Removed from the organisation")} />}
                    </Stack>
                  </Table.Cell>
                </Table.Row>);
            })}</Table.Body>
          </Table.Root></Box>
          <Text fontSize="xs" color={muted} mt={2}>Names are shown exactly as each person entered them at sign-up. Removing someone keeps everything they added, under their name.</Text>
        </Box>)}
    </Stack>
  );
}
