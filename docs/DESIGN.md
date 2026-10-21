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
- **Access token** lives in memory only (React context). Lost on reload → restored by calling `/api/auth/refresh` (the cookie rides along).
- **Single-flight refresh.** The backend treats a reused refresh token as theft and revokes every session. So:
  - within a tab, concurrent 401s share one refresh promise;
  - across tabs, the refresh call runs inside `navigator.locks.request('tm-refresh', …)`; the next tab to get the lock sends the already-rotated cookie.
- **401 handling:** `TOKEN_EXPIRED` → refresh once and retry the request once. Any other 401, or a failed refresh → clear the session and go to `/login?next=<path>`.
- **Route guard:** Next middleware (named `proxy` in newer Next versions — use whatever the installed version calls it) redirects to `/login` when there's no `tm_refresh` cookie, and away from `/login` when there is one. It only checks presence; the API is the real authority.
- **Logout:** `/api/auth/logout` sends the refresh token to the API, clears the cookie; the client drops the access token and the query cache. **Log out everywhere** uses `/api/auth/logout-all` with the current access token.
- **Change password** revokes all refresh tokens on the API, so the UI signs out and sends the user to log in again with a toast explaining why.

**Backend settings this needs:** `CORS_ORIGIN=http://localhost:3001` (the web app's dev URL). For production behind one proxy, the route handlers must forward the client IP (`X-Forwarded-For`) and the backend needs `app.set('trust proxy', 1)`; otherwise every login shares one rate-limit bucket. Recorded as a follow-up, not part of these steps.

---

## 4. Routes

| Route | Screen | Notes |
|---|---|---|
| `/login`, `/register` | Auth split screen (accent panel + form) | Prototype's segmented "Sign in / Create account" switch; `?next=` honoured |
| `/` | → redirects to `/my-tasks` | |
| `/my-tasks` | Tasks assigned to me across projects | Same filter bar minus assignee; each row shows its project |
| `/projects` | Projects grid / list | Mobile entry point; on desktop the sidebar covers it |
| `/projects/[projectId]` | → `/projects/[projectId]/tasks` | |
| `/projects/[projectId]/tasks` | List or board (`?view=list|board`), filters in the URL, task panel via `?task=<id>` | |
| `/projects/[projectId]/discussion` | Project-level comments | Not in prototype — same thread component as the task panel |
| `/projects/[projectId]/files` | Project-level attachments | Not in prototype — same attachment list component |
| `/projects/[projectId]/members` | Invite form, members table, invitations table | Per prototype |
| `/projects/[projectId]/settings` | Project details, danger zone | Per prototype |
| `/invitations` | Invitations sent to me — Accept / Decline | Not in prototype |
| `/notifications` | Full notifications list | Header panel shows the latest 10 |
| `/profile` | Profile, password, sign out | Per prototype, plus bio and avatar URL |
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
| Header "Search tasks" | Searches the current project (`q` on the task list); on `/my-tasks` it searches my tasks |
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
- `src/lib/api/client.ts` — openapi-fetch client with `baseUrl = NEXT_PUBLIC_API_URL + '/api/v1'` and a middleware that adds the bearer token and runs the §3 refresh-and-retry logic.
- `ApiError` — `{ status, code, message, details, requestId }` parsed from the error envelope.
- `src/lib/query/keys.ts` — one key factory: `projects.list()`, `projects.detail(id)`, `tasks.list(projectId, filters)`, `tasks.detail(projectId, taskId)`, `tasks.mine(filters)`, `comments.list(projectId, taskId|'none')`, `attachments.list(…)`, `members.list(projectId)`, `invitations.project(projectId)`, `invitations.mine()`, `notifications.list(filters)`, `me()`.
- One hook file per feature (`src/features/<feature>/api.ts`) exposing `useXQuery` / `useXMutation`; mutations invalidate the affected keys.
- **Optimistic updates** for task status/priority/assignee changes and board moves; roll back on error. A 409 rolls back and shows "Someone else changed this task — refreshed", then refetches.
- **Downloads** need the `Authorization` header, so they `fetch` the file as a Blob and trigger a download through an object URL (files are ≤ 10 MB).
- **Uploads** use `XMLHttpRequest` for a progress bar; same auth header and error mapping.

**Error mapping**

| API | UI |
|---|---|
| 401 `TOKEN_EXPIRED` | silent refresh + retry |
| other 401 | sign out → `/login?next=` |
| 403 | toast "You don't have permission to do that"; controls are hidden/disabled up front using `myRole` |
| 404 on a project route | project not-found screen |
| 409 | toast with the API message; task conflicts also refetch |
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

- Header button with unread badge (`meta.unreadCount`); panel with the 10 newest, **Mark all read**, and "View all" → `/notifications` (filter Unread / All, pagination).
- Sentences from `type` + `payload` snapshot:
  - `TASK_ASSIGNED` — "{actor} assigned you “{task}” in {project}"
  - `TASK_COMPLETED` — "{actor} completed “{task}”"
  - `TASK_UPDATED` — "{actor} updated {changedFields} on “{task}”"
  - `COMMENT_ADDED` — "{actor} commented on “{task}”: {preview}"
  - `PROJECT_INVITATION` — "{actor} invited you to {project} as {role}"
  A null actor name renders as "Someone".
- Clicking marks it read and navigates: task types → `/projects/{projectId}/tasks?task={taskId}`; invitation → `/invitations`.
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
│   │   ├── (auth)/login, register
│   │   ├── (app)/layout.tsx     # shell; guarded
│   │   ├── (app)/my-tasks, projects, projects/[projectId]/{tasks,discussion,files,members,settings}
│   │   ├── (app)/invitations, notifications, profile
│   │   ├── api/auth/[action]/route.ts
│   │   ├── dev/ui/              # component showcase (dev only)
│   │   ├── layout.tsx, not-found.tsx, globals.css
│   ├── components/ui/           # §6 inventory
│   ├── components/shell/        # header, sidebar, drawer, theme switch
│   ├── features/                # auth, projects, tasks, comments, attachments, members, invitations, notifications, profile, ai
│   │   └── <feature>/{api.ts, components/, schemas.ts, utils.ts}
│   ├── lib/api/                 # schema.d.ts, client.ts, errors.ts, upload.ts, download.ts
│   ├── lib/auth/                # session provider, refresh lock, cookie helpers
│   ├── lib/query/               # provider, keys
│   ├── lib/format/              # dates, initials, notification text
│   └── styles/                  # modernist.css, taskmaster-tokens.css
├── tests/ (unit, e2e)
├── middleware.ts (or proxy.ts)
├── .env.example                 # NEXT_PUBLIC_API_URL, API_URL (server-side), API_SPEC_URL
└── .github/workflows/ci.yml
```

`API_URL` is what route handlers use server-side (can differ from the public URL in Docker); `NEXT_PUBLIC_API_URL` is what the browser uses.

---

## 12. Build plan (in order)

Each step ends with lint, typecheck, format check, tests and `next build` passing, and is reviewed before committing. Run the API locally (`npm run dev` in the backend, port 3000); the web app runs on **3001**.

1. **Scaffold & design tokens** — Next.js app (TS strict, App Router, `src/`), ESLint + Prettier (4 spaces, same config style as the backend), Tailwind v4, Modernist + TaskMaster token CSS, `tailwind.config.js` ported to v4 `@theme`, Archivo, next-themes with `data-theme`, Vitest, CI, `.env.example`, README stub. *Done when* a placeholder page renders in both themes and CI is green.
2. **UI kit** — §6 components + `/dev/ui` showcase + component tests for Dialog, Segmented, Button loading/disabled.
3. **API layer** — generated types, openapi-fetch client, `ApiError`, Query provider, key factory, error-mapping helpers; MSW test setup.
4. **Auth** — route handlers + cookie, session provider, single-flight + Web Locks refresh, route guard, login/register screens, logout. Tests for refresh behaviour.
5. **App shell & projects** — header, sidebar, mobile drawer, theme switch, projects list page, New project dialog, project header + tabs, not-found screen.
6. **Task list** — filter bar (status segmented with counts, priority, assignee, created by, due range, overdue, sort/order, search) in the URL, table / rows, pagination, skeletons, empty state.
7. **Task panel & New task** — `?task=` sheet, permission-aware editing, optimistic PATCH with 409 handling, delete, New task dialog with AI description.
8. **Board** — status columns, dnd-kit drag (keyboard too), optimistic move, per-column Add task, "100+ tasks — use the list" guard (API limit).
9. **Comments & attachments** — thread + composer (edit / delete), upload with progress, list, download, delete; reused in Discussion and Files tabs.
10. **Members & invitations** — members table, roles, transfer ownership, remove, leave; invite form and project invitations table (revoke / invite again); `/invitations` inbox with accept / decline.
11. **My tasks** — cross-project list reusing step 6 components. *(Good one to write by hand.)*
12. **Notifications** — panel, page, sentence builder, mark read / all, SSE live updates and toasts.
13. **Profile & project settings** — profile form (name, bio, avatar URL), change password → sign out, project details, delete (type-to-confirm), leave.
14. **E2E, accessibility & delivery** — Playwright flows, keyboard and screen-reader pass, 375 px pass, README, Dockerfile. Optional: deploy to the home lab behind cloudflared.

**Cut line if time runs short:** step 8's keyboard drag, upload progress bars, then step 14's Docker/deploy. Never cut auth correctness (step 4) or error handling.