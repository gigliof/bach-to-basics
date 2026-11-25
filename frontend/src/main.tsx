import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { restoreLastDocument } from "./store/useAppStore";

// StrictMode deliberately double-mounts in dev, which conflicts with Pixi.js's
// async init - Application.destroy() fires before init() resolves.
createRoot(document.getElementById("root")!).render(<App />);

// Reopen the song from the previous visit, if any
restoreLastDocument().catch(console.warn);
