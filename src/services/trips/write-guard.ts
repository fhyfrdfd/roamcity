import type { JsonSkillRepository } from "@/skill/repository";
import { SkillError } from "@/skill/errors";

/** Reads a trip that a write command is about to mutate and enforces the
 * caller's optimistic-concurrency revision before any change is attempted. */
export async function loadTripForWrite(
  repository: Pick<JsonSkillRepository, "getTrip">,
  tripId: string,
  expectedRevision: number,
) {
  const stored = await repository.getTrip(tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  if (stored.revision !== expectedRevision) throw new SkillError("REVISION_CONFLICT", "Trip revision does not match expectedTripRevision");
  return stored;
}
