import type { Place } from "@/types/travel";

export function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

export function openingRange(value?: string) {
  if (!value || /全天|24/.test(value)) return undefined;
  const match = value.match(/(\d{1,2}):?(\d{2})?\s*[至\-–~]\s*(\d{1,2}):?(\d{2})?/);
  if (!match) return undefined;
  const start = Number(match[1]) * 60 + Number(match[2] ?? 0);
  const end = Number(match[3]) * 60 + Number(match[4] ?? 0);
  return { start, end: end < start ? end + 24 * 60 : end };
}

const OUTDOOR_PATTERN = /户外|公园|山|江|桥|步道|古镇|广场|夜景/;
const INDOOR_PATTERN = /室内|博物馆|美术馆|展览|商场|剧场|影院|文创|书店|温泉/;
const ACCESSIBILITY_HARD_PATTERN = /登山|徒步|爬坡|长阶梯|台阶|陡坡|山道|峡谷|栈道|索道/;

export function placeText(place: Place) {
  return [place.name, place.description, ...place.tags].join(" ");
}

export function isOutdoorPlace(place: Place) {
  return OUTDOOR_PATTERN.test(placeText(place)) || place.category === "viewpoint";
}

export function isIndoorPlace(place: Place) {
  return INDOOR_PATTERN.test(placeText(place));
}

/**
 * Conservative accessibility screen built from provider metadata. It only
 * flags places whose own text/vertical info signals stairs, steep climbs or
 * missing lifts — absence of metadata is not treated as a violation.
 */
export function isAccessibilityRisk(place: Place) {
  if (ACCESSIBILITY_HARD_PATTERN.test(placeText(place))) return true;
  const vertical = place.vertical;
  if (!vertical) return false;
  const hint = `${vertical.levelDescription ?? ""} ${vertical.elevatorHint ?? ""}`;
  const hasLift = /电梯|elevator|无障碍|轮椅/i.test(hint);
  if (/(无|没有|no)\s*(电梯|elevator|无障碍|wheelchair)/i.test(hint)) return true;
  if ((vertical.elevationDiffMeters ?? 0) >= 30 && !hasLift) return true;
  return /楼梯|阶梯|台阶|陡坡/.test(hint) && !hasLift;
}
