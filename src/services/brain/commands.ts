import { getConstraintsInputSchema, successEnvelope } from "@/skill/contracts";
import { SkillError } from "@/skill/errors";
import type { JsonSkillRepository } from "@/skill/repository";
import { status } from "@/skill/runtime-helpers";
import { evaluateDayConstraints, evaluateTripConstraints } from "@/services/brain/constraints";

export async function getConstraintsCommand(raw: unknown, repository: Pick<JsonSkillRepository, "getTrip">) {
  const input = getConstraintsInputSchema.parse(raw);
  const stored = await repository.getTrip(input.tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  const evaluation = input.dayId
    ? evaluateDayConstraints(stored.trip, input.dayId)
    : evaluateTripConstraints(stored.trip);
  return successEnvelope(
    { tripId: input.tripId, ...(input.dayId ? { dayId: input.dayId } : {}), ...evaluation },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    evaluation.warnings,
  );
}
