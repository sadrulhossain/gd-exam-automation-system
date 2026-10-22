import { model, Schema, type Model, type Types } from 'mongoose';

export interface DepartmentDoc {
  facultyId: Types.ObjectId;
  name: string;
  code: string;
  isArchived: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const departmentSchema = new Schema<DepartmentDoc>(
  {
    facultyId: { type: Schema.Types.ObjectId, required: true, ref: 'Faculty' },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    isArchived: { type: Boolean, required: true, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Department codes are unique within a faculty (archived records included).
departmentSchema.index({ facultyId: 1, code: 1 }, { unique: true });
departmentSchema.index({ isArchived: 1, name: 1 });

export const DepartmentModel: Model<DepartmentDoc> = model<DepartmentDoc>(
  'Department',
  departmentSchema,
);
