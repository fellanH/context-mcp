import React, { useState } from "react";
import type { VaultMode } from "@/shared/types";
import { DEFAULT_SETTINGS, LOCAL_DEFAULTS } from "@/shared/types";
import { WelcomeStep } from "./WelcomeStep";
import { ModeSelectStep } from "./ModeSelectStep";
import { ConnectStep } from "./ConnectStep";
import { DoneStep } from "./DoneStep";

type Step = "welcome" | "mode" | "connect" | "done";

export function Onboarding() {
  const [step, setStep] = useState<Step>("welcome");
  const [mode, setMode] = useState<VaultMode>("hosted");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SETTINGS.serverUrl);
  const [apiKey, setApiKey] = useState("");
  const [vaultPath, setVaultPath] = useState("");

  function handleModeSelect(m: VaultMode) {
    setMode(m);
    if (m === "local") {
      setServerUrl(LOCAL_DEFAULTS.serverUrl);
      setApiKey("");
      setVaultPath(LOCAL_DEFAULTS.vaultPath);
    } else {
      setServerUrl(DEFAULT_SETTINGS.serverUrl);
      setApiKey("");
      setVaultPath("");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      {step === "welcome" && <WelcomeStep onNext={() => setStep("mode")} />}
      {step === "mode" && (
        <ModeSelectStep
          mode={mode}
          onSelect={handleModeSelect}
          onNext={() => setStep("connect")}
        />
      )}
      {step === "connect" && (
        <ConnectStep
          mode={mode}
          serverUrl={serverUrl}
          apiKey={apiKey}
          vaultPath={vaultPath}
          onServerUrlChange={setServerUrl}
          onApiKeyChange={setApiKey}
          onVaultPathChange={setVaultPath}
          onConnected={() => setStep("done")}
        />
      )}
      {step === "done" && <DoneStep />}
    </div>
  );
}
