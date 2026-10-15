import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Base URI of the shared in-memory MongoDB, ending with a slash. */
    mongoUri: string;
  }
}

/** One in-memory mongod for the whole run; each test file uses its own database name. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const mongod = await MongoMemoryServer.create();
  project.provide('mongoUri', mongod.getUri());
  return async () => {
    await mongod.stop();
  };
}
