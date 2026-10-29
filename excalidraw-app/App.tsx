/**
 * Barebone pen whiteboard.
 *
 * The page is a white sheet. Freedraw is locked on load (it does not revert
 * to selection after a stroke). There is no visible UI.
 *
 * Keyboard
 * - Draw with the pen or mouse. Stroke is black, medium width, pressure-sensitive.
 * - Eraser: the pen's eraser end (Pointer Events button 5), or E / 0.
 * - Undo: Ctrl/Cmd+Z. Redo: Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y.
 * - Download PNG (scene embedded), SVG, and scene JSON: Ctrl/Cmd+Shift+S.
 *
 * `window.whiteboard` (set once the editor is ready)
 * - getScene() → { elements, appState, files, json }
 * - exportPNG() → Promise<Blob>  white background, scene embedded in the PNG
 * - exportSVG() → Promise<Blob>
 * - exportJSON() → Blob          .excalidraw scene
 * - download() → Promise<void>   saves all three
 *
 * The scene is stored in localStorage (`excalidraw`, `excalidraw-state`) and
 * restored on reload. Pen settings below are reapplied on every load.
 */
import { useCallback, useEffect, useRef } from "react";

import { EVENT, ROUGHNESS } from "@excalidraw/common";
import { isInitializedImageElement } from "@excalidraw/element";
import {
  Excalidraw,
  exportScene,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { cleanAppStateForExport } from "@excalidraw/excalidraw/appState";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

import type {
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import { LocalData } from "./data/LocalData";
import { importFromLocalStorage } from "./data/localStorage";

import "./index.scss";

/** Pure black on pure white. Excalidraw's palette black is #1e1e1e. */
const INK = "#000000";
const PAPER = "#ffffff";

/**
 * Locked freedraw, not the controlled `activeTool` prop.
 * The controlled prop blocks the pen's eraser button (Pointer Events button 5).
 * `locked` keeps the pen selected after a stroke and still lets the eraser
 * take over for one gesture, then return.
 */
const PEN_TOOL: AppState["activeTool"] = {
  type: "freedraw",
  customType: null,
  locked: true,
  fromSelection: false,
  lastActiveTool: null,
};

const penAppState = {
  viewBackgroundColor: PAPER,
  gridModeEnabled: false,
  theme: "light" as const,
  // On before the first pointer event, so a resting palm cannot draw.
  penMode: true,
  penDetected: true,
  currentItemStrokeColor: INK,
  // Freedraw "medium" is a 1px centerline, rendered ~4.25px and thinned by
  // pressure. That is a thin-to-medium handwriting stroke on a 4K pen display
  // at typical OS scaling (150–200%).
  currentItemStrokeWidthKey: "medium" as const,
  // Real pen pressure drives width. A mouse (pressure 0.5) still simulates it.
  currentItemStrokeVariability: "variable" as const,
  // Freedraw is filled by perfect-freehand, not roughjs. Architect roughness
  // keeps any restored non-pen elements from looking sketched.
  currentItemRoughness: ROUGHNESS.architect,
  currentItemStrokeStyle: "solid" as const,
  currentItemOpacity: 100,
  showWelcomeScreen: false,
  zenModeEnabled: false,
  viewModeEnabled: false,
  openMenu: null,
  openSidebar: null,
  openDialog: null,
  exportBackground: true,
  exportWithDarkMode: false,
  activeTool: PEN_TOOL,
};

const loadInitialData = (): ExcalidrawInitialDataState => {
  const local = importFromLocalStorage();
  const elements = restoreElements(local.elements, null, {
    repairBindings: true,
    deleteInvisibleElements: true,
  });
  const restored = restoreAppState(local.appState, null);

  return {
    elements,
    appState: {
      ...restored,
      ...penAppState,
      // Keep the viewport so a reload returns to the same part of the sheet.
      scrollX: restored.scrollX,
      scrollY: restored.scrollY,
      zoom: restored.zoom,
    },
  };
};

const exportScale = () =>
  Math.max(1, Math.min(window.devicePixelRatio || 1, 3));

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const filenameStamp = () => {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const createWhiteboard = (api: ExcalidrawImperativeAPI) => {
  const read = () => {
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    return { elements, appState, files };
  };

  const exportData = () => {
    const { elements, appState, files } = read();
    return {
      elements,
      appState: cleanAppStateForExport(appState),
      files,
    };
  };

  const exportPNG = () =>
    exportScene({
      type: "png",
      data: exportData(),
      config: {
        canvasBackgroundColor: PAPER,
        embedScene: true,
        theme: "light",
        scale: exportScale(),
      },
    });

  const exportSVG = async () => {
    const svg = await exportScene({
      type: "svg",
      data: exportData(),
      config: {
        canvasBackgroundColor: PAPER,
        theme: "light",
      },
    });
    return new Blob([svg.outerHTML], { type: "image/svg+xml" });
  };

  const exportJSON = () => {
    const { elements, appState, files } = read();
    return new Blob([serializeAsJSON(elements, appState, files, "local")], {
      type: "application/json",
    });
  };

  return {
    getScene: () => {
      const { elements, appState, files } = read();
      return {
        elements,
        appState,
        files,
        json: serializeAsJSON(elements, appState, files, "local"),
      };
    },
    exportPNG,
    exportSVG,
    exportJSON,
    download: async () => {
      const name = `whiteboard-${filenameStamp()}`;
      const [png, svg] = await Promise.all([exportPNG(), exportSVG()]);
      saveBlob(png, `${name}.png`);
      saveBlob(svg, `${name}.svg`);
      saveBlob(exportJSON(), `${name}.excalidraw`);
    },
  };
};

const isHistoryKey = (event: KeyboardEvent) => {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.altKey) {
    return false;
  }
  const key = event.key.toLowerCase();
  return key === "z" || (key === "y" && !event.shiftKey);
};

const isEraserKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  return event.key.toLowerCase() === "e" || event.key === "0";
};

/**
 * Tool shortcuts (R, V, P, …) stay in the editor even with the toolbar gone.
 * Swallow them so the locked pen is not replaced. Undo, redo, and the eraser
 * key still reach Excalidraw.
 */
const onKeyDownCapture = (event: KeyboardEvent) => {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (mod && event.shiftKey && !event.altKey && key === "s") {
    event.preventDefault();
    event.stopPropagation();
    void window.whiteboard?.download();
    return;
  }

  if (!isHistoryKey(event) && !isEraserKey(event) && key !== "escape") {
    event.stopPropagation();
    if (mod && key === "s") {
      event.preventDefault();
    }
  }
};

const blockBrowserGesture = (event: Event) => {
  event.preventDefault();
};

const blockBrowserZoom = (event: WheelEvent) => {
  // Trackpad pinch is delivered as ctrl+wheel. The canvas already consumes
  // wheel input; this stops the browser from zooming the page around it.
  if (event.ctrlKey) {
    event.preventDefault();
  }
};

const ExcalidrawApp = () => {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const initialDataRef = useRef<ExcalidrawInitialDataState | null>(null);
  if (!initialDataRef.current) {
    initialDataRef.current = loadInitialData();
  }

  useEffect(() => {
    const ownerDocument = document;
    ownerDocument.addEventListener("contextmenu", blockBrowserGesture);
    ownerDocument.addEventListener("gesturestart", blockBrowserGesture);
    ownerDocument.addEventListener("selectstart", blockBrowserGesture);
    ownerDocument.addEventListener("wheel", blockBrowserZoom, {
      passive: false,
    });
    ownerDocument.addEventListener("touchmove", blockBrowserGesture, {
      passive: false,
    });
    window.addEventListener("keydown", onKeyDownCapture, true);

    const onUnload = () => {
      LocalData.flushSave();
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, onUnload);

    return () => {
      ownerDocument.removeEventListener("contextmenu", blockBrowserGesture);
      ownerDocument.removeEventListener("gesturestart", blockBrowserGesture);
      ownerDocument.removeEventListener("selectstart", blockBrowserGesture);
      ownerDocument.removeEventListener("wheel", blockBrowserZoom);
      ownerDocument.removeEventListener("touchmove", blockBrowserGesture);
      window.removeEventListener("keydown", onKeyDownCapture, true);
      window.removeEventListener(EVENT.BEFORE_UNLOAD, onUnload);
    };
  }, []);

  const onExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI | null) => {
    apiRef.current = api;
    if (!api) {
      delete window.whiteboard;
      return;
    }

    window.whiteboard = createWhiteboard(api);

    const fileIds: FileId[] = [];
    for (const element of api.getSceneElements()) {
      if (isInitializedImageElement(element)) {
        fileIds.push(element.fileId);
      }
    }
    if (!fileIds.length) {
      return;
    }
    LocalData.fileStorage.getFiles(fileIds).then(({ loadedFiles }) => {
      if (loadedFiles.length && !api.isDestroyed) {
        api.addFiles(loadedFiles);
      }
    });
  }, []);

  const onChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      if (!LocalData.isSavePaused()) {
        LocalData.save(elements, appState, files, () => {
          // Images are not part of this board. Nothing to mark saved.
        });
      }
    },
    [],
  );

  return (
    <Excalidraw
      className="whiteboard"
      initialData={initialDataRef.current}
      onChange={onChange}
      onExcalidrawAPI={onExcalidrawAPI}
      UIOptions={{ canvasActions: { export: false, saveAsImage: false } }}
      ui={false}
      aiEnabled={false}
      theme="light"
      gridModeEnabled={false}
      objectsSnapModeEnabled={false}
      renderScrollbars={false}
      detectScroll={false}
      handleKeyboardGlobally={true}
      autoFocus={true}
      name="Whiteboard"
      langCode="en"
    />
  );
};

export default ExcalidrawApp;
