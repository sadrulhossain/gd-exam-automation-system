import type { Model, QueryFilter, SortOrder, Types, UpdateQuery } from 'mongoose';
import { ROLES } from '@eas/shared';
import { forbidden } from '../lib/errors.js';
import { isReadOnlyScope, type ActorScope, type RepoScope } from './scope.js';

/** A plain (lean) document as returned by repositories. */
export type Lean<TDoc> = TDoc & { _id: Types.ObjectId };

export interface ScopedRepositoryOptions {
  /**
   * Field that holds the owning department. Use `_id` for the Department collection
   * itself. Injected into every query for dept_admin, teacher and student.
   */
  departmentField: string;
  /**
   * Field a student's records must match with the student's user id (for example
   * `userId`, or `_id` for the user collection). Without it, students are denied.
   */
  studentOwnerField?: string;
}

export interface FindOptions {
  sort?: Record<string, SortOrder>;
  skip?: number;
  limit?: number;
  select?: string;
}

type Filter<TDoc> = QueryFilter<TDoc>;

/**
 * Base class for all data access. Route handlers and services never touch Mongoose
 * models; they receive repositories that were built for the signed-in user.
 *
 * Scope rules, applied to every read, update and delete (the scope clause is ANDed
 * onto the caller's filter, so a filter can never widen it):
 *  - superadmin / system: unrestricted.
 *  - authority: unrestricted reads across departments, all writes rejected.
 *  - dept_admin, teacher: confined to their own department.
 *  - student: confined to their own department and their own records; read-only.
 * Writes also force the department on create and reject attempts to move a record
 * to another department. Out-of-scope records look like they do not exist.
 */
export abstract class ScopedRepository<TDoc> {
  protected constructor(
    protected readonly model: Model<TDoc>,
    protected readonly scope: RepoScope,
    private readonly options: ScopedRepositoryOptions,
  ) {}

  /** The extra clause that confines queries to what this scope may see. */
  private scopeClause(): Filter<TDoc> | null {
    if (this.scope.kind === 'system') return null;
    const { role, departmentId, userId } = this.scope;
    if (role === ROLES.SUPERADMIN || role === ROLES.AUTHORITY) return null;
    // actorScope() guarantees a department for these roles; keep a hard stop regardless.
    if (departmentId === null) throw forbidden();

    const clause: Record<string, unknown> = { [this.options.departmentField]: departmentId };
    if (role === ROLES.STUDENT) {
      const { studentOwnerField } = this.options;
      if (studentOwnerField === undefined) throw forbidden();
      clause[studentOwnerField] = userId;
    }
    return clause as Filter<TDoc>;
  }

  protected scoped(filter: Filter<TDoc> = {}): Filter<TDoc> {
    const clause = this.scopeClause();
    return clause === null ? filter : ({ $and: [filter, clause] } as Filter<TDoc>);
  }

  protected assertWritable(): void {
    if (isReadOnlyScope(this.scope)) throw forbidden('This role has read-only access');
  }

  /** The actor when this scope pins records to its own department (dept_admin, teacher). */
  private pinnedActor(): ActorScope | null {
    if (this.scope.kind !== 'actor') return null;
    const { role } = this.scope;
    return role === ROLES.SUPERADMIN || role === ROLES.AUTHORITY ? null : this.scope;
  }

  async find(filter: Filter<TDoc> = {}, options: FindOptions = {}): Promise<Lean<TDoc>[]> {
    let query = this.model.find(this.scoped(filter));
    if (options.select !== undefined) query = query.select(options.select);
    if (options.sort !== undefined) query = query.sort(options.sort);
    if (options.skip !== undefined) query = query.skip(options.skip);
    if (options.limit !== undefined) query = query.limit(options.limit);
    return (await query.lean().exec()) as Lean<TDoc>[];
  }

  async findOne(filter: Filter<TDoc>): Promise<Lean<TDoc> | null> {
    return (await this.model.findOne(this.scoped(filter)).lean().exec()) as Lean<TDoc> | null;
  }

  findById(id: string | Types.ObjectId): Promise<Lean<TDoc> | null> {
    return this.findOne({ _id: id } as Filter<TDoc>);
  }

  count(filter: Filter<TDoc> = {}): Promise<number> {
    return this.model.countDocuments(this.scoped(filter)).exec();
  }

  async exists(filter: Filter<TDoc>): Promise<boolean> {
    return (await this.model.exists(this.scoped(filter)).exec()) !== null;
  }

  /** Creates a record. For dept_admin and teacher the department is forced to their own. */
  async create(data: Partial<TDoc>): Promise<Lean<TDoc>> {
    this.assertWritable();
    const pinned = this.pinnedActor();
    const { departmentField } = this.options;
    const record: Record<string, unknown> = { ...data };
    if (pinned !== null) {
      const supplied = record[departmentField];
      if (supplied != null && String(supplied) !== pinned.departmentId) {
        throw forbidden('Cannot create records in another department');
      }
      record[departmentField] = pinned.departmentId;
    }
    const document = new this.model(record);
    await document.save();
    return document.toObject() as Lean<TDoc>;
  }

  /** Applies `update` to one in-scope record; returns the new version, or null if none matched. */
  async updateById(
    id: string | Types.ObjectId,
    update: UpdateQuery<TDoc>,
  ): Promise<Lean<TDoc> | null> {
    this.assertWritable();
    if (this.pinnedActor() !== null && touchesField(update, this.options.departmentField)) {
      throw forbidden('Cannot move a record to another department');
    }
    return (await this.model
      .findOneAndUpdate(this.scoped({ _id: id } as Filter<TDoc>), update, {
        returnDocument: 'after',
        runValidators: true,
      })
      .lean()
      .exec()) as Lean<TDoc> | null;
  }

  /** Deletes one in-scope record; returns whether something was deleted. */
  async deleteById(id: string | Types.ObjectId): Promise<boolean> {
    this.assertWritable();
    const result = await this.model.deleteOne(this.scoped({ _id: id } as Filter<TDoc>)).exec();
    return result.deletedCount > 0;
  }
}

const UPDATE_OPERATORS = ['$set', '$unset', '$setOnInsert', '$rename', '$inc', '$min', '$max'];

/** Whether an update document writes `field`, directly or through an update operator. */
function touchesField(update: UpdateQuery<unknown>, field: string): boolean {
  const doc = update as Record<string, unknown>;
  if (field in doc) return true;
  return UPDATE_OPERATORS.some((operator) => {
    const body = doc[operator];
    return typeof body === 'object' && body !== null && field in body;
  });
}
