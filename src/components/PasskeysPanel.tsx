import { Box, Field, Flex, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type PasskeyItem } from "../api/client";
import { createPasskey, passkeyCancelled, passkeysSupported } from "../utils/passkeys";
import { useColorModeValue } from "../theme/color-mode";
import { Button } from "./ui/button";
import { toaster } from "./ui/toaster";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "not yet");

/** A person's own passkeys. Adding or removing one needs a recent sign-in, so an unattended open session cannot quietly add a way in; the password is asked for here, in place. */
export default function PasskeysPanel() {
  const border = useColorModeValue("gray.200", "gray.700");
  const muted = useColorModeValue("gray.600", "gray.400");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<PasskeyItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<null | (() => Promise<void>)>(null);
  const [password, setPassword] = useState("");

  const load = useCallback(async () => { setItems((await api.passkeys()).passkeys); }, []);
  useEffect(() => { api.authMethods().then((m) => { setEnabled(m.passkey); if (m.passkey) void load(); }).catch(() => setEnabled(false)); }, [load]);

  // Runs an action; if the sign-in is no longer recent, asks for the password and then runs it again.
  const guarded = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (e) {
      if (e instanceof ApiError && e.code === "AUTH-RECENT") setConfirming(() => action);
      else if (!passkeyCancelled(e)) toaster.create({ title: "That did not work", description: e instanceof ApiError ? e.message : "Your device could not complete this. Try again.", type: "error", closable: true });
    } finally { setBusy(false); }
  };
  const add = () => guarded(async () => {
    const { challengeId, options } = await api.passkeyEnrolOptions();
    await api.passkeyEnrolVerify(challengeId, await createPasskey(options));
    await load();
    toaster.create({ title: "Passkey added", description: "You can now use it to sign in on this device.", type: "success", closable: true });
  });
  const remove = (p: PasskeyItem) => guarded(async () => { await api.passkeyRemove(p.id); await load(); toaster.create({ title: "Passkey removed", type: "success", closable: true }); });
  const confirm = async () => {
    setBusy(true);
    try { await api.reauthenticate(password); const again = confirming; setConfirming(null); setPassword(""); if (again) await guarded(again); }
    catch (e) { toaster.create({ title: "Not confirmed", description: e instanceof ApiError ? e.message : "Try again.", type: "error", closable: true }); }
    finally { setBusy(false); }
  };

  if (enabled === null) return null;
  if (!enabled) return <Text fontSize="sm" color={muted}>Passkey sign-in is not switched on for this environment. You sign in with your e-mail and password.</Text>;
  return (
    <Stack gap={4} maxW="620px">
      <Text fontSize="sm" color={muted}>A passkey lets you sign in without typing your password. Your device confirms it is you with Face ID, Touch ID, Windows Hello or a device PIN, if it has them. Your face or fingerprint stays on your device and never reaches RoleMatch. Your password keeps working, so losing a device never locks you out.</Text>
      {items.length === 0 && <Text fontSize="sm">You have no passkeys yet.</Text>}
      {items.map((p) => (
        <Flex key={p.id} borderWidth="1px" borderColor={border} borderRadius="md" p={3} align="center" justify="space-between" gap={3}>
          <Box minW={0}>
            <Text fontSize="sm" fontWeight="medium">{p.label}</Text>
            <Text fontSize="xs" color={muted}>Added {when(p.createdAt)} · Last used {when(p.lastUsedAt)}</Text>
          </Box>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => remove(p)}>Remove</Button>
        </Flex>
      ))}
      {confirming && (
        <Box borderWidth="1px" borderColor={border} borderRadius="md" p={4}>
          <Field.Root>
            <Field.Label fontSize="sm">For your security, confirm your password first</Field.Label>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && password) void confirm(); }} />
          </Field.Root>
          <HStack mt={3} gap={2}>
            <Button size="sm" tone="#007BA7" disabled={busy || !password} onClick={confirm}>Confirm</Button>
            <Button size="sm" variant="ghost" onClick={() => { setConfirming(null); setPassword(""); }}>Cancel</Button>
          </HStack>
        </Box>
      )}
      {passkeysSupported()
        ? <Box><Button size="sm" tone="#007BA7" disabled={busy || !!confirming} onClick={add}>{items.length ? "Add another passkey" : "Add a passkey"}</Button></Box>
        : <Text fontSize="sm" color={muted}>This browser cannot create passkeys. You can keep using your password.</Text>}
    </Stack>
  );
}
