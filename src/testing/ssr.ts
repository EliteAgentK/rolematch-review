// For unit tests only (never imported by the application): renders a component to HTML text in Node, inside the same theme and settings providers the
// pages use, so a test can check what a panel offers (a button, a notice, a sentence) without a browser. Effects do not run in this kind of render, so it
// shows a component's first paint for the props given.
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The little of `window` the providers read while rendering: the device's light or dark setting, and listeners that are never called here. */
export function stubWindow() {
  const quiet = { matches: false, addEventListener() {}, removeEventListener() {} };
  (globalThis as { window?: unknown }).window ??= { matchMedia: () => quiet, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, innerWidth: 1280 };
}

/** The element's text as a person would read it, without markup or styles: one space between words. */
export async function renderText(element: ReactElement): Promise<string> {
  return (await renderHtml(element)).replace(/<style[^>]*>.*?<\/style>/gs, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export async function renderHtml(element: ReactElement): Promise<string> {
  stubWindow();
  const { Provider } = await import("../theme/provider");
  const { SettingsProvider } = await import("../settings/SettingsContext");
  return renderToStaticMarkup(h(Provider, null, h(SettingsProvider, { enabled: false, children: element })));
}
