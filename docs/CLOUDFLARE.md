# Deploying WhelkMail on Cloudflare

This is the complete, step-by-step guide to run WhelkMail on Cloudflare. You do not need a VPS, a mail server, or an external backend.

> **Important:** this is not a static site. Deploy it as a **Pages project with Functions**. The `functions/` directory is the API (IMAP/SMTP over `cloudflare:sockets`). Uploading only `dist` without Functions will break every API call.

## What you will create

| Cloudflare resource | Purpose |
|---|---|
| Pages project | Static UI + Pages Functions (`functions/`) |
| D1 database | Accounts, settings, IMAP sync metadata, relay archive/drafts metadata |
| Secrets | App password, encryption key, optional OAuth and relay keys |
| R2 bucket (optional) | Sent/draft archive for relay accounts; optional IMAP body/attachment archive |
| Custom domain (optional) | HTTPS hostname for the app |

## Before you start

- A Cloudflare account.
- A GitHub repository containing this project.
- Node.js 22 or newer and npm.
- Wrangler authenticated:
  ```bash
  npx wrangler login
  ```
- A Workers Paid plan is strongly recommended. IMAP/SMTP TLS handshakes and authentication routinely exceed the 10 ms CPU budget of the free plan.

## 1. Deploy from GitHub (recommended)

### 1.1 Create the D1 database

```bash
npx wrangler d1 create mail-client
```

The command prints a `database_id`. Use it in one of two ways:

- **GitHub deployment:** set the `DB` binding in the Pages dashboard; `wrangler.toml` can stay local and untracked.
- **CLI/local:** copy `wrangler.toml.example` to `wrangler.toml` and paste the ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mail-client"
database_id = "<paste-the-database-id-here>"
```

The zero UUID in the example is fine for local development. For remote CLI commands and for deployments that read `wrangler.toml`, replace it with the real D1 ID or the Functions will fail.

> The D1 database intentionally keeps the legacy name `mail-client` so existing deployments and data continue to work after the whelkmail rebrand. Only the Pages project is named `whelkmail`.

Dashboard equivalent: **Storage & Databases → D1 SQL Database → Create**.

### 1.2 Create the Pages project from GitHub

1. Open **Workers & Pages** in the Cloudflare dashboard.
2. **Create** → **Pages** → **Connect to Git**.
3. Select the repository and branch.
4. Project name: `whelkmail`.
5. Build settings:

| Setting | Value |
|---|---|
| Framework preset | None / Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |

Add an environment variable `NODE_VERSION=22` in the Pages project settings if the default Node version is older.

`functions/` is detected automatically; no extra configuration is needed.

### 1.3 Add bindings

In the Pages project: **Settings → Bindings**.

Required:

| Binding name | Type | Target |
|---|---|---|
| `DB` | D1 database | `mail-client` |

Optional:

| Binding name | Type | Target |
|---|---|---|
| `BUCKET` | R2 bucket | any bucket you create |

Use exactly these names. The code reads `env.DB` and `env.BUCKET`.

### 1.4 Add secrets and variables

In the Pages project: **Settings → Variables and Secrets**. Add them to **Production** and, if you use preview deployments, to **Preview** as well.

Required:

| Name | Type | Value |
|---|---|---|
| `APP_PASSWORD` | Secret | the login password for the whole app |
| `TOKEN_ENC_KEY` | Secret | 32 random bytes encoded in base64 |

Generate the key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

CLI equivalent:

```bash
npx wrangler pages secret put APP_PASSWORD --project-name whelkmail
npx wrangler pages secret put TOKEN_ENC_KEY --project-name whelkmail
```

Optional:

| Name | Type | Purpose |
|---|---|---|
| `GOOGLE_MAIL_CLIENT_ID` | Secret | Google OAuth for IMAP/SMTP |
| `GOOGLE_MAIL_CLIENT_SECRET` | Secret | Google OAuth secret |
| `GOOGLE_CLIENT_ID` | Secret | Google Drive archive |
| `GOOGLE_CLIENT_SECRET` | Secret | Google Drive secret |
| `MICROSOFT_CLIENT_ID` | Secret | Microsoft OAuth |
| `MICROSOFT_CLIENT_SECRET` | Secret | Microsoft OAuth secret |
| `MICROSOFT_TENANT` | Variable | `common` or a tenant ID |
| `RELAY_PROVIDER` | Variable | deployment-wide relay fallback |
| `RELAY_API_KEY` | Secret | deployment-wide relay key fallback |
| `RELAY_API_SECRET` | Secret | Mailjet fallback secret |
| `MAILGUN_DOMAIN` | Variable | Mailgun fallback domain |
| `MAILGUN_REGION` | Variable | `us` or `eu` |
| `VAPID_PUBLIC_KEY` | Variable/Secret | Web Push public key |
| `VAPID_PRIVATE_KEY` | Secret | Web Push private key |
| `VAPID_SUBJECT` | Variable | `mailto:` contact for VAPID |
| `CRON_SECRET` | Secret | shared secret for the cron worker |

Relay credentials entered per account in the UI take precedence over the deployment fallbacks.

Changing `TOKEN_ENC_KEY` later invalidates all stored IMAP/SMTP passwords, OAuth refresh tokens and relay API keys. Plan key rotation accordingly.

### 1.5 Apply the database schema

```bash
npm run db:remote
```

This runs:

```bash
wrangler d1 execute mail-client --remote --file=./db/schema.sql
```

Verify:

```bash
npx wrangler d1 execute mail-client --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table';"
```

You should see `accounts` and `messages`.

If the database already existed before labels and signatures were added, apply the additive migration:

```bash
npm run db:migrate:remote
```

That runs `db/migrations/001_labels_signatures.sql` through `db/migrations/016_sync_lock.sql`, which add the schema for labels, filters, contacts, IMAP sync/archive, push, filter-based forwarding, provider deletion logs, the per-account automatic-sync flag, the security tables (sessions, login rate limiting, one-time OAuth state), the cached drafts and spam folders, the short-lived body cache, and the cross-isolate sync lock.

If earlier migrations were already applied, run only the missing one:

```bash
npm run db:migrate:remote:13
```

Migration `012` also invalidates existing sessions: users must sign in again. Two-factor authentication is available in Settings → Security and is disabled by default.

### 1.6 Web Push notifications (optional)

Generate a VAPID key pair:

```bash
npm run vapid
```

Add to the Pages project:

```bash
npx wrangler pages secret put VAPID_PUBLIC_KEY --project-name whelkmail
npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name whelkmail
npx wrangler pages secret put CRON_SECRET --project-name whelkmail
```

`VAPID_SUBJECT` can be a plain variable such as `mailto:you@example.com`.

The cron worker config is personal, so it is gitignored. Copy the template, set your Pages URL and deploy:

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
# set APP_URL in worker/wrangler.toml to https://<your-project>.pages.dev
npx wrangler secret put CRON_SECRET -c worker/wrangler.toml
npm run cron:deploy
```

`npm run cron:deploy` creates the file from the template when it is missing and stops with a clear error while `APP_URL` is still empty or a placeholder.

The worker runs every 5 minutes and calls `POST /api/cron/notifications` on the Pages app. In the same run it also applies automatic forwarding rules, the optional provider cleanup, and the per-account automatic background sync. Enable notifications from **Settings → Push notifications**, background sync per account in Settings, and forwarding/deletion in the account/filter sections.

If the database already existed before relay support was added, apply the additive migration:

```sql
ALTER TABLE accounts ADD COLUMN relay_api_key_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_api_secret_enc TEXT;
ALTER TABLE accounts ADD COLUMN relay_domain TEXT;
ALTER TABLE accounts ADD COLUMN relay_region TEXT;
```

### 1.6 Deploy

- **Git integration:** push to the connected branch. Cloudflare builds and deploys automatically.
- **Manual retry:** Pages project → **Deployments** → **Retry deployment**.

The first deployment URL is `https://whelkmail.pages.dev` (or the project name you chose).

### 1.7 First login and account setup

1. Open the deployment URL.
2. Sign in with `APP_PASSWORD`.
3. Click **Add account** (Sidebar or Settings).
4. Choose **IMAP/SMTP mailbox** or **Send-only (relay)**.
5. For an IMAP mailbox:
   - Select the provider preset or enter IMAP/SMTP hosts, ports and security manually.
   - Choose OAuth where supported, or enter a password / app password.
   - Use **Test connection** in Settings.
6. For a send-only domain:
   - Select the relay provider and paste its API key.
   - Choose where sent copies and drafts go: **Google Drive**, **R2** (only if the `BUCKET` binding exists) or **another account's mailbox**. The third option appends every message to that IMAP account's Sent folder and every draft to its Drafts folder, and needs a connected IMAP account: without one the option stays disabled and saving drafts would fail (`sent_copy_target_not_connected`).
   - Only one destination is active at a time; switching back to Drive/R2 clears the mailbox choice.
7. Send a test message.
8. Save a draft, reopen it from **Drafts**, and delete it. With a mailbox destination, check that the draft also shows up in that account's Drafts folder on the provider.
9. Add a second account to see address labels and the unified inbox.

### 1.8 Custom domain

1. Pages project → **Custom domains** → **Set up a custom domain**.
2. Enter the hostname and follow the DNS instructions.
3. Wait for the certificate to become active.
4. If you use OAuth, update the redirect URIs to the new hostname.

## 2. Deploy from the CLI instead of GitHub

```bash
npx wrangler pages project create whelkmail
npm run build
npx wrangler pages deploy dist --project-name whelkmail
```

Or simply:

```bash
npm run deploy
```

`npm run deploy` runs `npm run build` and then `wrangler pages deploy dist`.

With CLI deployments, bindings and secrets come from the project configuration and your local `wrangler.toml`. With GitHub deployments, configure the D1 binding and secrets in the Pages dashboard instead; keep `wrangler.toml` local and untracked.

## 3. OAuth setup

OAuth is optional for generic IMAP and for app-password accounts. It is required for Microsoft 365 / Outlook accounts, which no longer accept basic authentication for IMAP/SMTP.

### 3.1 Google OAuth for IMAP/SMTP

Use a dedicated OAuth client, separate from the Drive client, so the Drive-only configuration remains non-sensitive.

1. Google Cloud Console → create or select a project.
2. OAuth consent screen → **External** (or **Internal** for Workspace-only use).
3. Add scopes:
   - `openid`
   - `email`
   - `https://mail.google.com/`
4. Create an OAuth client ID of type **Web application**.
5. Authorized redirect URIs:
   - `https://<your-domain>/api/google/oauth/callback`
   - `http://localhost:8788/api/google/oauth/callback` for local development
6. Set `GOOGLE_MAIL_CLIENT_ID` and `GOOGLE_MAIL_CLIENT_SECRET`.

Important: `https://mail.google.com/` is a **restricted** Google scope.

- A public production app requires Google verification (CASA).
- A personal deployment can stay in **Testing** by adding the Google account as a test user. OAuth works, but refresh tokens expire after 7 days.
- A Google Workspace **Internal** app avoids verification but only works inside that organization.
- If OAuth is not configured, use an app password with 2-Step Verification enabled.

### 3.2 Google Drive OAuth (relay and IMAP archive, optional)

1. Google Cloud Console → enable the Google Drive API.
2. OAuth consent screen → **External**.
3. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/drive.file`.
4. Create an OAuth client ID of type **Web application**.
5. Redirect URIs:
   - `https://<your-domain>/api/drive/oauth/callback`
   - `http://localhost:8788/api/drive/oauth/callback`
6. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. Set the consent screen to **In production** to avoid 7-day refresh-token expiry. `drive.file` is non-sensitive, so no CASA assessment is required.

The same credentials serve IMAP accounts that enable **Archive bodies and attachments** in Settings. They are separate from the Gmail mail client (`GOOGLE_MAIL_CLIENT_ID`/`GOOGLE_MAIL_CLIENT_SECRET`).

### 3.3 Microsoft OAuth (Outlook / Microsoft 365)

1. Microsoft Entra ID → **App registrations** → **New registration**.
2. Supported account types: personal and/or organizational, depending on your users.
3. Redirect URI (Web):
   - `https://<your-domain>/api/microsoft/oauth/callback`
   - `http://localhost:8788/api/microsoft/oauth/callback`
4. **Certificates & secrets** → create a client secret.
5. API permissions (delegated):
   - Office 365 Exchange Online: `IMAP.AccessAsUser.All`, `SMTP.Send`
   - OpenID: `offline_access`, `openid`, `email`, `profile`
6. Grant admin consent if the tenant requires it.
7. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and optionally `MICROSOFT_TENANT` (`common` for personal + work).

### 3.4 Relay provider setup

For send-only accounts:

1. Create an account with the relay provider.
2. Verify the sending domain with the provider (SPF and DKIM).
3. Copy the provider API key.
4. Paste it in the account creation form or in Settings.
5. Choose where the sent copies and drafts go: **Google Drive**, **R2** or **another account's mailbox**. The third option appends every message to the Sent folder (and every draft to the Drafts folder) of a connected IMAP account instead of storing them on Drive/R2; it is an alternative, not an addition.

Supported providers: SMTP2GO, Resend, Mailgun, Brevo, SendGrid, Mailjet, Postmark, Cloudflare Email Service.

**Cloudflare Email Service** ([docs](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)):

- API key: an account API token with the **Email Sending: Edit** permission.
- Account ID: your Cloudflare account ID (dashboard → account home, or the URL after `dash.cloudflare.com/`).
- The sending domain must be onboarded under **Email Service → Email Sending** in the same account. Each subdomain is onboarded separately.
- By default, a message with any recipient on Cloudflare's suppression list is rejected outright (error `10205`). Turn on **Drop suppressed recipients** for the sending domain to send to the other recipients instead; WhelkMail then reports the dropped addresses as not delivered.
- The custom SMTP option can't be used with Cloudflare's SMTP endpoint (`smtp.mx.cloudflare.net`): Workers block TCP sockets to Cloudflare's own IP ranges.

## 4. Optional R2 archive

R2 is used by send-only relay accounts and by IMAP accounts that enable the optional body/attachment archive. By default IMAP accounts keep everything on the mail provider.

1. **R2 Object Storage → Create bucket**.
2. Pages project → **Settings → Bindings** → add an R2 bucket binding named `BUCKET`.
3. Redeploy.

If the binding is absent, the R2 option is hidden in the UI.

## 5. Verification checklist

- `GET /api/health` returns `ok: true`.
- Login succeeds with `APP_PASSWORD` (plus the TOTP code if 2FA is enabled).
- Optional: 2FA can be enabled in Settings → Security, and a recovery code can complete the login.
- Security headers are present on `/` and `/api/health`.
- **Test connection** succeeds for an IMAP account.
- Sending adds a copy to the provider Sent folder (or the app appends it when `auto_saves_sent` is off).
- A draft can be saved, reopened and deleted.
- Two accounts produce colored labels and a unified inbox.
- Optional: Drive/R2 archive works for relay accounts and for IMAP accounts with body archiving enabled.
- Optional: OAuth reconnect works after a token refresh.

## 6. Operations

### Logs

Pages project → **Deployments** → select deployment → **Logs**, or:

```bash
npx wrangler pages deployment tail --project-name whelkmail
```

### Rollback

Pages project → **Deployments** → select a previous deployment → **Rollback**.

### D1 backup

```bash
npx wrangler d1 export mail-client --remote --output backup.sql
```

### Schema updates

Re-run `npm run db:remote` after changing `db/schema.sql`. `CREATE TABLE IF NOT EXISTS` does not alter existing tables; use `ALTER TABLE` for additive changes.

### Secret rotation

- Rotating `APP_PASSWORD` does not revoke existing sessions automatically; they remain valid until their 7-day expiry. To revoke all sessions immediately, delete the rows in `sessions` (or change `TOKEN_ENC_KEY`, which also invalidates credentials).
- Rotating `TOKEN_ENC_KEY` invalidates all stored credentials, sessions and pending OAuth states. Users must re-enter passwords and reconnect OAuth accounts.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `database_id` placeholder error | Replace the placeholder in the local `wrangler.toml`, or set the `DB` binding in the Pages dashboard |
| `D1_ERROR: no such table: accounts` | Run `npm run db:remote` |
| `D1_ERROR: no such table: labels` / `message_labels` / `app_settings` / `filters` / `contacts` / `imap_sync` / `imap_messages` / `push_subscriptions` / `push_prefs` / `forward_log` / `deletion_log` / `sessions` / `login_attempts` / `oauth_states` / `imap_body_cache` / `imap_sync_locks` | Run `npm run db:migrate:remote`; if earlier migrations were already applied, run `npm run db:migrate:remote:16` |
| `D1_ERROR: no such column: archive_imap_bodies` / `archive_key` / `imap_archive_driver` / `auto_sync` / `delete_after_archive` / `forward_to_json` / `drafts_folder` / `spam_folder` | Run `npm run db:migrate:remote`, or apply the missing `006`–`016` migrations in order |
| 401 loop after login | `APP_PASSWORD` mismatch, cookie blocked, site not served over HTTPS, or the `sessions` table missing (run `npm run db:migrate:remote:12`) |
| 500 on every API call | Missing `DB` binding, missing secrets, or missing security tables |
| Relay 503 | Relay provider not configured for the account and no deployment fallback |
| Google OAuth 503 | `GOOGLE_MAIL_CLIENT_ID` / `GOOGLE_MAIL_CLIENT_SECRET` missing |
| Microsoft OAuth 503 | `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` missing |
| OAuth redirect error | Redirect URI does not exactly match the app configuration |
| Google OAuth stops after ~7 days | Consent screen still in Testing; use Internal, verification, or an app password |
| R2 option missing | `BUCKET` binding not configured |
| `CPU time limit exceeded` | Upgrade to Workers Paid |
| IMAP timeout | Wrong host/port/security: 993 TLS, 465 TLS, 587 STARTTLS, 143 STARTTLS |
| Drafts fail | The provider has no `\Drafts` folder or does not allow `APPEND` |
| Duplicate sent copies | `auto_saves_sent` is disabled but the provider already stores sent mail |
| Custom domain error 1014/522 | DNS record missing or origin not ready |

## 8. Costs and limits

- Pages and Workers have free quotas, but IMAP/SMTP is CPU-heavy: use Workers Paid (from $5/month).
- D1 free tier: 5 GB storage and daily read/write quotas.
- R2 free tier: 10 GB storage, free egress.
- Google Drive: 15 GB shared with the Google account.
- No IMAP IDLE/push: the UI refreshes on navigation, after sending, or on reload.
- Last 30 messages per folder are listed; search is client-side over loaded messages.
