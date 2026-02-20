import { useState, useCallback, useMemo, useEffect } from "react";
import {
  AuthContext,
  type AuthState,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
} from "../lib/auth";
import { api, ApiError, isLocalConnection, getLocalPort } from "../lib/api";
import { transformUser } from "../lib/types";
import type {
  User,
  VaultMode,
  ApiUserResponse,
  ApiRegisterResponse,
} from "../lib/types";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [localServerDown, setLocalServerDown] = useState(false);

  // On mount: revalidate stored token, or detect local mode (no auth required)
  useEffect(() => {
    const storedToken = getStoredToken();

    // When opened via ?local=PORT, API calls already go to localhost
    // Try /api/me — works without token in local mode
    api
      .get<ApiUserResponse>("/me")
      .then((raw) => {
        const u = transformUser(raw);
        setUser(u);
        // Local mode: no token needed; use "local" so isAuthenticated is true
        if (!storedToken && raw.userId === "local") {
          setStoredToken("local");
          setToken("local");
        } else if (storedToken) {
          setToken(storedToken);
        } else {
          setToken("local");
        }
      })
      .catch((err) => {
        // If we're in local-via-hosted mode and the local server isn't running,
        // show a helpful message instead of redirecting to login
        if (isLocalConnection() && !(err instanceof ApiError)) {
          setLocalServerDown(true);
          return;
        }
        if (storedToken) {
          clearStoredToken();
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const loginWithApiKey = useCallback(async (key: string) => {
    setStoredToken(key);
    setToken(key);
    try {
      const raw = await api.get<ApiUserResponse>("/me");
      setUser(transformUser(raw));
    } catch (err) {
      clearStoredToken();
      setToken(null);
      setUser(null);
      throw err;
    }
  }, []);

  const loginWithLocalVault = useCallback(async (vaultDir: string) => {
    if (vaultDir.trim()) {
      const raw = await api.post<ApiUserResponse>("/local/connect", {
        vaultDir: vaultDir.trim(),
      });
      setStoredToken("local");
      setToken("local");
      setUser(transformUser(raw));
    } else {
      const raw = await api.get<ApiUserResponse>("/me");
      setStoredToken("local");
      setToken("local");
      setUser(transformUser(raw));
    }
  }, []);

  const register = useCallback(async (email: string, name?: string) => {
    const raw = await api.post<ApiRegisterResponse>("/register", {
      email,
      name,
    });

    // Store the API key as auth token
    setStoredToken(raw.apiKey.key);
    setToken(raw.apiKey.key);
    setUser({
      id: raw.userId,
      email: raw.email,
      tier: raw.tier,
      name: name || undefined,
      createdAt: new Date(),
    });

    return { apiKey: raw.apiKey.key };
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
  }, []);

  const vaultMode: VaultMode = user?.id === "local" ? "local" : "hosted";

  const value: AuthState = useMemo(
    () => ({
      user,
      token,
      vaultMode,
      isAuthenticated: !!token && !!user,
      isLoading,
      localServerDown,
      loginWithApiKey,
      loginWithLocalVault,
      register,
      logout,
    }),
    [
      user,
      token,
      vaultMode,
      isLoading,
      localServerDown,
      loginWithApiKey,
      loginWithLocalVault,
      register,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
