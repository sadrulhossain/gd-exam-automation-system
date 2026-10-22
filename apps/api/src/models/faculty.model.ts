import { model, Schema, type Model } from 'mongoose';

export interface FacultyDoc {
  name: string;
  code: string;
  isArchived: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const facultySchema = new Schema<FacultyDoc>(
  {
    name: { type: String, required: true, trim: true },
    // Unique across archived records too, so restoring one can never collide with a new one.
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    isArchived: { type: Boolean, required: true, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

facultySchema.index({ isArchived: 1, name: 1 });

export const FacultyModel: Model<FacultyDoc> = model<FacultyDoc>('Faculty', facultySchema);
