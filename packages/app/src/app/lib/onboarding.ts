import type { OnboardingStep, VaultMode } from "./types";

const DISMISSED_KEY = "context-vault-onboarding-dismissed";

interface OnboardingInputs {
  isAuthenticated: boolean;
  vaultMode: VaultMode;
  entriesUsed: number;
  hasApiKey: boolean;
  hasMcpActivity: boolean;
}

export function getOnboardingSteps({
  isAuthenticated,
  vaultMode,
  entriesUsed,
  hasApiKey,
  hasMcpActivity,
}: OnboardingInputs): OnboardingStep[] {
  if (vaultMode === "local") {
    return [
      {
        id: "connect-folder",
        label: "Locate your vault",
        completed: isAuthenticated,
        description: "Local mode is active for this dashboard session",
        actionLabel: "Connected",
      },
      {
        id: "connect-tools",
        label: "Connect AI tools",
        completed: hasMcpActivity,
        description: "Configure your AI tools to use Context Vault",
        action: "copy-connect-command",
        actionLabel: "Copy command",
      },
      {
        id: "first-entry",
        label: "Save your first entry",
        completed: entriesUsed > 0,
        action: "/vault/knowledge",
        actionLabel: "Add entry",
      },
      {
        id: "install-extension",
        label: "Install Chrome extension",
        completed: false,
        description: "Search your vault from ChatGPT, Claude, and Gemini",
        action: "chrome-web-store-link",
        actionLabel: "Install",
      },
      {
        id: "go-hosted",
        label: "Create a cloud account",
        completed: false,
        description: "Sync & backup your vault across devices",
        action: "/register",
        actionLabel: "Sign up",
      },
    ];
  }

  return [
    {
      id: "sign-in",
      label: "Sign in",
      completed: isAuthenticated,
      actionLabel: "Sign in",
      action: "/login",
    },
    {
      id: "connect-tools",
      label: "Connect AI tools",
      completed: hasMcpActivity,
      description: "Auto-configure all your AI tools with one command",
      action: "copy-connect-command",
      actionLabel: "Copy command",
    },
    {
      id: "first-entry",
      label: "Save your first entry",
      completed: entriesUsed > 0,
      action: "/vault/knowledge",
      actionLabel: "Add entry",
    },
    {
      id: "install-extension",
      label: "Install Chrome extension",
      completed: false,
      description: "Search your vault from ChatGPT, Claude, and Gemini",
      action: "chrome-web-store-link",
      actionLabel: "Install",
    },
  ];
}

export function isOnboardingDismissed(): boolean {
  return localStorage.getItem(DISMISSED_KEY) === "true";
}

export function dismissOnboarding() {
  localStorage.setItem(DISMISSED_KEY, "true");
}

export function resetOnboarding() {
  localStorage.removeItem(DISMISSED_KEY);
}
