interface DesktopInfo {
  appVersion: string;
  platform: string;
  arch: string;
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
    videos: Array<{ awemeId: string; description?: string; createTime?: string; shareUrl?: string; durationMs?: number; statistics: Record<string, number>; mediaAnalysisStatus: string; evidenceIds: string[]; artifactIds: string[] }>;
    coverage: { requested: number; received: number; metadataAnalyzed: number; mediaAnalyzed: number; missingMedia: number; hasMore: boolean; note: string };
    findings: Array<{ id: string; kind: string; title: string; detail: string; evidenceIds: string[] }>;
  };
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

interface CaptureWorkflowInput {
  projectTitle: string;
  blocks: Array<{ kind: "hook" | "claim" | "evidence" | "example" | "counterpoint" | "transition" | "conclusion" | "cta"; text: string; visualNeed: "none" | "support" | "must_show" }>;
  shots: Array<{ scriptBlockIndex: number; purpose: "explain" | "prove" | "transition" | "emotion" | "reset" | "brand"; mode: "talking_head" | "broll" | "screen_recording" | "graphic" | "generated" | "still"; framing?: "wide" | "medium" | "close" | "detail" | "screen"; cameraDirection?: string; actionDescription: string; targetMs: number; sourceRequirement: "existing_asset" | "shoot_task" | "generated_asset" | "any" }>;
}

interface CaptureShootTask {
  id: string;
  shotId: string;
  title: string;
  instruction: string;
  targetMs: number;
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
  status?: "ready" | "needs_material";
  project?: { id: string; title: string };
  missing?: Array<{ shotId: string; taskId?: string; reason: string; instruction: string }>;
  proposal?: EditProposal;
  assetLocks?: Array<{ assetId: string; contentHash: string }>;
  provider?: { providerKey: string; modelKey?: string; responseHash?: string };
}

interface EditRenderResult {
  ok: boolean;
  errorCode?: string;
  message?: string;
  renderId?: string;
  renderRunId?: string;
  files?: { video: string; subtitle: string | null; manifest: string };
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
}

interface Window {
  desktop?: {
    getInfo: () => Promise<DesktopInfo>;
    chooseWorkspace: () => Promise<ChooseWorkspaceResult>;
    importMedia: () => Promise<ImportMediaResult>;
    searchAssets: (query: string) => Promise<AssetSearchResult>;
    researchAccount: (input: { sourceInput: string; count?: number }) => Promise<AccountResearchResult>;
    downloadResearchMedia: (input: { reportId: string; awemeIds: string[] }) => Promise<DownloadResearchMediaResult>;
    analyzeResearchMedia: (input: { reportId: string; awemeIds: string[] }) => Promise<AnalyzeResearchMediaResult>;
    createCaptureWorkflow: (input: CaptureWorkflowInput) => Promise<CaptureWorkflowResult>;
    importTake: (shootTaskId: string) => Promise<ImportTakeResult>;
    selectTake: (input: { shootTaskId: string; takeId: string }) => Promise<SelectTakeResult>;
    proposeEdit: (projectId: string) => Promise<EditProposalResult>;
    renderEdit: (input: { projectId: string; proposal: EditProposal }) => Promise<EditRenderResult>;
    exportExchange: (input: { renderRunId: string; formats: Array<"fcpxml" | "otio"> }) => Promise<ExchangeExportResult>;
    createPublishPackage: (input: { renderRunId: string; platform?: string; title: string; description?: string; hashtags?: string[]; rightsNote?: string }) => Promise<PublishPackageResult>;
    openWorkspaceFile: (relativePath: string) => Promise<{ ok: boolean; message?: string }>;
    openExternal: (url: string) => Promise<{ ok: boolean; message?: string }>;
  };
}
