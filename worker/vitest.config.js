import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Solo para tests; wrangler.toml no se toca.
          compatibilityFlags: ['nodejs_compat'],
          // Las migraciones se aplican a la D1 local en test/apply-migrations.js.
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      // worker/index.test.mjs usa node:test; este runner solo recoge test/.
      include: ['test/**/*.test.js'],
      setupFiles: ['./test/apply-migrations.js'],
    },
  };
});
