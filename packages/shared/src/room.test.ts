import { describe, expect, it } from 'vitest';
import {
  CreateRoomSchema,
  UpdateRoomSchema,
  isValidSeat,
  roomCapacity,
  type RoomGrid,
} from './index.js';

const building = 'a'.repeat(24);

describe('roomCapacity', () => {
  it('is rows x columns when nothing is blocked', () => {
    expect(roomCapacity({ rows: 5, columns: 6 })).toBe(30);
    expect(roomCapacity({ rows: 5, columns: 6, blockedSeats: [] })).toBe(30);
  });

  it('subtracts blocked seats', () => {
    const room: RoomGrid = {
      rows: 3,
      columns: 3,
      blockedSeats: [
        { row: 1, col: 1 },
        { row: 3, col: 3 },
      ],
    };
    expect(roomCapacity(room)).toBe(7);
  });

  it('counts a duplicated blocked seat once', () => {
    const room: RoomGrid = {
      rows: 2,
      columns: 2,
      blockedSeats: [
        { row: 1, col: 1 },
        { row: 1, col: 1 },
      ],
    };
    expect(roomCapacity(room)).toBe(3);
  });

  it('ignores blocked seats outside the grid', () => {
    expect(roomCapacity({ rows: 2, columns: 2, blockedSeats: [{ row: 9, col: 9 }] })).toBe(4);
  });

  it('is 0 for a fully blocked or degenerate room', () => {
    expect(roomCapacity({ rows: 1, columns: 1, blockedSeats: [{ row: 1, col: 1 }] })).toBe(0);
    expect(roomCapacity({ rows: 0, columns: 5 })).toBe(0);
    expect(roomCapacity({ rows: 2.5, columns: 5 })).toBe(0);
  });
});

describe('isValidSeat', () => {
  const room: RoomGrid = { rows: 4, columns: 5, blockedSeats: [{ row: 2, col: 3 }] };

  it('accepts the corners of the grid (1-based)', () => {
    expect(isValidSeat(room, 1, 1)).toBe(true);
    expect(isValidSeat(room, 4, 5)).toBe(true);
  });

  it('rejects out-of-range seats', () => {
    expect(isValidSeat(room, 0, 1)).toBe(false);
    expect(isValidSeat(room, 1, 0)).toBe(false);
    expect(isValidSeat(room, 5, 1)).toBe(false);
    expect(isValidSeat(room, 1, 6)).toBe(false);
    expect(isValidSeat(room, -1, -1)).toBe(false);
  });

  it('rejects blocked seats', () => {
    expect(isValidSeat(room, 2, 3)).toBe(false);
    expect(isValidSeat(room, 2, 2)).toBe(true);
  });

  it('rejects non-integer coordinates', () => {
    expect(isValidSeat(room, 1.5, 1)).toBe(false);
    expect(isValidSeat(room, Number.NaN, 1)).toBe(false);
  });
});

describe('Room schemas', () => {
  it('applies the blockedSeats default', () => {
    const room = CreateRoomSchema.parse({ buildingId: building, name: 'R1', rows: 4, columns: 4 });
    expect(room.blockedSeats).toEqual([]);
  });

  it('rejects non-positive, fractional and oversized dimensions', () => {
    for (const rows of [0, -1, 1.5, 101]) {
      expect(
        CreateRoomSchema.safeParse({ buildingId: building, name: 'R1', rows, columns: 4 }).success,
      ).toBe(false);
    }
  });

  it('rejects blocked seats outside the grid', () => {
    const result = CreateRoomSchema.safeParse({
      buildingId: building,
      name: 'R1',
      rows: 2,
      columns: 2,
      blockedSeats: [{ row: 3, col: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate blocked seats', () => {
    const result = CreateRoomSchema.safeParse({
      buildingId: building,
      name: 'R1',
      rows: 2,
      columns: 2,
      blockedSeats: [
        { row: 1, col: 1 },
        { row: 1, col: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed building id', () => {
    expect(
      CreateRoomSchema.safeParse({ buildingId: 'nope', name: 'R1', rows: 2, columns: 2 }).success,
    ).toBe(false);
  });

  it('allows partial updates, checking bounds only when dimensions are present', () => {
    expect(UpdateRoomSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(
      UpdateRoomSchema.safeParse({ rows: 2, blockedSeats: [{ row: 3, col: 1 }] }).success,
    ).toBe(false);
    expect(UpdateRoomSchema.safeParse({ blockedSeats: [{ row: 3, col: 1 }] }).success).toBe(true);
  });
});
