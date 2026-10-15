import { z } from 'zod';
import { CodeSchema, NameSchema, ObjectIdSchema, entityBase } from './common.js';

// Campus
const campusFields = { name: NameSchema, address: z.string().trim().max(250).optional() };
export const CreateCampusSchema = z.object(campusFields);
export const UpdateCampusSchema = CreateCampusSchema.partial();
export const CampusSchema = z.object({
  ...entityBase,
  departmentId: ObjectIdSchema,
  ...campusFields,
});
export type CreateCampus = z.infer<typeof CreateCampusSchema>;
export type UpdateCampus = z.infer<typeof UpdateCampusSchema>;
export type Campus = z.infer<typeof CampusSchema>;

// Building
const buildingFields = { campusId: ObjectIdSchema, name: NameSchema, code: CodeSchema.optional() };
export const CreateBuildingSchema = z.object(buildingFields);
export const UpdateBuildingSchema = CreateBuildingSchema.partial();
export const BuildingSchema = z.object({
  ...entityBase,
  departmentId: ObjectIdSchema,
  ...buildingFields,
});
export type CreateBuilding = z.infer<typeof CreateBuildingSchema>;
export type UpdateBuilding = z.infer<typeof UpdateBuildingSchema>;
export type Building = z.infer<typeof BuildingSchema>;

// Room: a grid of seats. Rows and columns are 1-based.
export const MAX_ROOM_DIMENSION = 100;

export const SeatPositionSchema = z.object({
  row: z.int().min(1).max(MAX_ROOM_DIMENSION),
  col: z.int().min(1).max(MAX_ROOM_DIMENSION),
});
export type SeatPosition = z.infer<typeof SeatPositionSchema>;

/** Minimum a room needs for the seat helpers; accepts a full Room or a plain literal. */
export interface RoomGrid {
  rows: number;
  columns: number;
  blockedSeats?: readonly SeatPosition[];
}

const roomFields = {
  buildingId: ObjectIdSchema,
  name: NameSchema,
  rows: z.int().min(1).max(MAX_ROOM_DIMENSION),
  columns: z.int().min(1).max(MAX_ROOM_DIMENSION),
  /** Seats that exist in the grid but cannot be used (broken, reserved, aisle gaps). */
  blockedSeats: z.array(SeatPositionSchema).default([]),
};

type RoomDraft = { rows?: number; columns?: number; blockedSeats?: SeatPosition[] };

function checkBlockedSeats(room: RoomDraft, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  (room.blockedSeats ?? []).forEach((seat, index) => {
    const key = `${seat.row}:${seat.col}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockedSeats', index],
        message: 'Duplicate blocked seat',
      });
    }
    seen.add(key);
    // Bounds can only be checked when the update also carries the dimensions.
    const outOfRows = room.rows !== undefined && seat.row > room.rows;
    const outOfCols = room.columns !== undefined && seat.col > room.columns;
    if (outOfRows || outOfCols) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockedSeats', index],
        message: 'Blocked seat is outside the room grid',
      });
    }
  });
}

export const CreateRoomSchema = z.object(roomFields).superRefine(checkBlockedSeats);
export const UpdateRoomSchema = z.object(roomFields).partial().superRefine(checkBlockedSeats);
export const RoomSchema = z
  .object({ ...entityBase, departmentId: ObjectIdSchema, ...roomFields })
  .superRefine(checkBlockedSeats);
export type CreateRoom = z.infer<typeof CreateRoomSchema>;
export type UpdateRoom = z.infer<typeof UpdateRoomSchema>;
export type Room = z.infer<typeof RoomSchema>;

function inBounds(room: RoomGrid, row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 1 &&
    col >= 1 &&
    row <= room.rows &&
    col <= room.columns
  );
}

/** Number of usable seats: grid size minus distinct blocked seats that fall inside the grid. */
export function roomCapacity(room: RoomGrid): number {
  if (!Number.isInteger(room.rows) || !Number.isInteger(room.columns)) return 0;
  if (room.rows < 1 || room.columns < 1) return 0;
  const blocked = new Set<string>();
  for (const seat of room.blockedSeats ?? []) {
    if (inBounds(room, seat.row, seat.col)) blocked.add(`${seat.row}:${seat.col}`);
  }
  return room.rows * room.columns - blocked.size;
}

/** True when (row, col) is inside the grid and not blocked, i.e. a student can sit there. */
export function isValidSeat(room: RoomGrid, row: number, col: number): boolean {
  if (!inBounds(room, row, col)) return false;
  return !(room.blockedSeats ?? []).some((seat) => seat.row === row && seat.col === col);
}
