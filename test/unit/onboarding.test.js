import { describe, it, expect } from "vitest";
import { getOnboardingSteps } from "../../packages/app/src/app/lib/onboarding.ts";

describe("getOnboardingSteps (hosted mode)", () => {
  it("marks only sign-in when authenticated but no activity", () => {
    const steps = getOnboardingSteps({
      isAuthenticated: true,
      vaultMode: "hosted",
      entriesUsed: 0,
      hasApiKey: false,
      hasMcpActivity: false,
    });

    expect(steps.map((step) => [step.id, step.completed])).toEqual([
      ["sign-in", true],
      ["connect-tools", false],
      ["first-entry", false],
      ["install-extension", false],
    ]);
  });

  it("marks sign-in, connect-tools, and first-entry complete when present", () => {
    const steps = getOnboardingSteps({
      isAuthenticated: true,
      vaultMode: "hosted",
      entriesUsed: 2,
      hasApiKey: true,
      hasMcpActivity: true,
    });

    expect(steps.map((step) => [step.id, step.completed])).toEqual([
      ["sign-in", true],
      ["connect-tools", true],
      ["first-entry", true],
      ["install-extension", false],
    ]);
  });
});

describe("getOnboardingSteps (local mode)", () => {
  it("returns local-specific steps and completion rules", () => {
    const steps = getOnboardingSteps({
      isAuthenticated: true,
      vaultMode: "local",
      entriesUsed: 0,
      hasApiKey: false,
      hasMcpActivity: false,
    });

    expect(steps.map((step) => step.id)).toEqual([
      "connect-folder",
      "connect-tools",
      "first-entry",
      "install-extension",
      "go-hosted",
    ]);
    expect(steps[0].completed).toBe(true);
    expect(steps[1].completed).toBe(false);
    expect(steps[2].completed).toBe(false);
    expect(steps[3].completed).toBe(false);
    expect(steps[4].completed).toBe(false);
  });

  it("marks first-entry complete when entries exist", () => {
    const steps = getOnboardingSteps({
      isAuthenticated: true,
      vaultMode: "local",
      entriesUsed: 1,
      hasApiKey: false,
      hasMcpActivity: false,
    });

    expect(steps[2].completed).toBe(true);
  });
});
