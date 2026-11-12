# Development and publishing

This page describes how to work on WhelkMail, how the two repositories relate,
and what must never end up in the public one.

## Repositories

| Repository | Role |
| --- | --- |
| `mlzog/WhelkMail` (this one, remote `origin`) | development. Commits can be small, messy and frequent. |
| `WhelkMail/WhelkMail` (remote `public`) | distribution. Only curated snapshots, installable by anyone. |

The two histories are unrelated: the public repo was re-synced from the
development tree at some point. Do not try to merge them; publish snapshots
instead (see below).

## Local setup

Requirements: Node.js 22+ and npm.

```bash
npm install
cp wrangler.toml.example wrangler.toml   # gitignored
npm run db:local                          # fresh database: schema only
```

Create `.dev.vars` (gitignored) with at least:

```env
APP_PASSWORD=change-me
TOKEN_ENC_KEY=<32-byte base64 key>
```

Generate the key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run the app in two terminals:

```bash
npm run dev       # Vite on http://localhost:5173
npm run dev:api   # Pages Functions on http://localhost:8788
```

Open `http://localhost:8788` (the Functions proxy the Vite dev server).

### Working from the Acode terminal on Android

Node is not installed in the Acode Alpine terminal by default:

```bash
apk add nodejs npm
```

Alpine uses musl, and `wrangler dev` / `wrangler d1 --local` need the `workerd`
binary, which may not run there. `typecheck`, `lint`, `test` and `build` work
fine. When something needs a real Worker runtime, push to GitHub and use a
Cloudflare Pages preview deployment instead of a local emulator.

## Database changes

- `db/schema.sql` is the schema for a **fresh install** and must always contain
  every column.
- `db/migrations/NNN_name.sql` upgrades an **existing** database. They are
  additive `ALTER`/`CREATE` statements, not idempotent, so never run them on a
  fresh database.
- `npm run db:migrate:local` / `db:migrate:remote` apply every migration in
  order; `--from=013` restarts from one of them.

When you add a table or column, update `db/schema.sql` **and** add a migration.

## Tests

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
CI runs the same four steps on every push to `main` and every pull request,
plus a guard that fails when a personal config file is tracked.

## Publishing to the public repository

One-time setup:

```bash
git remote add public https://github.com/WhelkMail/WhelkMail.git
git fetch public
```

Then:

```bash
sh scripts/publish-public.sh                      # publishes main
MESSAGE="Release 0.1.0" sh scripts/publish-public.sh
SOURCE=feature-x sh scripts/publish-public.sh      # publish another branch
```

The script refuses to run if a personal config file is tracked in `SOURCE`:
`wrangler.toml`, `worker/wrangler.toml`, `.dev.vars` and its variants
(`.dev.vars.production`, …), `.env` and `.env.*`. The `*.example` templates are
allowed and expected. It then builds a snapshot commit whose parent is
`public/main` (so the public history stays linear and pushes are fast-forwards)
and pushes the tree of `SOURCE`.

The snapshot commit is also stored in the local `public-release` branch. If the
push fails (for example because no credentials are available), nothing is lost:
re-run the script or push the prepared commit directly with

```bash
git push public public-release:main
```

Before publishing, make sure the public tree is installable:

```bash
git ls-files | grep -E 'wrangler\.toml$|\.dev\.vars' && echo "unexpected config"
npm ci && npm run typecheck && npm run test && npm run build
```

The public repository must not contain:

- `wrangler.toml` or `worker/wrangler.toml` (they carry the Pages URL and
  account-scoped resource identifiers);
- `.dev.vars`, `.env*` or any secret;
- `node_modules/`, `dist/`, `.wrangler/` (local D1 state) or `coverage/`;
- seed data: `db/schema.sql` must stay `CREATE` statements only, with no
  `INSERT` of real accounts, contacts or messages.

`git ls-files` is the source of truth: anything tracked is published, anything
untracked is not.

## Notification assets

`public/notification-badge.png` (96x96) and `public/notification-icon.png`
(192x192) are generated from the shell mark in `public/whelkmail-logo.svg`:

```bash
npm run icons
```

Android masks `badge` into a monochrome silhouette in the status bar and does
not render SVG there, which is why both files are PNG and why the badge is white
on a transparent background. The badge drops the thin decorative strokes of the
logo: at status bar size they only add noise. After changing the files, bump
`CACHE` in `public/sw.js` so installed clients pick up the new assets.

## Where things live

| Path | Contents |
| --- | --- |
| `src/` | React app (`App.tsx` holds the state machine, `components/` the UI) |
| `functions/api/` | Pages Functions endpoints |
| `functions/_lib/` | IMAP/SMTP, D1 access, sync, cache, filters, crypto |
| `shared/` | types, schemas, presets and paging helpers shared by both sides |
| `worker/` | notification cron worker (`index.ts` + example config) |
| `db/` | schema and migrations |
| `scripts/` | helper scripts (VAPID keys, migrations, worker config, publishing) |
| `tests/` | Vitest suites |
