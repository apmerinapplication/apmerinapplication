-- Enable Cron, pg_net and Vault in the Supabase dashboard first.
-- Add TWO secrets through Vault (not here):
-- apmerin_worker_url = https://YOUR-DOMAIN/workflow/api/internal/tick
-- apmerin_worker_token = the exact random APMERIN_WORKER_SECRET set in Vercel
-- Ensure Vercel deployment protection allows this production URL.
-- Upsert the named schedule; do not create duplicates on repeat setup.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='apmerin-cloud-worker') THEN
    PERFORM cron.unschedule('apmerin-cloud-worker');
  END IF;
END $$;
SELECT cron.schedule('apmerin-cloud-worker','* * * * *', $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apmerin_worker_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apmerin_worker_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 250000
  );
$$);
