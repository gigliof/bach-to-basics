import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// StrictMode deliberately double-mounts in dev, which conflicts with Pixi.js's
// async init - Application.destroy() fires before init() resolves.
createRoot(document.getElementById("root")!).render(<App />);
