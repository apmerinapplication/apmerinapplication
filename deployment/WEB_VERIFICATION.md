# Web release verification — 16 October 2026

## Local checks completed

- 104 current web workflow regression tests passed, including bounded email review, on-demand HTML, existing-card import resumption and interrupted-message retry.
- A local PostgreSQL engine applied the Supabase schema twice successfully. All 18 business tables have RLS enabled; the anon/authenticated roles cannot access the private application schema. The evidence bucket definition is private.
- The Python Postgres SQL transport and Flask API were exercised against that local engine using synthetic accounts/jobs: role-based login, job creation/list/detail, reminders, stale-edit rejection and worker leases passed. The single-connection test harness does not establish production multi-session isolation or Supabase pooler connectivity.
- Concurrent worker lease acquisition, expired-lease recovery, owner-checked release, import interruption and durable retry were tested with isolated storage.
- Private object signing, invalid object names, authentication, CSRF, accounting edit restrictions, worker bearer authentication and shared Gemini budget/cache were checked using isolated data and mocked provider requests.
- The web ZIP is checked for exact allowlist membership, SHA-256 contents, integrity, blank secret examples and absence of desktop files/customer records/private keys. Browser Gemini requests use the authenticated application API. Generated browser scripts pass syntax checks.

- All 16 existing local cards were checked read-only for response size. The maximum fell from 7.35 MiB to 1.11 MiB; the review page was 0.16 MiB. Original HTML remains available through authenticated previews. The three largest original HTML emails rendered previews below 1.4 MiB.
- Cloud entrypoint startup rendered the login without creating business/session files or starting persistent Python workers. Saved local API keys and profile passwords were checked against all web ZIP contents without exposing their values.

## Live cloud checks outstanding

No Vercel deployment or live Supabase migration was performed in this task. Production environment variables, database credentials, private bucket access, five user accounts, scheduler setup, mailbox connectivity, real cloud Gemini calls, volume limits and independent backups still need live verification. No local company job/email data was uploaded. Existing local company data, settings, credentials and legacy installations were preserved.
