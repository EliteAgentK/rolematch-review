# RoleMatch cookie policy (DRAFT, not live)

*Draft of 12 Nov 2026, written from what the site actually stores (`src/`), checked on that date.*

RoleMatch uses no advertising cookies and no third-party tracking or analytics. It stores only what it needs to work:

| Name | Kind | What it is for | How long |
|---|---|---|---|
| Your sign-in | Secure cookie set by RoleMatch | Keeps you signed in | Until you sign out, or the session ends (7 days unused, 30 days at most) |
| `rolematch.portal` | Browser storage | Remembers which of your company's portals you last opened | Until you sign out or clear it |
| `rolematch.invite` | Browser storage, this tab only | Holds an invitation while you finish joining | Until the tab closes |
| `rolematch.portalOpened`, `th_just_signed_up`, `th_welcome_back` | Browser storage, this tab only | Shows the opening screen and welcome once, not every time | Until the tab closes or you sign out |
| `rolematchDontShowTutorial` | Browser storage | Remembers that you closed the tutorial | Until you clear it |
| `rolematch_cookie_consent` | Browser storage | Remembers your answer to the cookie banner | Until you clear it |
| `chakra-ui-color-mode` | Browser storage | Remembers light or dark mode | Until you clear it |
| `rm-reloaded-for-new-release` | Browser storage, this tab only | Reloads the page once when RoleMatch is updated | Until the tab closes |
| `rolematch_current_user`, `rolematch_user_email`, `profile_<id>` | Browser storage | The profile page's own copy of your name, e-mail and photo **(see the point below)** | Until you clear it |

**Points for the owner:**

- The profile page still keeps people's names, e-mail addresses and photos in the browser itself (`src/utils/profileManager.js`), a leftover from
  the demo days (CLAUDE.md: "the profile page still uses browser-stored demo profiles"). On a shared computer the next person could see them. It should
  read from the account instead; until then the policy has to admit it.
- The cookie banner offers "analytics" and "marketing" choices, but RoleMatch has nothing in either category. Either remove those choices from the
  banner, or keep them only once something real uses them. Offering a choice that does nothing reads as careless to a corporate reviewer.

*Last updated: [DATE].*
