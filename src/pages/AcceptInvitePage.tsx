import { Box, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { forgetAll } from "../utils/warm";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, selectPortal, type InvitationLookup, type SessionUser } from "../api/client";
import { AlertIcon, AlertRoot } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { useColorModeValue } from "../theme/color-mode";

// What an invitation link opens. Before accepting, the page shows only who invited the person, to which organisation and portal, and the offered role:
// no recruitment data. The server decides everything (address match, organisation, single use, expiry); this page only explains the outcome.
const ROLE: Record<string, string> = { admin: "Portal administrator (manages members and settings)", recruiter: "Recruiter (uploads, reviews and matches)", hiring_manager: "Hiring manager / HR (read-only: sees shortlisted candidates)" };
// In the viewer's own time zone, named: RoleMatch may be used from anywhere (owner, 12 Nov 2026).
const localTime = (iso: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));

export default function AcceptInvitePage() {
  // The link carries the secret in the address. It is moved into this tab's session storage and removed from the address bar at once, so it is not left in history,
  // copied by sharing the page, or sent anywhere (the site also sends no referrer). A reload in the same tab still works.
  const [params] = useSearchParams();
  const [token] = useState<string>(() => { const t = params.get("token"); try { if (t) sessionStorage.setItem("rolematch.invite", t); return t ?? sessionStorage.getItem("rolematch.invite") ?? ""; } catch { return t ?? ""; } });
  useEffect(() => { if (params.get("token")) window.history.replaceState(null, "", window.location.pathname); }, [params]);
  const navigate = useNavigate();
  const [inv, setInv] = useState<InvitationLookup | null | undefined>(undefined);   // undefined = loading, null = not valid
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined);
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const bg = useColorModeValue("gray.50", "gray.900"), card = useColorModeValue("white", "gray.800"), muted = useColorModeValue("gray.600", "gray.400");
  const logo = useColorModeValue("/logo-light.png", "/logo-dark.png");

  useEffect(() => {
    if (!token) { setInv(null); return; }
    api.invitation(token).then(setInv).catch(() => setInv(null));
    api.me().then(({ user }) => setMe(user)).catch(() => setMe(null));
  }, [token]);

  const accept = async () => {
    setBusy(true); setProblem(null);
    try { const r = await api.acceptInvitation(token); try { sessionStorage.removeItem("rolematch.invite"); } catch { /* optional */ } selectPortal(r.portalId); navigate("/overview"); }
    catch (e) { setProblem(e instanceof ApiError ? { code: e.code, message: e.message } : { code: "NET", message: "The server could not be reached. Try again." }); }
    setBusy(false);
  };
  const switchAccount = async () => { forgetAll(); await api.logout().catch(() => {}); setMe(null); setProblem(null); };

  const mismatch = !!inv && !!me && me.email.toLowerCase() !== inv.email.toLowerCase();
  const enc = encodeURIComponent(token);
  return (
    <Box minH="100vh" bg={bg} display="flex" alignItems="center" justifyContent="center" py={10} px={4}>
      <Box maxW="md" w="full" p={8} bg={card} borderRadius="xl" boxShadow="xl">
        <Stack gap={5}>
          <Box asChild display="inline-block"><Link to="/"><img src={logo} alt="RoleMatch" height={36} style={{ height: 36 }} /></Link></Box>
          <Heading size="lg">Portal invitation</Heading>
          {inv === undefined && <Text color={muted}>Checking your invitation…</Text>}
          {inv === null && <AlertRoot status="error"><AlertIcon /><span>This invitation is not valid. It may have expired, been used, or been withdrawn. Ask the person who invited you for a new one.</span></AlertRoot>}
          {inv && (<>
            <Stack gap={1} fontSize="sm">
              <Text><b>{inv.inviterEmail}</b> has invited you to join a portal on RoleMatch.</Text>
              <Text color={muted}>Organisation: <b>{inv.orgName}</b></Text>
              <Text color={muted}>Portal: <b>{inv.portalName}</b></Text>
              <Text color={muted}>Your role: <b>{ROLE[inv.role] ?? inv.role}</b></Text>
              <Text color={muted}>Invited address: <b>{inv.email}</b></Text>
              <Text color={muted}>Expires: {localTime(inv.expiresAt)}</Text>
            </Stack>
            {problem && <AlertRoot status={problem.code === "INVITE-OTHER-ORG" ? "warning" : "error"}><AlertIcon /><span>{problem.message}</span></AlertRoot>}
            {me === undefined && <Text color={muted}>Checking who is signed in…</Text>}
            {me === null && (
              <Stack gap={2}>
                <Text fontSize="sm" color={muted}>Use the invited address, <b>{inv.email}</b>, to continue.</Text>
                <HStack gap={3} flexWrap="wrap">
                  <Button to={`/signup?invite=${enc}`}>Create account</Button>
                  <Button to={`/login?invite=${enc}`} variant="outline">I already have an account</Button>
                </HStack>
              </Stack>
            )}
            {me && !mismatch && !problem && <Button onClick={accept} loading={busy}>Accept invitation</Button>}
            {me && mismatch && (
              <Stack gap={3}>
                <AlertRoot status="warning"><AlertIcon /><span>You are signed in as <b>{me.email}</b>, but this invitation was sent to a different address. Sign out and sign in with the invited address, or ask for an invitation to this one.</span></AlertRoot>
                <Button variant="outline" onClick={switchAccount}>Sign out and switch account</Button>
              </Stack>
            )}
            {me && !mismatch && problem?.code === "INVITE-OTHER-ORG" && <Button variant="outline" to="/overview">Back to my workspace</Button>}
          </>)}
        </Stack>
      </Box>
    </Box>
  );
}
