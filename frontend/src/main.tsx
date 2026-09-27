import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import "./desktop";
import { initializeSongLibrary } from "./library/useSongLibrary";
void initializeSongLibrary();

// StrictMode deliberately double-mounts in dev, which conflicts with Pixi.js's
// async init - Application.destroy() fires before init() resolves.
createRoot(document.getElementById("root")!).render(<App />);
