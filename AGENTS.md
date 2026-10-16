# Web application release requirements

The AP Merin procurement application is web-only. Prepare deployment for Vercel with Supabase Postgres and private Supabase Storage. Do not rebuild Windows/macOS installers or refresh Desktop shortcuts for procurement web updates. This supersedes the former desktop release requirements at the user's direction.

Build and verify `deployment/AP_Merin_Web_Vercel.zip` using the explicit web source allowlist. No desktop executables, launchers, local customer data, profiles, saved sessions, email settings, uploads or private API keys belong in this package. Supply blank secret examples only. Preserve all existing local company data, settings, credentials and legacy installations.

Use Gemini for AI detection. Do not restore NVIDIA integration. Browser code must never contain Gemini, database, Supabase service-role or worker secrets. Production must fail closed if cloud settings are missing. Do not store production business data on Vercel's temporary filesystem or start persistent background threads there.

Validate cloud schema, role/session controls, storage access, job import resumption, worker concurrency and source package contents. Distinguish local verification from live Vercel/Supabase verification; never report a cloud deployment as complete until it is actually deployed and tested.
