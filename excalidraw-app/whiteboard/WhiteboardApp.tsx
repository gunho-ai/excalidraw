import {
  CaptureUpdateAction,
  Excalidraw,
  exportScene,
  getNonDeletedElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { useCallback, useEffect, useRef } from "react";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { loadWhiteboard, saveWhiteboard } from "./persistence";

import "./whiteboard.css";

/**
 * Bare whiteboard.
 *
 * The sheet is a pure white canvas. Freedraw is selected on load and locked,
 * so a stroke does not fall back to the selection tool. Pen mode is on from
 * the first frame: touch (palm) is ignored, while mouse and pen still draw.
 * Real pen pressure drives stroke width (`currentItemStrokeVariability:
 * "variable"`). Roughness 0 keeps the ink smooth instead of sketchy.
 *
 * Agents (no visible UI):
 *   window.whiteboard.exportPng()   -> Promise<Blob>   drawing, white bg
 *   window.whiteboard.exportSvg()   -> Promise<string>
 *   window.whiteboard.exportJson()  -> string          Excalidraw scene JSON
 *   window.whiteboard.exportViewportPng() -> Promise<Blob>  visible sheet
 *   window.whiteboard.downloadPng() / downloadSvg() / downloadJson()
 *   window.whiteboard.getScene()    -> { elements, appState, files }
 *   window.whiteboard.clear()
 *
 * Keyboard (no visible UI):
 *   Ctrl/Cmd+Z              undo
 *   Ctrl/Cmd+Shift+Z        redo   (Ctrl/Cmd+Y also redoes)
 *   E  or  0                toggle eraser; E again returns to the pen
 *   pen eraser button       erases while held, then the pen returns
 *   Ctrl/Cmd+Shift+E        download PNG
 *   Ctrl/Cmd+Shift+S        download SVG
 *   Ctrl/Cmd+Shift+J        download scene JSON
 *
 * The drawing is stored in IndexedDB (`excalidraw-whiteboard` / `scene`)
 * and restored on reload.
 */

const STROKE = "#000000";
const PAPER = "#ffffff";

const PEN_APP_STATE = {
  viewBackgroundColor: PAPER,
  theme: "light" as const,
  gridModeEnabled: false,
  zenModeEnabled: false,
  viewModeEnabled: false,
  showWelcomeScreen: false,
  currentItemStrokeColor: STROKE,
  currentItemBackgroundColor: "transparent",
  currentItemStrokeWidthKey: "medium" as const,
  currentItemStrokeStyle: "solid" as const,
  currentItemRoughness: 0,
  currentItemStrokeVariability: "variable" as const,
  currentItemOpacity: 100,
  penMode: true,
  exportBackground: true,
  exportWithDarkMode: false,
  objectsSnapModeEnabled: false,
  showHints: false,
  openMenu: null,
  openSidebar: null,
  openDialog: null,
  openPopup: null,
  toast: null,
  errorMessage: null,
  selectedElementIds: {},
  activeTool: {
    type: "freedraw" as const,
    customType: null,
    locked: true,
    fromSelection: false,
    lastActiveTool: null,
  },
};

type SceneSnapshot = {
  elements: readonly NonDeletedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
};

export type WhiteboardApi = {
  exportPng: () => Promise<Blob>;
  exportSvg: () => Promise<string>;
  exportJson: () => string;
  exportViewportPng: () => Promise<Blob>;
  downloadPng: () => Promise<void>;
  downloadSvg: () => Promise<void>;
  downloadJson: () => void;
  getScene: () => SceneSnapshot;
  clear: () => void;
};

declare global {
  interface Window {
    whiteboard?: WhiteboardApi;
  }
}

const exportScale = () => {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(3, Math.max(1, Math.round(dpr)));
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const requireApi = (api: ExcalidrawImperativeAPI | null) => {
  if (!api) {
    throw new Error("whiteboard: editor is not ready");
  }
  return api;
};

const WhiteboardApp = () => {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const readyRef = useRef(false);
  const latestRef = useRef<SceneSnapshot | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const latest = latestRef.current;
    if (!readyRef.current || !latest) {
      return;
    }
    const { elements, appState, files } = latest;
    void saveWhiteboard({
      elements,
      files,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom.value,
    });
  }, []);

  const scheduleSave = useCallback(
    (snapshot: SceneSnapshot) => {
      if (!readyRef.current) {
        return;
      }
      latestRef.current = snapshot;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(flushSave, 300);
    },
    [flushSave],
  );

  const readScene = useCallback((): SceneSnapshot => {
    const api = requireApi(apiRef.current);
    return {
      elements: getNonDeletedElements(api.getSceneElements()),
      appState: api.getAppState(),
      files: api.getFiles(),
    };
  }, []);

  const exportPng = useCallback(async () => {
    const { elements, appState, files } = readScene();
    const blob = await exportScene({
      type: "png",
      data: { elements, appState, files },
      config: {
        canvasBackgroundColor: PAPER,
        padding: 32,
        scale: exportScale(),
        embedScene: true,
      },
    });
    return blob;
  }, [readScene]);

  const exportViewportPng = useCallback(async () => {
    const { elements, appState, files } = readScene();
    const zoom = appState.zoom.value || 1;
    const blob = await exportScene({
      type: "png",
      data: { elements, appState, files },
      config: {
        canvasBackgroundColor: PAPER,
        x: -appState.scrollX,
        y: -appState.scrollY,
        width: appState.width / zoom,
        height: appState.height / zoom,
        fit: "none",
        padding: 0,
        scale: exportScale(),
      },
    });
    return blob;
  }, [readScene]);

  const exportSvg = useCallback(async () => {
    const { elements, appState, files } = readScene();
    const svg = await exportScene({
      type: "svg",
      data: { elements, appState, files },
      config: {
        canvasBackgroundColor: PAPER,
        padding: 32,
      },
    });
    return new XMLSerializer().serializeToString(svg);
  }, [readScene]);

  const exportJson = useCallback(() => {
    const { elements, appState, files } = readScene();
    return serializeAsJSON(elements, appState, files, "local");
  }, [readScene]);

  const downloadPng = useCallback(async () => {
    downloadBlob(await exportPng(), "whiteboard.png");
  }, [exportPng]);

  const downloadSvg = useCallback(async () => {
    const svg = await exportSvg();
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "whiteboard.svg");
  }, [exportSvg]);

  const downloadJson = useCallback(() => {
    downloadBlob(
      new Blob([exportJson()], { type: "application/json" }),
      "whiteboard.excalidraw",
    );
  }, [exportJson]);

  const clear = useCallback(() => {
    const api = requireApi(apiRef.current);
    api.updateScene({
      elements: [],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.setActiveTool({ type: "freedraw", locked: true });
  }, []);

  useEffect(() => {
    const api: WhiteboardApi = {
      exportPng,
      exportSvg,
      exportJson,
      exportViewportPng,
      downloadPng,
      downloadSvg,
      downloadJson,
      getScene: readScene,
      clear,
    };
    window.whiteboard = api;
    return () => {
      if (window.whiteboard === api) {
        delete window.whiteboard;
      }
    };
  }, [
    clear,
    downloadJson,
    downloadPng,
    downloadSvg,
    exportJson,
    exportPng,
    exportSvg,
    exportViewportPng,
    readScene,
  ]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        flushSave();
      }
    };
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onHide);
      flushSave();
    };
  }, [flushSave]);

  useEffect(() => {
    const prevent = (event: Event) => {
      event.preventDefault();
    };
    const passiveFalse = { passive: false } as const;
    document.addEventListener("gesturestart", prevent, passiveFalse);
    document.addEventListener("gesturechange", prevent, passiveFalse);
    document.addEventListener("gestureend", prevent, passiveFalse);
    document.addEventListener("contextmenu", prevent);
    document.addEventListener("selectstart", prevent);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod && (event.key === "?" || event.key === "F1")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!mod || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "e" && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void downloadPng();
        return;
      }
      if (key === "s" && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void downloadSvg();
        return;
      }
      if (key === "j" && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        downloadJson();
        return;
      }
      // Block the editor's save / open / clear-canvas dialogs.
      if (
        ((key === "s" || key === "o") && !event.shiftKey) ||
        event.key === "Backspace" ||
        event.key === "Delete"
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
      document.removeEventListener("gestureend", prevent);
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("selectstart", prevent);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [downloadJson, downloadPng, downloadSvg]);

  const initialData = useCallback(async () => {
    const saved = await loadWhiteboard();
    return {
      elements: saved?.elements ?? [],
      files: saved?.files,
      appState: {
        ...PEN_APP_STATE,
        scrollX: saved?.scrollX ?? 0,
        scrollY: saved?.scrollY ?? 0,
        zoom: {
          value: (saved?.zoom ?? 1) as AppState["zoom"]["value"],
        },
      },
    };
  }, []);

  const keepPen = (appState: AppState) => {
    const api = apiRef.current;
    if (!api || !readyRef.current) {
      return;
    }
    const tool = appState.activeTool.type;
    if (
      appState.newElement == null &&
      tool !== "eraser" &&
      (tool !== "freedraw" || !appState.activeTool.locked)
    ) {
      api.setActiveTool({ type: "freedraw", locked: true });
    }
    if (
      appState.viewBackgroundColor !== PAPER ||
      appState.currentItemStrokeColor !== STROKE ||
      appState.currentItemRoughness !== 0 ||
      appState.currentItemStrokeWidthKey !== "medium" ||
      appState.currentItemStrokeVariability !== "variable" ||
      !appState.penMode ||
      appState.theme !== "light" ||
      appState.gridModeEnabled
    ) {
      api.updateScene({
        appState: {
          viewBackgroundColor: PAPER,
          currentItemStrokeColor: STROKE,
          currentItemRoughness: 0,
          currentItemStrokeWidthKey: "medium",
          currentItemStrokeVariability: "variable",
          penMode: true,
          theme: "light",
          gridModeEnabled: false,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  };

  return (
    <Excalidraw
      ui={false}
      theme="light"
      gridModeEnabled={false}
      aiEnabled={false}
      autoFocus={true}
      detectScroll={false}
      handleKeyboardGlobally={true}
      renderScrollbars={false}
      name="Whiteboard"
      initialData={initialData}
      UIOptions={{
        canvasActions: {
          export: false,
          saveAsImage: false,
          loadScene: false,
          saveToActiveFile: false,
          toggleTheme: false,
          changeViewBackgroundColor: false,
          clearCanvas: false,
        },
        tools: { image: false },
      }}
      onExcalidrawAPI={(api) => {
        apiRef.current = api;
      }}
      onInitialize={() => {
        readyRef.current = true;
      }}
      onChange={(elements, appState, files) => {
        keepPen(appState);
        scheduleSave({
          elements: getNonDeletedElements(elements),
          appState,
          files,
        });
      }}
    />
  );
};

export default WhiteboardApp;
