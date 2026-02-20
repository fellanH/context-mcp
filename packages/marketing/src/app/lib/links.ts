const rawBaseUrl = import.meta.env.VITE_APP_BASE_URL || "";
const normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, "");

export const docsQuickstartUrl =
  "https://github.com/fellanH/context-vault/blob/main/docs/distribution/connect-in-2-minutes.md";

export function appHref(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedBaseUrl ? `${normalizedBaseUrl}${normalizedPath}` : normalizedPath;
}
