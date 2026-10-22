import { Types } from 'mongoose';
import type { ArchivedFilter } from '@eas/shared';
import { allOf, archivedClause, searchClause } from '../lib/query.js';
import { DepartmentModel, type DepartmentDoc } from '../models/index.js';
import { ScopedRepository, type Lean } from './base.repository.js';
import { definedOnly } from './faculty.repository.js';
import { assertSuperadmin, type RepoScope } from './scope.js';

export type DepartmentRecord = Lean<DepartmentDoc>;

export interface DepartmentSearch {
  search?: string | undefined;
  archived: ArchivedFilter;
  facultyId?: string | undefined;
  sort: Record<string, 1 | -1>;
  skip: number;
  limit: number;
}

/**
 * The department collection itself, scoped by `_id`: dept_admin, teacher and student see
 * only their own department. Only superadmin may create or change departments, and they
 * are archived, never deleted (other records will point at them).
 */
export class DepartmentRepository extends ScopedRepository<DepartmentDoc> {
  constructor(scope: RepoScope) {
    super(DepartmentModel, scope, { departmentField: '_id' });
  }

  async search(query: DepartmentSearch): Promise<{ items: DepartmentRecord[]; total: number }> {
    const filter = allOf(
      archivedClause(query.archived),
      searchClause(query.search, ['name', 'code']),
      query.facultyId === undefined ? null : { facultyId: new Types.ObjectId(query.facultyId) },
    );
    const [items, total] = await Promise.all([
      this.find(filter, { sort: query.sort, skip: query.skip, limit: query.limit }),
      this.count(filter),
    ]);
    return { items, total };
  }

  /** Creates a department from API input, where the faculty is an id string. */
  add(data: { facultyId: string; name: string; code: string }): Promise<DepartmentRecord> {
    return this.create({ ...data, facultyId: new Types.ObjectId(data.facultyId) });
  }

  /** Creates the department under a fixed id unless it exists (seeding); true when created. */
  async ensureWithId(data: {
    id: string;
    facultyId: string;
    name: string;
    code: string;
  }): Promise<boolean> {
    assertSuperadmin(this.scope);
    const result = await DepartmentModel.updateOne(
      { _id: new Types.ObjectId(data.id) },
      {
        $setOnInsert: {
          facultyId: new Types.ObjectId(data.facultyId),
          name: data.name,
          code: data.code.toUpperCase(),
          isArchived: false,
          archivedAt: null,
        },
      },
      { upsert: true },
    ).exec();
    return result.upsertedCount > 0;
  }

  override create(data: Partial<DepartmentDoc>): Promise<DepartmentRecord> {
    assertSuperadmin(this.scope);
    return super.create(data);
  }

  override updateById(
    id: string | Types.ObjectId,
    update: Parameters<ScopedRepository<DepartmentDoc>['updateById']>[1],
  ): Promise<DepartmentRecord | null> {
    assertSuperadmin(this.scope);
    return super.updateById(id, update);
  }

  override deleteById(): Promise<boolean> {
    return Promise.reject(new Error('Departments are archived, not deleted'));
  }

  /** Updates a non-archived department; null when missing, archived or out of scope. */
  async updateActive(
    id: string | Types.ObjectId,
    patch: { name?: string | undefined; code?: string | undefined; facultyId?: string | undefined },
  ): Promise<DepartmentRecord | null> {
    assertSuperadmin(this.scope);
    const { facultyId, ...rest } = definedOnly(patch);
    const set = {
      ...rest,
      ...(facultyId === undefined ? {} : { facultyId: new Types.ObjectId(facultyId) }),
    };
    return (await DepartmentModel.findOneAndUpdate(
      this.scoped({ _id: id, isArchived: false }),
      { $set: set },
      { returnDocument: 'after', runValidators: true },
    )
      .lean()
      .exec()) as DepartmentRecord | null;
  }

  /** Flips the soft-delete flag; null when missing or already in the requested state. */
  async setArchived(
    id: string | Types.ObjectId,
    archived: boolean,
    now: Date,
  ): Promise<DepartmentRecord | null> {
    assertSuperadmin(this.scope);
    return (await DepartmentModel.findOneAndUpdate(
      this.scoped({ _id: id, isArchived: !archived }),
      { $set: { isArchived: archived, archivedAt: archived ? now : null } },
      { returnDocument: 'after' },
    )
      .lean()
      .exec()) as DepartmentRecord | null;
  }

  countActiveInFaculty(facultyId: string | Types.ObjectId): Promise<number> {
    return this.count({ facultyId: new Types.ObjectId(String(facultyId)), isArchived: false });
  }
}
