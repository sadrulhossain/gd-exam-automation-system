import type { AuthKit } from '../auth/index.js';
import { createSuperadminRouter } from './superadmin.routes.js';
import { UserAdminService } from './users.service.js';

export { createSuperadminRouter } from './superadmin.routes.js';
export { generateTemporaryPassword, UserAdminService } from './users.service.js';

/** Wires the superadmin routes to the auth kit's guards, hasher and system repositories. */
export function createSuperadminModule(auth: AuthKit): ReturnType<typeof createSuperadminRouter> {
  return createSuperadminRouter({
    auth: auth.middleware,
    users: new UserAdminService({ hasher: auth.hasher, system: auth.repos }),
  });
}
