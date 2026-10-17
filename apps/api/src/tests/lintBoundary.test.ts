import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: path.join(repoRoot, 'eslint.config.js'),
});

async function restrictedImportMessages(code: string, relativePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, relativePath) });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

describe('data access boundary (lint)', () => {
  it.each([
    [
      'a route file importing a model',
      'apps/api/src/modules/rooms/rooms.routes.ts',
      "import { UserModel } from '../../models/index.js';\nvoid UserModel;\n",
    ],
    [
      'a service importing a model file',
      'apps/api/src/modules/auth/x.service.ts',
      "import { UserModel } from '../../models/user.model.js';\nvoid UserModel;\n",
    ],
    [
      'middleware importing mongoose',
      'apps/api/src/middleware/x.ts',
      "import mongoose from 'mongoose';\nvoid mongoose;\n",
    ],
  ])('rejects %s', async (_name, file, code) => {
    const messages = await restrictedImportMessages(code, file);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/repository/i);
  });

  it.each([
    ['a repository', 'apps/api/src/repositories/x.repository.ts'],
    ['the db layer', 'apps/api/src/db/x.ts'],
    ['a test', 'apps/api/src/tests/x.test.ts'],
  ])('allows %s to import models', async (_name, file) => {
    expect(
      await restrictedImportMessages(
        "import { UserModel } from '../models/index.js';\nvoid UserModel;\n",
        file,
      ),
    ).toEqual([]);
  });

  it('allows route files to import repositories', async () => {
    expect(
      await restrictedImportMessages(
        "import { createRepositories } from '../../repositories/index.js';\nvoid createRepositories;\n",
        'apps/api/src/modules/rooms/rooms.routes.ts',
      ),
    ).toEqual([]);
  });
});
