import { z } from 'zod';
import { CodeSchema, NameSchema, ObjectIdSchema, entityBase } from './common.js';
import { DEPARTMENT_SCOPED_ROLES, RoleSchema } from './constants.js';

// Faculty
const facultyFields = { name: NameSchema, code: CodeSchema };
export const CreateFacultySchema = z.object(facultyFields);
export const UpdateFacultySchema = CreateFacultySchema.partial();
export const FacultySchema = z.object({ ...entityBase, ...facultyFields });
export type CreateFaculty = z.infer<typeof CreateFacultySchema>;
export type UpdateFaculty = z.infer<typeof UpdateFacultySchema>;
export type Faculty = z.infer<typeof FacultySchema>;

// Department
const departmentFields = { facultyId: ObjectIdSchema, name: NameSchema, code: CodeSchema };
export const CreateDepartmentSchema = z.object(departmentFields);
export const UpdateDepartmentSchema = CreateDepartmentSchema.partial();
export const DepartmentSchema = z.object({ ...entityBase, ...departmentFields });
export type CreateDepartment = z.infer<typeof CreateDepartmentSchema>;
export type UpdateDepartment = z.infer<typeof UpdateDepartmentSchema>;
export type Department = z.infer<typeof DepartmentSchema>;

// User
export const PasswordSchema = z.string().min(8).max(128);
export const EmailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());

const userFields = {
  email: EmailSchema,
  name: NameSchema,
  role: RoleSchema,
  /** Required for dept_admin, teacher and student; null for superadmin and authority. */
  departmentId: ObjectIdSchema.nullable().default(null),
  isActive: z.boolean().default(true),
};

type RoleDepartment = { role: z.infer<typeof RoleSchema>; departmentId: string | null };

function checkDepartmentMatchesRole(user: RoleDepartment, ctx: z.RefinementCtx): void {
  const scoped = DEPARTMENT_SCOPED_ROLES.includes(user.role);
  if (scoped && user.departmentId === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['departmentId'],
      message: `departmentId is required for role ${user.role}`,
    });
  }
  if (!scoped && user.departmentId !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['departmentId'],
      message: `departmentId must be null for role ${user.role}`,
    });
  }
}

export const CreateUserSchema = z
  .object({ ...userFields, password: PasswordSchema })
  .superRefine(checkDepartmentMatchesRole);

/** Password changes use a dedicated flow, so they are not part of a profile update. */
export const UpdateUserSchema = z.object(userFields).partial();

/** What the API returns: never includes a password or hash. */
export const UserSchema = z
  .object({ ...entityBase, ...userFields })
  .superRefine(checkDepartmentMatchesRole);

export const LoginSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(128) });

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type User = z.infer<typeof UserSchema>;
export type Login = z.infer<typeof LoginSchema>;
