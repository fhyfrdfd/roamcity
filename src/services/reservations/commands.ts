import {
  addReservationInputSchema,
  getReservationsInputSchema,
  importReservationsInputSchema,
  removeReservationInputSchema,
  successEnvelope,
  updateReservationInputSchema,
} from "@/skill/contracts";
import { SkillError } from "@/skill/errors";
import type { JsonSkillRepository } from "@/skill/repository";
import { status } from "@/skill/runtime-helpers";
import { reservationSchema, type Reservation } from "@/schemas/reservation";
import { uid } from "@/lib/utils";
import type { Trip } from "@/types/travel";
import { loadTripForWrite } from "@/services/trips/write-guard";

type ReservationRepository = Pick<JsonSkillRepository, "getTrip" | "updateTrip">;

export async function addReservationCommand(raw: unknown, repository: ReservationRepository) {
  const input = addReservationInputSchema.parse(raw);
  const stored = await loadTripForWrite(repository, input.tripId, input.expectedTripRevision);
  const reservation = {
    ...input.reservation,
    id: uid("res"),
    tripId: input.tripId,
    provenance: {
      source: "user" as const,
      fetchedAt: new Date().toISOString(),
      estimated: false,
    },
  };
  const parsed = reservationSchema.parse(reservation);
  const trip: Trip = { ...stored.trip, reservations: [...(stored.trip.reservations ?? []), parsed], updatedAt: new Date().toISOString() };
  const saved = await repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
  return successEnvelope(
    { tripId: input.tripId, reservation: parsed, reservations: saved.trip.reservations ?? [], revision: saved.revision, tripHash: saved.hash, trip: saved.trip },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    [],
    { source: "user_reservation" },
  );
}

export async function updateReservationCommand(raw: unknown, repository: ReservationRepository) {
  const input = updateReservationInputSchema.parse(raw);
  const stored = await loadTripForWrite(repository, input.tripId, input.expectedTripRevision);
  const existing = (stored.trip.reservations ?? []).find((candidate) => candidate.id === input.reservationId);
  if (!existing) throw new SkillError("RESERVATION_NOT_FOUND", "Reservation not found");
  // id/tripId/provenance.source are immutable through the patch path.
  const merged = reservationSchema.parse({
    ...existing,
    ...input.patch,
    id: existing.id,
    tripId: existing.tripId,
    provenance: { ...existing.provenance, fetchedAt: new Date().toISOString() },
  });
  const trip: Trip = {
    ...stored.trip,
    reservations: (stored.trip.reservations ?? []).map((candidate) => (candidate.id === merged.id ? merged : candidate)),
    updatedAt: new Date().toISOString(),
  };
  const saved = await repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
  return successEnvelope(
    { tripId: input.tripId, reservation: merged, reservations: saved.trip.reservations ?? [], revision: saved.revision, tripHash: saved.hash },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}

export async function removeReservationCommand(raw: unknown, repository: ReservationRepository) {
  const input = removeReservationInputSchema.parse(raw);
  const stored = await loadTripForWrite(repository, input.tripId, input.expectedTripRevision);
  const reservations = stored.trip.reservations ?? [];
  if (!reservations.some((candidate) => candidate.id === input.reservationId)) {
    throw new SkillError("RESERVATION_NOT_FOUND", "Reservation not found");
  }
  const trip: Trip = {
    ...stored.trip,
    reservations: reservations.filter((candidate) => candidate.id !== input.reservationId),
    updatedAt: new Date().toISOString(),
  };
  const saved = await repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
  return successEnvelope(
    { tripId: input.tripId, removedId: input.reservationId, reservations: saved.trip.reservations ?? [], revision: saved.revision, tripHash: saved.hash },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}

export async function getReservationsCommand(raw: unknown, repository: Pick<JsonSkillRepository, "getTrip">) {
  const input = getReservationsInputSchema.parse(raw);
  const stored = await repository.getTrip(input.tripId);
  if (!stored) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  let reservations = stored.trip.reservations ?? [];
  if (input.status) reservations = reservations.filter((candidate) => candidate.status === input.status);
  if (input.type) reservations = reservations.filter((candidate) => candidate.type === input.type);
  return successEnvelope(
    { tripId: input.tripId, reservations, total: reservations.length },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
  );
}

export async function importReservationsCommand(raw: unknown, repository: ReservationRepository) {
  const input = importReservationsInputSchema.parse(raw);
  const stored = await loadTripForWrite(repository, input.tripId, input.expectedTripRevision);
  const now = new Date().toISOString();
  const existing = stored.trip.reservations ?? [];
  // Dedupe: a confirmation code is authoritative; otherwise same type at the
  // same start instant is treated as the same booking.
  const fingerprint = (candidate: { type: string; startAt: string; confirmationCode?: string }) =>
    candidate.confirmationCode ? `code:${candidate.confirmationCode}` : `${candidate.type}:${candidate.startAt}`;
  const seen = new Set(existing.map(fingerprint));
  const imported: Reservation[] = [];
  const skipped: string[] = [];
  for (const [index, item] of input.reservations.entries()) {
    const candidate = reservationSchema.parse({
      ...item,
      id: uid("res"),
      tripId: input.tripId,
      provenance: { source: "import" as const, ...(input.vendor ? { vendor: input.vendor } : {}), fetchedAt: now, estimated: false },
    });
    const key = fingerprint(candidate);
    if (seen.has(key)) {
      skipped.push(`#${index + 1}${candidate.confirmationCode ? `（确认号 ${candidate.confirmationCode}）` : ""}`);
      continue;
    }
    seen.add(key);
    imported.push(candidate);
  }
  if (!imported.length) {
    return successEnvelope(
      { tripId: input.tripId, imported: [], skipped, reservations: existing, revision: stored.revision, tripHash: stored.hash },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
      ["导入的预订均已存在，行程未修改"],
    );
  }
  const trip: Trip = { ...stored.trip, reservations: [...existing, ...imported], updatedAt: now };
  const saved = await repository.updateTrip({ tripId: input.tripId, expectedRevision: stored.revision, trip });
  return successEnvelope(
    { tripId: input.tripId, imported, skipped, reservations: saved.trip.reservations ?? [], revision: saved.revision, tripHash: saved.hash },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    skipped.length ? [`${skipped.length} 条重复预订已跳过`] : [],
    { source: "import_reservations" },
  );
}
