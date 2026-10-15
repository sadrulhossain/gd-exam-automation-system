import { z } from 'zod';
import { IsoDateSchema, NameSchema, ObjectIdSchema, TimeSchema, entityBase } from './common.js';

export const EXAM_TYPES = {
  MIDTERM: 'midterm',
  FINAL: 'final',
  QUIZ: 'quiz',
  OTHER: 'other',
} as const;
export type ExamType = (typeof EXAM_TYPES)[keyof typeof EXAM_TYPES];
export const ExamTypeSchema = z.enum(EXAM_TYPES);

// ISO dates (YYYY-MM-DD) and HH:mm times compare correctly as strings.
function checkDateRange(v: { startDate?: string; endDate?: string }, ctx: z.RefinementCtx): void {
  if (v.startDate !== undefined && v.endDate !== undefined && v.endDate < v.startDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must not be before startDate',
    });
  }
}

const examFields = {
  name: NameSchema,
  examType: ExamTypeSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
};
export const CreateExamSchema = z.object(examFields).superRefine(checkDateRange);
export const UpdateExamSchema = z.object(examFields).partial().superRefine(checkDateRange);
export const ExamSchema = z
  .object({ ...entityBase, departmentId: ObjectIdSchema, ...examFields })
  .superRefine(checkDateRange);
export type CreateExam = z.infer<typeof CreateExamSchema>;
export type UpdateExam = z.infer<typeof UpdateExamSchema>;
export type Exam = z.infer<typeof ExamSchema>;

function checkTimeRange(v: { startTime?: string; endTime?: string }, ctx: z.RefinementCtx): void {
  if (v.startTime !== undefined && v.endTime !== undefined && v.endTime <= v.startTime) {
    ctx.addIssue({
      code: 'custom',
      path: ['endTime'],
      message: 'endTime must be after startTime',
    });
  }
}

const idList = z.array(ObjectIdSchema).refine((ids) => new Set(ids).size === ids.length, {
  message: 'Duplicate ids',
});

const examSessionFields = {
  examId: ObjectIdSchema,
  courseId: ObjectIdSchema,
  classGroupId: ObjectIdSchema,
  date: IsoDateSchema,
  startTime: TimeSchema,
  endTime: TimeSchema,
  roomIds: idList.min(1),
  /** Students enrolled in the session (filled by the enrolment step). */
  studentIds: idList.default([]),
};
export const CreateExamSessionSchema = z.object(examSessionFields).superRefine(checkTimeRange);
export const UpdateExamSessionSchema = z
  .object(examSessionFields)
  .partial()
  .superRefine(checkTimeRange);
export const ExamSessionSchema = z
  .object({ ...entityBase, departmentId: ObjectIdSchema, ...examSessionFields })
  .superRefine(checkTimeRange);
export type CreateExamSession = z.infer<typeof CreateExamSessionSchema>;
export type UpdateExamSession = z.infer<typeof UpdateExamSessionSchema>;
export type ExamSession = z.infer<typeof ExamSessionSchema>;
