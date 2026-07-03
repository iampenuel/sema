import { z } from "zod";

export const SafetyFlagTypeSchema = z.enum([
  "diagnosis_request", "treatment_request", "triage_request", "safe_unsafe_request", "image_interpretation_request",
  "audio_classification_request", "body_map_overinterpretation", "delay_care_request",
  "privacy_warning", "missing_context"
]);

const SupportingTextSchema = z.array(z.string().min(1).max(500)).min(1).max(3);
const SupportedValueSchema = z.object({ value: z.string().min(1).max(500), supportingText: SupportingTextSchema });

export const StoryExtractionDraftSchema = z.object({
  mainConcern: z.string().min(1).max(500),
  mainConcernSupportingText: SupportingTextSchema,
  timeline: z.array(z.object({ label: z.string().min(1).max(200), detail: z.string().min(1).max(500), supportingText: SupportingTextSchema })).max(12),
  affectedAreas: z.array(SupportedValueSchema.extend({ value: z.string().min(1).max(200) })).max(12),
  changesOverTime: z.array(SupportedValueSchema).max(12),
  triggersOrPatterns: z.array(SupportedValueSchema).max(12),
  patientConcerns: z.array(SupportedValueSchema).max(12),
  missingDetails: z.array(z.string().min(1).max(300)).max(12),
  clinicianQuestions: z.array(z.string().min(1).max(300)).max(10),
  summaryNote: z.string().min(1).max(1200),
  safetyFlags: z.array(SafetyFlagTypeSchema.exclude(["privacy_warning"])).max(10)
});

export const AgentActionTypeSchema = z.enum(["openSignalFolder", "showSignalFolderOverview", "readSignalFolder", "readCurrentPage", "readSafetyNote", "listMissingDetails", "generateStorySummary", "generateClinicianQuestions", "prepareEvidencePacket", "saveDraftToFolder", "readPacketSection", "exportPacketPdf", "clearSession", "deleteAudio", "sharePacket", "openPhotoCapture", "readPhotoObservation"]);

export const AgentActionProposalSchema = z.object({
  type: AgentActionTypeSchema,
  payload: z.record(z.string(), z.unknown()).optional()
});

export const AgentAIProposalSchema = z.object({
  reply: z.string().min(1).max(1500),
  proposedActions: z.array(AgentActionProposalSchema).max(2),
  safetyDisposition: z.enum(["allowed", "redirected", "blocked"]),
  safetyFlags: z.array(SafetyFlagTypeSchema).max(10),
  requiresReview: z.boolean()
});

export const PacketAIDraftSchema = z.object({
  conciseNarrative: z.string().min(1).max(1500),
  missingDetails: z.array(z.string().min(1).max(300)).max(12),
  clinicianQuestions: z.array(z.string().min(1).max(300)).max(10),
  organizationNotes: z.array(z.string().min(1).max(300)).max(8),
  safetyFlags: z.array(SafetyFlagTypeSchema.exclude(["privacy_warning"])).max(10)
}).strict();

export const ConcernTypeSchema = z.enum(["pain_injury", "cough_respiratory", "skin_visible", "report_document", "other"]);
export const FolderIdSchema = z.enum(["story", "body_location", "audio", "motion_visual", "packet"]);
export const FolderStatusSchema = z.enum(["empty", "in_progress", "saved", "needs_review", "optional", "planned_later", "not_applicable"]);
const PacketReadinessRequirementSchema = z.object({
  key: z.string().max(100),
  label: z.string().max(120),
  reason: z.string().max(300),
  recommendedAction: z.string().max(300).optional()
});

export const ExtractStoryRequestSchema = z.object({ rawText: z.string().trim().min(1).max(12000), concernType: ConcernTypeSchema.optional() });
export const AgentContextSchema = z.object({
  currentRoute: z.string().max(100), activeFolder: FolderIdSchema, concernType: ConcernTypeSchema.optional(),
  folderStatuses: z.record(FolderIdSchema, FolderStatusSchema), hasStory: z.boolean(), hasSummary: z.boolean(),
  summaryApproved: z.boolean(), bodyLocationObservationCount: z.number().int().min(0).max(100),
  audioSignalCount: z.number().int().min(0).max(100), motionVisualNoteCount: z.number().int().min(0).max(100),
  hasPacketDraft: z.boolean(),
  packetReadiness: z.object({
    ready: z.boolean(),
    unresolvedRequirements: z.array(PacketReadinessRequirementSchema).max(12),
    pendingReviewCount: z.number().int().min(0).max(100),
    packetStale: z.boolean(),
    nextRequiredDestination: z.enum(["story", "body_location", "audio", "motion_visual", "review_board"]).optional()
  }).optional(),
  missingDetails: z.array(z.string().max(300)).max(30),
  safetyFlags: z.array(z.object({ id: z.string(), type: SafetyFlagTypeSchema, message: z.string().max(500), severity: z.enum(["info", "caution", "blocked"]) })).max(30),
  availableActions: z.array(AgentActionTypeSchema.or(z.literal("blockedSafetyResponse"))).max(30)
});
export const AgentRequestSchema = z.object({ message: z.string().trim().min(1).max(3000), context: AgentContextSchema });

const TimelineSchema = z.object({ id: z.string(), label: z.string(), detail: z.string(), source: z.enum(["patient_stated", "ai_organized", "demo_generated"]) });
const StructuredSummarySchema = z.object({
  mainConcern: z.string(), timeline: z.array(TimelineSchema), affectedAreas: z.array(z.string()), changesOverTime: z.array(z.string()),
  triggersOrPatterns: z.array(z.string()), patientConcerns: z.array(z.string()), missingDetails: z.array(z.string()),
  clinicianQuestions: z.array(z.string()), summaryNote: z.string(), source: z.enum(["ai_organized_from_patient_provided_information", "demo_generated"])
});
const BodyObservationSchema = z.object({ id: z.string(), x: z.number().optional(), y: z.number().optional(), regionLabel: z.string(), signalType: z.enum(["pain", "stiffness", "swelling", "numbness_tingling", "rash_visible_change", "discomfort", "other"]), note: z.string().optional(), intensity: z.number().optional(), source: z.literal("patient_stated") });
const MotionNoteSchema = z.object({ id: z.string(), note: z.string(), createdAt: z.string(), source: z.literal("patient_stated") });

export const PacketAIRequestSchema = z.object({ approvedSessionContent: z.object({
  concernType: ConcernTypeSchema.optional(), patientWords: z.string().max(12000), approvedSummary: StructuredSummarySchema.optional(),
  bodyLocationObservations: z.array(BodyObservationSchema).max(100),
  audioSignalMetadata: z.array(z.object({ name: z.string().max(200), durationSeconds: z.number().min(0).max(7200), tags: z.array(z.string().max(100)).max(20), notes: z.string().max(1000).optional() })).max(100),
  motionVisualNotes: z.array(MotionNoteSchema).max(100),
  packetReadiness: z.object({
    ready: z.boolean(),
    concernTypeSelected: z.boolean(),
    folders: z.object({
      story: z.enum(["empty", "in_progress", "complete", "not_applicable", "needs_review"]),
      bodyLocation: z.enum(["empty", "in_progress", "complete", "not_applicable", "needs_review"]),
      audio: z.enum(["empty", "in_progress", "complete", "not_applicable", "needs_review"]),
      motionVisual: z.enum(["empty", "in_progress", "complete", "not_applicable", "needs_review"])
    }),
    unresolvedRequirements: z.array(PacketReadinessRequirementSchema).max(12),
    pendingReviewCount: z.number().int().min(0).max(100),
    packetStale: z.boolean(),
    nextRequiredDestination: z.enum(["story", "body_location", "audio", "motion_visual", "review_board"]).optional()
  }).optional()
}) });
