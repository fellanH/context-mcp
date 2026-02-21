import React from "react";
import { createRoot } from "react-dom/client";
import { Onboarding } from "./components/Onboarding";
import "../styles/index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Onboarding />
  </React.StrictMode>,
);
