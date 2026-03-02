import { describe, it, expect } from "vitest";
import {
  resolveTemporalShortcut,
  resolveTemporalParams,
} from "../../packages/local/src/temporal.js";

// Fixed reference point: Wednesday 2025-03-12 14:30:00 UTC
const NOW = new Date("2025-03-12T14:30:00.000Z");

describe("resolveTemporalShortcut", () => {
  describe("today", () => {
    it("since:today → start of today UTC", () => {
      const result = resolveTemporalShortcut("since", "today", NOW);
      expect(result).toBe("2025-03-12T00:00:00.000Z");
    });

    it("until:today → start of tomorrow (exclusive end)", () => {
      const result = resolveTemporalShortcut("until", "today", NOW);
      expect(result).toBe("2025-03-13T00:00:00.000Z");
    });

    it("case-insensitive: Today", () => {
      expect(resolveTemporalShortcut("since", "Today", NOW)).toBe(
        "2025-03-12T00:00:00.000Z",
      );
    });

    it("case-insensitive: TODAY", () => {
      expect(resolveTemporalShortcut("since", "TODAY", NOW)).toBe(
        "2025-03-12T00:00:00.000Z",
      );
    });
  });

  describe("yesterday", () => {
    it("since:yesterday → start of yesterday UTC", () => {
      const result = resolveTemporalShortcut("since", "yesterday", NOW);
      expect(result).toBe("2025-03-11T00:00:00.000Z");
    });

    it("until:yesterday → start of today (exclusive end of yesterday)", () => {
      const result = resolveTemporalShortcut("until", "yesterday", NOW);
      expect(result).toBe("2025-03-12T00:00:00.000Z");
    });
  });

  describe("this_week", () => {
    it("since:this_week → Monday 00:00 UTC (Wednesday ref → Mon 10 Mar)", () => {
      // 2025-03-12 is a Wednesday; Monday was 2025-03-10
      const result = resolveTemporalShortcut("since", "this_week", NOW);
      expect(result).toBe("2025-03-10T00:00:00.000Z");
    });

    it("since:this week (space separator)", () => {
      const result = resolveTemporalShortcut("since", "this week", NOW);
      expect(result).toBe("2025-03-10T00:00:00.000Z");
    });

    it("until:this_week → start of tomorrow", () => {
      const result = resolveTemporalShortcut("until", "this_week", NOW);
      expect(result).toBe("2025-03-13T00:00:00.000Z");
    });

    it("Monday reference → same day", () => {
      const monday = new Date("2025-03-10T08:00:00.000Z");
      expect(resolveTemporalShortcut("since", "this_week", monday)).toBe(
        "2025-03-10T00:00:00.000Z",
      );
    });

    it("Sunday reference → previous Monday", () => {
      const sunday = new Date("2025-03-16T12:00:00.000Z");
      expect(resolveTemporalShortcut("since", "this_week", sunday)).toBe(
        "2025-03-10T00:00:00.000Z",
      );
    });
  });

  describe("this_month", () => {
    it("since:this_month → first of current month", () => {
      const result = resolveTemporalShortcut("since", "this_month", NOW);
      expect(result).toBe("2025-03-01T00:00:00.000Z");
    });

    it("until:this_month → first of next month", () => {
      const result = resolveTemporalShortcut("until", "this_month", NOW);
      expect(result).toBe("2025-04-01T00:00:00.000Z");
    });
  });

  describe("last_N_days", () => {
    it("last_3_days → 3 days ago midnight", () => {
      const result = resolveTemporalShortcut("since", "last_3_days", NOW);
      expect(result).toBe("2025-03-09T00:00:00.000Z");
    });

    it("last_7_days → 7 days ago midnight", () => {
      const result = resolveTemporalShortcut("since", "last_7_days", NOW);
      expect(result).toBe("2025-03-05T00:00:00.000Z");
    });

    it("space form: 'last 3 days'", () => {
      const result = resolveTemporalShortcut("since", "last 3 days", NOW);
      expect(result).toBe("2025-03-09T00:00:00.000Z");
    });

    it("singular: 'last_1_day'", () => {
      const result = resolveTemporalShortcut("since", "last_1_day", NOW);
      expect(result).toBe("2025-03-11T00:00:00.000Z");
    });
  });

  describe("last_N_weeks", () => {
    it("last_2_weeks → 14 days ago midnight", () => {
      const result = resolveTemporalShortcut("since", "last_2_weeks", NOW);
      expect(result).toBe("2025-02-26T00:00:00.000Z");
    });

    it("singular: last_1_week", () => {
      const result = resolveTemporalShortcut("since", "last_1_week", NOW);
      expect(result).toBe("2025-03-05T00:00:00.000Z");
    });
  });

  describe("last_N_months", () => {
    it("last_1_month → 30 days ago midnight", () => {
      const result = resolveTemporalShortcut("since", "last_1_month", NOW);
      expect(result).toBe("2025-02-10T00:00:00.000Z");
    });

    it("last_3_months → 90 days ago midnight", () => {
      const result = resolveTemporalShortcut("since", "last_3_months", NOW);
      expect(result).toBe("2024-12-12T00:00:00.000Z");
    });
  });

  describe("pass-through (backwards compatibility)", () => {
    it("ISO date string passes through unchanged", () => {
      const iso = "2025-01-15T00:00:00.000Z";
      expect(resolveTemporalShortcut("since", iso, NOW)).toBe(iso);
    });

    it("partial ISO date passes through unchanged", () => {
      expect(resolveTemporalShortcut("since", "2025-01-15", NOW)).toBe(
        "2025-01-15",
      );
    });

    it("unrecognised string passes through unchanged", () => {
      expect(resolveTemporalShortcut("since", "next tuesday", NOW)).toBe(
        "next tuesday",
      );
    });

    it("empty string passes through unchanged", () => {
      expect(resolveTemporalShortcut("since", "", NOW)).toBe("");
    });
  });
});

describe("resolveTemporalParams", () => {
  it("resolves since:today", () => {
    const result = resolveTemporalParams({ since: "today" }, NOW);
    expect(result.since).toBe("2025-03-12T00:00:00.000Z");
    expect(result.until).toBeUndefined();
  });

  it("resolves both since and until", () => {
    const result = resolveTemporalParams(
      { since: "last_3_days", until: "today" },
      NOW,
    );
    expect(result.since).toBe("2025-03-09T00:00:00.000Z");
    expect(result.until).toBe("2025-03-13T00:00:00.000Z");
  });

  it("yesterday auto-fills until when omitted", () => {
    const result = resolveTemporalParams({ since: "yesterday" }, NOW);
    expect(result.since).toBe("2025-03-11T00:00:00.000Z");
    expect(result.until).toBe("2025-03-12T00:00:00.000Z");
  });

  it("yesterday does NOT auto-fill until when until is already provided", () => {
    const result = resolveTemporalParams(
      { since: "yesterday", until: "2025-03-12" },
      NOW,
    );
    expect(result.since).toBe("2025-03-11T00:00:00.000Z");
    expect(result.until).toBe("2025-03-12");
  });

  it("ISO dates pass through unchanged", () => {
    const result = resolveTemporalParams(
      { since: "2024-12-01", until: "2025-01-01" },
      NOW,
    );
    expect(result.since).toBe("2024-12-01");
    expect(result.until).toBe("2025-01-01");
  });

  it("undefined params remain undefined", () => {
    const result = resolveTemporalParams({}, NOW);
    expect(result.since).toBeUndefined();
    expect(result.until).toBeUndefined();
  });
});
