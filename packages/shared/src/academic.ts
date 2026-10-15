import { z } from 'zod';
import { CodeSchema, NameSchema, ObjectIdSchema, entityBase } from './common.js';
import { EmailSchema } from './organization.js';

const scoped = { departmentId: ObjectIdSchema };

// Teacher
const teacherFields = {
  /** Login account, when the teacher has one. */
  userId: ObjectIdSchema.optional(),
  employeeId: CodeSchema,
  name: NameSchema,
  email: EmailSchema,
  designation: z.string().trim().max(80).optional(),
  isActive: z.boolean().default(true),
};
export const CreateTeacherSchema = z.object(teacherFields);
export const UpdateTeacherSchema = CreateTeacherSchema.partial();
export const TeacherSchema = z.object({ ...entityBase, ...scoped, ...teacherFields });
export type CreateTeacher = z.infer<typeof CreateTeacherSchema>;
export type UpdateTeacher = z.infer<typeof UpdateTeacherSchema>;
export type Teacher = z.infer<typeof TeacherSchema>;

// Course
const courseFields = {
  code: CodeSchema,
  title: NameSchema,
  creditHours: z.number().min(0).max(30).optional(),
};
export const CreateCourseSchema = z.object(courseFields);
export const UpdateCourseSchema = CreateCourseSchema.partial();
export const CourseSchema = z.object({ ...entityBase, ...scoped, ...courseFields });
export type CreateCourse = z.infer<typeof CreateCourseSchema>;
export type UpdateCourse = z.infer<typeof UpdateCourseSchema>;
export type Course = z.infer<typeof CourseSchema>;

// Class group and its sections
export const SectionSchema = z.object({ name: CodeSchema });
export type Section = z.infer<typeof SectionSchema>;

function checkUniqueSections(value: { sections?: Section[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  (value.sections ?? []).forEach((section, index) => {
    const key = section.name.toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections', index, 'name'],
        message: 'Duplicate section name',
      });
    }
    seen.add(key);
  });
}

const classGroupFields = {
  name: NameSchema,
  academicYear: z.string().trim().min(1).max(20).optional(),
  sections: z.array(SectionSchema).min(1).max(50),
};
export const CreateClassGroupSchema = z.object(classGroupFields).superRefine(checkUniqueSections);
export const UpdateClassGroupSchema = z
  .object(classGroupFields)
  .partial()
  .superRefine(checkUniqueSections);
export const ClassGroupSchema = z
  .object({ ...entityBase, ...scoped, ...classGroupFields })
  .superRefine(checkUniqueSections);
export type CreateClassGroup = z.infer<typeof CreateClassGroupSchema>;
export type UpdateClassGroup = z.infer<typeof UpdateClassGroupSchema>;
export type ClassGroup = z.infer<typeof ClassGroupSchema>;

// Student
const studentFields = {
  userId: ObjectIdSchema.optional(),
  /** Institutional roll / registration number. */
  studentId: CodeSchema,
  name: NameSchema,
  email: EmailSchema.optional(),
  classGroupId: ObjectIdSchema,
  /** Name of one of the class group's sections. */
  section: CodeSchema,
  isActive: z.boolean().default(true),
};
export const CreateStudentSchema = z.object(studentFields);
export const UpdateStudentSchema = CreateStudentSchema.partial();
export const StudentSchema = z.object({ ...entityBase, ...scoped, ...studentFields });
export type CreateStudent = z.infer<typeof CreateStudentSchema>;
export type UpdateStudent = z.infer<typeof UpdateStudentSchema>;
export type Student = z.infer<typeof StudentSchema>;
