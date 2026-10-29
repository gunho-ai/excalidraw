import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import ExcalidrawApp from "./App";

// Leave render throttling off. The host app used to set
// EXCALIDRAW_THROTTLE_RENDER, which delays a frame of ink on a pen display.

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Whiteboard root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>,
);
