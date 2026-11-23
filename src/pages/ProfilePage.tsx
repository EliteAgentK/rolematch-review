import { Alert, Badge, Box, Container, Field, Flex, Heading, Input, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiArrowLeft } from "react-icons/fi";
import { api, ApiError, type SessionUser } from "../api/client";
import DashboardNavbar from "../components/DashboardNavbar";
import BrandLoader from "../components/BrandLoader";
import { AlertIcon, AlertRoot } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { useColorModeValue } from "../theme/color-mode";
import { useOptionalSettings } from "../settings/SettingsContext";

// The signed-in person's own account, as the server holds it (code review, 16 Nov 2026). Until then this page was built on an invented demo file and
// profiles kept in the browser: it could show the previous person's name, photo and phone to whoever signed in next on the same computer, and its
// Change Password never changed a password. Nothing here is kept in the browser. A password is changed with a code sent to the person's own e-mail,
// the same check as a forgotten password, because the server holds no other way to prove it is them.

type Me = { user: SessionUser; portals?: { id: string; name: string; role: string }[] };
const MIN_PASSWORD = 12;   // the server's own rule (server/src/auth.ts)
const roleWords: Record<string, string> = { admin: "Administrator", recruiter: "Recruiter", hiring_manager: "Hiring manager (view only)", viewer: "View only" };
const roleOf = (r: string) => roleWords[r] ?? r.replace(/_/g, " ");

export default function ProfilePage() {
  const navigate = useNavigate();
  const orgName = useOptionalSettings()?.response?.orgName ?? "";   // the real name, even where the header hides it
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "sending" | "code" | "saving" | "done">("idle");
  const [code, setCode] = useState(""), [password, setPassword] = useState(""), [note, setNote] = useState<string | null>(null);
  const bg = useColorModeValue("white", "gray.800"), border = useColorModeValue("gray.200", "gray.700"), muted = useColorModeValue("gray.600", "gray.400");

  useEffect(() => { api.me().then(setMe).catch((e) => setProblem(e instanceof ApiError ? e.message : "Your account could not be loaded. Check your connection and reload the page.")); }, []);

  const sendCode = async () => {
    if (!me) return;
    setStep("sending"); setNote(null);
    try { await api.forgotPassword(me.user.email); setStep("code"); setNote(`A code is on its way to ${me.user.email}. Enter it below with your new password.`); }
    catch (e) { setStep("idle"); setNote(e instanceof ApiError ? e.message : "The code could not be sent. Try again in a moment."); }
  };
  const changePassword = async () => {
    if (!me) return;
    setStep("saving"); setNote(null);
    try { await api.resetPassword(me.user.email, code.trim(), password); setStep("done"); setCode(""); setPassword(""); }
    catch (e) { setStep("code"); setNote(e instanceof ApiError ? e.message : "The password could not be changed. Try again in a moment."); }
  };

  const row = (label: string, value: React.ReactNode) => (
    <Box><Text fontSize="sm" color={muted}>{label}</Text><Box fontWeight="medium" mt={1} wordBreak="break-word">{value || "Not given"}</Box></Box>
  );

  return (
    <Box minH="100vh" bg={useColorModeValue("gray.50", "gray.900")}>
      <DashboardNavbar onHelpClick={() => {}} />
      <Container maxW="3xl" py={8}>
        <Button variant="outline" size="sm" mb={4} leftIcon={<FiArrowLeft />} onClick={() => navigate("/dashboard")} data-testid="back-to-board">Back to the board</Button>
        <Heading as="h1" size="lg" mb={1}>Your account</Heading>
        <Text color={muted} fontSize="sm" mb={6}>As your organisation's RoleMatch holds it. Your name and role are set by your organisation's administrator.</Text>

        {problem && <AlertRoot status="error" borderRadius="md" mb={5} role="alert"><AlertIcon /><Alert.Description>{problem}</Alert.Description></AlertRoot>}
        {!me && !problem && <BrandLoader />}

        {me && (
          <Stack gap={6}>
            <Box bg={bg} borderWidth="1px" borderColor={border} borderRadius="md" p={6}>
              <Heading as="h2" size="md" mb={4}>Who you are</Heading>
              <SimpleGrid columns={{ base: 1, md: 2 }} gap={5}>
                {row("Name", me.user.name)}
                {row("E-mail", me.user.email)}
                {row("Organisation", orgName)}
                {row("Role in the organisation", roleOf(me.user.role))}
              </SimpleGrid>
              {!!me.portals?.length && (
                <Box mt={5}>
                  <Text fontSize="sm" color={muted} mb={2}>Portals you belong to</Text>
                  <Flex gap={2} wrap="wrap">{me.portals.map((p) => <Badge key={p.id} px={2} py={1} colorPalette="blue" variant="subtle">{p.name} · {roleOf(p.role)}</Badge>)}</Flex>
                </Box>
              )}
            </Box>

            <Box bg={bg} borderWidth="1px" borderColor={border} borderRadius="md" p={6}>
              <Heading as="h2" size="md" mb={1}>Password</Heading>
              <Text fontSize="sm" color={muted} mb={4}>To change it we send a code to {me.user.email}, so only you can. Changing it signs you out everywhere, this browser included.</Text>
              {note && <AlertRoot status={step === "code" ? "info" : "error"} borderRadius="md" mb={4} role="status"><AlertIcon /><Alert.Description>{note}</Alert.Description></AlertRoot>}
              {step === "done" ? (
                <AlertRoot status="success" borderRadius="md" role="status"><AlertIcon /><Alert.Description>
                  Your password has been changed. <Button variant="link" px={1} onClick={() => navigate("/login")}>Sign in again</Button> with your new password.
                </Alert.Description></AlertRoot>
              ) : step === "code" || step === "saving" ? (
                <Stack gap={4} maxW="sm">
                  <Field.Root required><Field.Label>Code from the e-mail</Field.Label><Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field.Root>
                  <Field.Root required invalid={!!password && password.length < MIN_PASSWORD}>
                    <Field.Label>New password</Field.Label>
                    <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <Field.HelperText>At least {MIN_PASSWORD} characters.</Field.HelperText>
                  </Field.Root>
                  <Flex gap={3} wrap="wrap">
                    <Button colorPalette="blue" loading={step === "saving"} disabled={!code.trim() || password.length < MIN_PASSWORD} onClick={changePassword}>Change password</Button>
                    <Button variant="ghost" onClick={() => { setStep("idle"); setNote(null); setCode(""); setPassword(""); }}>Cancel</Button>
                  </Flex>
                </Stack>
              ) : (
                <Button colorPalette="blue" variant="outline" loading={step === "sending"} onClick={sendCode}>Send me a code to change it</Button>
              )}
            </Box>

            <Text fontSize="sm" color={muted}>Passkeys, for signing in without a password, are in <Button variant="link" px={1} onClick={() => navigate("/settings")}>Settings, Security</Button>.</Text>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
