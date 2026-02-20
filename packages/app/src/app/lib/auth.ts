import { createContext, useContext } from "react";
import type { User, VaultMode } from "./types";

export interface AuthState {
  user: User | null;
  token: string | null;
  vaultMode: VaultMode;
  isAuthenticated: boolean;
  isLoading: boolean;
  localServerDown: boolean;
  loginWithApiKey: (key: string) => Promise<void>;
  loginWithLocalVault: (vaultDir: string) => Promise<void>;
  register: (email: string, name?: string) => Promise<{ apiKey: string }>;
  logout: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

const STORAGE_KEY = "context-vault-auth";

export function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}
