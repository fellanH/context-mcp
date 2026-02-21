import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import {
  transformEntry,
  transformSearchResult,
  transformApiKey,
  transformUsage,
  transformTeam,
  transformTeamMember,
  transformTeamInvite,
} from "./types";
import type {
  Entry,
  SearchResult,
  ApiKey,
  UsageResponse,
  ApiEntry,
  ApiSearchResult,
  ApiKeyListItem,
  ApiUsageResponse,
  ApiVaultStatusResponse,
  ApiTeamListResponse,
  ApiTeamDetailResponse,
  ApiTeamUsageResponse,
  Category,
} from "./types";

// ─── Entries ─────────────────────────────────────────────────────────────────

interface UseEntriesOpts {
  category?: Category;
  kind?: string;
  offset?: number;
  limit?: number;
}

export function useEntries({
  category,
  kind,
  offset = 0,
  limit = 20,
}: UseEntriesOpts = {}) {
  return useQuery({
    queryKey: ["entries", { category, kind, offset, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (kind && kind !== "all") params.set("kind", kind);
      params.set("offset", String(offset));
      params.set("limit", String(limit));

      const raw = await api.get<{ entries: ApiEntry[]; total: number }>(
        `/vault/entries?${params}`,
      );
      return {
        entries: raw.entries.map(transformEntry),
        total: raw.total,
      };
    },
  });
}

export function useEntry(id: string | null) {
  return useQuery({
    queryKey: ["entry", id],
    queryFn: async () => {
      const raw = await api.get<ApiEntry>(`/vault/entries/${id}`);
      return transformEntry(raw);
    },
    enabled: !!id,
  });
}

export function useCreateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      kind: string;
      title: string;
      body: string;
      tags?: string[];
    }) => api.post<ApiEntry>("/vault/entries", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ deleted: boolean }>(`/vault/entries/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

// ─── Search ──────────────────────────────────────────────────────────────────

interface SearchOpts {
  query: string;
  category?: string;
  limit?: number;
}

export function useSearch() {
  return useMutation({
    mutationFn: async (opts: SearchOpts) => {
      const body: Record<string, unknown> = {
        query: opts.query,
        limit: opts.limit || 20,
      };
      if (opts.category && opts.category !== "all")
        body.category = opts.category;

      const raw = await api.post<{
        results: ApiSearchResult[];
        count: number;
        query: string;
      }>("/vault/search", body);
      return {
        results: raw.results.map(transformSearchResult),
        count: raw.count,
        query: raw.query,
      };
    },
  });
}

// ─── API Keys ────────────────────────────────────────────────────────────────

export function useApiKeys() {
  return useQuery({
    queryKey: ["apiKeys"],
    queryFn: async () => {
      const raw = await api.get<{ keys: ApiKeyListItem[] }>("/keys");
      return raw.keys.map(transformApiKey);
    },
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<{ id: string; key: string; prefix: string; name: string }>(
        "/keys",
        { name },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: boolean }>(`/keys/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });
}

// ─── Usage / Billing ─────────────────────────────────────────────────────────

export function useUsage() {
  const apiKeys = useApiKeys();

  return useQuery({
    queryKey: ["usage"],
    queryFn: async () => {
      const raw = await api.get<ApiUsageResponse>("/billing/usage");
      const keyCount = apiKeys.data?.length ?? 0;
      return transformUsage(raw, keyCount);
    },
  });
}

export function useRawUsage() {
  return useQuery({
    queryKey: ["rawUsage"],
    queryFn: () => api.get<ApiUsageResponse>("/billing/usage"),
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (opts?: { successUrl?: string; cancelUrl?: string }) =>
      api.post<{ url: string; sessionId: string }>("/billing/checkout", opts),
  });
}

// ─── Account ─────────────────────────────────────────────────────────────────

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => api.del<{ deleted: boolean }>("/account"),
  });
}

// ─── Import / Export ─────────────────────────────────────────────────────────

export function useImportEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.post<{ id: string }>("/vault/import", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["usage"] });
    },
  });
}

export function useExportVault() {
  return useQuery({
    queryKey: ["export"],
    queryFn: () => api.get<{ entries: ApiEntry[] }>("/vault/export"),
    enabled: false, // manual trigger only
  });
}

// ─── Vault Status ────────────────────────────────────────────────────────────

interface VaultStatusOpts {
  enabled?: boolean;
  refetchInterval?: number;
}

export function useVaultStatus(opts: VaultStatusOpts = {}) {
  return useQuery({
    queryKey: ["vaultStatus"],
    queryFn: () => api.get<ApiVaultStatusResponse>("/vault/status"),
    ...opts,
  });
}

// ─── Teams ──────────────────────────────────────────────────────────────────

export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const raw = await api.get<ApiTeamListResponse>("/teams");
      return raw.teams.map(transformTeam);
    },
  });
}

export function useTeam(id: string | null) {
  return useQuery({
    queryKey: ["team", id],
    queryFn: async () => {
      const raw = await api.get<ApiTeamDetailResponse>(`/teams/${id}`);
      return {
        id: raw.id,
        name: raw.name,
        tier: raw.tier,
        role: raw.role,
        createdAt: new Date(raw.createdAt),
        members: raw.members.map(transformTeamMember),
        invites: raw.invites.map(transformTeamInvite),
      };
    },
    enabled: !!id,
  });
}

export function useTeamUsage(id: string | null) {
  return useQuery({
    queryKey: ["teamUsage", id],
    queryFn: () => api.get<ApiTeamUsageResponse>(`/teams/${id}/usage`),
    enabled: !!id,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<{ id: string; name: string; role: string }>("/teams", { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, email }: { teamId: string; email: string }) =>
      api.post<{ id: string; token: string; email: string; expiresAt: string }>(
        `/teams/${teamId}/invite`,
        { email },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["team", vars.teamId] });
    },
  });
}

export function useJoinTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, token }: { teamId: string; token: string }) =>
      api.post<{ joined: boolean; teamId: string; role: string }>(
        `/teams/${teamId}/join`,
        { token },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
      api.del<{ removed: boolean; userId: string }>(
        `/teams/${teamId}/members/${userId}`,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["team", vars.teamId] });
      qc.invalidateQueries({ queryKey: ["teamUsage", vars.teamId] });
    },
  });
}
