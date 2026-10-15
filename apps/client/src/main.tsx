import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@vtt/ui";
import "@vtt/ui/styles.css";
import "./styles.css";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { App } from "./shell/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AppErrorBoundary>
  </StrictMode>
);
