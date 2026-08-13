interface DesktopInfo {
  appVersion: string;
  platform: string;
  arch: string;
}

interface ChooseWorkspaceResult {
  canceled: boolean;
  path: string | null;
}

interface Window {
  desktop?: {
    getInfo: () => Promise<DesktopInfo>;
    chooseWorkspace: () => Promise<ChooseWorkspaceResult>;
  };
}
