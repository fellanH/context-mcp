import { describe, it, expect } from "vitest";
import { computeGrowthWarnings } from "@context-vault/core/core/status";
import { DEFAULT_GROWTH_THRESHOLDS } from "@context-vault/core/constants";

function makeStatus(overrides = {}) {
  return {
    embeddingStatus: { total: 0, indexed: 0, missing: 0 },
    eventCount: 0,
    eventsWithoutTtlCount: 0,
    expiredCount: 0,
    dbSizeBytes: 0,
    kindCounts: [],
    ...overrides,
  };
}

describe("DEFAULT_GROWTH_THRESHOLDS", () => {
  it("defaults totalEntries.warn to 2000", () => {
    expect(DEFAULT_GROWTH_THRESHOLDS.totalEntries.warn).toBe(2000);
  });

  it("defaults eventEntries.warn to 1000", () => {
    expect(DEFAULT_GROWTH_THRESHOLDS.eventEntries.warn).toBe(1000);
  });
});

describe("computeGrowthWarnings", () => {
  it("returns empty result when thresholds is null", () => {
    const result = computeGrowthWarnings(makeStatus(), null);
    expect(result.warnings).toEqual([]);
    expect(result.hasWarnings).toBe(false);
    expect(result.hasCritical).toBe(false);
    expect(result.kindBreakdown).toEqual([]);
  });

  it("no warnings when below all thresholds", () => {
    const result = computeGrowthWarnings(
      makeStatus({ embeddingStatus: { total: 500 } }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.hasWarnings).toBe(false);
    expect(result.kindBreakdown).toEqual([]);
  });

  it("warns when total entries exceed warn threshold", () => {
    const result = computeGrowthWarnings(
      makeStatus({ embeddingStatus: { total: 2500 } }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.hasWarnings).toBe(true);
    expect(result.warnings[0].level).toBe("warn");
    expect(result.warnings[0].message).toContain("2,500");
  });

  it("critical when total entries exceed critical threshold", () => {
    const result = computeGrowthWarnings(
      makeStatus({ embeddingStatus: { total: 6000 } }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.hasCritical).toBe(true);
    expect(result.warnings[0].level).toBe("critical");
  });

  it("includes kind breakdown when total entries threshold exceeded", () => {
    const result = computeGrowthWarnings(
      makeStatus({
        embeddingStatus: { total: 2500 },
        kindCounts: [
          { kind: "event", c: 1800 },
          { kind: "insight", c: 400 },
          { kind: "reference", c: 300 },
        ],
      }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.kindBreakdown).toHaveLength(3);
    expect(result.kindBreakdown[0].kind).toBe("event");
    expect(result.kindBreakdown[0].count).toBe(1800);
    expect(result.kindBreakdown[0].pct).toBe(72);
    expect(result.kindBreakdown[1].kind).toBe("insight");
    expect(result.kindBreakdown[2].kind).toBe("reference");
  });

  it("no kind breakdown when below threshold", () => {
    const result = computeGrowthWarnings(
      makeStatus({
        embeddingStatus: { total: 500 },
        kindCounts: [
          { kind: "event", c: 300 },
          { kind: "insight", c: 200 },
        ],
      }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.kindBreakdown).toEqual([]);
  });

  it("warns on event entries exceeding threshold", () => {
    const result = computeGrowthWarnings(
      makeStatus({ eventCount: 1500 }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.hasWarnings).toBe(true);
    expect(
      result.warnings.some((w) => w.message.includes("Event entries")),
    ).toBe(true);
  });

  it("event warning includes TTL note when events lack expires_at", () => {
    const result = computeGrowthWarnings(
      makeStatus({ eventCount: 1500, eventsWithoutTtlCount: 800 }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    const eventWarning = result.warnings.find((w) =>
      w.message.includes("Event entries"),
    );
    expect(eventWarning.message).toContain("without TTL");
  });

  it("suggests prune action when expired entries exist", () => {
    const result = computeGrowthWarnings(
      makeStatus({ expiredCount: 42 }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.actions.some((a) => a.includes("prune"))).toBe(true);
    expect(result.actions.some((a) => a.includes("42"))).toBe(true);
  });

  it("respects custom thresholds", () => {
    const custom = {
      totalEntries: { warn: 5000, critical: 10000 },
      eventEntries: { warn: 3000, critical: 8000 },
      vaultSizeBytes: { warn: 100 * 1024 * 1024, critical: 500 * 1024 * 1024 },
      eventsWithoutTtl: { warn: 500 },
    };
    const result = computeGrowthWarnings(
      makeStatus({ embeddingStatus: { total: 3000 } }),
      custom,
    );
    expect(result.hasWarnings).toBe(false);
  });

  it("kind breakdown sorted by count descending", () => {
    const result = computeGrowthWarnings(
      makeStatus({
        embeddingStatus: { total: 3000 },
        kindCounts: [
          { kind: "insight", c: 100 },
          { kind: "event", c: 2500 },
          { kind: "reference", c: 400 },
        ],
      }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.kindBreakdown[0].kind).toBe("event");
    expect(result.kindBreakdown[1].kind).toBe("reference");
    expect(result.kindBreakdown[2].kind).toBe("insight");
  });

  it("warns on database size exceeding threshold", () => {
    const result = computeGrowthWarnings(
      makeStatus({ dbSizeBytes: 60 * 1024 * 1024 }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.hasWarnings).toBe(true);
    expect(
      result.warnings.some((w) => w.message.includes("Database size")),
    ).toBe(true);
  });

  it("warns on events without TTL exceeding threshold", () => {
    const result = computeGrowthWarnings(
      makeStatus({ eventsWithoutTtlCount: 250 }),
      DEFAULT_GROWTH_THRESHOLDS,
    );
    expect(result.hasWarnings).toBe(true);
    expect(
      result.warnings.some((w) => w.message.includes("without expires_at")),
    ).toBe(true);
  });
});
