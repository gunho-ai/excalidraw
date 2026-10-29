import "@excalidraw/excalidraw/global";
import "@excalidraw/excalidraw/css";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type WhiteboardScene = ReturnType<ExcalidrawImperativeAPI["getSceneElements"]>;

interface WhiteboardApi {
  /** Elements, editor state, files, and the scene as Excalidraw JSON. */
  getScene: () => {
    elements: WhiteboardScene;
    appState: ReturnType<ExcalidrawImperativeAPI["getAppState"]>;
    files: ReturnType<ExcalidrawImperativeAPI["getFiles"]>;
    json: string;
  };
  /** PNG of the drawing. The Excalidraw scene is embedded in the file. */
  exportPNG: () => Promise<Blob>;
  /** SVG of the drawing on a white background. */
  exportSVG: () => Promise<Blob>;
  /** Scene JSON (`.excalidraw`). */
  exportJSON: () => Blob;
  /** Download PNG, SVG, and JSON. Also bound to Ctrl/Cmd+Shift+S. */
  download: () => Promise<void>;
}

declare global {
  interface Window {
    __EXCALIDRAW_SHA__: string | undefined;
    whiteboard?: WhiteboardApi;
  }
}
