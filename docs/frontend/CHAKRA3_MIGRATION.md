# Chakra UI 2.10 to 3.37 (2026-10-27)

**Pass rule (owner, 2026-10-27):** every screen and state looks exactly as before, pixel for pixel; any exception is shown to the owner.
**Result:** all 52 captured states (26 screens and states, light and dark, desktop 1440×900) are pixel-identical to the Chakra 2 build, with
zero differing pixels allowed, in two consecutive runs. No exceptions were needed.

## How it was checked

* `e2e/visual.spec.ts` (`npm run test:visual`) replays recorded server answers with a frozen clock, seeded randomness and reduced motion,
  and compares each screen with screenshots taken from the Chakra 2 build. The screenshots and recordings stay on the machine
  (`e2e/visual-data/`, git-ignored). Recording again needs the running server and a sign-in: `npm run test:visual:record`.
* While porting, both builds were also recorded element by element (`VISUAL_DUMP`), and `e2e/visual-diff.py` named the element and
  CSS property behind each difference.
* Two "before" screenshots (the home page, light and dark) were taken again from the Chakra 2 build: the originals had caught its
  entrance animations mid-way. The capture now waits for those animations on the public pages.

## What was done

* **Theme** (`src/theme/`): Chakra 3 starts from its bare base, and RoleMatch supplies Chakra 2's reset, tokens, state selectors and
  component styles, generated from or copied out of Chakra 2.10.10 (MIT), plus RoleMatch's own overrides.
* **Behaviour of the style system kept from Chakra 2:**
  * A component's own styles and the styles given on it combine Chakra 2's way: shallowly, a given key replacing the earlier one and
    moving to the end (`src/theme/index.ts`). Chakra 3 deep-merges, which changed which declaration won (for example card borders and
    heading sizes).
  * Colours that change with light and dark mode are CSS variables (`semantic-tokens.ts`), as Chakra 2 chose them per mode in JavaScript;
    a colour given directly on a component therefore still wins in dark mode.
  * `_hover`, `_dark`, `_groupHover` and the other state selectors are Chakra 2's (`conditions.ts`); "no outline" is still drawn as a
    transparent outline for Windows high-contrast mode; `lineClamp` writes what `noOfLines` did.
* **Small building blocks** (`src/components/ui/`) where Chakra 3's own components look or behave differently: buttons with icons and
  loading spinners, icon buttons, close buttons, tooltips (no delay, 8px away, allowed to reach the window edge), toasts, avatars (initials
  colour from the name), input groups, selects, switches, images (no forced crop; fallback picture), dialog headers and close buttons,
  menu items, and the icons from the retired `@chakra-ui/icons`.
* **Removed:** `@chakra-ui/icons`, `@emotion/styled`, the direct `framer-motion` dependency (still installed through `motion`), `src/theme.js`.
* **Added:** `@chakra-ui/react` 3.37.0 and its 88 dependencies (Ark UI, Zag, Floating UI; MIT and Apache-2.0). `npm audit`: 0 vulnerabilities.

## After the move

* The home page's flip cards had stopped flipping on hover: Chakra 3 reads a nested selector written without `&` (".flip-card-inner")
  as a property. Written as "& .flip-card-inner" it works again (the screenshots do not hover, so only a hover check found it).
* Measured against the Chakra 2 build (same pages, five runs, served from disk): the script is 7% larger (405 KB against 378 KB
  compressed), and pages are ready 10 to 30 ms later with 20 to 30 ms more script time. Not noticeable on a desktop; worth a
  look before phones are designed for.

## Found on the way, not changed (they behaved the same before; separate fixes)

* Features page: the two pictures (`features-hero.png`, `dashboard-preview.png`) are missing from the site, so the placeholder always shows.
* Contact page: "Request a Demo" was a button with an `href`, which browsers ignore; it never went anywhere (the `href` was dropped).
* Profile page: in the change-password window, Cancel closes the photo window instead and Apply saves the photo; the eye buttons have no label.
* Match window: the "Recruiter decision" box uses the colour `blue.950`, which does not exist, so in dark mode it has no background, and
  its Shortlist button's text colour `blue.950` is ignored, leaving white text on light cyan.
* The screenshots cover desktop only; phones get their own design later (owner, 2026-10-27).
