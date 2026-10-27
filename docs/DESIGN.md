# TaskMaster Web — Design Document

Next.js frontend for the TaskMaster API ([Airtribe_TaskMaster](https://github.com/utkarsh-vats/Airtribe_TaskMaster)). It implements the Claude Design prototype (`design/prototype/`) on top of the existing REST API, without backend feature changes.

**Stack:** Node.js 22, TypeScript (strict), Next.js (latest stable, App Router), Tailwind CSS v4, Radix UI primitives, TanStack Query, openapi-typescript + openapi-fetch, react-hook-form + Zod, Vitest + Testing Library + MSW, Playwright.

---

## 1. Scope

| In scope | Out of scope |
|---|---|
| Sign in / create account, session restore, log out, log out everywhere | Password reset ("Forgot password?" in the prototype — no API) |
| App shell: header, sidebar, mobile drawer, light/dark theme | Global cross-project search |
| Projects: list, create, edit, delete, leave | Email delivery, avatars upload (avatar is a URL) |
| Tasks: list (rows / table) and board, full filter bar, detail panel, create with AI description | Offline support |
| Comments and attachments (task-level and project-level) | Real-time collaborative editing |
| Members, roles, ownership transfer, invitations (send, revoke, accept, decline) | Task keys like `TM-101` (API ids are UUIDs) |
| My tasks, notifications (panel, page, live via SSE), profile, change password | |
| Tests, CI, Docker image | |

---

## 2. Key decisions

| Concern | Choice | Why |
|---|---|---|
| Repo | Separate repo `Airtribe_TaskMaster_Web` | Backend submission stays untouched; independent CI |
| Framework | Next.js App Router, mostly client components for data views | The API needs a bearer token held in browser memory, so data is fetched client-side; layouts and static chrome stay server components |
| Styling | Modernist `styles.css` + `taskmaster-tokens.css` as the base layer, Tailwind v4 for layout | The prototype is built on these classes (`.btn`, `.tag`, `.field`, `.card`, `.table`, `.dialog`, `.seg`, `.nav`); reuse them instead of re-creating them |
| UI primitives | Radix UI (Dialog, DropdownMenu, Popover, Tooltip, Tabs, Select-free) styled with the Modernist classes | Accessible behaviour (focus traps, keyboard, ARIA) without fighting a pre-styled kit. shadcn/ui is not used: its rounded defaults contradict the zero-radius system |
| Icons / font | lucide-react; Archivo via `next/font/google` | What the design system specifies |
| Toasts | sonner, styled flat (0 radius, 2px rule) | Small, accessible |
| Board drag & drop | @dnd-kit | Touch and keyboard support (the prototype uses native HTML5 drag, which fails on mobile) |
| Server state | TanStack Query | Caching, invalidation, optimistic updates, retries |
| API types | Generated from the backend's `/openapi.json` with openapi-typescript; calls through openapi-fetch | Request/response types can't drift from the API |
| Forms | react-hook-form + Zod (limits mirror the API) | Inline validation, 422 `details` map onto fields |
| URL state | Filters, sort, page, view and the open task live in the URL, read with `useSearchParams` and parsed with Zod (`src/features/tasks/filters.ts`); URLs built with the in-house `useUrlWith` helper — no nuqs | Shareable, back-button friendly; invalid params are dropped instead of breaking the page |
| Live updates | `@microsoft/fetch-event-source` | Browser `EventSource` can't send an `Authorization` header |
| Theme | `data-theme="light|dark"` on `<html>` via next-themes (`attribute="data-theme"`) | Matches the token files; no flash on load |

---

## 3. Authentication (token handler pattern)

The browser never sees the refresh token.

```
Browser ──(credentials)──▶ Next route handler /api/auth/login ──▶ API /auth/login
        ◀── { accessToken, expiresIn, user } + Set-Cookie: tm_refresh (httpOnly) ──
Browser ──(Bearer accessToken)──────────────────────────────────▶ API (all other calls, direct)
```

- **Route handlers** (`app/api/auth/*`): `login`, `register`, `refresh`, `logout`, `logout-all`. They call the API server-side, put the refresh token in an `httpOnly; Secure (prod); SameSite=Lax; Path=/` cookie `tm_refresh` with the refresh TTL as `Max-Age`, and return only `{ accessToken, expiresIn, user }`.
- **Access token** lives in memory only (a module-level store, `src/lib/auth/store.ts`, read with `useSyncExternalStore`). Lost on reload → restored by `SessionProvider` calling `/api/auth/refresh` (the cookie rides along). `SessionProvider` is mounted in the dashboard layout only, so visiting `/`, `/login` or `/register` never rotates the refresh token.
- **Refresh outcomes:** only an auth failure ends a session — 401 or another 4xx (e.g. 400) from the refresh → signed out, and the route clears the cookie. A 429 or 5xx never does: the route keeps the cookie (a 429 passes through with its `Retry-After` / `RateLimit-*` headers). 5xx / network → nothing changes: a signed-in user stays signed in (and the proactive refresh retries in 30 s); a session being restored shows "Can't reach TaskMaster" with *Try again* instead of redirecting to `/login` (which would loop once the guard sends signed-in users back). 429 → a signed-in user keeps their in-memory token and the refresh retries after `Retry-After` (default 30 s); a session being restored shows the same screen with "Too many requests — retrying in {n} s", counts down and retries by itself (*Try again* still works). The proactive refresh runs 60 s before `expiresAt` (or halfway for tokens shorter than 2 min).
- **Single-flight refresh.** The backend treats a reused refresh token as theft and revokes every session. So:
  - within a tab, concurrent 401s share one refresh promise;
  - across tabs, the refresh call runs inside `navigator.locks.request('tm-refresh', …)`; the next tab to get the lock sends the already-rotated cookie.
- **401 handling:** `TOKEN_EXPIRED` → refresh once and retry the request once (from a clone taken before sending, so POST/PATCH bodies survive; a retry is never retried). If another request already refreshed while this one was in flight, the retry reuses that token instead of refreshing again. Any other 401, or a rejected refresh → clear the session and the query cache and go to `/login?next=<path>` (a full page load). If the refresh was rate limited or the API is down, the request fails with its 401 and the user stays signed in. `/api/auth/*` calls never go through this.
- **Route guard:** `src/proxy.ts` (Next 16 renamed middleware to proxy), matcher `/dashboard/:path*`, `/login`, `/register` only — never `/`, `/api`, `_next` or static files. It only checks that the `tm_refresh` cookie is present and non-empty; the API is the real authority.
  - `/dashboard/**` without the cookie → 307 `/login?next=<path + query>`.
  - `/login` and `/register` with the cookie → 307 `safeNext(?next)`.
  - `/` is never redirected — the marketing landing is reachable signed in or not.
- **Safe `next`** (`src/lib/auth/safeNext.ts`, used by the guard and the login / register forms): kept only if, raw and decoded once, it is `/dashboard`, `/dashboard/…` or `/dashboard?…` with no leading `//`, backslash, scheme, control character or `.` / `..` segment, and the URL parser agrees it resolves under `/dashboard`; otherwise `/dashboard`. The query string is preserved.
- **After login / register:** client-side `router.replace(safeNext(next))`, so the in-memory session is kept (no second refresh on arrival). If registration succeeds but its automatic sign-in fails → `/login?next=…` with the toast "Account created — please sign in." Form errors: `INVALID_CREDENTIALS`, 429, network and 5xx → a form-level alert under the heading (focused); 422 details → the fields (first one focused), unplaced ones → the alert; register 409 → the email field ("An account with this email already exists.").
- **Stale cookie, no loop:** `/login` with a stale cookie → `/dashboard` → `SessionProvider`'s restore gets a 401 → the refresh route clears the cookie → client goes to `/login?next=…` → no cookie, so `/login` renders. If the API is unreachable the refresh route keeps the cookie and `SessionProvider` shows *Try again* rather than redirecting, so that path can't loop either (`tests/unit/auth/guardLoop.test.tsx` walks both).
- **Server-side session check:** `src/lib/auth/hasSession.ts` (cookie presence via `next/headers`) — used by the marketing header to show "Go to dashboard" and reused by the guard logic.
- **Logout** (`signOut()`): `/api/auth/logout` revokes the refresh token and clears the cookie (failures ignored — the route clears the cookie either way); then the client drops the access token and the query cache, broadcasts `signed-out` and goes to `/login`. Calling it twice sends one request. A deliberate sign-out suppresses `SessionProvider`'s `/login?next=…` redirect.
- **Log out everywhere** (`signOutEverywhere()`): fresh token first — if the access token is missing or expires within 30 s, refresh before calling `/api/auth/logout-all` with `Authorization: Bearer`, so the call can't fail with `TOKEN_EXPIRED` halfway. 204 → local sign-out + toast "Signed out on all devices."; 401, or no token even after refreshing → local sign-out + "Signed out on this device. Sign in again to sign out everywhere."; network / 5xx → nothing happened server-side, so the user stays signed in and gets an error toast. From the menu it navigates client-side (`router.replace`) so the toast survives.
- **Cross-tab sync:** `BroadcastChannel('tm-auth')` (no-op where unsupported), messages `{ type, tabId }`; a tab ignores its own. `signed-out` → other tabs on `/dashboard/**` drop their session and cache and go to `/login`; `signed-in` (after `signIn` / `register`) → other tabs on `/login` or `/register` go to `safeNext(their next)`. Tabs on other pages (e.g. `/`) aren't moved.
- **Change password** revokes all refresh tokens on the API, so the UI signs out and sends the user to log in again with a toast explaining why.

**Backend settings this needs:** `CORS_ORIGIN=http://localhost:3001` (the web app's dev URL). For production behind one proxy, the route handlers must forward the client IP (`X-Forwarded-For`) and the backend needs `app.set('trust proxy', 1)`; otherwise every login shares one rate-limit bucket. Recorded as a follow-up (§13), not part of these steps.

---

## 4. Routes

Three areas, each with its own layout: **marketing** (`(marketing)` route group), **auth** (`(auth)` route group) and the signed-in app under **`/dashboard`**.

| Route | Screen | Notes |
|---|---|---|
| `/` | Marketing landing | Always reachable, signed in or not. Header shows "Sign in" / "Create account", or "Go to dashboard" when signed in. Currently a "Coming soon" page |
| `/login`, `/register` | Auth split screen (accent panel + form) | Signed in → `/dashboard`. Prototype's segmented "Sign in / Create account" switch; `?next=` honoured |
| `/dashboard` | → redirects to `/dashboard/my-tasks` | |
| `/dashboard/my-tasks` | Tasks assigned to me across projects | Same filter bar minus assignee; each row shows its project |
| `/dashboard/projects` | Projects card grid (1 / 2 / 3 columns at < 820 / ≥ 820 / ≥ 1200 px), 24 per page via `?page=` | Mobile entry point; on desktop the sidebar covers it. `?new=1` opens the New project dialog (the sidebar's link); closing it drops the param with `replace`. Creating a project goes to its tasks |
| `/dashboard/projects/[projectId]` | → `/dashboard/projects/[projectId]/tasks` | |
| `/dashboard/projects/[projectId]/tasks` | List or board (`?view=board`; the list is the default and isn't written), filters in the URL, task panel via `?task=<id>` | The toolbar's small List / Board switch pushes the change, keeping the filters and dropping the page. The board ignores `?status` (its columns are the statuses) and has no pages: each column loads up to 100 tasks (the API's cap) with the other filters and sort, and a column holding more shows "Showing 100 of N" with "See all in the list" (the list filtered to that status, other filters kept). Filters: `?status=` (comma list; the segmented control sets one value, and a multi-value link highlights no option), `?q=` (1–200 chars); invalid values are dropped. Filter params are written first in a fixed order; any filter change resets the page. Search below 820 px lives in the toolbar (debounced 300 ms, history replace). 25 per page via `?page=` (page 1 drops the param). Table from 820 px, rows below — both rendered, CSS shows one. `?task` (panel) and `?new=1` (New task dialog) are mutually exclusive: setting one removes the other. `?column=IN_PROGRESS|COMPLETED` (not a filter; junk ignored, To do omitted) is the board column New task adds to, and leaves together with `?new` |
| `/dashboard/projects/[projectId]/discussion` | Project-level comments | Not in prototype — same thread component as the task panel |
| `/dashboard/projects/[projectId]/files` | Project-level attachments | Not in prototype — same attachment list component |
| `/dashboard/projects/[projectId]/members` | Invite form, members table, invitations table | Per prototype |
| `/dashboard/projects/[projectId]/settings` | Project details, danger zone | Per prototype |
| `/dashboard/invitations` | Invitations sent to me — Accept / Decline | Not in prototype — styled like its lists (§9 Invitations inbox) |
| `/dashboard/notifications` | Full notifications list | Header panel shows the latest 10 |
| `/dashboard/profile` | Profile, password, sign out | Per prototype, plus bio and avatar URL |
| `/dev/ui` | Component showcase | Dev only — `notFound()` in production |
| not found | "Project not found" / generic 404 | The API returns 404 for projects you're not in (and 422 for a malformed id): both show "Project not found" inside the dashboard shell, with a link to `/dashboard/projects` |

---

## 5. Prototype → API mapping

The prototype was built on demo data. Where it differs from the API, the API wins:

| Prototype | Implementation |
|---|---|
| Status `TODO / IN_PROGRESS / DONE` | API `OPEN / IN_PROGRESS / COMPLETED`, labelled "To do / In progress / Done" with the same tags (`tag-neutral`, `tag-accent`, `tag-outline`) |
| Priority `HIGH / MEDIUM / LOW` | API adds `URGENT`: label "Urgent", priority mark in `--tm-danger`, bold label. Order Urgent → Low |
| Task key `TM-101` | Not shown (no sequential ids). The panel breadcrumb is `Project / Task` |
| Status select in "New task" | API creates every task as `OPEN`. The modal has no status field; "Add task" at the bottom of a board column (ghost button, Plus icon) opens it with `?new=1&column=<status>`, then the task is created and PATCHed to that status |
| Due date is a date input | Sent as end of that day in the user's timezone, ISO 8601 with offset (`2026-10-28T23:59:59+05:30`); displayed as a date. Date-only values (the `dueFrom` / `dueTo` filters, YYYY-MM-DD) are calendar days, shown with `formatDay()` (`src/lib/format/dates.ts`), which never shifts the day with the time zone |
| Status filter with counts | Counts come from 4 `limit=1` list queries reading `meta.total`, cached with the list |
| Header "Search tasks" | Searches the current project (`q` on the task list); on `/dashboard/my-tasks` it searches my tasks |
| Sidebar project count | API gives `memberCount`, not open-task count; the sidebar shows the role tag instead of a number |
| Invitations "Resend" | No resend endpoint. Pending rows: **Revoke**. Expired rows: **Invite again** (creates a new invitation with the same email and role; hidden on an ADMIN invitation unless you're the OWNER). The table lists PENDING and EXPIRED: two requests (`status=PENDING`, `status=EXPIRED`, 50 each — the API filters one status at a time and reports a lapsed PENDING invitation as EXPIRED), merged newest first |
| Notification "is overdue" / "accepted your invitation" | Not produced by the API. Notifications show the five API types only (§9) |
| Members role select (Admin / Member) | Owner also gets **Make owner** (transfer; confirm dialog "Transfer ownership to {name}?" — "You'll become an admin…"). Below 820 px the row's actions sit in a menu, the role as "Make admin" / "Make member" |
| Register hint "one number" | API only requires 8–128 characters; hint says "At least 8 characters" |
| List density A / B / C (demo toggle) | Desktop: table (B). Below 820 px: rows (A). Grouped (C) is dropped |
| Profile: name + email | Adds bio (≤ 500) and avatar URL; email stays read-only |
| AI draft (priority + checklist JSON) | Uses `POST /ai/task-description` → plain description only, in the New task dialog (not the panel). Sends the trimmed title, plus the description typed so far as `notes`. The draft replaces the description; an Undo button restores the previous text until the description is edited or drafted again. 503 `AI_DISABLED` shows "AI drafting isn't available right now." for that open dialog and hides the row for the rest of the browser session (in memory, not storage); 502 shows "AI couldn't respond — try again."; 429 shows "Too many AI requests — wait a minute." Closing the dialog aborts the request |
| Task panel has comments only | Adds an Attachments section (upload, list, download, delete) |

---

## 6. Layout and components

**Shell (≥ 820 px):** sticky header bar (brand, search, theme switch, notifications button with unread badge, profile menu). Search: on a project's task list or My tasks it sets `?q` in place (other params kept, page reset); anywhere else it opens My tasks with `?q`; `/` focuses it, Esc clears. The badge reads `meta.unreadCount` from `GET /notifications?unread=true&limit=1` (own query key, polled every 60 s while visible; SSE takes over in 12c), hidden at 0, `99+` above 99 over a 2-column body: a 240 px sidebar (sticky under the header, scrolls on its own, 2px right rule) and `main`. The sidebar (`SidebarNav`, shared with the drawer) has personal links — My tasks, Invitations (badge = pending invitations from `GET /users/me/invitations`), Notifications — then "Projects" from `GET /projects?limit=100` in API order (name truncated with a title, small role tag; "View all projects" when `meta.total` > 100; skeleton / compact error with retry / "No projects yet"), then *New project* → `/dashboard/projects?new=1`. Active links get `aria-current="page"` and the prototype's accent-100 highlight. **< 820 px:** the sidebar moves into a left drawer opened by the header's menu button; it closes on navigation (including a link to the current page), Esc or an overlay click, and returns focus to the menu button; project switching uses the prototype's select; search moves into the tasks toolbar. **< 480 px:** the header's gaps and padding tighten and the profile trigger shows the avatar only (no first name), so the bar fits a 360 px screen; only the brand name may truncate.

**Project header:** kicker "Project", role tag, name (h2; below 820 px a select of my projects that keeps the current tab), description, tabs: Tasks · Discussion · Files · Members · Settings (2px accent underline on the active tab, per prototype). `src/app/dashboard/projects/[projectId]/layout.tsx` renders `ProjectShell`, which loads the project and provides `ProjectContext` (`project`, `myRole`, §8 permissions bound to the signed-in user). The page title "{name} · TaskMaster" is a React `<title>` rendered by the shell; the layout sets `title: null` because the server can't fetch the name (no token). On the Discussion, Files and Members tabs the shell's title is "{Tab} · {name} · TaskMaster".

**Members tab** (`MembersView`, prototype Members tab): sections stacked up to 960px wide, each after the first behind the 2px rule — **Invite people**, **Members**, **Pending invitations**.

Invite people (`InviteSection`): for ADMIN+ a form — Email (trimmed, lowercased, ≤ 254) + Role + primary **Send invite** (disabled until the email is valid, spinner while sending). The OWNER picks Member (default) or Admin; an ADMIN's role is a fixed Member tag (only the OWNER invites admins). Success: toast "Invitation sent to {email}", the form resets and the invitations refetch. A 409 (already a member / already invited) puts the API's message under Email; a 422 maps `details` onto the fields; anything else toasts. MEMBERs see the heading and the prototype's muted "Only owners and admins can invite people or change roles."

Pending invitations (`ProjectInvitationsSection`, ADMIN+ only — not rendered or fetched for MEMBERs): h4 + muted count. ≥ 820px a table — Email, Role (RoleTag), Sent (relative), Expires (`timeUntil`, "in 5 days"; "Expired" in the danger colour), action; below 820px stacked rows with the same. PENDING → ghost danger **Revoke** → "Revoke the invitation to {email}?" / "They won't be able to join with this invitation." (Revoke, danger) → DELETE; the lists refetch after it, success or not. A 409 (no longer pending) toasts the API's message, a 404 just closes; other errors keep the dialog open. EXPIRED → ghost **Invite again**. Empty: "No pending invitations." under the 2px rule; loading (first load only): skeleton rows; error (a first load that failed): compact ErrorState with Try again. Once both lists have loaded, the rows stay up while either refetches, and after a failed background refetch.

Relative times: `relativeTime` is for past events (comments, files, Sent) and shows any future instant as "just now" — the server's clock may run ahead of the viewer's, so a past event never reads "in 2 min". Deadlines use `timeUntil`: "in 5 min", "in 3 h", "Tomorrow", "in 5 days", then the date ("in under a minute" when it's that close or already past); the caller decides "Expired" (the Expires column goes by the invitation's status). Members: h4 + muted count, then the members in API order (OWNER, ADMINs, MEMBERs, each by join date). ≥ 820px a table (min 560px): Name (avatar, name with a muted "(you)" for the signed-in user, email muted below), Role (RoleTag), Joined (short date, full date/time in the title) and an actions column for 10b. Below 820px stacked rows: avatar, name + "(you)", email, then RoleTag and "Joined {date}". Loading: a 3-row TableSkeleton (stacked placeholders below 820px); error: ErrorState with Try again. No empty state — a project always has its owner.

Member actions (§8, from ProjectContext's bound checks; ≥ 820px in the actions column, below in a per-row menu): the OWNER gets an Admin / Member select on other non-owner rows (PATCH `{ role }`, select disabled with a spinner while saving, not optimistic — the response is the full member list and becomes the members cache) and **Make owner** (in a ⋯ menu) → "Transfer ownership to {name}?" / "You'll become an admin. Only {name} will be able to delete the project, change roles or invite admins." → toast "{name} is now the owner."; the project and projects list are refetched, so the header's role tag and every action update. **Remove** (ghost danger, `can.removeMember`) → "Remove {name}?" / "Their open tasks will be unassigned. Their comments and files stay." → DELETE, then the members, the project, its task queries and the projects list are refetched; toast "{name} was removed.". **Leave project** on your own row (not the OWNER, who sees "Transfer ownership before leaving.") → "Leave {project}?" / "Your open tasks will be unassigned and you'll lose access to this project." → DELETE yourself, go to /dashboard/projects, toast "You left {project}."; nothing of the project is refetched on the way out, and its cache is dropped once its pages unmount. Errors: 409 toasts the API's message; 404 refetches the members and toasts "That person is no longer a member." (closing the dialog; when leaving, a 404 counts as having left); others toast as usual. Dialogs stay open on any error but a 404.

**Discussion & Files tabs** (`ProjectDiscussion`, `ProjectFiles`): the same `CommentThread` / `AttachmentList` with `taskId` null (`taskId=none`), max 760px wide. Discussion: heading "Discussion" + the thread total, composer placeholder "Write to the whole project", empty "No discussion yet — start the conversation."; posts carry no `taskId`. Files: heading "Files" + the list total, empty "No project files yet. Upload one, or drop it here."; uploads carry no `taskId`. Everything else (Load more, edit/delete permissions, uploads, downloads, delete) is as in the task panel; both components take optional `heading` and `emptyText`, and the thread takes `placeholder`, for this.

**Task toolbar and filters:** one row (list and board): status segmented control (list only) · **Filters** toggle · Sort select + order toggle · List / Board switch · New task. There's no visible "N tasks" line: the status counts and column headers show the numbers, and a screen-reader-only polite live region announces "{n} tasks" / "No tasks match" when the list result changes. From 820 px the Filters toggle (SlidersHorizontal, active-count badge, ChevronDown that turns when open; `aria-expanded` + `aria-controls`) shows and hides the filter row — priority, assignee, created by, due range, overdue, Clear filters — with a height/opacity transition that's instant under `prefers-reduced-motion` (and skipped when a remembered-open row first renders). The row is collapsed by default and the choice is remembered per browser in `localStorage` (`tm.taskFilters.open`; blocked storage → remembered for the page only). While it's collapsed and any row filter is active, a chip row sits under the toolbar: "Priority: Urgent, High", "Assignee: Me", "Created by: Priya Raman", "Due: Oct 20 – Oct 25" (or "from …" / "until …"), "Overdue", each with an × that removes just that filter (page reset), plus **Clear all**, which removes the chips' filters but keeps status, search and sort. Status and search have their own controls, so they get no chips. Below 820 px nothing changes: a Filters button (same badge) opens a sheet with the filters and the sort. The toggle, chips and sort controls are separate components, for reuse on My tasks.

**Task panel:** right-side sheet (full screen on mobile), deep-linked by `?task=`. Title as an auto-growing textarea; Status / Priority / Assignee / Due in a 2-column grid; Description; Attachments; Comments with composer; footer "Created by … · date" and Delete. Fields the user can't edit render read-only with a tooltip. Opening from the list pushes a history entry (Back closes it); closing from inside — X, Esc, overlay — goes back when this tab pushed that entry and otherwise (deep link, reload) replaces the URL without `?task`, so there's never a duplicate entry; focus returns to the row that opened it (`src/features/tasks/panelHistory.ts`). While the detail loads, the matching cached list row is shown as placeholder data; detail-only fields (counts) appear when it arrives. 404 / 422 → "Task not found".

**CollapsibleSection** (`src/components/ui/CollapsibleSection.tsx`): the h4 holds a button — title, muted count, chevron — with `aria-expanded` / `aria-controls`; an optional actions slot on the right (e.g. Upload) isn't part of the toggle, and stays usable while closed. Open by default; open / closed is remembered per key in localStorage (`tm:section:<key>`, every access guarded, in memory for the page when storage is blocked). The section is labelled by its title alone.

**Attachments order and cap:** newest first everywhere — the API already returns them newest first (no sort parameters), so that order is used as is: Load more appends older pages, a new upload is prepended, and files being uploaded show above the list. In the task panel the list is a CollapsibleSection (key `task-attachments`) showing the 3 newest, then a ghost **Show N more** / **Show less** (N counts every file, loaded or not; hidden with 3 or fewer; Load more only once expanded). A file just uploaded is the top row, so it's always visible; deleting keeps the expanded state. The Files tab is a full page: no cap, not collapsible.

**Attachments** (`AttachmentList`, above Comments in the task panel; the project's Files tab with `taskId` null → `taskId=none`): h5 "Attachments" + muted count (in the panel, the task's `attachmentCount` once the full task is in; elsewhere the list's total). Rows: a lucide icon by MIME type (FileImage, FileSpreadsheet for CSV / Excel / ODS, FileArchive, FileText for text / PDF / Word, else File), the name truncated (full name in the title), muted "{size} · {uploader} · {relative time}" (`formatBytes`: binary units, "512 B" / "3.4 MB" / "12 KB"), and an icon-only Download button ("Download {name}") with its own spinner while that file downloads. Newest first, 50 a page, **Load more**. Empty: "No files yet."; loading: 2 skeleton rows; error: compact ErrorState with Try again. **Upload** (secondary, Paperclip) opens a multi-file input (`accept` = the allowlist); files can also be dropped on the list (2px accent outline, accent-100 tint while dragging). Files upload one at a time; each has a row with name, size, a progress bar and Cancel; failures show their message with Retry (not for pre-check failures) and Dismiss. Uploads still running when the list unmounts are cancelled. Delete: icon-only Trash2 ("Delete {name}") for the uploader or ADMIN+, ConfirmDialog "Delete this file?"; a 404 counts as deleted ("That file was already deleted."). **Preview** (`AttachmentPreview`): the file's name is a button (click or Enter) opening a large dialog (`min(92vw, 1000px)`, body up to 80vh). Header: the name (truncated), muted "{size} · {uploader}", Download and Close. By type (`previewKind`): PNG / JPEG / GIF / WebP → `<img>` (object-fit contain, alt = name); PDF → `<iframe title={name}>`; text/plain and text/csv → the decoded text in a wrapping `<pre>` (plain text, never HTML), the first 1 MB only with "Preview truncated — download for the full file."; anything else (SVG included) → the type's icon, "No preview for this file type." and a primary Download, with nothing fetched up front. The file comes from `fetchAttachmentBlob()` (same client path as downloads) in a query with `gcTime: 0`, so closing or moving on aborts it; images and PDFs use an object URL that is revoked when the element goes. Loading: a skeleton block; 404: "This file is no longer available."; other errors: ErrorState with Try again. The header's Download saves the already-fetched Blob when there is one. Previous / Next (and ← / →, except while typing in a field) move through all the list's loaded files, "{i} of {n}"; hidden for a single file. The row's Download icon still downloads directly.

**Comments** (`CommentThread`, in the task panel; the project's Discussion tab with `taskId` null → `taskId=none`): a CollapsibleSection (key `task-comments` / `project-discussion`) titled "Comments" (or "Discussion") with the thread's `meta.total` — top-level comments, kept right in the cache on post and delete; no number until the thread has loaded. The composer comes first, under the header: an auto-growing textarea ("Write a comment") + secondary **Post**; Ctrl/Cmd+Enter posts; trimmed, 1–5000 characters; Post is disabled while it's empty or posting. Then the comments **newest first**: the list always asks for `parentId=none&order=desc` (part of the cache key) — replies never show as top-level comments (the replies UI is the next step). A first batch shows (3 in the task panel, 10 on the Discussion tab); **See more** reveals the next batch, fetching the next, older, page of 50 only once the loaded ones run out; **Show less** goes back to the first batch. Items: small avatar, author in bold, relative time (full date and time in the title), muted "· edited" when `editedAt` is set, then the body as plain text with line breaks kept. Empty: "No comments yet."; loading: 3 skeleton items; error (a failed first load): compact ErrorState with Try again. Posting is optimistic: the comment shows at once at the top of the first page (dimmed, no actions, `parentId: null`, `replyCount: 0`, meta.total +1) and the box clears; the server's comment takes its place in the same row; a failure takes it out again and puts the text back — a 422 shows under the composer, a 404 (the task was deleted) toasts "This task no longer exists.", anything else toasts the error. Being newest, a posted comment is always in the first batch. Edits and deletes keep the batch shown. Each comment has a **Comment actions** menu (MoreHorizontal) with only the items the user may use (§8: Edit for the author — not even the OWNER; Delete for the author or ADMIN+), and no menu when there are none; from 820 px with a mouse it appears on hover or keyboard focus of the comment, on touch and below 820 px it's always shown. **Edit** turns the body into an inline editor (auto-growing, prefilled, focused with the cursor at the end) with Save / Cancel; Esc cancels, Ctrl/Cmd+Enter saves; trimmed 1–5000; unchanged text just closes. Saving closes the editor and shows the new body at once (optimistic); the server's comment brings "· edited"; a 422 reopens the editor with the text and the message (the body rolls back underneath); other errors roll back and toast. One comment is in edit mode at a time. **Delete** asks "Delete this comment?" / "This can't be undone." (Delete, danger); not optimistic — the button spins until the server answers, and the dialog stays open on an error (toast). A 404 means it was already gone: removed all the same, with "That comment was already deleted." Permissions come from the cached project and the signed-in user, like the task panel's, so the thread works outside a project page too.

**New task dialog:** a 580 px modal, open while `?new=1` is on the tasks route. Fields: Title (required, 1–200, autofocused), Description (≤ 5000), then Priority (default Medium) / Assignee (default Unassigned, then members by name) / Due date in one row. There's no status field (the API creates every task OPEN), and the AI draft row sits under the title (§5): its state isn't part of the dirty check. The body sends only the fields that are set; the due date is end of that day in the user's timezone. On success the dialog closes and a "Task created" toast offers **Open**, which opens the new task's panel. Closing (Cancel, Esc, overlay, X) with a title or description typed asks "Discard this task?" (Discard / Keep editing); a clean form closes at once, and it resets each time it opens. A 422 maps `assigneeId` → Assignee and `dueDate` → Due date; anything it can't place, and any other error, shows in a FormAlert at the top. History works like the panel's: the New task button pushes `?new=1`, and closing goes back when this tab pushed it, otherwise it replaces the URL.

**Add task in a board column** opens the same dialog with `?column=<status>` (omitted for To do; the toolbar's New task is always To do). For In progress / Done a muted "Will be added to {column}" line sits under the title, and submitting POSTs, then PATCHes `{ status }` through the task update path; the button stays pending and the dialog stays open until both finish. If the PATCH fails the task still exists in To do: the dialog closes with a "Task created in To do — couldn't move it to {column}" error toast (with **Open**) and the columns refetch. A failed POST behaves as above.

**Board:** columns To do / In progress / Done, each its own `GET …/tasks?status=…&limit=100` query keyed by the list key factory (so panel edits and deletes patch the cards too). Column header: h6 + muted `meta.total`. Cards (`.card elev-sm`, `shadow-md` on hover) show the priority mark and label, the title, then the due date (overdue in danger, bold) and the assignee's initials avatar. A card is a link to `?task=<id>`: a click or Enter opens the panel in place, and a modified click opens it in a new tab. Each column has its own states: 3 skeleton cards, "No tasks", or a compact error with Try again. From 820 px three equal columns split by 2px rules; below that the columns scroll sideways with scroll snap, each ~85vw wide, inside the board (the page itself never scrolls sideways). On the board the status segmented control, task count and pagination are hidden; the filter bar, sort and mobile Filters sheet work as on the list, and Clear filters stays on the board.

**Board drag & drop** (`@dnd-kit/core`, no sortable: the API has no ordering field, so a card only changes column and dropping on its own column does nothing). Only cards the user can edit (§8) are draggable — grab cursor, `aria-roledescription="draggable"` and the instructions; the rest just open. Mouse drags start after 6 px, so a plain click still opens the card; touch drags need a 200 ms press (8 px tolerance), so swiping still scrolls the board; mouse events are used rather than pointer events so a touch never starts a mouse-style drag. Keyboard: Space picks up the focused card, ← / → move it to the top of the previous / next column, Space drops, Esc cancels; Enter still opens the card. Announcements: "Picked up {title}, in To do.", "Over In progress." (not repeated for the same column), "Moved {title} to Done.", "{title} stayed in To do." (dropped where it started), "Cancelled, {title} stayed in To do.". While dragging, a copy of the card (`shadow-lg`) follows the pointer, the original dims, and the column under it gets a 2px accent outline and accent-100 tint. A drop goes through `useUpdateTask` with `{ status }` (§7). The drop rules live in `src/features/tasks/boardDnd.ts`; the column cache moves in `boardCache.ts`.

**Component inventory** (`src/components/ui/`), each a thin React wrapper over the Modernist classes:

| Component | Base |
|---|---|
| Button (primary, secondary, ghost, icon, block; loading state) | `.btn*` |
| Tag, StatusTag, PriorityMark, RoleTag | `.tag*`, tokens |
| Field, Input, Textarea, NativeSelect, FieldError | `.field`, `.input` |
| Segmented | `.seg`, `.seg-opt` |
| Card, TaskCard | `.card`, `.elev-*` |
| DataTable (header, rows, empty, skeleton) | `.table` |
| Dialog, ConfirmDialog (optional type-to-confirm) | Radix Dialog + `.dialog*` |
| Sheet (task panel), Drawer (mobile nav) | Radix Dialog |
| Menu, Popover, Tooltip, Tabs | Radix |
| Avatar (initials, optional image) | tokens |
| Toaster | sonner |
| Skeleton, EmptyState, ErrorState, Pagination | tokens |
| ThemeSwitch | prototype switch |
| MultiSelect (priority, status) and DateField | Popover + checkboxes; native `type="date"` |

A dev-only `/dev/ui` page renders every component in both themes (the prototype's "Tokens & components" view).

**Design rules carried over:** zero radius everywhere; 2px rules between sections, 1px between rows; labels flush left (including wide buttons); accent only for primary actions and emphasis; focus ring `2px solid var(--color-accent)` offset 2px; disabled at 45% opacity; overdue due dates in `--tm-danger`, bold.

---

## 7. Data layer

- `src/lib/api/schema.d.ts` — generated: `npm run api:types` runs openapi-typescript against `API_SPEC_URL` (default `http://localhost:3000/openapi.json`). The file is committed; regenerate when the API changes.
- `src/lib/api/client.ts` — openapi-fetch client with `baseUrl = NEXT_PUBLIC_API_URL` (the spec's paths already include `/api/v1`) and a middleware that adds the bearer token and runs the §3 refresh-and-retry logic. `unwrap()` / `unwrapPage()` return the `{ data }` payload (or `{ items, meta }`) and throw `ApiError`.
- `ApiError` — `{ status, code, message, details, requestId }` parsed from the error envelope.
- `src/lib/query/keys.ts` — one key factory: `projects.list()`, `projects.detail(id)`, `tasks.list(projectId, filters)`, `tasks.detail(projectId, taskId)`, `tasks.mine(filters)`, `comments.list(projectId, taskId|'none')`, `attachments.list(…)`, `members.list(projectId)`, `invitations.project(projectId)`, `invitations.mine()`, `notifications.list(filters)`, `me()`.
- One hook file per feature (`src/features/<feature>/api.ts`) exposing `useXQuery` / `useXMutation`; mutations invalidate the affected keys.
- **Optimistic updates** for task status/priority/assignee changes and board moves; roll back on error. A board move also takes the card out of its column's cached page and puts it at the top of the target column's (both `meta.total`s adjusted; a full column drops its 100th card from the page), and an error puts both pages back exactly; a 409 shows the status-conflict toast, and the columns refetch with everything else on settle. Panel edits PATCH one field at a time (`useUpdateTask`); the detail and every cached list row (project lists, My tasks) change at once, and a failure restores only the fields that update touched, so concurrent edits of different fields don't undo each other. Each field has its own pending state. After settling, the project's lists and status counts and My tasks are refetched; a 422 shows under its field. The API's 409 on PATCH task only detects a concurrent *status* change; every other field is last-write-wins (there's no version field or `If-Match`). So after any 409 the UI rolls back, refetches the task and says "This task's status changed — refreshed"; it doesn't claim to detect conflicts on other fields.
- **Posting a comment** isn't optimistic: on success it's appended to its thread's cache (only when every page is loaded — otherwise it's on a page Load more will fetch), the task's `commentCount` goes up in the detail and any cached list row that carries it, then the thread is refetched.
- **Editing a comment** is optimistic (the body in the thread cache; the server's comment replaces it, an error restores the old body). **Deleting one** removes it from the thread cache (`meta.total` too) and lowers the task's `commentCount`, then refetches the thread.
- **Deletes are never optimistic.** A confirm dialog waits for the server and keeps its spinner until the request finishes; on failure it toasts and stays open for a retry. On success, or on a 404 (someone else deleted it first: "That task was already deleted."), the task leaves the detail cache and every cached list (with `meta.total` decremented), and the project's lists, counts and My tasks are refetched in the background. The panel closes at once, the same way as the X button, and never re-renders the deleted task, so a refetch can't flash "Task not found". Deleting the only row of a page past the first lands on the previous page; when the panel pushed its own history entry, that's a Back followed by a replace, so no stale entry is left.
- **Task list query** (`src/features/tasks/filters.ts`): the URL holds `status`, `q`, `priority`, `assignee` (`me` / `unassigned` / id), `createdBy` (`me` / id), `dueFrom` / `dueTo` (inclusive `YYYY-MM-DD`), `overdue=true`, `sort`, `order`, `page` — always written in that order; junk is dropped per field, and an inverted due range is dropped entirely. At request time the days become the API's exclusive instants in the user's time zone: `dueAfter` = start of `dueFrom` − 1 ms, `dueBefore` = start of the day after `dueTo`. `order` is omitted unless it differs from the field's default (dueDate asc, createdAt / updatedAt desc, priority desc, title asc); picking a new sort field resets it. Array params go out comma-separated (`priority=URGENT,HIGH`) as the spec's `explode: false` requires — repeated keys get a 422. Status counts reuse every filter except status (and ignore sort).
- **URL updates for list state** (filters, sort, page, `?task`, `?new`) use `history.pushState` / `replaceState` (`src/lib/hooks/shallowUrl.ts`), which Next syncs with `useSearchParams` without refetching the route's server components; `router.push` is kept for real navigation to another page.
- **Downloads** need the `Authorization` header, so they `fetch` the file as a Blob and trigger a download through an object URL (files are ≤ 10 MB). `fetchAttachmentBlob()` (`src/lib/api/download.ts`, also used by the preview) and `downloadAttachment()` go through the API client (`parseAs: 'blob'`), so it gets the bearer token and the TOKEN_EXPIRED refresh-and-retry; it saves under the attachment's `originalName` (Content-Disposition isn't readable cross-origin, §13) via a temporary `<a download>`, then revokes the URL. A 404 toasts "This file is no longer available."; other errors toast as usual.
- **Uploads** (`uploadAttachment`, `src/lib/api/upload.ts`) use `XMLHttpRequest` for a progress bar: multipart `taskId?` + `file`, the bearer token, one refresh-and-retry on 401 TOKEN_EXPIRED (shared `tokenAfterExpiry` from client.ts), sign-out on other 401s; resolves to uploaded / failed (ApiError) / cancelled. Before sending, files are checked against `NEXT_PUBLIC_MAX_UPLOAD_MB` (default 10) and the backend's MIME allowlist (`src/features/attachments/allowlist.ts`); a file whose browser type isn't allowed but whose extension is (e.g. Windows' `application/x-zip-compressed`) is sent with the extension's type. On success the file is prepended to its list's cache, the task's `attachmentCount` goes up, and the list is refetched. Failures toast too, except 413 / 415 and pre-checks, which stay on the row.

**Error mapping**

| API | UI |
|---|---|
| 401 `TOKEN_EXPIRED` | silent refresh + retry |
| other 401 | sign out → `/login?next=` |
| 403 | toast "You don't have permission to do that"; controls are hidden/disabled up front using `myRole` |
| 404 on a project route | project not-found screen |
| 409 | toast with the API message; on a task, roll back and refetch (status conflicts only — see above) |
| 410 `INVITATION_EXPIRED` | toast "This invitation has expired", remove it from the inbox |
| 413 / 415 | on the file's upload row, no toast ("Too large — max {N} MB." / "That file type isn't allowed."); the same checks run before sending |
| 422 | `details[].path` → field errors; anything unmatched → toast |
| 429 | toast "Too many attempts — try again in a minute" |
| 502 / 503 (AI) | inline message next to the AI button (button stays) / unavailable message for this dialog, then the row is hidden for the session |
| network / 5xx | toast with a Retry action; queries show ErrorState |
| any error on a background refetch | Background refetch failures keep the current data; the error state is only for a failed first load. Silent — no toast (focus / reconnect refetches would spam); the next refetch recovers. `queryView()` (`src/lib/query/view.ts`) decides loading / error / ready; placeholder data (previous page or filters) doesn't count as data. A 404 / 422 on the project or the open task still shows "not found", since it means the thing is gone. |

---

## 8. Permissions in the UI

UI checks only hide or disable controls; the API stays the authority. `myRole` comes from the project detail. The checks are pure helpers in `src/features/projects/permissions.ts`; components get them bound to the current user via `useProjectContext().can`.

| Control | Shown / enabled for |
|---|---|
| Edit project, invite, revoke invitations, remove MEMBERs | ADMIN, OWNER |
| Change roles, transfer ownership, invite as Admin, remove ADMINs, delete project | OWNER |
| Leave project | ADMIN, MEMBER (on their own row; the OWNER's row shows "Transfer ownership before leaving.") |
| Edit task fields | task creator, assignee, ADMIN+ (an assignee who reassigns the task to someone else loses edit rights at once; the panel turns read-only, with a tooltip explaining why) |
| Delete task | task creator, ADMIN+ (else disabled with the prototype's hint "Members can delete only tasks they created." plus the same tooltip; an assignee can edit but not delete) |
| Edit comment | author only; delete: author, ADMIN+ |
| Delete attachment | uploader, ADMIN+ |

---

## 9. Notifications

**Invitations inbox** (`InvitationsInbox`, `/dashboard/invitations`): h2 "Invitations" + muted count, then my **pending** invitations newest first. `GET /users/me/invitations` takes no filters and isn't paginated — it returns every status — so non-pending ones (and PENDING past `expiresAt`) are filtered out client-side; the sidebar badge reads the same cache entry. Each row: project name, "{inviter} invited you as {RoleTag}", muted "Sent {relativeTime} · Expires {timeUntil}", primary **Accept** and ghost **Decline** (beside the text from 820px, full-width under it below). A row's buttons are disabled while either of its requests is pending; other rows stay usable. Accept (POST `/invitations/{id}/accept`) → the row leaves the cache once the server agrees (not optimistic), my invitations and all project queries are refetched, toast "You joined {project}" with an **Open project** action. Decline → "Decline the invitation to {project}?" / "You'll need a new invitation to join." → POST `/invitations/{id}/decline` → toast "Invitation declined". A 404 / 409 / 410 (revoked, already answered, expired) toasts its message (`errorMessage`) and refetches, closing the decline dialog; anything else (e.g. 403) is the usual error toast, and the dialog stays open. Empty: EmptyState "No pending invitations" / "When someone invites you to a project, it shows up here."; loading: skeleton rows; error: ErrorState with Try again. Sidebar **Invitations** badge: the pending count, hidden at 0, shown as "9+" above nine; the link reads "Invitations, N pending" to screen readers. No polling — SSE arrives in 12c.


- Header button with unread badge (`meta.unreadCount`); panel with the 10 newest, **Mark all read**, and "View all" → `/dashboard/notifications` (filter Unread / All, pagination).
- Sentences from `type` + `payload` snapshot:
  - `TASK_ASSIGNED` — "{actor} assigned you “{task}” in {project}"
  - `TASK_COMPLETED` — "{actor} completed “{task}”"
  - `TASK_UPDATED` — "{actor} updated {changedFields} on “{task}”"
  - `COMMENT_ADDED` — "{actor} commented on “{task}”: {preview}"
  - `PROJECT_INVITATION` — "{actor} invited you to {project} as {role}"
  - `COMMENT_REPLY` — new in the API with comment replies; no notification UI handles types yet, so nothing needed a placeholder. The copy ("{actor} replied to your comment", label "Reply") comes with step 12a.
  A null actor name renders as "Someone".
- Clicking marks it read and navigates: task types → `/dashboard/projects/{projectId}/tasks?task={taskId}`; invitation → `/dashboard/invitations`.
- **Live:** one SSE connection per signed-in tab (`fetch-event-source`, bearer token). On `notification`: prepend to the cache, bump the badge, show a toast, and invalidate the related project's task queries so other people's changes appear. Reconnect with backoff using a fresh token; after reconnecting, refetch the list to catch anything missed.

---

## 10. Testing

- **Unit / component (Vitest + Testing Library + MSW):** UI kit behaviour, form validation, error mapping, the refresh single-flight (two concurrent 401s → one refresh), notification sentence builder, due-date conversion, permission helpers, filter ↔ URL round-trips. The suite runs in `TZ=UTC` by default (`vitest.config.mts`; a `TZ` set in the shell wins, so it can be run in other zones); tests that need a zone use `tests/timeZone.ts`, which restores the previous value, and `tests/setup.ts` resets it after every file as a safety net.
- **E2E (Playwright, against a locally running API):** register → create project → create task → move it on the board → comment → upload/download a file; invite → accept as a second user; notification appears live; log out.
- **CI (GitHub Actions):** lint, format check, typecheck, unit tests, `next build`. E2E runs locally (it needs the API).
- **Manual checks per step:** 375 px width, both themes, keyboard-only navigation of the step's screens.

---

## 11. Project structure

```
taskmaster-web/
├── design/prototype/            # the Claude Design export (reference only)
├── src/
│   ├── app/
│   │   ├── (marketing)/layout.tsx, page.tsx   # top bar + footer; `/` landing
│   │   ├── (auth)/layout.tsx                   # split screen
│   │   ├── (auth)/login, register
│   │   ├── dashboard/layout.tsx                # app shell; guarded
│   │   ├── dashboard/page.tsx                  # → /dashboard/my-tasks
│   │   ├── dashboard/my-tasks, projects, projects/[projectId]/{tasks,discussion,files,members,settings}
│   │   ├── dashboard/invitations, notifications, profile
│   │   ├── api/auth/[action]/route.ts
│   │   ├── dev/ui/                             # component showcase (dev only)
│   │   ├── layout.tsx, not-found.tsx, globals.css
│   ├── components/ui/           # §6 inventory
│   ├── components/shell/        # header, sidebar, drawer, theme switch
│   ├── features/                # auth, projects, tasks, comments, attachments, members, invitations, notifications, profile, ai
│   │   └── <feature>/{api.ts, components/, schemas.ts, utils.ts}
│   ├── lib/api/                 # schema.d.ts, client.ts, errors.ts, upload.ts, download.ts
│   ├── lib/auth/                # hasSession, session provider, refresh lock, cookie helpers
│   ├── lib/query/               # provider, keys
│   ├── lib/format/              # dates, initials, notification text
│   ├── styles/                  # modernist.css, taskmaster-tokens.css
│   └── proxy.ts                 # route guard (§3)
├── tests/ (unit, e2e)
├── .env.example                 # NEXT_PUBLIC_API_URL, API_URL (server-side), API_SPEC_URL
└── .github/workflows/ci.yml
```

`API_URL` is what route handlers use server-side (can differ from the public URL in Docker); `NEXT_PUBLIC_API_URL` is what the browser uses.

---

## 12. Build plan (in order)

Each step ends with lint, typecheck, format check, tests and `next build` passing, and is reviewed before committing. Run the API locally (`npm run dev` in the backend, port 3000); the web app runs on **3001**.

1. **Scaffold & design tokens** — Next.js app (TS strict, App Router, `src/`), ESLint + Prettier (4 spaces, same config style as the backend), Tailwind v4, Modernist + TaskMaster token CSS, `tailwind.config.js` ported to v4 `@theme`, Archivo, next-themes with `data-theme`, Vitest, CI, `.env.example`, README stub. Route groups and layouts for the three areas — `(marketing)` with a coming-soon `/`, `(auth)` with placeholder login/register, `dashboard` with a placeholder shell — and `/dev/ui`. *Done when* the pages render in both themes and CI is green.
2. **UI kit** — §6 components + `/dev/ui` showcase + component tests for Dialog, Segmented, Button loading/disabled.
Steps 3–14 are split into small, separately reviewed sub-steps:

**3 · API layer**
- **3a** Generated API types — `openapi-typescript` from `/openapi.json` → `src/lib/api/schema.d.ts`; friendly aliases in `src/lib/api/types.ts`.
- **3b** API client + `ApiError` — openapi-fetch client, bearer middleware hook, error-envelope parsing; MSW test setup.
- **3c** Query provider, key factory, error helpers — TanStack Query provider, §7 key factory, §7 error-mapping helpers.

**4 · Auth**
- **4a** Auth route handlers + cookie — `app/api/auth/*`, `tm_refresh` httpOnly cookie.
- **4b** Session provider + single-flight / cross-tab refresh + retry — in-memory access token, Web Locks, `TOKEN_EXPIRED` retry. Tests for refresh behaviour.
- **4c** Route guard (`proxy.ts`) + safe `next` — `/dashboard/**` protection, signed-in redirects away from `/login` / `/register`.
- **4d** Login / register forms.
- **4e** Logout / logout-all.

**5 · App shell & projects**
- **5a** Dashboard header.
- **5b** Sidebar + mobile drawer.
- **5c** Projects page + New project dialog.
- **5d** Project layout, tabs, not-found.

**6 · Task list**
- **6a** Task list — table / rows, pagination, skeleton, empty state.
- **6b** URL state, status segmented with counts, search.
- **6c** Advanced filters + sort — priority, assignee, created by, due range, overdue, sort / order.

**7 · Task panel & New task**
- **7a** Task panel read-only — `?task=` sheet.
- **7b** Panel editing — permissions, optimistic PATCH, 409 handling.
- **7c** Delete task.
- **7d** New task dialog.
- **7e** AI description.

**8 · Board**
- **8a** Board read-only + view switch — status columns, "Showing 100 of N — See all in the list" guard (API limit).
- **8b** Drag & drop + optimistic move — dnd-kit, keyboard too.
- **8c** Per-column Add task.

**9 · Comments & attachments**
- **9a** Comments list / post.
- **9b** Comments edit / delete.
- **9c** Attachments list / download.
- **9d** Upload, progress, delete, 413 / 415 handling.
- **9e** Discussion & Files tabs (reuse 9a–9d).

**10 · Members & invitations**
- **10a** Members table.
- **10b** Roles, transfer ownership, remove, leave.
- **10c** Invite form + project invitations table (revoke / invite again).
- **10d** `/dashboard/invitations` inbox (accept / decline) + badge.

**11 · My tasks** — cross-project list reusing step 6 components. *(Hand-written.)*

**12 · Notifications**
- **12a** Notification sentences + `/dashboard/notifications` page.
- **12b** Header panel + mark read / mark all read.
- **12c** SSE live updates + toasts + query invalidation.

**13 · Profile & project settings**
- **13a** Profile form (name, bio, avatar URL).
- **13b** Change password → sign out.
- **13c** Project settings (details).
- **13d** Danger zone — delete (type-to-confirm), leave.

**14 · E2E, accessibility & delivery**
- **14a** Playwright + auth E2E.
- **14b** Task-flow E2E.
- **14c** Accessibility (keyboard, screen reader) and 375 px pass.
- **14d** README + Dockerfile.
- **14e** Optional: home-lab deploy behind cloudflared.

**Cut line if time runs short:** keyboard drag (8b), upload progress bars (9d), then Docker / deploy (14d's Dockerfile, 14e). Optional: replace the coming-soon landing page with a real marketing page. Never cut auth correctness (4a–4e) or error handling.

---

## 13. Backend follow-ups

Changes the API should make; the web app works around them for now.

- Give `/auth/refresh` its own, higher rate limit — it's token-gated, so the login limit isn't needed. (Today a few quick reloads can hit the shared limit; the app treats that 429 as temporary and retries, §3.)
- Expose `Content-Disposition` and `X-Request-Id` in CORS (`Access-Control-Expose-Headers`), so the browser can read the server's filename on downloads and the request id on errors. Until then downloads are named from `originalName`.
- Behind a proxy: `app.set('trust proxy', 1)` and read the client IP from `X-Forwarded-For`, so logins don't share one rate-limit bucket (§3).
