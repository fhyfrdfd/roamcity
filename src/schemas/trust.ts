import { z } from "zod";

export const trustEvidenceSourceSchema = z.enum(["amap", "official", "demo", "manual"]);

export const evidenceCardSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  source: trustEvidenceSourceSchema,
  sourceId: z.string().optional(),
  fetchedAt: z.string().min(1),
  real: z.boolean(),
  openingHours: z.string().optional(),
  price: z.number().min(0).optional(),
  rating: z.number().min(0).max(5).optional(),
  address: z.string().optional(),
  distanceFromPreviousM: z.number().min(0).optional(),
  travelMinutesFromPrevious: z.number().min(0).optional(),
  confidence: z.number().min(0).max(1),
  whyChosen: z.string().min(1),
}).strict();

export const validationSeveritySchema = z.enum(["error", "warning", "info"]);

export const validationIssueSchema = z.object({
  code: z.string().min(1),
  severity: validationSeveritySchema,
  dayId: z.string().optional(),
  itemId: z.string().optional(),
  placeId: z.string().optional(),
  message: z.string().min(1),
  suggestion: z.string().optional(),
  evidence: z.array(evidenceCardSchema).optional(),
}).strict();

export const validationReportSchema = z.object({
  score: z.number().min(0).max(100),
  passed: z.boolean(),
  issues: z.array(validationIssueSchema),
  generatedAt: z.string().min(1),
}).strict();

export const trustMetadataSchema = z.object({
  evidence: z.array(evidenceCardSchema),
  validation: validationReportSchema,
}).strict();

export const replanReasonSchema = z.enum([
  "PLACE_CLOSED",
  "WEATHER",
  "TRAVEL_TOO_LONG",
  "BUDGET",
  "WALKING_LIMIT",
  "ACCESSIBILITY",
  "CROWD",
  "USER_REQUEST",
]);

export const tripChangeSchema = z.object({
  type: z.enum(["add", "remove", "replace", "move", "retime", "budget"]),
  dayId: z.string().min(1),
  fromItemId: z.string().optional(),
  toItemId: z.string().optional(),
  fromPlaceId: z.string().optional(),
  toPlaceId: z.string().optional(),
  reason: replanReasonSchema,
}).strict();

export const replanProposalSchema = z.object({
  baseSnapshotId: z.string().min(1),
  reason: replanReasonSchema,
  changes: z.array(tripChangeSchema),
  validation: validationReportSchema,
  requiresConfirmation: z.boolean(),
}).strict();

export type EvidenceCard = z.output<typeof evidenceCardSchema>;
export type ValidationSeverity = z.output<typeof validationSeveritySchema>;
export type ValidationIssue = z.output<typeof validationIssueSchema>;
export type ValidationReport = z.output<typeof validationReportSchema>;
export type TrustMetadata = z.output<typeof trustMetadataSchema>;
export type ReplanReason = z.output<typeof replanReasonSchema>;
export type TripChange = z.output<typeof tripChangeSchema>;
export type ReplanProposal = z.output<typeof replanProposalSchema>;
