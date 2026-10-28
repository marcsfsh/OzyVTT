import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTransparency } from "@vtt/ui";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installZoomGuard } from "./lib/zoom-guard";
import "@vtt/ui/styles.css";
import "./viewer/viewer-page.css";
import { ViewerApp } from "./viewer/ViewerApp";

installZoomGuard();
initTransparency();

createRoot(document.getElementById("viewer-root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ViewerApp />
    </AppErrorBoundary>
  </StrictMode>
);
