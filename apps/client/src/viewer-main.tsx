import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ViewerApp } from "./viewer/ViewerApp";

createRoot(document.getElementById("viewer-root")!).render(<StrictMode><ViewerApp /></StrictMode>);
