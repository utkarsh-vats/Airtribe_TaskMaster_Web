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
| URL state | Filters, sort, page, view and the open task live in the URL (nuqs) | Shareable, back-button friendly |
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
- **Refresh outcomes:** 401 / 4xx → signed out. 5xx / network → nothing changes: a signed-in user stays signed in (and the proactive refresh retries in 30 s); a session being restored shows "Can't reach TaskMaster" with *Try again* instead of redirecting to `/login` (which would loop once the guard sends signed-in users back). The proactive refresh runs 60 s before `expiresAt` (or halfway for tokens shorter than 2 min).
- **Single-flight refresh.** The backend treats a reused refresh token as theft and revokes every session. So:
  - within a tab, concurrent 401s share one refresh promise;
  - across tabs, the refresh call runs inside `navigator.locks.request('tm-refresh', …)`; the next tab to get the lock sends the already-rotated cookie.
- **401 handling:** `TOKEN_EXPIRED` → refresh once and retry the request once (from a clone taken before sending, so POST/PATCH bodies survive; a retry is never retried). If another request already refreshed while this one was in flight, the retry reuses that token instead of refreshing again. Any other 401, or a failed refresh → clear the session and the query cache and go to `/login?next=<path>` (a full page load). `/api/auth/*` calls never go through this.
- **Route guard:** `src/proxy.ts` (Next 16 renamed middleware to proxy). It only checks presence of the `tm_refresh` cookie; the API is the real authority.
  - `/dashboard/**` without the cookie → `/login?next=<path>`.
  - `/login` and `/register` with the cookie → `/dashboard`.
  - `/` is never redirected — the marketing landing is reachable signed in or not.
- **After login / register:** go to `next` if it is a same-origin path under `/dashboard` (starts with `/dashboard`, not `//`, no scheme); otherwise `/dashboard`.
- **Server-side session check:** `src/lib/auth/hasSession.ts` (cookie presence via `next/headers`) — used by the marketing header to show "Go to dashboard" and reused by the guard logic.
- **Logout:** `/api/auth/logout` sends the refresh token to the API, clears the cookie; the client drops the access token and the query cache. **Log out everywhere** uses `/api/auth/logout-all` with the current access token.
- **Change password** revokes all refresh tokens on the API, so the UI signs out and sends the user to log in again with a toast explaining why.

**Backend settings this needs:** `CORS_ORIGIN=http://localhost:3001` (the web app's dev URL). For production behind one proxy, the route handlers must forward the client IP (`X-Forwarded-For`) and the backend needs `app.set('trust proxy', 1)`; otherwise every login shares one rate-limit bucket. Recorded as a follow-up, not part of these steps.

---

## 4. Routes

Three areas, each with its own layout: **marketing** (`(marketing)` route group), **auth** (`(auth)` route group) and the signed-in app under **`/dashboard`**.

| Route | Screen | Notes |
|---|---|---|
| `/` | Marketing landing | Always reachable, signed in or not. Header shows "Sign in" / "Create account", or "Go to dashboard" when signed in. Currently a "Coming soon" page |
| `/login`, `/register` | Auth split screen (accent panel + form) | Signed in → `/dashboard`. Prototype's segmented "Sign in / Create account" switch; `?next=` honoured |
| `/dashboard` | → redirects to `/dashboard/my-tasks` | |
| `/dashboard/my-tasks` | Tasks assigned to me across projects | Same filter bar minus assignee; each row shows its project |
| `/dashboard/projects` | Projects grid / list | Mobile entry point; on desktop the sidebar covers it |
| `/dashboard/projects/[projectId]` | → `/dashboard/projects/[projectId]/tasks` | |
| `/dashboard/projects/[projectId]/tasks` | List or board (`?view=list|board`), filters in the URL, task panel via `?task=<id>` | |
| `/dashboard/projects/[projectId]/discussion` | Project-level comments | Not in prototype — same thread component as the task panel |
| `/dashboard/projects/[projectId]/files` | Project-level attachments | Not in prototype — same attachment list component |
| `/dashboard/projects/[projectId]/members` | Invite form, members table, invitations table | Per prototype |
| `/dashboard/projects/[projectId]/settings` | Project details, danger zone | Per prototype |
| `/dashboard/invitations` | Invitations sent to me — Accept / Decline | Not in prototype |
| `/dashboard/notifications` | Full notifications list | Header panel shows the latest 10 |
| `/dashboard/profile` | Profile, password, sign out | Per prototype, plus bio and avatar URL |
| `/dev/ui` | Component showcase | Dev only — `notFound()` in production |
| not found | "Project not found" / generic 404 | The API returns 404 for projects you're not in |

---

## 5. Prototype → API mapping

The prototype was built on demo data. Where it differs from the API, the API wins:

| Prototype | Implementation |
|---|---|
| Status `TODO / IN_PROGRESS / DONE` | API `OPEN / IN_PROGRESS / COMPLETED`, labelled "To do / In progress / Done" with the same tags (`tag-neutral`, `tag-accent`, `tag-outline`) |
| Priority `HIGH / MEDIUM / LOW` | API adds `URGENT`: label "Urgent", priority mark in `--tm-danger`, bold label. Order Urgent → Low |
| Task key `TM-101` | Not shown (no sequential ids). The panel breadcrumb is `Project / Task` |
| Status select in "New task" | API creates every task as `OPEN`. The modal has no status field; "Add task" in a board column creates the task, then PATCHes its status |
| Due date is a date input | Sent as end of that day in the user's timezone, ISO 8601 with offset (`2026-10-28T23:59:59+05:30`); displayed as a date |
| Status filter with counts | Counts come from 4 `limit=1` list queries reading `meta.total`, cached with the list |
| Header "Search tasks" | Searches the current project (`q` on the task list); on `/dashboard/my-tasks` it searches my tasks |
| Sidebar project count | API gives `memberCount`, not open-task count; the sidebar shows the role tag instead of a number |
| Invitations "Resend" | No resend endpoint. Pending rows: **Revoke**. Expired rows: **Invite again** (creates a new invitation) |
| Notification "is overdue" / "accepted your invitation" | Not produced by the API. Notifications show the five API types only (§9) |
| Members role select (Admin / Member) | Owner also gets **Transfer ownership** (confirm dialog: "You'll become an admin") |
| Register hint "one number" | API only requires 8–128 characters; hint says "At least 8 characters" |
| List density A / B / C (demo toggle) | Desktop: table (B). Below 820 px: rows (A). Grouped (C) is dropped |
| Profile: name + email | Adds bio (≤ 500) and avatar URL; email stays read-only |
| AI draft (priority + checklist JSON) | Uses `POST /ai/task-description` → plain description only. 503 hides the button; 502 shows "AI couldn't respond, try again" |
| Task panel has comments only | Adds an Attachments section (upload, list, download, delete) |

---

## 6. Layout and components

**Shell (≥ 820 px):** header bar (brand, search, theme switch, notifications button with unread badge, profile button) over a 2-column body: sidebar (Projects list with active highlight, New project, then My tasks, Invitations with badge, Notifications) and `main`. **< 820 px:** sidebar becomes a drawer behind a menu button; project switching uses the prototype's select; search moves into the tasks toolbar.

**Project header:** kicker "Project", role tag, name (h2), description, tabs: Tasks · Discussion · Files · Members · Settings (2px accent underline on the active tab, per prototype).

**Task panel:** right-side sheet (full screen on mobile), deep-linked by `?task=`. Title as an auto-growing textarea; Status / Priority / Assignee / Due in a 2-column grid; Description; Attachments; Comments with composer; footer "Created by … · date" and Delete. Fields the user can't edit render read-only with a tooltip.

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
- **Optimistic updates** for task status/priority/assignee changes and board moves; roll back on error. The API's 409 on PATCH task only detects a concurrent *status* change; every other field is last-write-wins (there's no version field or `If-Match`). So after any 409 the UI rolls back, refetches the task and says "This task's status changed — refreshed"; it doesn't claim to detect conflicts on other fields.
- **Downloads** need the `Authorization` header, so they `fetch` the file as a Blob and trigger a download through an object URL (files are ≤ 10 MB).
- **Uploads** use `XMLHttpRequest` for a progress bar; same auth header and error mapping.

**Error mapping**

| API | UI |
|---|---|
| 401 `TOKEN_EXPIRED` | silent refresh + retry |
| other 401 | sign out → `/login?next=` |
| 403 | toast "You don't have permission to do that"; controls are hidden/disabled up front using `myRole` |
| 404 on a project route | project not-found screen |
| 409 | toast with the API message; on a task, roll back and refetch (status conflicts only — see above) |
| 410 `INVITATION_EXPIRED` | toast "This invitation has expired", remove it from the inbox |
| 413 / 415 | inline under the upload area ("Max 10 MB" / "That file type isn't allowed") |
| 422 | `details[].path` → field errors; anything unmatched → toast |
| 429 | toast "Too many attempts — try again in a minute" |
| 502 / 503 (AI) | inline message next to the AI button / button hidden |
| network / 5xx | toast with a Retry action; queries show ErrorState |

---

## 8. Permissions in the UI

UI checks only hide or disable controls; the API stays the authority. `myRole` comes from the project detail.

| Control | Shown / enabled for |
|---|---|
| Edit project, invite, revoke invitations, remove MEMBERs | ADMIN, OWNER |
| Change roles, transfer ownership, invite as Admin, remove ADMINs, delete project | OWNER |
| Leave project | ADMIN, MEMBER |
| Edit task fields | task creator, assignee, ADMIN+ |
| Delete task | task creator, ADMIN+ (else disabled with the prototype's hint) |
| Edit comment | author only; delete: author, ADMIN+ |
| Delete attachment | uploader, ADMIN+ |

---

## 9. Notifications

- Header button with unread badge (`meta.unreadCount`); panel with the 10 newest, **Mark all read**, and "View all" → `/dashboard/notifications` (filter Unread / All, pagination).
- Sentences from `type` + `payload` snapshot:
  - `TASK_ASSIGNED` — "{actor} assigned you “{task}” in {project}"
  - `TASK_COMPLETED` — "{actor} completed “{task}”"
  - `TASK_UPDATED` — "{actor} updated {changedFields} on “{task}”"
  - `COMMENT_ADDED` — "{actor} commented on “{task}”: {preview}"
  - `PROJECT_INVITATION` — "{actor} invited you to {project} as {role}"
  A null actor name renders as "Someone".
- Clicking marks it read and navigates: task types → `/dashboard/projects/{projectId}/tasks?task={taskId}`; invitation → `/dashboard/invitations`.
- **Live:** one SSE connection per signed-in tab (`fetch-event-source`, bearer token). On `notification`: prepend to the cache, bump the badge, show a toast, and invalidate the related project's task queries so other people's changes appear. Reconnect with backoff using a fresh token; after reconnecting, refetch the list to catch anything missed.

---

## 10. Testing

- **Unit / component (Vitest + Testing Library + MSW):** UI kit behaviour, form validation, error mapping, the refresh single-flight (two concurrent 401s → one refresh), notification sentence builder, due-date conversion, permission helpers, filter ↔ URL round-trips.
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
- **8a** Board read-only + view switch — status columns, "100+ tasks — use the list" guard (API limit).
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