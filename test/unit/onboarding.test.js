import { describe, it, expect } from "vitest";
import { getOnboardingSteps } from "../../packages/app/src/app/lib/onboarding.ts";

describe("getOnboardingSteps (hosted mode)", () => {
  it("marks only sign-in when authenticated but no activity", () => {
    const steps = getOnboardingSteps({
      isAuthenticated: true,
      isLocalMode: false,
      entriesUsed: 0,
      hasApiKey: false,
      hasMcpActivity: false,
    });

    expect(steps.map((step) => [step.id, step.completed])).toEqual([
      ["sign-in", true],
      ["connect-tools", false],
      ["first-entry", false],
    ]);
  });

  it("marks all steps complete when present", () => {
    const steps = getOnboardingSteps({
      isAuthenticated: true,
      isLocalMode: false,
      entriesUsed: 2,
      hasApiKey: true,
      hasMcpActivity: true,
    });

    expect(steps.every((step) => step.completed)).toBe(true);
  });
});

describe("getOnboardingSteps (local mode)", () => {
  it("returns local-specific steps and completion rules", () => {
    const steps = getOnboardingSteps({
      isAuthenticated: true,
      isLocalMode: true,
      entriesUsed: 0,
      hasApiKey: false,
      hasMcpActivity: false,
    });

    expect(steps.map((step) => step.id)).toEqual(["connect-folder", "connect-tools", "first-entry", "go-hosted"]);
    expect(steps[0].completed).toBe(true);
    expect(steps[1].completed).toBe(false);
    expect(steps[2].completed).toBe(false);
    expect(steps[3].completed).toBe(false);
  });

  it("marks first-entry complete when entries exist", () => {
    const steps = getOnboardingSteps({
      isAuthenticated: true,
      isLocalMode: true,
      entriesUsed: 1,
      hasApiKey: false,
      hasMcpActivity: false,
    });

    expect(steps[2].completed).toBe(true);
  });
});
