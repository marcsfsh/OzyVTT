import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./viewer/viewer-page.css";
import { ViewerApp } from "./viewer/ViewerApp";

createRoot(document.getElementById("viewer-root")!).render(<StrictMode><AppErrorBoundary><ViewerApp /></AppErrorBoundary></StrictMode>);
