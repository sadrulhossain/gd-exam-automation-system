import type { Types } from 'mongoose';
import type { ArchivedFilter } from '@eas/shared';
import { allOf, archivedClause, searchClause } from '../lib/query.js';
import { FacultyModel, type FacultyDoc } from '../models/index.js';
import type { Lean } from './base.repository.js';
import { assertGlobalReader, assertSuperadmin, type RepoScope } from './scope.js';

export type FacultyRecord = Lean<FacultyDoc>;

export interface FacultySearch {
  search?: string | undefined;
  archived: ArchivedFilter;
  sort: Record<string, 1 | -1>;
  skip: number;
  limit: number;
}

export function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Faculties are global (they sit above departments), so there is no department to scope
 * by. Superadmin and authority read; only superadmin writes; every other role is refused.
 */
export class FacultyRepository {
  constructor(private readonly scope: RepoScope) {}

  async search(query: FacultySearch): Promise<{ items: FacultyRecord[]; total: number }> {
    assertGlobalReader(this.scope);
    const filter = allOf(
      archivedClause(query.archived),
      searchClause(query.search, ['name', 'code']),
    );
    const [items, total] = await Promise.all([
      FacultyModel.find(filter).sort(query.sort).skip(query.skip).limit(query.limit).lean().exec(),
      FacultyModel.countDocuments(filter).exec(),
    ]);
    return { items: items as FacultyRecord[], total };
  }

  async findById(id: string | Types.ObjectId): Promise<FacultyRecord | null> {
    assertGlobalReader(this.scope);
    return (await FacultyModel.findById(id).lean().exec()) as FacultyRecord | null;
  }

  async create(data: { name: string; code: string }): Promise<FacultyRecord> {
    assertSuperadmin(this.scope);
    const document = new FacultyModel(data);
    await document.save();
    return document.toObject() as FacultyRecord;
  }

  /** Creates the faculty unless one with this code exists (seeding); returns the stored one. */
  async ensure(data: { name: string; code: string }): Promise<FacultyRecord> {
    assertSuperadmin(this.scope);
    const code = data.code.toUpperCase();
    return (await FacultyModel.findOneAndUpdate(
      { code },
      { $setOnInsert: { name: data.name, code, isArchived: false, archivedAt: null } },
      { upsert: true, returnDocument: 'after' },
    )
      .lean()
      .exec()) as FacultyRecord;
  }

  /** Updates a non-archived faculty; null when it does not exist or is archived. */
  async update(
    id: string | Types.ObjectId,
    patch: { name?: string | undefined; code?: string | undefined },
  ): Promise<FacultyRecord | null> {
    assertSuperadmin(this.scope);
    return (await FacultyModel.findOneAndUpdate(
      { _id: id, isArchived: false },
      { $set: definedOnly(patch) },
      { returnDocument: 'after', runValidators: true },
    )
      .lean()
      .exec()) as FacultyRecord | null;
  }

  /** Flips the soft-delete flag; null when missing or already in the requested state. */
  async setArchived(
    id: string | Types.ObjectId,
    archived: boolean,
    now: Date,
  ): Promise<FacultyRecord | null> {
    assertSuperadmin(this.scope);
    return (await FacultyModel.findOneAndUpdate(
      { _id: id, isArchived: !archived },
      { $set: { isArchived: archived, archivedAt: archived ? now : null } },
      { returnDocument: 'after' },
    )
      .lean()
      .exec()) as FacultyRecord | null;
  }
}
