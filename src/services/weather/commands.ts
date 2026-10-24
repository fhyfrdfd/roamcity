import { getWeatherInputSchema, successEnvelope, type ProviderLevel } from "@/skill/contracts";
import { normalizeProviderError } from "@/skill/errors";
import type { ProviderForecast, TravelDataProvider } from "@/skill/providers";
import { status, weatherLevel } from "@/skill/runtime-helpers";
import { weatherForDate } from "@/services/weather/merge";

export interface WeatherCommandDeps {
  providerFactory: () => Promise<TravelDataProvider>;
}

export async function getWeatherCommand(raw: unknown, deps: WeatherCommandDeps) {
  const input = getWeatherInputSchema.parse(raw);
  let provider: TravelDataProvider | undefined;
  try {
    provider = await deps.providerFactory();
  } catch (error) {
    if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "WEATHER_UNAVAILABLE");
  }
  let forecasts: ProviderForecast[] = [];
  if (provider) {
    try {
      forecasts = await provider.getWeather(input.destination);
    } catch (error) {
      if (input.fallbackPolicy !== "estimated") throw normalizeProviderError(error, "WEATHER_UNAVAILABLE");
    }
  }
  const weather = input.dates.map((date) => ({ date, ...weatherForDate(forecasts, date) }));
  const missing = weather.some((item) => item.provenance.source === "unavailable");
  const level: ProviderLevel = provider ? weatherLevel(provider, missing) : "UNAVAILABLE";
  return successEnvelope({ weather }, status("UNKNOWN", "UNKNOWN", level), missing ? ["Weather unavailable for one or more dates"] : []);
}
