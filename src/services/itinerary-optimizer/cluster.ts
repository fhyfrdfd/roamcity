import { haversineMeters } from "@/lib/utils";
import type { PlaceScheduleProfile } from "./types";

/**
 * Deterministic geographic clustering: farthest-first seeding anchored on the
 * guide's first place (order stays a signal), then a fixed number of
 * k-means iterations. No randomness, so identical input yields identical
 * clusters — the optimizer is testable by construction.
 */
export function clusterByGeography(profiles: PlaceScheduleProfile[], k: number): PlaceScheduleProfile[][] {
  const clusters: PlaceScheduleProfile[][] = Array.from({ length: k }, () => []);
  if (!profiles.length) return clusters;
  const count = Math.max(1, Math.min(k, profiles.length));

  if (profiles.length <= count) {
    // Fewer candidates than days: one place per day in guide order; the
    // leftover days stay empty and are reported as unresolved by validate.
    profiles.forEach((profile, index) => {
      const cluster = clusters[index];
      if (cluster) cluster.push(profile);
    });
    return clusters;
  }

  const seeds = farthestFirstSeeds(profiles, count);
  let assignments = assignToSeeds(profiles, seeds);
  const MAX_ITERATIONS = 8;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const centroids = seeds.map((members) => centroid(members));
    const next = profiles.map((profile) => {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centroids.forEach((center, index) => {
        const distance = haversineMeters(profile.place, center);
        // Tie-break on guide order so boundary places follow the original
        // sweep instead of floating between clusters.
        if (distance < bestDistance - 1 || (Math.abs(distance - bestDistance) <= 1 && index < best)) {
          best = index;
          bestDistance = distance;
        }
      });
      return best;
    });
    if (next.every((cluster, index) => cluster === assignments[index])) break;
    assignments = next;
    for (let index = 0; index < count; index += 1) {
      seeds[index] = profiles.filter((_, placeIndex) => assignments[placeIndex] === index);
    }
  }
  profiles.forEach((profile, index) => {
    const target = assignments[index];
    const cluster = target === undefined ? undefined : clusters[target];
    if (cluster) cluster.push(profile);
  });
  // Empty clusters absorb members from the largest one so every day gets a
  // fair share before pacing rebalances things.
  for (let index = 0; index < count; index += 1) {
    const cluster = clusters[index];
    if (!cluster || cluster.length) continue;
    let largestIndex = -1;
    let largestSize = 0;
    clusters.forEach((candidate, clusterIndex) => {
      if (candidate.length > largestSize) {
        largestSize = candidate.length;
        largestIndex = clusterIndex;
      }
    });
    const largest = clusters[largestIndex];
    if (largest && largest.length > 1) {
      const moved = largest.pop();
      if (moved) cluster.push(moved);
    }
  }
  clusters.forEach((cluster) => cluster.sort((left, right) => left.originalOrder - right.originalOrder));
  return clusters;
}

function farthestFirstSeeds(profiles: PlaceScheduleProfile[], count: number): PlaceScheduleProfile[][] {
  const seedClusters: PlaceScheduleProfile[][] = [];
  const firstProfile = profiles[0];
  if (!firstProfile) return seedClusters;
  seedClusters.push([firstProfile]);
  while (seedClusters.length < count) {
    let best: PlaceScheduleProfile | null = null;
    let bestDistance = -1;
    for (const profile of profiles) {
      if (seedClusters.some((cluster) => cluster.includes(profile))) continue;
      const distance = Math.min(...seedClusters.map((cluster) => {
        const seed = cluster[0];
        return seed ? haversineMeters(profile.place, seed.place) : Number.POSITIVE_INFINITY;
      }));
      if (distance > bestDistance) {
        bestDistance = distance;
        best = profile;
      }
    }
    if (!best) break;
    seedClusters.push([best]);
  }
  return seedClusters;
}

function assignToSeeds(profiles: PlaceScheduleProfile[], seeds: PlaceScheduleProfile[][]): number[] {
  return profiles.map((profile) => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    seeds.forEach((cluster, index) => {
      const seed = cluster[0];
      if (!seed) return;
      const distance = haversineMeters(profile.place, seed.place);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  });
}

function centroid(members: PlaceScheduleProfile[]): { lat: number; lng: number } {
  if (!members.length) return { lat: 0, lng: 0 };
  const lat = members.reduce((sum, member) => sum + member.place.lat, 0) / members.length;
  const lng = members.reduce((sum, member) => sum + member.place.lng, 0) / members.length;
  return { lat, lng };
}
