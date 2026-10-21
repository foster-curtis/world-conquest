-- Local-only Vault values for the cron jobs (supabase/migrations/*_cron.sql).
-- `kong` is the API gateway's alias on the local Docker network, reachable from the database container.
-- The secret must match [edge_runtime.secrets] WC_SYSTEM_SECRET in config.toml. Production sets both by hand.
select vault.create_secret('http://kong:8000/functions/v1/game', 'game_function_url', 'game function base URL for pg_net');
select vault.create_secret('local-dev-system-secret', 'game_system_secret', 'x-wc-system-secret header value');
