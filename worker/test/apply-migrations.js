import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

// Aplica worker/migrations/ a la D1 local de Miniflare antes de cada fichero de tests.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
