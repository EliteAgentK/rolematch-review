import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Box } from '@chakra-ui/react'
import { Provider } from './theme/provider'
import CookieConsentBanner from './components/CookieConsentBanner'
import ReadOnlyNotice from './components/ReadOnlyNotice'
import SessionGuard from './components/SessionGuard'
import { PageFooter } from './components/Footer'
import PageFailed from './components/PageFailed'

// Fonts are served from this site (no request to a third party): Outfit for headings, Sora for text.
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import '@fontsource/sora/400.css'
import '@fontsource/sora/500.css'
import '@fontsource/sora/600.css'
import './theme/motion.css'

import { SettingsProvider } from './settings/SettingsContext'
import { forgetDemoProfiles } from './utils/forgetDemoProfiles'

forgetDemoProfiles()   // what an earlier version kept about people in this browser goes at once, on every page (code review, 16 Nov 2026)

// Pages, each loaded when it is first needed, so a visitor downloads only the page in front of them (owner, 11 Nov 2026, PageSpeed: the whole site,
// 500 KB, was downloaded and run before anything showed). The Overview and the Matching Board are fetched in the background, once the browser is idle,
// on every page someone signs in from or works in, so moving between them never waits on a download.
const pages = {
  home: () => import('./pages/HomePage'), features: () => import('./pages/FeaturesPage'), pricing: () => import('./pages/PricingPage'), contact: () => import('./pages/ContactPage'),
  login: () => import('./pages/LoginPage'), signup: () => import('./pages/SignupPage'), invite: () => import('./pages/AcceptInvitePage'),
  overview: () => import('./overview/OverviewPage'), board: () => import('./pages/Dashboard'), settings: () => import('./pages/SettingsPage'), profile: () => import('./pages/ProfilePage'),
}
// A page's code from an earlier release is gone once a new release is live (each release names its files afresh). A tab left open asks for the old
// file when someone moves to another page: rather than a blank screen (owner, 11 Nov 2026: pressed Shortlisted on the Overview right after a release), the
// tab reloads once, onto the new release. Should that not help, PageFailed (below) says so and offers to reload, so no one is left on an empty screen.
const RELOADED = 'rm-reloaded-for-new-release'
const onDemand = (load) => lazy(() => load().then((m) => { try { sessionStorage.removeItem(RELOADED) } catch { /* private window */ } return m }, (e) => {
  let first = false
  try { first = sessionStorage.getItem(RELOADED) !== '1'; sessionStorage.setItem(RELOADED, '1') } catch { /* private window */ }
  if (first) { window.location.reload(); return new Promise(() => {}) }
  throw e
}))
const HomePage = onDemand(pages.home), FeaturesPage = onDemand(pages.features), PricingPage = onDemand(pages.pricing), ContactPage = onDemand(pages.contact)
const LoginPage = onDemand(pages.login), SignupPage = onDemand(pages.signup), AcceptInvitePage = onDemand(pages.invite)
const OverviewPage = onDemand(pages.overview), Dashboard = onDemand(pages.board), SettingsPage = onDemand(pages.settings), ProfilePage = onDemand(pages.profile)
if (!['/', '/features', '/pricing', '/contact'].includes(window.location.pathname)) {
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 400))
  idle(() => { pages.overview().then(() => pages.board()).catch(() => {}) }, { timeout: 2000 })   // fetched ahead; a miss is fetched again when opened
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider>
      <BrowserRouter>
        {/* Main Application Layout */}
        {/* Nothing makes a page scroll sideways: an element sliding in from the side, or anything else wider than the screen, is clipped at the page's
            edge (layout audit, 11 Nov 2026). "clip", not "hidden": it is not a scrolling box, so the panels' tabs still stay in reach. */}
        <Box position="relative" minH="100vh" display="flex" flexDirection="column" overflowX="clip">
          <ReadOnlyNotice />
          {/* Warns before a sign-in ends and asks for the password again on the same page, so unsaved work is kept */}
          <SessionGuard />
          {/* The page and its footer appear together: while a page's code is still arriving, the screen shows only its plain ground, never a footer on
              its own (owner, 11 Nov 2026: the footer showed alone for a split second before the landing page). App pages are fetched ahead (above). */}
          <PageFailed>
          <Suspense fallback={null}>
          <Box flex="1" display="flex" flexDirection="column" css={{ "& > *": { flexGrow: 1 } }}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/features" element={<FeaturesPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
              <Route path="/dashboard" element={<SettingsProvider><Dashboard /></SettingsProvider>} />
              <Route path="/overview" element={<SettingsProvider><OverviewPage /></SettingsProvider>} />
              <Route path="/settings" element={<SettingsProvider><SettingsPage /></SettingsProvider>} />
              {/* With the settings, like the other signed-in pages: without them the page said "Organisation: Not given" (found 18 Nov 2026) */}
              <Route path="/profile" element={<SettingsProvider><ProfilePage /></SettingsProvider>} />
            </Routes>
          </Box>
          {/* The one footer, under every page (Footer.jsx) */}
          <PageFooter />
          </Suspense>
          </PageFailed>

          {/* Cookie Consent Banner - appears on all pages */}
          <CookieConsentBanner />
        </Box>
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
)
