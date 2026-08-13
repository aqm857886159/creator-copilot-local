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

interface Window {
  desktop?: {
    getInfo: () => Promise<DesktopInfo>;
    chooseWorkspace: () => Promise<ChooseWorkspaceResult>;
    importMedia: () => Promise<ImportMediaResult>;
    createCaptureWorkflow: (input: CaptureWorkflowInput) => Promise<CaptureWorkflowResult>;
    importTake: (shootTaskId: string) => Promise<ImportTakeResult>;
    selectTake: (input: { shootTaskId: string; takeId: string }) => Promise<SelectTakeResult>;
    openWorkspaceFile: (relativePath: string) => Promise<{ ok: boolean; message?: string }>;
  };
}
