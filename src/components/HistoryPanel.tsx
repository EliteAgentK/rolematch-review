import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Flex, Table, Tabs, Text } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { api, ApiError, ROLE_LABEL, selectedPortal, type ActivityItem, type HistoryScope, type InvitationHistoryItem, type UploadHistoryItem } from "../api/client";
import { useEveryFiveMinutes } from "./useEveryFiveMinutes";
import { useColorModeValue } from "../theme/color-mode";
import { useSettings } from "../settings/SettingsContext";

// Settings, History: what people did, uploads (single files and batches alike) and invitations sent, for this portal or, for an organisation administrator, every portal. Refreshes every five minutes.
// Activity shows where the portal's work, and so its usage, went (owner, 9 Nov 2026: "people need to see where their usage went"). Read-only.
const OUTCOME: Record<UploadHistoryItem["outcome"], { label: string; palette: string }> = {
  deleted: { label: "Deleted", palette: "gray" }, added: { label: "Added", palette: "green" }, added_needs_review: { label: "Added, needs review", palette: "orange" }, added_reviewed: { label: "Added, reviewed", palette: "green" }, being_read: { label: "Being read", palette: "blue" },
  not_added: { label: "Not added", palette: "red" }, held_for_review: { label: "Held for review", palette: "orange" }, cancelled: { label: "Cancelled", palette: "gray" },
};
const STATUS: Record<InvitationHistoryItem["status"], { label: string; palette: string }> = {
  accepted: { label: "Accepted", palette: "green" }, waiting: { label: "Waiting", palette: "blue" }, expired: { label: "Expired", palette: "gray" }, withdrawn: { label: "Withdrawn", palette: "gray" },
};
const MAIL: Record<string, string> = { not_sent: "Not sent", queued: "Sending", accepted: "Accepted by the mail server", previewed: "Preview only (not sent)", failed: "Could not be sent", expired: "Expired before sending" };
const when = (iso: string) => new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

export default function HistoryPanel({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  const { nouns } = useSettings();
  const [scope, setScope] = useState<HistoryScope>("portal");
  const [uploads, setUploads] = useState<UploadHistoryItem[] | null>(null), [uploadsError, setUploadsError] = useState("");
  const [invites, setInvites] = useState<InvitationHistoryItem[] | null>(null), [invitesError, setInvitesError] = useState("");
  const muted = useColorModeValue("gray.600", "gray.400"), border = useColorModeValue("gray.200", "gray.700"), activeBg = useColorModeValue("blue.50", "whiteAlpha.100");
  const [activity, setActivity] = useState<ActivityItem[] | null>(null), [activityError, setActivityError] = useState(""), [updated, setUpdated] = useState("");
  const why = (e: unknown) => (e instanceof ApiError ? e.message : "The history could not be loaded. Try again shortly.");
  const load = useCallback((first: boolean) => {   // a later refresh that fails keeps what is on screen; the time shown says how old it is
    const was = (set: (m: string) => void) => (e: unknown) => { if (first) set(why(e)); };
    const stamp = <T,>(set: (v: T) => void) => (v: T) => { set(v); setUpdated(when(new Date().toISOString())); };
    api.activityHistory(scope).then(stamp(setActivity)).catch(was(setActivityError));
    api.uploadHistory(scope).then(stamp(setUploads)).catch(was(setUploadsError));
    api.invitationHistory(scope).then(stamp(setInvites)).catch(was(setInvitesError));
  }, [scope]);
  useEffect(() => { setActivity(null); setUploads(null); setInvites(null); setActivityError(""); setUploadsError(""); setInvitesError(""); load(true); }, [load]);
  useEveryFiveMinutes(() => load(false));
  const org = scope === "org";
  const onThisBoard = (u: UploadHistoryItem) => !org || u.portalId === selectedPortal();   // "This portal" lists only the board's own portal
  const empty = (t: string) => <Text color={muted} py={4}>{t}</Text>;

  return (
    <Box>
      {isOrgAdmin && (
        <Flex gap={1} mb={4} p={1} borderWidth="1px" borderColor={border} borderRadius="md" w="fit-content" role="radiogroup" aria-label="Whose history">
          {(["portal", "org"] as const).map((k) => (
            <Box as="button" key={k} role="radio" aria-checked={scope === k} onClick={() => setScope(k)} px={3} py={1} borderRadius="sm" fontSize="sm"
              fontWeight={scope === k ? "semibold" : "normal"} bg={scope === k ? activeBg : "transparent"} transition="background .32s cubic-bezier(.16,1,.3,1)">
              {k === "portal" ? "This portal" : "Whole organisation"}
            </Box>))}
        </Flex>)}
      {updated && <Text fontSize="xs" color={muted} mb={2}>Updated {updated}; refreshes every 5 minutes.</Text>}
      <Tabs.Root defaultValue="activity" variant="line" lazyMount>
        <Tabs.List mb={4}><Tabs.Trigger value="activity">Activity</Tabs.Trigger><Tabs.Trigger value="uploads">Uploads</Tabs.Trigger><Tabs.Trigger value="invitations">Invitations</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="activity" className="rm-reveal">
          {activityError ? empty(activityError) : !activity ? empty("Loading…") : activity.length === 0 ? empty("Nothing has happened here yet.") : (
            <Box overflowX="auto"><Table.Root size="sm" variant="line">
              <Table.Header><Table.Row><Table.ColumnHeader>When</Table.ColumnHeader><Table.ColumnHeader>Who</Table.ColumnHeader><Table.ColumnHeader>What</Table.ColumnHeader>{org && <Table.ColumnHeader>Portal</Table.ColumnHeader>}</Table.Row></Table.Header>
              <Table.Body>{activity.map((a) => (
                <Table.Row key={a.id}>
                  <Table.Cell whiteSpace="nowrap">{when(a.at)}</Table.Cell>
                  <Table.Cell maxW="220px"><Text truncate title={a.who}>{a.who || "a former member"}</Text></Table.Cell>
                  <Table.Cell>{a.what}</Table.Cell>
                  {org && <Table.Cell>{a.portal}</Table.Cell>}
                </Table.Row>))}</Table.Body>
            </Table.Root></Box>)}
        </Tabs.Content>
        <Tabs.Content value="uploads" className="rm-reveal">
          {uploadsError ? empty(uploadsError) : !uploads ? empty("Loading…") : uploads.length === 0 ? empty("Nothing has been uploaded here yet.") : (
            <Box overflowX="auto"><Table.Root size="sm" variant="line">
              <Table.Header><Table.Row><Table.ColumnHeader>When</Table.ColumnHeader><Table.ColumnHeader>File</Table.ColumnHeader><Table.ColumnHeader>Type</Table.ColumnHeader>{org && <Table.ColumnHeader>Portal</Table.ColumnHeader>}<Table.ColumnHeader>Uploaded by</Table.ColumnHeader><Table.ColumnHeader>How</Table.ColumnHeader><Table.ColumnHeader>Outcome</Table.ColumnHeader><Table.ColumnHeader><Box as="span" srOnly>Record</Box></Table.ColumnHeader></Table.Row></Table.Header>
              <Table.Body>{uploads.map((u) => (
                <Table.Row key={u.id}>
                  <Table.Cell whiteSpace="nowrap">{when(u.at)}</Table.Cell>
                  <Table.Cell maxW="260px"><Text truncate title={u.fileName}>{u.fileName}</Text></Table.Cell>
                  <Table.Cell whiteSpace="nowrap">{u.kind === "cv" ? `${nouns.candidate.one} CV` : `${nouns.job.one} description`}</Table.Cell>
                  {org && <Table.Cell>{u.portal}</Table.Cell>}
                  <Table.Cell maxW="220px"><Text truncate title={u.uploadedBy}>{u.uploadedBy || "unknown account"}</Text></Table.Cell>
                  <Table.Cell>{u.viaBatch ? "Batch" : "Single file"}</Table.Cell>
                  <Table.Cell><Badge colorPalette={OUTCOME[u.outcome].palette} variant="subtle">{OUTCOME[u.outcome].label}</Badge>{u.reason && <Text fontSize="xs" color={muted} mt={1} maxW="260px">{u.reason}</Text>}</Table.Cell>
                  <Table.Cell whiteSpace="nowrap">{u.recordId && (onThisBoard(u)
                    ? <RouterLink to={`/dashboard?open=${u.kind === "cv" ? "candidate" : "job"}:${u.recordId}`} style={{ color: "var(--chakra-colors-blue-600)", textDecoration: "underline" }} aria-label={`Open ${u.fileName} on the board`}>Open</RouterLink>
                    : <Text fontSize="xs" color={muted}>In {u.portal}</Text>)}</Table.Cell>
                </Table.Row>))}</Table.Body>
            </Table.Root></Box>)}
        </Tabs.Content>
        <Tabs.Content value="invitations" className="rm-reveal">
          {invitesError ? empty(invitesError) : !invites ? empty("Loading…") : invites.length === 0 ? empty("No invitations have been sent here yet.") : (
            <Box overflowX="auto"><Table.Root size="sm" variant="line">
              <Table.Header><Table.Row><Table.ColumnHeader>Sent</Table.ColumnHeader><Table.ColumnHeader>To</Table.ColumnHeader>{org && <Table.ColumnHeader>Portal</Table.ColumnHeader>}<Table.ColumnHeader>Role</Table.ColumnHeader><Table.ColumnHeader>Invited by</Table.ColumnHeader><Table.ColumnHeader>Status</Table.ColumnHeader><Table.ColumnHeader>E-mail</Table.ColumnHeader></Table.Row></Table.Header>
              <Table.Body>{invites.map((i) => (
                <Table.Row key={i.id}>
                  <Table.Cell whiteSpace="nowrap">{when(i.sentAt)}</Table.Cell>
                  <Table.Cell maxW="240px"><Text truncate title={i.email}>{i.email}</Text></Table.Cell>
                  {org && <Table.Cell>{i.portal}</Table.Cell>}
                  <Table.Cell>{ROLE_LABEL[i.role] ?? i.role}</Table.Cell>
                  <Table.Cell maxW="220px"><Text truncate title={i.invitedBy}>{i.invitedBy}</Text></Table.Cell>
                  <Table.Cell><Badge colorPalette={STATUS[i.status].palette} variant="subtle">{STATUS[i.status].label}</Badge><Text fontSize="xs" color={muted} mt={1}>{i.status === "accepted" && i.acceptedAt ? when(i.acceptedAt) : i.status === "waiting" ? `until ${when(i.expiresAt)}` : ""}</Text></Table.Cell>
                  <Table.Cell><Text fontSize="sm">{MAIL[i.emailState] ?? i.emailState}</Text>{i.resends > 0 && <Text fontSize="xs" color={muted}>resent {i.resends}×</Text>}</Table.Cell>
                </Table.Row>))}</Table.Body>
            </Table.Root></Box>)}
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}
