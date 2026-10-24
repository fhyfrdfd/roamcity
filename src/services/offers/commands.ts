import {
  refreshTravelOffersInputSchema,
  searchFlightsInputSchema,
  searchTravelOffersInputSchema,
  successEnvelope,
} from "@/skill/contracts";
import { normalizeProviderError, SkillError } from "@/skill/errors";
import type { JsonSkillRepository } from "@/skill/repository";
import type { TravelDataProvider } from "@/skill/providers";
import { status } from "@/skill/runtime-helpers";
import { createFliggyTopClient } from "@/services/booking/fliggy-top";
import { queryFliggyOffers } from "@/services/booking/fliggy-offers";
import { queryMeituan } from "@/services/meituan/runner";
import { weatherForDate } from "@/services/weather/merge";
import type { OfferKind, OfferProviderLevel, OfferProviderStatus, TravelOffer } from "@/types/offers";

export interface OfferCommandDeps {
  repository: Pick<JsonSkillRepository, "getTrip" | "replaceOffers">;
  providerFactory: () => Promise<TravelDataProvider>;
}

export async function searchFlightsCommand(raw: unknown) {
  const input = searchFlightsInputSchema.parse(raw);
  const client = createFliggyTopClient();
  if (!client) throw new SkillError("NO_PROVIDER_CONFIGURED", "FLIGGY_APP_KEY and FLIGGY_APP_SECRET are required");

  try {
    const data = await client.flightSearch(input);
    return successEnvelope(
      { flights: data, provenance: { source: "fliggy", estimated: false } },
      status("UNKNOWN", "UNKNOWN", "UNKNOWN"),
    );
  } catch (error) {
    throw normalizeProviderError(error, "TICKET_PROVIDER_UNAVAILABLE");
  }
}

export async function searchTravelOffersCommand(raw: unknown) {
  const input = searchTravelOffersInputSchema.parse(raw);
  const result = await queryMeituan(input);
  return successEnvelope(
    { offers: result.offers, rawText: result.rawText, rawJson: result.rawJson },
    status("UNKNOWN", "UNKNOWN", "UNKNOWN", result.status.overall),
    result.status.warnings,
  );
}

export async function refreshTravelOffersCommand(raw: unknown, deps: OfferCommandDeps) {
  const input = refreshTravelOffersInputSchema.parse(raw);
  const categories = input.categories;
  const provider = await deps.providerFactory();
  const existing = await deps.repository.getTrip(input.tripId);
  if (!existing) throw new SkillError("TRIP_NOT_FOUND", "Trip not found");
  const dates = existing.trip.days.map((day) => day.date);
  const [meituanResult, fliggyResult, weatherResult] = await Promise.all([
    queryMeituan(input).catch((error) => ({ offers: [] as TravelOffer[], rawText: undefined, rawJson: undefined, status: { overall: "UNAVAILABLE" as const, warnings: [error instanceof SkillError ? error.message : "美团查询失败"] } })),
    queryFliggyOffers({ ...input, categories }).catch((error) => ({ offers: [] as TravelOffer[], status: "UNAVAILABLE" as OfferProviderLevel, warnings: [error instanceof Error ? error.message : "飞猪查询失败"] })),
    dates.length ? provider.getWeather(input.destination).then((forecasts) => ({ forecasts, level: forecasts.length ? "REAL" as const : "UNKNOWN" as const, warnings: [] as string[] })).catch(() => ({ forecasts: [], level: "UNAVAILABLE" as const, warnings: ["天气查询失败"] })) : Promise.resolve({ forecasts: [], level: "UNKNOWN" as const, warnings: ["未提供天气日期"] }),
  ]);
  const offers = [...meituanResult.offers, ...fliggyResult.offers];
  const categoryStatus = (kind: OfferKind): OfferProviderLevel => {
    if (offers.some((offer) => offer.kind === kind && offer.structured)) return "REAL";
    if (offers.some((offer) => offer.kind === kind)) return "UNSTRUCTURED";
    if (kind === "hotel" || kind === "flight") {
      if (fliggyResult.status === "PERMISSION_REQUIRED") return "PERMISSION_REQUIRED";
      return fliggyResult.status === "UNAVAILABLE" && meituanResult.status.overall === "UNAVAILABLE" ? "UNAVAILABLE" : "UNKNOWN";
    }
    if (categories.includes(kind)) return meituanResult.status.overall;
    return "UNKNOWN";
  };
  const statusByKind: OfferProviderStatus = {
    overall: offers.some((offer) => offer.structured) ? "REAL" : offers.length || meituanResult.status.overall === "UNSTRUCTURED" ? "UNSTRUCTURED" : "UNAVAILABLE",
    hotel: categoryStatus("hotel"), train: categoryStatus("train"), flight: categoryStatus("flight"), ticket: categoryStatus("ticket"), restaurant: categoryStatus("restaurant"), coupon: categoryStatus("coupon"), weather: weatherResult.level,
    fetchedAt: new Date().toISOString(), warnings: [...(meituanResult.status.warnings ?? []), ...fliggyResult.warnings, ...weatherResult.warnings],
  };
  const stored = await deps.repository.replaceOffers({
    tripId: input.tripId,
    expectedRevision: input.expectedTripRevision,
    offers,
    status: statusByKind,
    weatherByDate: input.destination === existing.trip.destination ? Object.fromEntries(dates.map((date) => [date, weatherForDate(weatherResult.forecasts, date)])) : undefined,
  });
  return successEnvelope(
    { tripId: input.tripId, trip: stored.trip, revision: stored.revision, tripHash: stored.hash },
    status(provider.kind === "amap" ? "REAL" : "MOCK", "UNKNOWN", weatherResult.level, statusByKind.overall),
    statusByKind.warnings ?? [],
  );
}
