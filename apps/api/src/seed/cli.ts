import { ConfigError, loadConfig } from '../config/index.js';
import { connectWithRetry, disconnectDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { createAuthKit } from '../modules/auth/index.js';
import { DEV_SEED_PASSWORD, runSeed, SeedRefusedError } from './seed.js';

/** `npm run seed -w @eas/api` (or `make seed`). Development tool; see assertSeedAllowed. */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const { repos, hasher } = createAuthKit({ config, logger });

  await connectWithRetry(config.mongodbUri, logger);
  try {
    const result = await runSeed({ env: process.env, repos, hasher, logger });
    for (const email of result.created) console.log(`created  ${email}`);
    for (const email of result.skipped) console.log(`exists   ${email}`);
    if (result.created.length > 0 && process.env['SEED_PASSWORD'] === undefined) {
      console.log(`Password for created users: ${DEV_SEED_PASSWORD} (development only)`);
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SeedRefusedError || error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
