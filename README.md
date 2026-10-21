# TaskMaster Web

Next.js frontend for the TaskMaster API. It implements the TaskMaster design prototype
(`design/prototype/`) on top of the existing REST API. See [docs/DESIGN.md](docs/DESIGN.md) for
the architecture and build plan.

Backend: [utkarsh-vats/Airtribe_TaskMaster](https://github.com/utkarsh-vats/Airtribe_TaskMaster)

## Prerequisites

- Node.js 22+
- The TaskMaster API running on `http://localhost:3000` with `CORS_ORIGIN=http://localhost:3001`

## Setup

```sh
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3001.

## Scripts

| Script                 | What it does                                      |
| ---------------------- | ------------------------------------------------- |
| `npm run dev`          | Dev server on port 3001                           |
| `npm run build`        | Production build                                  |
| `npm run start`        | Serve the production build on port 3001           |
| `npm run lint`         | ESLint                                            |
| `npm run format`       | Format everything with Prettier                   |
| `npm run format:check` | Check formatting (CI)                             |
| `npm run typecheck`    | Generate Next route types, then `tsc --noEmit`    |
| `npm test`             | Run unit / component tests once (Vitest + jsdom)  |
| `npm run test:watch`   | Vitest in watch mode                              |
| `npm run api:types`    | Regenerate `src/lib/api/schema.d.ts` from the API |

Regenerate API types: start the backend, then `npm run api:types`. It reads `API_SPEC_URL` from
the environment or `.env.local` (default `http://localhost:3000/openapi.json`); commit the
regenerated `src/lib/api/schema.d.ts` with the change that needed it.

## Environment

| Variable              | Used by                 | Example                              |
| --------------------- | ----------------------- | ------------------------------------ |
| `NEXT_PUBLIC_API_URL` | Browser                 | `http://localhost:3000`              |
| `API_URL`             | Server (route handlers) | `http://localhost:3000`              |
| `API_SPEC_URL`        | `npm run api:types`     | `http://localhost:3000/openapi.json` |

Values are validated with Zod in `src/lib/env.ts` (public) and `src/lib/env.server.ts`
(server-only).
