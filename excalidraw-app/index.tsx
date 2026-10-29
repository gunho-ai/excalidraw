import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import WhiteboardApp from "./whiteboard/WhiteboardApp";

performance.mark("excalidraw:app-start");

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <WhiteboardApp />
  </StrictMode>,
);
