import type {
  Asset,
  ContentProject,
  EditJob,
  IntegrationStatus,
  RadarVideo,
  Workspace,
} from "../types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || `请求失败（${response.status}）`);
  }
  return payload as T;
}

export const api = {
  workspace: () => request<Workspace>("/api/workspace"),
  integrations: () => request<IntegrationStatus>("/api/integrations"),
  saveIntegrations: (body: Record<string, unknown>) =>
    request<IntegrationStatus>("/api/integrations", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  searchRadar: (query: string, labelType = 1) =>
    request<{ items: RadarVideo[]; source: "tikhub" | "demo"; notice?: string }>(
      `/api/radar/search?q=${encodeURIComponent(query)}&labelType=${labelType}`,
    ),
  createIdea: (body: { title: string; premise: string; tags?: string[] }) =>
    request<Workspace>("/api/ideas", { method: "POST", body: JSON.stringify(body) }),
  createProject: (ideaId: string) =>
    request<{ workspace: Workspace; project: ContentProject }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ ideaId }),
    }),
  advanceProject: (id: string) =>
    request<{ workspace: Workspace; project: ContentProject }>(
      `/api/projects/${id}/advance`,
      { method: "POST" },
    ),
  generateScript: (id: string) =>
    request<{ workspace: Workspace; project: ContentProject; mode: "ai" | "local" }>(
      `/api/projects/${id}/script`,
      { method: "POST" },
    ),
  scanAssets: (directory: string) =>
    request<{ workspace: Workspace; imported: Asset[] }>("/api/assets/scan", {
      method: "POST",
      body: JSON.stringify({ directory }),
    }),
  searchAssets: (query: string) =>
    request<{ items: Asset[] }>(`/api/assets/search?q=${encodeURIComponent(query)}`),
  createEditJob: (body: { projectId: string; style: string }) =>
    request<{ workspace: Workspace; job: EditJob }>("/api/edit/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  renderEditJob: (id: string) =>
    request<{ workspace: Workspace; job: EditJob }>(`/api/edit/jobs/${id}/render`, {
      method: "POST",
    }),
  chat: (message: string, projectId?: string) =>
    request<{ message: string; mode: "ai" | "local" }>("/api/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ message, projectId }),
    }),
};
