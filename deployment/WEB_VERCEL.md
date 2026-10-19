# AP Merin procurement web deployment

Deploy the contents of **AP_Merin_Web_Vercel.zip** as one Vercel Flask project. This is the procurement web application; no Windows/macOS installation or Desktop shortcut is required. Legacy local installations and company records remain untouched. Do not deploy the entire development/Desktop folder.

## Architecture

- Vercel serves the dashboard and authenticated Python APIs at `/workflow/`, plus the existing quotation worksheet at `/quotation`. `pyproject.toml` explicitly selects `main:app`; the legacy standalone `app.py` is not the deployment entrypoint.
- Supabase Postgres holds jobs, accounts, role assignments, hashed passwords, reminders, events, import cursors, extraction caches and AI usage. Use the **transaction pooler** URI with its URL-encoded password, not the Supabase project URL. Prepared statements are disabled for pooler compatibility.
- Private Supabase Storage holds original emails and attachments. Only the server has its service key. Authenticated download requests obtain object-specific links valid for 60 seconds. There is no anonymous bucket policy.
- Gemini runs on the server, with bounded requests, cached results and a shared estimated US$10 monthly application allowance. This is not a Google billing limit. Keys are never returned to browsers.
- Functions perform resumable task steps instead of launching persistent background threads. Historical searches try subjects first, with text fallback when a client reference has no subject matches in that folder; `history_timeout` can be configured from 12 to 180 seconds. Each invocation advances a bounded batch, and a retry keeps saved folder/message progress even if a partial card already exists. A serialized Postgres lease prevents overlapping browser/scheduler workers. Email checks are requested at login and every ten minutes while users are active. Supabase Cron can continue queued imports without an open browser.

## Setup

1. In the existing Supabase project, apply `supabase/migrations/202610160001_workflow.sql` through SQL Editor. This creates the private `apmerin` schema and private `apmerin-evidence` bucket. Do not expose the schema through the Data API. Keep Storage public access disabled. Existing data is not automatically uploaded or replaced.
2. Extract the ZIP into a new local folder. Deploy that folder using Vercel CLI (`vercel`) or connect a private repository containing only these extracted files. Select Flask and Python 3.12/3.13. The configured build runs `python prepare_web_assets.py` to stage sanitized CDN assets. Function duration is configured to 300 seconds; no desktop dependencies are installed.
3. In **Vercel Project Settings → Environment Variables**, set every required value from `deployment/web.env.example`. Use distinct random session and worker secrets, each at least 32 characters. Store the supplied Gemini key there as `APMERIN_GEMINI_KEY`. Do not put values in Git, browser settings, screenshots or the ZIP. Configure production and preview environments separately; use a separate Supabase project for previews.
4. Set mailbox JSON using only identifiers, server names and password-environment-variable names. Put each mailbox password in its named Vercel secret. `folders:["*"]` enables historical import discovery; use `monitor_folders:["INBOX","Sent Items"]` for new-mail checks. Empty mail configuration leaves imports unavailable and is reported in Administration. Never copy local profile/password files into a deployment.

   New reference imports search only the signed-in procurement user's mailbox and Nurul's accounting mailbox. Match mailbox `id` to the staff account ID (`suga`, `kirthana`, `navin`), or set `user_id` explicitly. Use `id:"nurul"` (legacy `accounting` also works) for Nurul. Both connections are required; another user's mailbox is never substituted. Administrators select the responsible procurement mailbox when importing. Manually created RFQ cards and cards created through email review also queue this scan; a missing connection is reported while preserving the saved card. Each import saves its mailbox IDs so retries keep the same scope even if configuration order changes. Reviewed quantities, prices and delivery/payment approvals are preserved.
5. From a trusted local terminal with the database environment configured, run `python -m procurement_automation.manage init-users`. Enter five unique passwords interactively. This seeds Administrator, Suga, Kirthana, Navin and Nurul (accounting). No default passwords ship. It does not reset existing accounts. Configure client email allowlists, contacts, signatures and default CCs through the authenticated workflow setup.
6. Enable Supabase Cron, pg_net and Vault. Add `apmerin_worker_url` (the deployed `/workflow/api/internal/tick` URL) and `apmerin_worker_token` (matching `APMERIN_WORKER_SECRET`) through Vault. Apply `supabase/schedule.sql`. Confirm deployment protection permits this production scheduler request. Reapplying the SQL replaces the named schedule rather than creating duplicates.

## Incomplete setup after GitHub import

GitHub supplies source code only. It does not transfer local secrets into Vercel. All six variables below are required in the Production environment, followed by a redeployment:

| Variable | Value source |
| --- | --- |
| `APMERIN_DATABASE_URL` | Supabase Connect → Transaction pooler URI, with the database password URL-encoded |
| `APMERIN_SUPABASE_URL` | `https://pttjwzyhfnevwmdtzsjf.supabase.co` |
| `APMERIN_SUPABASE_SERVICE_KEY` | Supabase project API keys → server secret/service-role key; never the browser publishable key |
| `APMERIN_SESSION_SECRET` | A new cryptographically random secret of at least 32 characters |
| `APMERIN_WORKER_SECRET` | A different cryptographically random secret of at least 32 characters |
| `APMERIN_GEMINI_KEY` | Google AI Studio API key, entered directly into Vercel |

Missing or malformed settings return a `503 Cloud setup required` page and block every dashboard/API route without constructing the application, connecting to local storage or starting workers. The health endpoint returns `cloud_configuration_required`. If older deployments show `500 FUNCTION_INVOCATION_FAILED`, runtime logs listing missing server environment variables indicate this setup issue. A setup page is not a working deployment: schema installation, user creation and the live acceptance checks still apply.

## Release checks and operational limits

Run `python web_release.py` to rebuild and verify the explicit source allowlist and SHA-256 manifest. Run the workflow and cloud tests before deploying. `deployment/AP_Merin_Web_Vercel.zip` contains code/assets, schema and blank secret examples only; it contains no installed credentials or local jobs.

Vercel's function payload limit is 4.5 MB. Manual worksheet/attachment requests must remain below the app's 4 MB request limit; use document sections smaller than 3 MB and PDFs of up to eight pages for AI worksheet extraction. Larger originals received from email go directly from the worker to private Storage, and downloads bypass Vercel through short-lived signed links. Job-card metadata excludes duplicate Outlook HTML, which loads through the original preview endpoint when opened. Email review is paged, and each page is bounded to 25 messages with a size guard. Very large histories still need live volume testing.

Use an eligible commercial Vercel plan for company operation: Hobby is restricted to personal, non-commercial use. Function usage, Supabase quotas, Gemini billing and independent backups still need monitoring. Supabase Cron is used rather than a frequent Vercel Hobby cron. A minute schedule advances queued work; it does not scan the mailbox every minute when no signed-in user has requested it.

## Required live acceptance before use

After setting secrets, deploy and test login for all roles, logout/session expiry, forbidden accounting edits, evidence isolation/private downloads, real IMAP/SMTP connectivity, interrupted import retry, duplicate message handling, simultaneous workers, Gemini detection/cost accounting, supplier tracking credentials and backup/restore. Confirm job and email evidence counts before any separately authorized migration. The current local trial database is preserved and is **not automatically uploaded**.

Local tests and package validation do not establish a successful cloud deployment. This release needs actual Vercel/Supabase configuration and live verification before production use.

Official references: [Flask on Vercel](https://vercel.com/docs/frameworks/backend/flask), [function limits](https://vercel.com/docs/functions/limitations), [Hobby terms](https://vercel.com/docs/plans/hobby), [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [private Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals).
