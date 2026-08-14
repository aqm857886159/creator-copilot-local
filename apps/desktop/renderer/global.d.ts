interface DesktopInfo {
  appVersion: string;
  platform: string;
  arch: string;
  workspacePath?: string | null;
}

interface ChooseWorkspaceResult {
  canceled: boolean;
  path: string | null;
}

interface ImportMediaResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  sourceName?: string;
  durationMs?: number | null;
  streams?: Array<{ kind: string; codec?: string; width?: number; height?: number; frameRate?: number; sampleRate?: number; channels?: number; rotation?: number }>;
  artifacts?: Array<{ artifactId: string; kind: string; relativePath: string; mimeType: string; contentHash: string; byteSize: number; parentArtifactIds: string[] }>;
}

interface AssetSearchResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  artifacts?: Array<{ artifactId: string; kind: string; relativePath: string; mimeType: string; contentHash: string; byteSize: number; parentArtifactIds: string[] }>;
  facts?: Array<{ id: string; artifactId: string; kind: string; startMs: number; endMs: number; text: string; labels: string[]; providerKey: string }>;
  analysisJobs?: Array<{ id: string; state: string; attempt: number; artifactIds: string[]; lastError?: { code: string; message: string; retryable: boolean }; updatedAt: string }>;
}

interface AnalyzeAssetResult {
  ok: boolean;
  status?: "succeeded" | "running" | "failed" | "needs_attention" | "cancelled";
  errorCode?: string;
  message?: string;
  reused?: boolean;
  summary?: string;
  asrStatus?: string;
  ocrStatus?: string;
  job?: { id: string; state: string; attempt: number; artifactIds: string[] };
  facts?: Array<{ id: string; artifactId: string; kind: string; startMs: number; endMs: number; text: string; labels: string[]; providerKey: string }>;
}

interface CancelAnalysisResult {
  ok: boolean;
  status?: string;
  errorCode?: string;
  message?: string;
}

interface AccountResearchResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  report?: {
    id: string;
    providerKey: string;
    sourceInput: string;
    secUserId: string;
    profile: { nickname?: string; signature?: string; followerCount?: number; followingCount?: number; awemeCount?: number };
    videos: Array<{ awemeId: string; description?: string; createTime?: string; shareUrl?: string; durationMs?: number; statistics: Record<string, number>; mediaAnalysisStatus: string; evidenceIds: string[]; analysisFactIds: string[]; artifactIds: string[]; analysis?: { status: "partial" | "completed"; analyzedAt?: string; summary?: string; factCount: number; shotCount: number; transcriptCount: number; ocrCount: number; missingKinds: string[]; openingText: string[]; timeline: Array<{ id: string; startMs: number; endMs: number; shotFactId?: string; transition?: string; transcript: Array<{ factId: string; startMs: number; endMs: number; text: string }>; ocr: Array<{ factId: string; startMs: number; endMs: number; text: string }> }> } }>;
    coverage: { requested: number; received: number; metadataAnalyzed: number; mediaAnalyzed: number; missingMedia: number; hasMore: boolean; note: string };
    patternSummary?: { analyzedVideoCount: number; perVideo: Array<{ awemeId: string; durationMs?: number; shotCount: number; averageShotDurationMs?: number; firstShotDurationMs?: number; shortShotRate?: number; transcriptCount: number; ocrCount: number; openingText: string[]; statistics: Record<string, number> }>; topByPlayCount: string[]; comparison: { topSampleAwemeId?: string; topSamplePlayCount?: number; topSampleAverageShotDurationMs?: number; otherAverageShotDurationMs?: number; topSampleShortShotRate?: number; otherShortShotRate?: number }; caveat: string };
    findings: Array<{ id: string; kind: string; title: string; detail: string; evidenceIds: string[] }>;
    opportunities: Array<{ id: string; title: string; angle: string; whyNow: string; sourceVideoIds: string[]; evidenceIds: string[]; status: "candidate" }>;
    accountAnalysis?: { schemaVersion: 1; day: number; capturedAt: string; metrics: Record<string, number>; evidenceId: string; responseHash: string };
    evidence: Array<{ id: string; type: string; sourceId: string; label: string; payload: Record<string, unknown>; capturedAt: string }>;
  };
}

interface ScriptProposalView {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  brief: string;
  voiceProfile?: string;
  blocks: Array<{ schemaVersion: 1; id: string; order: number; kind: "hook" | "claim" | "evidence" | "example" | "counterpoint" | "transition" | "conclusion" | "cta"; text: string; emphasis: string[]; evidenceIds: string[]; visualNeed: "none" | "support" | "must_show"; visualSuggestion: string; shotPlan?: { schemaVersion: 1; purpose: "explain" | "prove" | "transition" | "emotion" | "reset" | "brand"; mode: "talking_head" | "broll" | "screen_recording" | "graphic" | "generated" | "still"; framing?: "wide" | "medium" | "close" | "detail" | "screen"; actionDescription: string; cameraDirection: string; targetMs: number; sourceRequirement: "existing_asset" | "shoot_task" | "generated_asset" | "any"; deviceHint: "phone" | "camera" | "screen" | "any"; orientation: "portrait" | "landscape" | "any"; checklist: string[]; referencePrompt?: string } }>;
  styleNotes: string[];
  warnings: string[];
  status: "previewed" | "accepted" | "rejected" | "expired";
  provider: { providerKey: string; modelKey?: string; responseHash?: string };
  createdAt: string;
  updatedAt: string;
}

interface ScriptProposalResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  proposal?: ScriptProposalView;
  provider?: { providerKey: string; modelKey?: string; responseHash?: string };
}

interface ScriptAcceptResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  proposal?: ScriptProposalView;
  project?: { id: string; workspaceId: string; title: string; stage: string; revision: number; payload: Record<string, unknown>; createdAt: string; updatedAt: string };
  script?: { id: string; projectId: string; revision: number; blocks: Array<{ id: string; order: number; kind: string; text: string; emphasis: string[]; evidenceIds: string[]; visualNeed: "none" | "support" | "must_show" }>; estimatedDurationMs: number };
}

interface AccountMetricsQuoteView {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  reportId: string;
  awemeIds: string[];
  endpoint: string;
  batchCount: number;
  costUsd: number;
  rateLimit?: string;
  quotedAt: string;
  expiresAt: string;
}

interface AccountMetricsQuoteResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  quote?: AccountMetricsQuoteView;
}

interface AccountMetricsRunResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  report?: AccountResearchResult["report"];
  updatedCount?: number;
  missingAwemeIds?: string[];
}

interface AccountWorkAnalysisQuoteView {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  reportId: string;
  secUserId: string;
  day: number;
  endpoint: string;
  costUsd: number;
  rateLimit?: string;
  quotedAt: string;
  expiresAt: string;
}

interface AccountWorkAnalysisQuoteResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  quote?: AccountWorkAnalysisQuoteView;
}

interface AccountWorkAnalysisRunResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  report?: AccountResearchResult["report"];
}

interface DownloadResearchMediaResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  report?: AccountResearchResult["report"];
  downloaded?: Array<{ awemeId: string; reused: boolean; artifactIds: string[] }>;
  failed?: Array<{ awemeId: string; message: string }>;
}

interface AnalyzeResearchMediaResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  report?: AccountResearchResult["report"];
  failed?: Array<{ awemeId: string; message: string }>;
  jobs?: Array<{ id: string; state: string; reused?: boolean; factCount?: number }>;
}

interface TopicRadarQueryView {
  schemaVersion: 1;
  sources: Array<"low_fan" | "high_completion" | "search_hot">;
  keyword: string;
  dateWindow: 1 | 24 | 72 | 168;
  pageSize: number;
}

interface TopicRadarQuoteView {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  query: TopicRadarQueryView;
  lines: Array<{ source: "low_fan" | "high_completion" | "search_hot"; endpoint: string; costUsd: number; rateLimit?: string; endpointType?: string }>;
  totalCostUsd: number;
  currency: "USD";
  quotedAt: string;
  expiresAt: string;
}

interface TopicRadarReportView {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  providerKey: "tikhub";
  query: TopicRadarQueryView;
  quote: TopicRadarQuoteView;
  status: "completed" | "partial" | "failed";
  signals: Array<{ id: string; source: string; kind: string; label: string; detail: string; metrics: Record<string, number>; sourceId: string; sourceUrl?: string; capturedAt: string }>;
  opportunities: Array<{ id: string; source: string; title: string; angle: string; whyNow: string; evidenceIds: string[]; status: "candidate" }>;
  runs: Array<{ source: string; endpoint: string; jobId: string; quotedCostUsd: number; status: string; itemCount: number; responseHash?: string; error?: { code: string; message: string; retryable: boolean } }>;
  createdAt: string;
}

interface TopicRadarQuoteResult { ok: boolean; errorCode?: string; message?: string; quote?: TopicRadarQuoteView }
interface TopicRadarRunResult { ok: boolean; errorCode?: string; message?: string; report?: TopicRadarReportView; reports?: TopicRadarReportView[] }

interface CaptureWorkflowInput {
  projectTitle: string;
  existingProjectId?: string;
  existingScriptId?: string;
  blocks: Array<{ kind: "hook" | "claim" | "evidence" | "example" | "counterpoint" | "transition" | "conclusion" | "cta"; text: string; visualNeed: "none" | "support" | "must_show" }>;
  shots: Array<{ scriptBlockIndex: number; purpose: "explain" | "prove" | "transition" | "emotion" | "reset" | "brand"; mode: "talking_head" | "broll" | "screen_recording" | "graphic" | "generated" | "still"; framing?: "wide" | "medium" | "close" | "detail" | "screen"; cameraDirection?: string; deviceHint?: "phone" | "camera" | "screen" | "any"; orientation?: "portrait" | "landscape" | "any"; checklist?: string[]; actionDescription: string; targetMs: number; sourceRequirement: "existing_asset" | "shoot_task" | "generated_asset" | "any" }>;
}

interface CaptureShootTask {
  id: string;
  shotId: string;
  title: string;
  instruction: string;
  targetMs: number;
  minMs?: number;
  maxMs?: number;
  deviceHint: "phone" | "camera" | "screen" | "any";
  orientation: "portrait" | "landscape" | "any";
  checklist: string[];
  status: "todo" | "recorded" | "imported" | "accepted" | "skipped";
  takeIds: string[];
}

interface CaptureTake {
  id: string;
  shootTaskId: string;
  assetId: string;
  relativePath: string;
  durationMs?: number;
  status: "unreviewed" | "candidate" | "selected" | "rejected";
}

interface CaptureWorkflowResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  projectId?: string;
  tasks?: CaptureShootTask[];
  capturePackage?: { id: string; relativePath: string; status: string };
}

interface ImportTakeResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  take?: CaptureTake;
  task?: CaptureShootTask;
  sourceName?: string;
  thumbnail?: { relativePath: string };
}

interface SelectTakeResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  task?: CaptureShootTask;
  takes?: CaptureTake[];
}

interface EditProposalOperation {
  id: string;
  shotId: string;
  sourceAssetId: string;
  sourceSegment: { startMs: number; endMs: number };
  timeline: { startMs: number; endMs: number };
  role: "a_roll" | "b_roll" | "screen" | "generated" | "still";
  reason: string;
  evidenceIds: string[];
  confidence: number;
  status: "suggested" | "accepted" | "rejected";
}

interface EditProposal {
  schemaVersion: 1;
  id: string;
  projectId: string;
  durationMs: number;
  operations: EditProposalOperation[];
  subtitles: Array<{ id: string; timeline: { startMs: number; endMs: number }; text: string }>;
  outputProfile: { container: string; videoCodec: string; width: number; height: number; fps: number; audioCodec: string; audioSampleRate: number; subtitle: string };
  status: string;
}

interface EditProposalResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  status?: "ready" | "needs_material" | "pending" | "failed";
  receipt?: { schemaVersion: 1; commandId: string; correlationId: string; status: "accepted" | "rejected" | "pending" | "duplicate" | "conflict"; target: { type: string; id: string; expectedRevision?: number }; jobIds: string[]; eventIds: string[]; artifactIds: string[]; approvalRequired: boolean; errorCode?: string; errorDetails?: Record<string, unknown> };
  idempotencyScope?: string;
  idempotencyKey?: string;
  jobId?: string;
  project?: { id: string; title: string };
  missing?: Array<{ shotId: string; taskId?: string; reason: string; instruction: string }>;
  analysisFacts?: Array<{ id: string; artifactId: string; kind: string; startMs: number; endMs: number; text: string; labels: string[]; providerKey: string }>;
  assetCandidates?: Array<{ shotId: string; candidates: Array<{ assetId: string; relativePath: string; contentHash: string; score: number; confidence: "low" | "medium" | "high"; matchedTerms: string[]; evidenceIds: string[]; sourceSegment?: { startMs: number; endMs: number }; durationMs?: number; reason: string }> }>;
  proposal?: EditProposal;
  assetLocks?: Array<{ assetId: string; contentHash: string }>;
  provider?: { providerKey: string; modelKey?: string; responseHash?: string };
}

interface EditRenderResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  freezeReceipt?: EditProposalResult["receipt"];
  frozenEditSpecId?: string;
  renderId?: string;
  renderRunId?: string;
  jobId?: string;
  artifactIds?: string[];
  files?: { video: string; subtitle: string | null; manifest: string };
}

interface RenderRecoveryListResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  items?: Array<{ renderRun: { schemaVersion: 1; id: string; projectId: string; frozenEditSpecId: string; state: string; manifestRelativePath?: string; manifestHash?: string; error?: { code: string; message: string } }; job: { id: string; state: string; attempt: number; lastError?: { code: string; message: string; retryable: boolean } } }>;
}

interface ReconcileEditProposalResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  retryNonce?: string;
  receipt?: EditProposalResult["receipt"];
}

interface EditProposalRecoveryListResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  items?: Array<{ idempotencyScope: string; idempotencyKey: string; receipt: EditProposalResult["receipt"]; job: { id: string; state: string; attempt: number } }>;
}

interface ExchangeExportResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  renderRunId?: string;
  outputs?: Record<string, { relativePath: string; lossReportPath: string; report: { adapter: string; formatVersion: string; supported: string[]; losses: Array<{ kind: string; sourceId: string; severity: string; message: string }> } }>;
}

interface PublishPackageResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  packageId?: string;
  packageRelativePath?: string;
  manifestRelativePath?: string;
  manifest?: { title: string; platform: string; files: Array<{ kind: string; relativePath: string }>; warnings: string[] };
  publicationId?: string;
}

interface MetricSnapshotView {
  schemaVersion: 1;
  id: string;
  publicationId: string;
  capturedAt: string;
  window: string;
  source: "manual" | "connector";
  metrics: { views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; completionRate: number | null; averageWatchSeconds: number | null; newFollowers: number | null };
  notes: string;
}

interface PublicationView {
  schemaVersion: 1;
  id: string;
  projectId: string;
  packageId: string;
  platform: string;
  status: "draft" | "published" | "failed" | "removed";
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ReviewMemoryProposalView {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  sourcePublicationIds: string[];
  evidenceSnapshotIds: string[];
  statement: string;
  confidence: number;
  appliesTo: { pillars: string[]; formats: string[]; platforms: string[] };
  status: "candidate" | "confirmed" | "rejected" | "expired";
  createdAt: string;
  confirmedAt?: string;
}

interface PublicationListResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  publications?: Array<{ publication: PublicationView; snapshots: MetricSnapshotView[] }>;
  proposals?: ReviewMemoryProposalView[];
}

interface MetricRecordResult { ok: boolean; errorCode?: string; message?: string; snapshot?: MetricSnapshotView }
interface ReviewMemoryResult { ok: boolean; errorCode?: string; message?: string; proposal?: ReviewMemoryProposalView }

interface Window {
  desktop?: {
    getInfo: () => Promise<DesktopInfo>;
    chooseWorkspace: () => Promise<ChooseWorkspaceResult>;
    importMedia: () => Promise<ImportMediaResult>;
    analyzeAsset: (input: { artifactId: string }) => Promise<AnalyzeAssetResult>;
    cancelAnalysis: (input: { artifactId: string }) => Promise<CancelAnalysisResult>;
    searchAssets: (query: string) => Promise<AssetSearchResult>;
    researchAccount: (input: { sourceInput: string; count?: number }) => Promise<AccountResearchResult>;
    quoteAccountMetrics: (input: { reportId: string; awemeIds: string[] }) => Promise<AccountMetricsQuoteResult>;
    runAccountMetrics: (quoteId: string) => Promise<AccountMetricsRunResult>;
    quoteAccountAnalysis: (input: { reportId: string; day?: number }) => Promise<AccountWorkAnalysisQuoteResult>;
    runAccountAnalysis: (quoteId: string) => Promise<AccountWorkAnalysisRunResult>;
    downloadResearchMedia: (input: { reportId: string; awemeIds: string[] }) => Promise<DownloadResearchMediaResult>;
    analyzeResearchMedia: (input: { reportId: string; awemeIds: string[] }) => Promise<AnalyzeResearchMediaResult>;
    proposeScript: (input: { brief: string; voiceProfile?: string; sourceEvidence?: Array<{ id: string; text: string; source?: string }> }) => Promise<ScriptProposalResult>;
    acceptScriptProposal: (input: { proposalId: string; projectTitle: string }) => Promise<ScriptAcceptResult>;
    quoteTopicRadar: (input: TopicRadarQueryView) => Promise<TopicRadarQuoteResult>;
    runTopicRadar: (quoteId: string) => Promise<TopicRadarRunResult>;
    listTopicRadarReports: () => Promise<TopicRadarRunResult>;
    createCaptureWorkflow: (input: CaptureWorkflowInput) => Promise<CaptureWorkflowResult>;
    importTake: (shootTaskId: string) => Promise<ImportTakeResult>;
    selectTake: (input: { shootTaskId: string; takeId: string }) => Promise<SelectTakeResult>;
    proposeEdit: (input: { projectId: string; retryNonce?: string } | string) => Promise<EditProposalResult>;
    reconcileEditProposal: (input: { idempotencyScope: string; idempotencyKey: string; action: "user_confirmed_not_submitted" }) => Promise<ReconcileEditProposalResult>;
    listEditProposalRecoveries: (projectId: string) => Promise<EditProposalRecoveryListResult>;
    renderEdit: (input: { projectId: string; proposal: EditProposal }) => Promise<EditRenderResult>;
    listRenderRecoveries: (projectId: string) => Promise<RenderRecoveryListResult>;
    retryRender: (input: { projectId: string; renderRunId: string }) => Promise<EditRenderResult & { status?: "running" }>;
    exportExchange: (input: { renderRunId: string; formats: Array<"fcpxml" | "otio"> }) => Promise<ExchangeExportResult>;
    createPublishPackage: (input: { renderRunId: string; platform?: string; title: string; description?: string; hashtags?: string[]; rightsNote?: string }) => Promise<PublishPackageResult>;
    listPublications: () => Promise<PublicationListResult>;
    recordMetrics: (input: { publicationId: string; window?: string; metrics: Partial<MetricSnapshotView["metrics"]>; notes?: string }) => Promise<MetricRecordResult>;
    proposeReviewMemory: (input: { publicationId: string; statement: string }) => Promise<ReviewMemoryResult>;
    confirmReviewMemory: (proposalId: string) => Promise<ReviewMemoryResult>;
    openWorkspaceFile: (relativePath: string) => Promise<{ ok: boolean; message?: string }>;
    openExternal: (url: string) => Promise<{ ok: boolean; message?: string }>;
  };
}
