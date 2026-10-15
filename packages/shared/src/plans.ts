import { z } from 'zod';
import { IsoDateTimeSchema, ObjectIdSchema, entityBase } from './common.js';
import { PLAN_STATUSES, PlanStatusSchema } from './constants.js';
import { SeatPositionSchema } from './infrastructure.js';

type PlanLifecycle = { status: string; publishedAt: string | null };

/** A published plan has a publish time; a draft does not. */
function checkLifecycle(plan: PlanLifecycle, ctx: z.RefinementCtx): void {
  const published = plan.status === PLAN_STATUSES.PUBLISHED;
  if (published !== (plan.publishedAt !== null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['publishedAt'],
      message: 'publishedAt must be set if and only if status is published',
    });
  }
}

const planFields = {
  ...entityBase,
  departmentId: ObjectIdSchema,
  examId: ObjectIdSchema,
  status: PlanStatusSchema,
  generatedAt: IsoDateTimeSchema,
  publishedAt: IsoDateTimeSchema.nullable().default(null),
};

// Seat plan
export const SeatPlanSchema = z.object(planFields).superRefine(checkLifecycle);
export type SeatPlan = z.infer<typeof SeatPlanSchema>;

export const SeatAssignmentSchema = z.object({
  id: ObjectIdSchema,
  seatPlanId: ObjectIdSchema,
  examSessionId: ObjectIdSchema,
  studentId: ObjectIdSchema,
  roomId: ObjectIdSchema,
  ...SeatPositionSchema.shape,
});
export type SeatAssignment = z.infer<typeof SeatAssignmentSchema>;

// Duty plan
export const DUTY_ROLES = {
  CHIEF_INVIGILATOR: 'chief_invigilator',
  INVIGILATOR: 'invigilator',
} as const;
export type DutyRole = (typeof DUTY_ROLES)[keyof typeof DUTY_ROLES];
export const DutyRoleSchema = z.enum(DUTY_ROLES);

export const DutyPlanSchema = z.object(planFields).superRefine(checkLifecycle);
export type DutyPlan = z.infer<typeof DutyPlanSchema>;

export const DutyAssignmentSchema = z.object({
  id: ObjectIdSchema,
  dutyPlanId: ObjectIdSchema,
  examSessionId: ObjectIdSchema,
  roomId: ObjectIdSchema,
  teacherId: ObjectIdSchema,
  dutyRole: DutyRoleSchema.default(DUTY_ROLES.INVIGILATOR),
});
export type DutyAssignment = z.infer<typeof DutyAssignmentSchema>;
