# CLAUDE.md

- Never commit; the user reviews and commits. End each task with: files changed, decisions beyond spec, test count.
- The user's dev server runs on :3001 — never stop it, never delete `.next`. If you need a server, build into a separate dir (`NEXT_DIST_DIR=.next-verify npm run build`) and `next start -p 3002` from it, or skip live checks.
- The backend runs on :3000 with a login rate limit of 10/min per IP — avoid repeated live logins; prefer MSW tests.
- Before finishing: `npm run lint`, `format:check`, `typecheck`, `test`, `build` must pass. Strict TS, no `any`.
- `docs/DESIGN.md` is the spec; update it when behaviour differs.
