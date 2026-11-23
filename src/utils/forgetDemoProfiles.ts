// Until 16 Nov 2026 the profile page kept people's profiles, photos and who was last signed in in this browser (the removed profileManager.js).
// Nothing reads them any more. This removes whatever an earlier version left behind, so nothing personal stays on a shared computer: it runs when
// the app starts and when someone signs out.
const OWNED = (key: string) => key === "rolematch_current_user" || key === "rolematch_user_email" || key.startsWith("profile_") || key.startsWith("user_photo_");

export function forgetDemoProfiles(): void {
  try {
    const owned: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && OWNED(key)) owned.push(key); }
    owned.forEach((key) => localStorage.removeItem(key));
  } catch { /* storage blocked: then nothing was kept either */ }
}
