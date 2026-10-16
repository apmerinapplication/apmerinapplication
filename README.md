# AP Merin procurement web application

Web-only procurement job cards, email evidence, supplier follow-up, shipment approvals and accounting workflow for AP Merin Services.

## Deployment

Deploy this repository as a **Vercel Flask** project with **Supabase Postgres** and **private Supabase Storage**. The entrypoint is `main:app`. Vercel runs the configured build to prepare CDN assets.

Follow [the deployment guide](deployment/WEB_VERCEL.md), apply the [Supabase schema](supabase/migrations/202610160001_workflow.sql), and enter the required values from [the blank environment example](deployment/web.env.example) in Vercel's server environment settings. Gemini and database/storage credentials must never be placed in browser code or committed to Git.

See [local verification and remaining live checks](deployment/WEB_VERIFICATION.md). This repository contains the deployment source; publishing it to GitHub does not by itself deploy or configure Vercel/Supabase.

## Release

Run `python web_release.py` to build and validate `deployment/AP_Merin_Web_Vercel.zip`. The package uses an explicit source allowlist and SHA-256 manifest. The current web release passed 104 isolated regression tests plus local PostgreSQL compatibility checks.

No customer jobs, mailboxes, credentials, saved sessions or desktop installers are included. Existing local company data and legacy installations remain separate.
