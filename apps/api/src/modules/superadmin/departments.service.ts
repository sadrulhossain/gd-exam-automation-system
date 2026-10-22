import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  ERROR_CODES,
  type CreateDepartment,
  type DepartmentListQuery,
  type DepartmentRecord,
  type Paginated,
  type UpdateDepartment,
} from '@eas/shared';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { pageMeta, parseSort, skipFor } from '../../lib/query.js';
import { audit, diffFields, toDepartmentRecord, type AdminContext } from './context.js';

const SORT_FIELDS = ['name', 'code', 'createdAt'] as const;

const notFoundDepartment = () => notFound('Department not found');
const invalidState = (message: string) => new AppError(ERROR_CODES.INVALID_STATE, message);

/** A department may only sit under a faculty that exists and is not archived. */
async function requireActiveFaculty(ctx: AdminContext, facultyId: string): Promise<void> {
  const faculty = await ctx.repos.faculties.findById(facultyId);
  if (faculty === null) throw notFound('Faculty not found');
  if (faculty.isArchived) throw invalidState('The faculty is archived');
}

export async function listDepartments(
  ctx: AdminContext,
  query: DepartmentListQuery,
): Promise<Paginated<DepartmentRecord>> {
  const { items, total } = await ctx.repos.departments.search({
    search: query.search,
    archived: query.archived,
    facultyId: query.facultyId,
    sort: parseSort(query.sort, SORT_FIELDS, { name: 1 }),
    skip: skipFor(query),
    limit: query.limit,
  });
  return { items: items.map(toDepartmentRecord), meta: pageMeta(total, query) };
}

export async function getDepartment(ctx: AdminContext, id: string): Promise<DepartmentRecord> {
  const department = await ctx.repos.departments.findById(id);
  if (department === null) throw notFoundDepartment();
  return toDepartmentRecord(department);
}

export async function createDepartment(
  ctx: AdminContext,
  input: CreateDepartment,
): Promise<DepartmentRecord> {
  await requireActiveFaculty(ctx, input.facultyId);
  const created = await ctx.repos.departments.add({
    facultyId: input.facultyId,
    name: input.name,
    code: input.code.toUpperCase(),
  });
  await audit(ctx, {
    action: AUDIT_ACTIONS.DEPARTMENT_CREATE,
    targetType: AUDIT_TARGET_TYPES.DEPARTMENT,
    targetId: created._id.toString(),
    metadata: { facultyId: input.facultyId, name: created.name, code: created.code },
  });
  return toDepartmentRecord(created);
}

export async function updateDepartment(
  ctx: AdminContext,
  id: string,
  patch: UpdateDepartment,
): Promise<DepartmentRecord> {
  if (patch.name === undefined && patch.code === undefined && patch.facultyId === undefined) {
    throw badRequest('Provide at least one field to update');
  }
  const before = await ctx.repos.departments.findById(id);
  if (before === null) throw notFoundDepartment();
  if (before.isArchived) throw invalidState('Restore the department before editing it');
  if (patch.facultyId !== undefined && patch.facultyId !== before.facultyId.toString()) {
    await requireActiveFaculty(ctx, patch.facultyId);
  }

  const after = await ctx.repos.departments.updateActive(id, {
    name: patch.name,
    code: patch.code?.toUpperCase(),
    facultyId: patch.facultyId,
  });
  if (after === null) throw invalidState('Department changed state while it was being updated');
  await audit(ctx, {
    action: AUDIT_ACTIONS.DEPARTMENT_UPDATE,
    targetType: AUDIT_TARGET_TYPES.DEPARTMENT,
    targetId: id,
    metadata: { changes: diffFields(before, after, ['facultyId', 'name', 'code']) },
  });
  return toDepartmentRecord(after);
}

/** Soft delete. Users and later records keep pointing at the archived department. */
export async function archiveDepartment(ctx: AdminContext, id: string): Promise<DepartmentRecord> {
  const current = await ctx.repos.departments.findById(id);
  if (current === null) throw notFoundDepartment();
  if (current.isArchived) throw invalidState('Department is already archived');

  const archived = await ctx.repos.departments.setArchived(id, true, new Date());
  if (archived === null) throw invalidState('Department is already archived');
  await audit(ctx, {
    action: AUDIT_ACTIONS.DEPARTMENT_ARCHIVE,
    targetType: AUDIT_TARGET_TYPES.DEPARTMENT,
    targetId: id,
    metadata: { name: archived.name, code: archived.code },
  });
  return toDepartmentRecord(archived);
}

export async function restoreDepartment(ctx: AdminContext, id: string): Promise<DepartmentRecord> {
  const current = await ctx.repos.departments.findById(id);
  if (current === null) throw notFoundDepartment();
  if (!current.isArchived) throw invalidState('Department is not archived');
  await requireActiveFaculty(ctx, current.facultyId.toString());

  const restored = await ctx.repos.departments.setArchived(id, false, new Date());
  if (restored === null) throw invalidState('Department is not archived');
  await audit(ctx, {
    action: AUDIT_ACTIONS.DEPARTMENT_RESTORE,
    targetType: AUDIT_TARGET_TYPES.DEPARTMENT,
    targetId: id,
    metadata: { name: restored.name, code: restored.code },
  });
  return toDepartmentRecord(restored);
}
