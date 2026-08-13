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

interface Window {
  desktop?: {
    getInfo: () => Promise<DesktopInfo>;
    chooseWorkspace: () => Promise<ChooseWorkspaceResult>;
    importMedia: () => Promise<ImportMediaResult>;
  };
}
