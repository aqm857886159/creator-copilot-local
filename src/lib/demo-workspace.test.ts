import { describe, expect, it } from "vitest";
import { demoWorkspace } from "./demo-workspace";

describe("demo workspace shell", () => {
  it("starts with a creator profile and actionable projects", () => {
    expect(demoWorkspace.profile.name).toBeTruthy();
    expect(demoWorkspace.projects.length).toBeGreaterThan(0);
    expect(demoWorkspace.projects.every((project) => project.nextAction.length > 0)).toBe(true);
  });

  it("keeps the seed workspace local and media-free", () => {
    expect(demoWorkspace.assets).toEqual([]);
    expect(demoWorkspace.editJobs).toEqual([]);
  });
});
