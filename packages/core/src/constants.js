export const APP_URL = "https://app.context-vault.com";
export const API_URL = "https://api.context-vault.com";
export const MARKETING_URL = "https://contextvault.dev";
export const GITHUB_ISSUES_URL =
  "https://github.com/fellanH/context-vault/issues";

export const MAX_BODY_LENGTH = 100 * 1024; // 100KB
export const MAX_TITLE_LENGTH = 500;
export const MAX_KIND_LENGTH = 64;
export const MAX_TAG_LENGTH = 100;
export const MAX_TAGS_COUNT = 20;
export const MAX_META_LENGTH = 10 * 1024; // 10KB
export const MAX_SOURCE_LENGTH = 200;
export const MAX_IDENTITY_KEY_LENGTH = 200;

export const DEFAULT_GROWTH_THRESHOLDS = {
  totalEntries: { warn: 1000, critical: 5000 },
  eventEntries: { warn: 500, critical: 2000 },
  vaultSizeBytes: { warn: 50 * 1024 * 1024, critical: 200 * 1024 * 1024 },
  eventsWithoutTtl: { warn: 200 },
};
