import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  ERROR_CODES,
  type CreateFaculty,
  type FacultyListQuery,
  type FacultyRecord,
  type Paginated,
  type UpdateFaculty,
} from '@eas/shared';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { pageMeta, parseSort, skipFor } from '../../lib/query.js';
import { audit, diffFields, toFacultyRecord, type AdminContext } from './context.js';

const SORT_FIELDS = ['name', 'code', 'createdAt'] as const;

const notFoundFaculty = () => notFound('Faculty not found');
const invalidState = (message: string, details?: unknown) =>
  new AppError(ERROR_CODES.INVALID_STATE, message, details === undefined ? {} : { details });

export async function listFaculties(
  ctx: AdminContext,
  query: FacultyListQuery,
): Promise<Paginated<FacultyRecord>> {
  const { items, total } = await ctx.repos.faculties.search({
    search: query.search,
    archived: query.archived,
    sort: parseSort(query.sort, SORT_FIELDS, { name: 1 }),
    skip: skipFor(query),
    limit: query.limit,
  });
  return { items: items.map(toFacultyRecord), meta: pageMeta(total, query) };
}

export async function getFaculty(ctx: AdminContext, id: string): Promise<FacultyRecord> {
  const faculty = await ctx.repos.faculties.findById(id);
  if (faculty === null) throw notFoundFaculty();
  return toFacultyRecord(faculty);
}

export async function createFaculty(
  ctx: AdminContext,
  input: CreateFaculty,
): Promise<FacultyRecord> {
  const created = await ctx.repos.faculties.create({
    name: input.name,
    code: input.code.toUpperCase(),
  });
  await audit(ctx, {
    action: AUDIT_ACTIONS.FACULTY_CREATE,
    targetType: AUDIT_TARGET_TYPES.FACULTY,
    targetId: created._id.toString(),
    metadata: { name: created.name, code: created.code },
  });
  return toFacultyRecord(created);
}

export async function updateFaculty(
  ctx: AdminContext,
  id: string,
  patch: UpdateFaculty,
): Promise<FacultyRecord> {
  if (patch.name === undefined && patch.code === undefined) {
    throw badRequest('Provide at least one field to update');
  }
  const before = await ctx.repos.faculties.findById(id);
  if (before === null) throw notFoundFaculty();
  if (before.isArchived) throw invalidState('Restore the faculty before editing it');

  const after = await ctx.repos.faculties.update(id, {
    name: patch.name,
    code: patch.code?.toUpperCase(),
  });
  if (after === null) throw invalidState('Faculty changed state while it was being updated');
  await audit(ctx, {
    action: AUDIT_ACTIONS.FACULTY_UPDATE,
    targetType: AUDIT_TARGET_TYPES.FACULTY,
    targetId: id,
    metadata: { changes: diffFields(before, after, ['name', 'code']) },
  });
  return toFacultyRecord(after);
}

/** Soft delete. A faculty with active departments cannot be archived. */
export async function archiveFaculty(ctx: AdminContext, id: string): Promise<FacultyRecord> {
  const current = await ctx.repos.faculties.findById(id);
  if (current === null) throw notFoundFaculty();
  if (current.isArchived) throw invalidState('Faculty is already archived');

  const activeDepartments = await ctx.repos.departments.countActiveInFaculty(id);
  if (activeDepartments > 0) {
    throw invalidState('Archive or move the faculty’s departments first', {
      activeDepartments,
    });
  }
  const archived = await ctx.repos.faculties.setArchived(id, true, new Date());
  if (archived === null) throw invalidState('Faculty is already archived');
  await audit(ctx, {
    action: AUDIT_ACTIONS.FACULTY_ARCHIVE,
    targetType: AUDIT_TARGET_TYPES.FACULTY,
    targetId: id,
    metadata: { name: archived.name, code: archived.code },
  });
  return toFacultyRecord(archived);
}

export async function restoreFaculty(ctx: AdminContext, id: string): Promise<FacultyRecord> {
  const current = await ctx.repos.faculties.findById(id);
  if (current === null) throw notFoundFaculty();
  if (!current.isArchived) throw invalidState('Faculty is not archived');

  const restored = await ctx.repos.faculties.setArchived(id, false, new Date());
  if (restored === null) throw invalidState('Faculty is not archived');
  await audit(ctx, {
    action: AUDIT_ACTIONS.FACULTY_RESTORE,
    targetType: AUDIT_TARGET_TYPES.FACULTY,
    targetId: id,
    metadata: { name: restored.name, code: restored.code },
  });
  return toFacultyRecord(restored);
}
