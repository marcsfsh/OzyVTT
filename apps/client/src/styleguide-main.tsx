import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@vtt/ui/styles.css";
import "./styleguide/styleguide.css";
import { StyleGuide } from "./styleguide/StyleGuide";

createRoot(document.getElementById("styleguide-root")!).render(
  <StrictMode>
    <StyleGuide />
  </StrictMode>
);
