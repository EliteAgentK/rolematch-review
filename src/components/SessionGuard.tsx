// Keeps a sign-in honest about its length (8 hours from signing in, for everyone: the platform's rule). A few minutes before the end
// it warns; at the end, or whenever the server says the person is no longer signed in, it covers the page with a "Session ended" window and
// lets them log in again right there. The page underneath never unloads, so anything they were typing is still there when they come back.
// If someone else signs in instead, the page reloads for them, so they never see the previous person's work.
import { Dialog, Field, Input, Portal, Stack, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError, type SessionWindow } from "../api/client";
import { Button } from "./ui/button";
import { DialogHeader } from "./ui/dialog";
import { toaster } from "./ui/toaster";

const SIGNED_IN_PAGES = ["/overview", "/dashboard", "/settings", "/profile"];
const CHECK_EVERY_MS = 15_000;   // a cheap clock check; also right after a computer wakes, when long timers are unreliable

type Known = SessionWindow & { userId: string; email: string };
type Ended = { reason: "ended" | "signed-out"; message?: string };

export default function SessionGuard() {
  const { pathname } = useLocation();
  const active = SIGNED_IN_PAGES.some((p) => pathname.startsWith(p));
  const known = useRef<Known | null>(null);
  const warned = useRef("");
  const [ended, setEnded] = useState<Ended | null>(null);
  const [learnt, setLearnt] = useState(0);   // bumped whenever new session times arrive, so the timers are set again at once

  useEffect(() => {
    const onSession = (e: Event) => {
      const d = (e as CustomEvent).detail;
      known.current = { endsAt: d.endsAt, warnMinutes: d.warnMinutes, userId: d.user?.userId ?? known.current?.userId ?? "", email: d.user?.email ?? known.current?.email ?? "" };
      setLearnt((n) => n + 1);
    };
    const onSignedOut = (e: Event) => {
      const { code, message } = (e as CustomEvent).detail as { code: string; message: string };
      // A page opened without signing in simply goes to the login page as before; this window is for a session that was running
      if (code === "AUTH-005") setEnded((x) => x ?? { reason: "ended", message });
      else if (known.current) setEnded((x) => x ?? { reason: "signed-out" });
    };
    window.addEventListener("rolematch:session", onSession);
    window.addEventListener("rolematch:signed-out", onSignedOut);
    return () => { window.removeEventListener("rolematch:session", onSession); window.removeEventListener("rolematch:signed-out", onSignedOut); };
  }, []);

  useEffect(() => {
    if (!active) return;
    const check = () => {
      const k = known.current;
      if (!k || ended) return;
      const left = Date.parse(k.endsAt) - Date.now();
      if (left <= 0) { setEnded({ reason: "ended" }); return; }
      if (left <= k.warnMinutes * 60_000 && warned.current !== k.endsAt) {
        warned.current = k.endsAt;
        const minutes = Math.max(1, Math.round(left / 60_000));
        toaster.create({ title: `Your session ends in ${minutes} minute${minutes === 1 ? "" : "s"}`, description: "Save what you are working on. You will be asked to log in again, and nothing on the page will be lost.", type: "warning", duration: 15_000, closable: true });
      }
    };
    check();
    // Exact timers for the warning and the end; the regular check covers a computer that slept through them
    const k = known.current, at = (ms: number) => Math.min(Math.max(0, ms - Date.now()) + 50, 2 ** 31 - 1);
    const exact = k ? [setTimeout(check, at(Date.parse(k.endsAt) - k.warnMinutes * 60_000)), setTimeout(check, at(Date.parse(k.endsAt)))] : [];
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => { exact.forEach(clearTimeout); clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [active, ended, learnt]);

  if (!active || !ended) return null;
  return <SessionEnded ended={ended} email={known.current?.email ?? ""} previousUser={known.current?.userId ?? ""} onBack={() => setEnded(null)} />;
}

function SessionEnded({ ended, email: lastEmail, previousUser, onBack }: { ended: Ended; email: string; previousUser: string; onBack: () => void }) {
  const [email, setEmail] = useState(lastEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  const logIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { user } = await api.login(email, password);
      if (!previousUser || user.userId !== previousUser) { window.location.assign("/overview"); return; }   // someone else: start clean, where signing in opens
      setPassword("");
      onBack();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That email or password is not right." : err instanceof ApiError ? err.message : "Logging in did not work. Check your connection and try again.");
    } finally { setBusy(false); }
  };

  return (
    // Cannot be closed without logging in; the blur keeps what was on screen unreadable to anyone passing by
    <Dialog.Root open role="alertdialog" placement="center" closeOnInteractOutside={false} closeOnEscape={false} initialFocusEl={() => passwordRef.current}>
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.700" backdropFilter="blur(14px)" />
        <Dialog.Positioner>
          <Dialog.Content as="form" onSubmit={logIn} maxW="420px">
            <DialogHeader fontSize="lg" fontWeight="bold">{ended.reason === "ended" ? "Session ended" : "You were signed out"}</DialogHeader>
            <Dialog.Body>
              <Stack gap={4}>
                <Text fontSize="sm" color="text.secondary">
                  {ended.reason === "ended"
                    ? "For security, a session ends a set time after signing in. Log in to carry on where you left off: anything you were typing is still on this page."
                    : "Your sign-in is no longer valid. Log in to carry on where you left off: anything you were typing is still on this page."}
                </Text>
                <Field.Root required>
                  <Field.Label fontSize="sm">Email</Field.Label>
                  <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field.Root>
                <Field.Root required invalid={!!error}>
                  <Field.Label fontSize="sm">Password</Field.Label>
                  <Input ref={passwordRef} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  {error && <Field.ErrorText>{error}</Field.ErrorText>}
                </Field.Root>
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="ghost" onClick={() => window.location.assign("/login")}>Use another account</Button>
              <Button type="submit" ml={3} loading={busy} loadingText="Logging in" disabled={!email || !password}>Log in</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
