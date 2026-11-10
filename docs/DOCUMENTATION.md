# WhelkMail — Technical Documentation

This document covers the architecture, security model, mailbox behavior and storage.

> **Deploying or using it on Cloudflare?** Start with the dedicated step-by-step guide: [CLOUDFLARE.md](CLOUDFLARE.md). It covers dashboard clicks, exact commands, bindings, secrets, OAuth setup, verification and troubleshooting.

## 1. Scope

WhelkMail is a **webmail client**, not a mail server.

- It connects to existing mailboxes through IMAP and SMTP.
- It does not receive mail directly, does not run an MTA, and does not listen on ports 25/143/993/465/587.
- It does not create mailboxes. Thunderbird and mobile clients can keep connecting to the same provider independently.
- For domains with no SMTP, a separate **relay account** type sends through an HTTP email API and archives sent copies/drafts on Google Drive or Cloudflare R2.

## 2. Architecture

```
Browser (React/Vite)
        |
        | HTTPS, same-origin /api
        v
Cloudflare Pages Functions (Workers runtime)
        |
        +-- D1 (accounts, message metadata, relay archive, drafts)
        +-- IMAP over cloudflare:sockets (TLS / STARTTLS)
        +-- SMTP over cloudflare:sockets (TLS / STARTTLS)
        +-- OAuth: Google and Microsoft (XOAUTH2), Google Drive (archive)
        +-- HTTP relay APIs (send-only accounts)
        +-- R2 binding (optional, relay/IMAP archive)
```

Key constraints:

- Browsers cannot speak IMAP/SMTP, so all mailbox traffic goes through Pages Functions.
- Cloudflare Workers can open **outbound** TCP sockets with `cloudflare:sockets`. They cannot accept inbound TCP connections.
- Port 25 is blocked by Cloudflare and is not used.
- IMAP `IDLE` is not supported across requests. The UI refreshes on navigation, after sending, or on reload.

## 3. Request flows

### List messages

1. `GET /api/messages?accountId=all&folder=inbox`
2. The list is served from the D1 mirror first. If the folder has never been synced, the request bootstraps the newest headers from IMAP; otherwise a stale folder returns the cached list immediately and schedules a background sync.
3. The sync reads `UIDNEXT` from `SELECT` and fetches new UIDs plus bounded backfill windows instead of running `UID SEARCH ALL` on every pass. `BODYSTRUCTURE` is parsed locally to detect attachments without downloading message bodies.
4. Headers are parsed with `postal-mime`; results from all accounts are merged and sorted. Relay accounts contribute their D1 `messages` rows.
5. After the response, the server prefetches the newest few bodies (one message per account in the unified view, up to three for a selected account) into the D1 body cache with `UID FETCH ... (BODY.PEEK[])` on a single connection.

### Read a message

1. `GET /api/messages/:id`
2. The ID encodes the account, folder and UID (`i_<account>.<folder>.<uid>`) or a relay row (`r_<uuid>`).
3. The raw MIME is served from the D1 body cache when available, then from the R2/Drive archive, then from IMAP. A body fetched from IMAP or the archive is stored in the D1 cache (up to 512 KB) to make later opens and attachment requests fast.
4. Text, HTML and attachment metadata are returned. The message is marked `\Seen` for Inbox and Spam items. Cache/archive hits update D1 immediately and mark the provider asynchronously, so the HTTP response does not wait for a second IMAP connection.
5. HTML is rendered by the client in a sandboxed iframe with a restrictive CSP; scripts and forms are disabled. Remote images are blocked by default and can be enabled per message. Small `cid:` images are embedded as data URIs in the detail response; larger ones fall back to the authenticated attachment endpoint.

### Message actions

1. `POST /api/messages/actions` with `{ ids, action: "delete" | "spam" | "move", target?: "inbox" | "spam" | "trash" }`.
2. IMAP messages are grouped by account and folder; one connection copies the UIDs to the target with `UID COPY` and removes them from the source with `UID STORE +FLAGS (\Deleted)` plus `UID EXPUNGE`.
3. Delete moves the message to the provider Trash; spam moves it to the `\Junk` folder; not-spam moves it back to Inbox.
4. The D1 mirror is updated and the source/target folders are queued for sync. Moved rows stay in D1 until the target sync transfers labels through `stable_key`, then the source sync prunes them.

### Send

1. `POST /api/messages/send`
2. The server builds a complete MIME message.
3. **IMAP account:** authenticate and send through the account's own SMTP.
4. If `auto_saves_sent` is false, the same MIME is appended to the provider's Sent folder (`\Sent`, fallback `Sent`).
5. If `draftId` is present, the original draft is deleted.
6. **Relay account:** store the `.eml` in Drive/R2, send through the selected HTTP relay, record metadata in D1.

### Drafts

- **IMAP:** `APPEND` to the `\Drafts` folder with `\Draft \Seen`; delete with `UID STORE +FLAGS (\Deleted)` + `EXPUNGE`.
- **Relay:** MIME stored on Drive/R2 (`drafts/<id>.eml`), metadata in D1 with `folder='draft'`.
- Autosave runs 5 seconds after the last change and every 30 seconds while changes remain. Closing the composer saves pending changes first.
- On IMAP, autosave appends a new draft and deletes the previous one. The new UID comes from `APPENDUID` when the server supports UIDPLUS, otherwise from the highest UID in the Drafts folder.
- An explicit **Save draft** closes the composer and opens the Drafts folder.

## 4. Project structure

```
functions/                 Cloudflare Pages Functions
  _lib/
    imap/client.ts         IMAP client over cloudflare:sockets
    smtp/client.ts         SMTP client (PLAIN, LOGIN, XOAUTH2)
    mail/                  auth helpers, folder lookup, drafts, loading
    mime.ts                MIME builder
    storage/               Drive and R2 adapters
    relay/                 HTTP relay adapters
    microsoft/oauth.ts     Microsoft OAuth2 / XOAUTH2 token flow
  api/                     HTTP endpoints
shared/                    Types, Zod schemas, provider presets, paging helpers
src/                       React application
db/schema.sql              D1 schema for a fresh install
db/migrations/             Additive upgrades for existing databases
wrangler.toml.example      local Pages/D1 configuration template
worker/wrangler.toml.example  cron worker template (the real file is gitignored)
```

## 5. Data model

### `accounts`

One row per connected identity.

Important fields:

- `kind`: `imap` or `relay`
- `imap_host`, `imap_port`, `imap_security`, `smtp_host`, `smtp_port`, `smtp_security`
- `username`
- `auth_type`: `password` or `oauth2`
- `secret_enc`: encrypted password or OAuth refresh token
- `access_token_enc`, `access_token_expires_at`
- `oauth_provider`: currently `microsoft`
- `sent_folder`, `drafts_folder`, `spam_folder`, `auto_saves_sent`
- `signature`: optional per-account signature, used only when `signature_mode` is `per_account`
- `incoming_label_id`: optional shared label applied automatically to every incoming message of this account
- `delete_after_archive`: opt-in provider cleanup; archived incoming messages are moved to the provider Trash
- `auto_sync`: opt-in automatic background sync for Inbox, Sent, Drafts and Spam via the cron worker
- `storage_driver`: `provider`, `drive` or `r2`
- `relay_provider`, `relay_api_key_enc`, `relay_api_secret_enc`, `relay_domain`, `relay_region`
- `drive_*` fields for the optional Drive archive

### `messages`

Used for relay accounts: sent copies and drafts. IMAP messages are read from the provider and mirrored in `imap_messages`; the optional sync keeps metadata current, while recent bodies are held in the short-lived D1 cache. Full bodies are copied to R2/Drive only when long-term archiving is enabled.

Fields include folder, addresses JSON, subject, snippet, body text/HTML, size, storage key, attachment metadata and status.

### `labels` and `message_labels`

`labels` stores the custom label definitions (name, color). Labels are shared across every account, which keeps one unified taxonomy. `message_labels` stores assignments keyed by the app message id (`i_<account>.<folder>.<uid>` for IMAP, `r_<uuid>` for relay messages). IMAP assignments survive page reloads but refer to IMAP UIDs; if a mailbox changes UIDVALIDITY, reassign labels on affected messages. Deleting a label removes the related assignments and filter references.

### `filters`

Gmail-style automatic filters, shared across all accounts. Each row stores criteria (`from_pattern`, `to_pattern`, `subject_pattern`, `has_words`, `doesnt_have`, `has_attachment`) and actions: label ids in `label_ids_json` and forwarding recipients in `forward_to_json`. The legacy `account_id` column is kept only for schema compatibility and is set to an empty string for new rows. Enabled filters are evaluated when the inbox is listed and when the cron worker syncs new inbox messages; matching messages receive the labels in `message_labels` and are forwarded when `forward_to_json` is not empty.

### `contacts`

Shared address book: `id`, `name`, `email`, `note`, `created_at`. A unique index on `lower(email)` prevents duplicates; creating a contact with an existing email updates the name/note instead. Contacts are not account-scoped. The UI supports search, create/edit/delete, CSV import/export, and autocomplete in To/Cc/Bcc.

### `imap_sync` and `imap_messages`

`imap_messages` mirrors IMAP message metadata (headers, flags, size, attachment flag) in D1. `imap_sync` stores the per-account/per-folder cursor: `uid_validity`, `max_uid`, `min_uid`, `backfill_done`, status, error, counts and last sync time.

The sync is resumable and chunked (40 metadata messages per request, 8 when body archiving is enabled). It reads `UIDNEXT` from `SELECT`, fetches new UIDs above `max_uid`, and backfills older messages through bounded UID windows instead of running `UID SEARCH ALL` on every pass. Each run also refreshes flags for the most recent window, so read/unread changes made by other clients land in D1. A folder synced in `partial` state keeps receiving backfill chunks after a short retry interval, independently of the 60-second refresh of new mail. A row in `imap_sync_locks` (with a 5-minute expiry and an owner token) prevents two Workers isolates from running the same folder at the same time; the owner renews the expiry during long phases and only the owner can release it. Expired locks are removed by the cron worker. If the lock table or owner column is missing the sync still runs unlocked. A changed `UIDVALIDITY` resets the folder mirror. `stable_key` is the RFC `Message-ID` (or a deterministic hash fallback) and is used to transfer labels when a message moves between folders. Deleted/expunged messages are pruned after backfill when the provider message count differs from D1; archived objects are removed unless provider cleanup is enabled, in which case the archive is preserved.

The folder list reads from `imap_messages` first. Opening a folder does not block on IMAP: if the mirror is stale, the request returns the cached list immediately and schedules a background sync; the frontend polls the lightweight sync state with backoff and refreshes the list only when new UIDs or folder state change. On the first open of an account (empty mirror) the request runs one bounded sync chunk and re-reads the mirror, so it does not open a second IMAP connection just to render the same folder. Sent, Drafts and Spam folder names are resolved once and stored in `accounts.sent_folder` / `accounts.drafts_folder` / `accounts.spam_folder`.

`imap_body_cache` is a bounded, best-effort cache: message bodies up to 512 KB are kept for 3 days, with a hard 64 MB cap. The cron worker deletes expired rows and evicts the oldest bodies until the cache is back under the cap; opportunistic cleanup also runs every 50 writes. It never replaces the provider or the long-term archive; it only avoids repeated IMAP fetches for recently listed/opened messages.

`accounts.auto_sync` enables the cron worker to advance Inbox, Sent, Drafts and Spam every 5 minutes. Each run processes one bounded chunk per folder and resumes on the next run. New IMAP accounts enable it by default; existing accounts can still rely on the sync scheduled when a folder is opened.

`accounts.archive_imap_bodies` is optional; `accounts.imap_archive_driver` selects `r2` or `drive`. R2 requires a bound `BUCKET`; Drive requires the account's Google Drive OAuth connection. The sync stores the raw EML under `imap/<account>/<folder>/<uidvalidity>/<folder>-<uid>.eml` and records `archived`/`archive_key` in `imap_messages`. With Drive, `archive_key` is the Drive file id. Reading and attachment/download endpoints use the D1 body cache first, then the archive, and fall back to IMAP otherwise. When disabled, bodies and attachments stay on the provider.

### `push_subscriptions` and `push_prefs`

`push_subscriptions` stores Web Push endpoints and their `p256dh`/`auth` keys. Subscriptions are installation-wide, not account-scoped. `push_prefs` stores per-account notification preferences: `enabled` and `folders_json` (default `["inbox"]`). The cron endpoint reads these tables, syncs the selected folders and sends notifications for messages above the previous `max_uid`.

### `forward_log` and `deletion_log`

`forward_log` records the last forwarding result per `(filter_id, message_id)` and prevents duplicate forwards. `deletion_log` records provider-cleanup results per message.

Forwarding is an action of a filter. The cron endpoint evaluates filters for new incoming messages, applies their labels and forwards matching messages to the filter recipients. The original EML is attached, and the forwarded message carries `X-WhelkMail-Forwarded` to prevent loops.

Provider cleanup only runs when `archive_imap_bodies` and `delete_after_archive` are both enabled and the message is archived. The message is copied to the provider Trash and then removed from the source folder; the archived copy is preserved.

### `app_settings`

Key/value store for deployment-wide preferences. Currently used for `default_signature` and `signature_mode`.

`signature_mode` is `shared` (default) or `per_account`:

- `shared`: `default_signature` is used for every account and `accounts.signature` is ignored.
- `per_account`: every account uses its own `accounts.signature`; an empty value means no signature.

## 6. Security model

- **Single shared password + optional 2FA:** `APP_PASSWORD` protects the whole deployment. Two-factor authentication (TOTP, RFC 6238) can be enabled in Settings → Security; it is **off by default** and works with any authenticator app. Recovery codes are shown once and stored only as SHA-256 hashes.
- **Sessions:** random 256-bit session IDs; only their SHA-256 hashes are stored in D1 (`sessions`). TTL is 7 days. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS. Logout revokes the session. Deleting the `sessions` table rows invalidates all sessions.
- **Brute-force protection:** login and 2FA attempts are rate limited per IP in D1 (10 attempts per 15 minutes, then a 15-minute block).
- **Origin check:** mutating requests with a foreign `Origin` header are rejected.
- **OAuth:** one-time state stored in D1 with a 10-minute TTL, plus PKCE (`S256`) for Google, Microsoft and Google Drive.
- **Credential encryption:** IMAP/SMTP passwords, OAuth refresh tokens and relay API keys are encrypted with AES-256-GCM using `TOKEN_ENC_KEY` (32 raw bytes, base64 encoded). Session/challenge signatures use an HKDF-derived subkey.
- **Security headers:** CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` are set on static assets (`public/_headers`) and API responses (middleware).
- **Key rotation:** changing `TOKEN_ENC_KEY` makes all stored credentials unreadable and invalidates sessions and pending OAuth states. Users must re-enter passwords and reconnect OAuth accounts.
- **No multi-tenancy:** there is no per-user isolation. This is intended for personal or small trusted deployments. Put Cloudflare Access in front for stronger authentication.
- **Secrets:** `.dev.vars`, `.env` and `.wrangler` are gitignored. Production secrets belong in the Pages project settings.

If you lose both the authenticator and the recovery codes, disable 2FA from a D1 console:

```sql
DELETE FROM app_settings WHERE key IN ('totp_enabled', 'totp_secret_enc', 'totp_recovery_json');
DELETE FROM sessions;
```

## 7. Authentication per account

| Provider | Method |
|---|---|
| Google accounts | OAuth2 (recommended) or app password (2-Step Verification required) |
| Outlook / Microsoft 365 | OAuth2 + XOAUTH2 (basic auth is no longer supported by Microsoft) |
| Yahoo | App password |
| iCloud | App-specific password |
| Generic IMAP | Account password or app password |
| Relay accounts | Provider HTTP API key (+ secret/domain where required) |

## 8. Relay accounts and storage

Relay accounts are for send-only domains. Supported providers:

`smtp2go`, `resend`, `mailgun`, `brevo`, `sendgrid`, `mailjet`, `postmark`.

- Credentials can be entered per account in the UI and are encrypted.
- Deployment-level `RELAY_*` variables act as a fallback.
- The sender domain must be verified with the provider (SPF/DKIM).
- Conservative attachment limits are enforced per provider: 15 MB for most, 12 MB for Mailjet, 8 MB for Brevo.

Archive storage:

- **Google Drive:** per-user OAuth with `drive.file`; files live in a `MailClient` folder. 15 GB free for personal accounts. Service accounts have no storage quota and cannot be used as a free bucket.
- **Cloudflare R2:** optional binding named `BUCKET`. When the binding is absent, R2 is hidden in the UI.

IMAP accounts use external storage only when body archiving is enabled per account: by default attachments, Sent copies and drafts stay on the mail provider. The same Drive/R2 destinations can be used for that optional archive ("Archive bodies and attachments" in the account's sync section).

## 9. Account chips and custom labels

Messages carry `accountId`, `accountName` and `accountEmail`. The unified view shows a deterministic color label per connected address, and the account bar filters by address. This is address-level labeling, not alias-level labeling.

Custom labels are separate and user-defined, shared across accounts. They can be created from the sidebar or from the filter editor. Clicking a label opens a label view: the API reads `message_labels`, groups the assigned message ids by account and folder, fetches those IMAP UIDs directly from the provider and merges them with relay messages. The view therefore covers Inbox, Sent, Drafts and Spam across the selected accounts, like Gmail, without mirroring the whole mailbox locally. Removed or expunged messages simply disappear from the view.

Each account can also define an `incoming_label_id`. When the inbox is listed, every incoming message of that account receives the shared label automatically. The label is chosen while adding the account or in Settings; if it does not exist, it is created.

Automatic filtering is managed in Settings → Filters and is shared across accounts. Criteria are ANDed and matching is case-insensitive. Actions can apply one or more labels, forward to recipients, or both, like Gmail. Matching runs when the inbox is listed and when the cron worker syncs new inbox messages. The match text covers sender, recipients, subject and snippet, not the full body.

When a message moves to another folder on the provider, its UID changes and the local label assignment no longer applies. The optional IMAP metadata sync mirrors headers and UIDs, but labels still follow the UID, so a move can lose the local assignment until the message is labeled again.

## 10. PWA and Web Push

`public/manifest.webmanifest` and `public/sw.js` make the app installable. The service worker caches the app shell and static assets, never `/api/`, and handles `push` and `notificationclick`.

Web Push works in three parts:

1. The client asks for browser permission, registers the service worker and subscribes with the VAPID public key.
2. `push_subscriptions` and `push_prefs` persist the subscription and per-account/folder preferences.
3. The `worker/` cron Worker runs every 5 minutes and calls `POST /api/cron/notifications` with `CRON_SECRET`. That endpoint syncs the selected folders, detects new UIDs and sends encrypted Web Push messages with VAPID.

VAPID keys are generated with `npm run vapid` and stored as Pages secrets. The cron worker needs `APP_URL` and the same `CRON_SECRET`.

## 11. Forwarding and provider cleanup

Forwarding is a filter action: a filter can apply labels, forward to one or more recipients, or both, like Gmail. The cron endpoint processes messages above the previous inbox `max_uid`, evaluates enabled filters and the account incoming label, then forwards messages matched by a filter with `forward_to_json`. The forwarded message is built from the original EML, attached as `message/rfc822`, and stamped with `X-WhelkMail-Forwarded`; messages carrying that header are skipped to prevent loops. `forward_log` has a unique `(filter_id, message_id)` key so a message is forwarded once per filter.

Provider cleanup is opt-in per account and requires body archiving. For a new inbox message with `archived = 1` and an `archive_key`, the cron copies the message to the provider Trash (`\Trash`, with name fallbacks), removes it from the inbox and writes `deletion_log`. The archived R2/Drive object is preserved when this feature is enabled.

## 12. Internationalization

- Default locale: English.
- Italian included.
- Choice persisted in `localStorage` (`whelkmail_locale`, falling back to the legacy `mc_locale`).
- UI strings live in `src/i18n.tsx`; add a locale object and a `LOCALES` entry to extend.
- Provider/server error strings are not translated.

## 13. Local development

```bash
npm install
npm run db:local
npm run dev
npm run dev:api
```

- `npm run db:local` applies `db/schema.sql` to the local D1 database.
- `npm run db:migrate:local` applies all additive migrations (labels, filters, contacts, sync, archive, push, forwarding, deletion, security) to an existing local database.
- If you only need the security tables (sessions, 2FA rate limiting, OAuth state), run `npm run db:migrate:local:12`. Existing sessions are invalidated and you will need to sign in again.
- `npm run dev` starts Vite on port 5173.
- `npm run dev:api` starts Pages Functions on port 8788 and proxies static files to Vite.
- Open `http://localhost:8788`.

`.dev.vars`:

```env
APP_PASSWORD=change-me
TOKEN_ENC_KEY=<32-byte base64 key>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_MAIL_CLIENT_ID=
GOOGLE_MAIL_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT=common
RELAY_PROVIDER=smtp2go
RELAY_API_KEY=
```

Generate `TOKEN_ENC_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Checks:

```bash
npm run typecheck
npm run build
npm run lint
```

## 14. Cloudflare deployment overview

> **Complete step-by-step guide:** [CLOUDFLARE.md](CLOUDFLARE.md). It covers dashboard clicks, exact commands, D1 setup, bindings, secrets, OAuth applications, verification and troubleshooting.

### Prerequisites

- Cloudflare account with Workers & Pages enabled
- Node.js 22+
- `npx wrangler login`
- The repository pushed to GitHub (private repositories are supported)

### 12.1 Create the D1 database

```bash
npx wrangler d1 create mail-client
```

Copy the returned `database_id` into your local `wrangler.toml` (gitignored; start from `wrangler.toml.example`), or configure the `DB` binding in the Pages dashboard:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mail-client"
database_id = "<your-database-id>"
```

The D1 database keeps the legacy `mail-client` name to preserve existing data; the Pages project is `whelkmail`.

### 12.2 Create the Pages project

Dashboard route:

1. Workers & Pages → Create → Pages → Connect to Git.
2. Select the repository.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Root directory: `/`
6. Set `NODE_VERSION=22` if the default is older.

CLI alternative:

```bash
npx wrangler pages project create whelkmail
npm run deploy
```

`npm run deploy` builds the frontend and runs `wrangler pages deploy dist`.

### 12.3 Bindings

In the Pages project settings → Bindings:

- **D1**: variable name `DB`, database `mail-client`.
- **R2 (optional)**: variable name `BUCKET`, choose or create a bucket.

Keep the binding names exactly `DB` and `BUCKET`.

### 12.4 Secrets and variables

Add these in Pages → Settings → Variables and Secrets. Use encrypted secrets for credentials.

Required:

| Name | Type | Notes |
|---|---|---|
| `APP_PASSWORD` | Secret | Login password for the whole app |
| `TOKEN_ENC_KEY` | Secret | 32-byte base64 key; do not change after entering credentials |

Optional:

| Name | Type | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Secret | Google Drive archive for relay and IMAP accounts |
| `GOOGLE_CLIENT_SECRET` | Secret | Google OAuth client secret |
| `GOOGLE_MAIL_CLIENT_ID` | Secret | Google OAuth client for IMAP/SMTP |
| `GOOGLE_MAIL_CLIENT_SECRET` | Secret | Google OAuth secret for IMAP/SMTP |
| `MICROSOFT_CLIENT_ID` | Secret | Microsoft OAuth application ID |
| `MICROSOFT_CLIENT_SECRET` | Secret | Microsoft client secret |
| `MICROSOFT_TENANT` | Variable | `common` or a tenant ID |
| `RELAY_PROVIDER` | Variable | Deployment-wide relay fallback |
| `RELAY_API_KEY` | Secret | Fallback relay key |
| `RELAY_API_SECRET` | Secret | Mailjet fallback secret |
| `MAILGUN_DOMAIN` | Variable | Mailgun fallback domain |
| `MAILGUN_REGION` | Variable | `us` or `eu` |

Relay credentials entered per account in the UI take precedence over these values.

### 12.5 Apply the schema

```bash
npm run db:remote
```

If you already created the tables before labels and signatures were added, apply the additive migration:

```bash
npm run db:migrate:remote
```

If you already created the tables before relay support, apply the additive migration:

```sql
ALTER TABLE accounts ADD COLUMN relay_api_key_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_api_secret_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_domain TEXT;
ALTER TABLE accounts ADD COLUMN relay_region TEXT;
```

### 12.6 Workers Paid

IMAP and SMTP TLS handshakes plus authentication frequently exceed the free Workers CPU budget (10 ms). Use the Workers Paid plan (starting at $5/month) for a usable deployment.

### 12.7 Google Drive OAuth (optional)

Used by relay accounts that archive on Drive and by IMAP accounts that enable **Archive bodies and attachments** in their sync settings. These are Drive credentials, separate from the Gmail mail client (`GOOGLE_MAIL_CLIENT_ID`/`GOOGLE_MAIL_CLIENT_SECRET`); without them the Connect Drive button returns `oauth_not_configured`.

1. Google Cloud Console → enable the Google Drive API.
2. OAuth consent screen → External.
3. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/drive.file`.
4. Create an OAuth client ID of type Web application.
5. Authorized redirect URIs:
   - `https://<your-domain>/api/drive/oauth/callback`
   - `http://localhost:8788/api/drive/oauth/callback` for local development.
6. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
7. Set the consent screen to **In production**. In Testing mode, refresh tokens expire after 7 days. `drive.file` is non-sensitive, so no CASA assessment is required.

### 12.8 Google OAuth for IMAP/SMTP (optional)

Google accounts can authenticate over IMAP/SMTP with OAuth2, the same model Thunderbird uses. It requires the restricted scope `https://mail.google.com/`.

1. Google Cloud Console → create or select a project.
2. OAuth consent screen → External (or Internal for Workspace-only use).
3. Scopes: `openid`, `email`, `https://mail.google.com/`.
4. Create an OAuth client ID of type **Web application**. Prefer a dedicated client, separate from the Drive client, so the Drive-only setup remains non-sensitive.
5. Authorized redirect URIs:
   - `https://<your-domain>/api/google/oauth/callback`
   - `http://localhost:8788/api/google/oauth/callback`.
6. Set `GOOGLE_MAIL_CLIENT_ID` and `GOOGLE_MAIL_CLIENT_SECRET`.
7. Verification: `https://mail.google.com/` is a restricted scope. A public app in production requires Google verification (CASA). For personal use, keep the consent screen in **Testing** and add the Google accounts as test users: OAuth works, but refresh tokens expire after 7 days. Internal Workspace apps avoid verification but are limited to that organization.

If Google OAuth is not configured, Google accounts can still use an app password with 2-Step Verification.

### 12.9 Microsoft OAuth (optional)

Required for Outlook / Microsoft 365, which no longer accept basic authentication for IMAP/SMTP.

1. Microsoft Entra ID → App registrations → New registration.
2. Supported account types: personal and organizational accounts as needed.
3. Redirect URI (Web):
   - `https://<your-domain>/api/microsoft/oauth/callback`
   - `http://localhost:8788/api/microsoft/oauth/callback`.
4. Certificates & secrets → create a client secret.
5. API permissions (delegated):
   - Office 365 Exchange Online: `IMAP.AccessAsUser.All`, `SMTP.Send`
   - OpenID scopes: `offline_access`, `openid`, `email`, `profile`
6. Grant admin consent if your tenant requires it.
7. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` (`common` for personal + work).

### 12.10 Custom domain

Pages → Custom domains → add the domain and follow the DNS instructions. After changing the domain, update the OAuth redirect URIs.

### 12.11 Post-deploy checklist

- `GET /api/health` returns `ok: true`.
- Sign in with `APP_PASSWORD`.
- Add an IMAP account and use **Test connection** in Settings.
- Send a message and verify it in the provider's Sent folder.
- Save a draft and reopen it.
- Add a second account and verify labels and the unified inbox.
- For relay accounts, verify the relay key, domain verification and archive storage.

## 15. Environment reference

| Name | Required | Purpose |
|---|---|---|
| `APP_PASSWORD` | Yes | App login |
| `TOKEN_ENC_KEY` | Yes | AES-GCM key for stored credentials |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | Drive archive |
| `GOOGLE_MAIL_CLIENT_ID` / `GOOGLE_MAIL_CLIENT_SECRET` | No | Google OAuth for IMAP/SMTP |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | No | Outlook OAuth |
| `MICROSOFT_TENANT` | No | Defaults to `common` |
| `RELAY_PROVIDER` | No | Default relay fallback |
| `RELAY_API_KEY` | No | Default relay key fallback |
| `RELAY_API_SECRET` | No | Mailjet fallback secret |
| `MAILGUN_DOMAIN` / `MAILGUN_REGION` | No | Mailgun fallback |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | No | Web Push VAPID keys |
| `VAPID_SUBJECT` | No | VAPID contact (`mailto:`) |
| `CRON_SECRET` | No | Shared secret for the cron worker |
| `DB` (D1 binding) | Yes | Metadata |
| `BUCKET` (R2 binding) | No | R2 archive |

## 16. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Google `AUTHENTICATIONFAILED` | Use OAuth or an app password with 2FA enabled, not the account password |
| Google OAuth stops working after ~7 days | Consent screen still in Testing; use an Internal app or complete verification, or fall back to an app password |
| Google “access blocked” | Redirect URI mismatch, missing test user, or restricted-scope verification required |
| Outlook login fails | Missing OAuth permissions, redirect URI mismatch, or admin consent |
| Connection timeout | Wrong host/port/security: 993 TLS, 465 TLS, 587 STARTTLS, 143 STARTTLS |
| Sent copy not saved | Provider lacks `\Sent`/`APPEND`; set the folder manually or adjust `auto_saves_sent` |
| Duplicate sent mail | `auto_saves_sent` is false but the provider already saves sent mail |
| Drafts not saved | No `\Drafts` folder or no `APPEND` permission |
| Drive 403 | OAuth scopes, testing-mode token expiry, or Drive not connected |
| R2 option hidden | Missing `BUCKET` binding |
| Attachment rejected | Provider-specific message size limit |
| `CPU time limit exceeded` | Upgrade to Workers Paid |
| D1 errors after deploy | Placeholder `database_id` or schema not applied |

## 17. Known limitations

- No IMAP IDLE. Metadata sync is manual/chunked or opt-in automatic via the cron worker; Web Push also depends on that worker.
- Folder lists are served from the D1 mirror (up to 100 messages); the first open of an account bootstraps from IMAP. Search is client-side over the loaded set.
- No IMAP server-side search UI beyond the latest page.
- HTML bodies are rendered in a sandboxed frame; remote images and tracking pixels are blocked by default and can be enabled globally in Settings → General, or per message. Small inline `cid:` images are embedded in the detail response; larger ones fall back to the authenticated attachment endpoint, which uses the D1 body cache when the message fits.
- Attachments for messages not in the D1 body cache are fetched by re-reading the full message. Messages up to 512 KB are cached after the first read; larger ones keep using the provider unless a long-term archive is configured.
- No alias-based send-as; the sender is the account address.
- Autosave requires the provider to accept `APPEND` in the Drafts folder; without `APPENDUID`, the new UID is resolved with a search, which can be ambiguous with concurrent clients.
- Forwarding and provider cleanup only process new messages detected by the cron worker after the initial sync; failed attempts are logged but not retried automatically.
- Provider cleanup moves messages to Trash and requires archive; it never performs a permanent delete from the provider.
- Account deletion removes D1 rows and makes a best-effort cleanup of R2/Drive objects referenced in D1; it never deletes mail from the provider. Objects orphaned by failed writes may remain.
- No per-user isolation or audit log. Login and 2FA rate limiting are present but per-IP only.
- Generic API errors include a stable `code`; the UI translates it. Provider details (for example IMAP or relay responses) are shown to the authenticated admin to help debugging and are not exposed on public endpoints.
- Attachment indicators in lists come from `BODYSTRUCTURE`. The newest bodies are prefetched in the background and cached; other bodies are downloaded when a message is opened.

## 18. License

MIT — see [LICENSE](../LICENSE).
