import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { detectLocalPort } from "./app/lib/api";
import "./styles/index.css";

// Detect ?local=PORT before React renders (stores in sessionStorage, strips param)
detectLocalPort();

createRoot(document.getElementById("root")!).render(<App />);
