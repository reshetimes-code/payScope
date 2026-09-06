import type { Prisma } from '@prisma/client';

// Shared coercion for values headed into a Prisma `Json` column. Prisma's
// Json input rejects Decimal/Date/protobuf-Long/etc directly — round-tripping
// through JSON.stringify uses each value's own toJSON() where one exists
// (Prisma Decimal does), which is what we want for stored snapshots anyway:
// a plain readable value, not a live object graph.
export function toJsonSafe(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
