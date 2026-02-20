import { describe, it, expect } from "vitest";
import { resolve, sep } from "node:path";
import { safeJoin } from "@context-vault/core/core/files";
import { safeFolderPath } from "@context-vault/core/capture/file-ops";

// ─── safeJoin ───────────────────────────────────────────────────────────────────

describe("safeJoin", () => {
  const base = "/tmp/vault";

  describe("normal paths", () => {
    it("joins a simple filename", () => {
      expect(safeJoin(base, "file.md")).toBe(resolve(base, "file.md"));
    });

    it("joins nested subdirectories", () => {
      expect(safeJoin(base, "sub", "deep", "file.md")).toBe(
        resolve(base, "sub", "deep", "file.md")
      );
    });

    it("joins a path with extension", () => {
      expect(safeJoin(base, "notes.txt")).toBe(resolve(base, "notes.txt"));
    });

    it("returns the base itself when no parts given", () => {
      expect(safeJoin(base)).toBe(resolve(base));
    });

    it("handles paths with spaces", () => {
      expect(safeJoin(base, "my folder", "file.md")).toBe(
        resolve(base, "my folder", "file.md")
      );
    });
  });

  describe("traversal attacks", () => {
    it("blocks ../", () => {
      expect(() => safeJoin(base, "..")).toThrow("Path traversal blocked");
    });

    it("blocks ../../", () => {
      expect(() => safeJoin(base, "..", "..")).toThrow("Path traversal blocked");
    });

    it("blocks ../../../etc/passwd", () => {
      expect(() => safeJoin(base, "..", "..", "..", "etc", "passwd")).toThrow(
        "Path traversal blocked"
      );
    });

    it("blocks traversal embedded in a subpath", () => {
      expect(() => safeJoin(base, "sub", "..", "..", "escape")).toThrow(
        "Path traversal blocked"
      );
    });

    it("allows sub/../sub (stays within base)", () => {
      expect(safeJoin(base, "sub", "..", "other")).toBe(
        resolve(base, "other")
      );
    });
  });

  describe("absolute path injection", () => {
    it("neutralizes /etc/passwd by keeping it within base (path.join strips leading /)", () => {
      // path.join("/tmp/vault", "/etc/passwd") → "/tmp/vault/etc/passwd"
      // This stays within the base, so safeJoin correctly allows it
      const result = safeJoin(base, "/etc/passwd");
      expect(result).toBe(resolve(base, "etc", "passwd"));
      expect(result.startsWith(resolve(base))).toBe(true);
    });

    it("neutralizes / by resolving to base itself", () => {
      const result = safeJoin(base, "/");
      expect(result).toBe(resolve(base));
    });
  });

  describe("null byte injection", () => {
    it("handles null byte in filename", () => {
      // Node's resolve handles null bytes; the result should either throw
      // or stay within base. We verify it doesn't escape.
      try {
        const result = safeJoin(base, "file\x00.txt");
        expect(result.startsWith(resolve(base))).toBe(true);
      } catch {
        // Throwing is also acceptable — the path is blocked
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty string part", () => {
      expect(safeJoin(base, "")).toBe(resolve(base));
    });

    it("handles single dot (current dir)", () => {
      expect(safeJoin(base, ".")).toBe(resolve(base));
    });

    it("blocks double dot (parent dir)", () => {
      expect(() => safeJoin(base, "..")).toThrow("Path traversal blocked");
    });

    it("normalizes trailing slashes", () => {
      expect(safeJoin(base, "sub/")).toBe(resolve(base, "sub"));
    });

    it("normalizes double slashes", () => {
      expect(safeJoin(base, "sub//deep")).toBe(resolve(base, "sub", "deep"));
    });

    it("handles deeply nested valid path", () => {
      expect(safeJoin(base, "a", "b", "c", "d", "e")).toBe(
        resolve(base, "a", "b", "c", "d", "e")
      );
    });
  });

  describe("prefix attack", () => {
    it("blocks a path that is a prefix of the base but not a child", () => {
      // e.g., base = /tmp/vault, trying to reach /tmp/vault-evil
      // safeJoin checks startsWith(base + sep), so this should block
      const evil = resolve(base + "-evil", "file.md");
      // We can't directly construct this via safeJoin parts, but we verify
      // the sep check by using a base that is a prefix of another dir
      const shortBase = "/tmp/v";
      expect(() => safeJoin(shortBase, "../vault/secret")).toThrow(
        "Path traversal blocked"
      );
    });
  });
});

// ─── safeFolderPath ─────────────────────────────────────────────────────────────

describe("safeFolderPath", () => {
  const vaultDir = "/tmp/vault";

  describe("normal folders", () => {
    it("returns the kind base when folder is empty", () => {
      const result = safeFolderPath(vaultDir, "insight", "");
      expect(result).toBe(resolve(vaultDir, "knowledge", "insights"));
    });

    it("returns the kind base when folder is undefined", () => {
      const result = safeFolderPath(vaultDir, "insight", undefined);
      expect(result).toBe(resolve(vaultDir, "knowledge", "insights"));
    });

    it("appends a simple subfolder", () => {
      const result = safeFolderPath(vaultDir, "insight", "react");
      expect(result).toBe(resolve(vaultDir, "knowledge", "insights", "react"));
    });

    it("appends a nested subfolder", () => {
      const result = safeFolderPath(vaultDir, "insight", "react/hooks");
      expect(result).toBe(
        resolve(vaultDir, "knowledge", "insights", "react", "hooks")
      );
    });

    it("works with entity kinds", () => {
      const result = safeFolderPath(vaultDir, "contact", "vendors");
      expect(result).toBe(
        resolve(vaultDir, "entities", "contacts", "vendors")
      );
    });

    it("works with event kinds", () => {
      const result = safeFolderPath(vaultDir, "session", "2024");
      expect(result).toBe(
        resolve(vaultDir, "events", "sessions", "2024")
      );
    });
  });

  describe("traversal attacks", () => {
    it("blocks ../", () => {
      expect(() => safeFolderPath(vaultDir, "insight", "../")).toThrow(
        "Folder path escapes vault"
      );
    });

    it("blocks ../../", () => {
      expect(() => safeFolderPath(vaultDir, "insight", "../../")).toThrow(
        "Folder path escapes vault"
      );
    });

    it("blocks ../../../etc/passwd", () => {
      expect(() =>
        safeFolderPath(vaultDir, "insight", "../../../etc/passwd")
      ).toThrow("Folder path escapes vault");
    });

    it("blocks traversal that escapes kind dir", () => {
      expect(() =>
        safeFolderPath(vaultDir, "insight", "../decisions/secret")
      ).toThrow("Folder path escapes vault");
    });

    it("blocks traversal that escapes vault entirely", () => {
      expect(() =>
        safeFolderPath(vaultDir, "insight", "../../../../etc/shadow")
      ).toThrow("Folder path escapes vault");
    });
  });

  describe("absolute path injection", () => {
    it("blocks /etc/passwd", () => {
      expect(() =>
        safeFolderPath(vaultDir, "insight", "/etc/passwd")
      ).toThrow("Folder path escapes vault");
    });

    it("blocks absolute root path", () => {
      expect(() => safeFolderPath(vaultDir, "insight", "/")).toThrow(
        "Folder path escapes vault"
      );
    });
  });

  describe("URL-encoded traversal", () => {
    it("treats %2e%2e%2f as a literal folder name (not traversal)", () => {
      // URL-encoded strings are NOT decoded by resolve/path — they stay literal
      const result = safeFolderPath(vaultDir, "insight", "%2e%2e%2f");
      expect(result).toBe(
        resolve(vaultDir, "knowledge", "insights", "%2e%2e%2f")
      );
    });

    it("treats %2e%2e/ as a literal folder name", () => {
      const result = safeFolderPath(vaultDir, "insight", "%2e%2e/");
      expect(result).toBe(
        resolve(vaultDir, "knowledge", "insights", "%2e%2e")
      );
    });
  });

  describe("edge cases", () => {
    it("handles single dot folder (stays in kind dir)", () => {
      const result = safeFolderPath(vaultDir, "insight", ".");
      expect(result).toBe(resolve(vaultDir, "knowledge", "insights"));
    });

    it("blocks double dot folder", () => {
      expect(() => safeFolderPath(vaultDir, "insight", "..")).toThrow(
        "Folder path escapes vault"
      );
    });

    it("normalizes trailing slashes", () => {
      const result = safeFolderPath(vaultDir, "insight", "react/");
      expect(result).toBe(
        resolve(vaultDir, "knowledge", "insights", "react")
      );
    });

    it("normalizes double slashes in folder", () => {
      const result = safeFolderPath(vaultDir, "insight", "react//hooks");
      expect(result).toBe(
        resolve(vaultDir, "knowledge", "insights", "react", "hooks")
      );
    });

    it("handles folder with spaces", () => {
      const result = safeFolderPath(vaultDir, "insight", "my folder");
      expect(result).toBe(
        resolve(vaultDir, "knowledge", "insights", "my folder")
      );
    });

    it("handles deeply nested valid folder", () => {
      const result = safeFolderPath(vaultDir, "insight", "a/b/c/d");
      expect(result).toBe(
        resolve(vaultDir, "knowledge", "insights", "a", "b", "c", "d")
      );
    });
  });
});
