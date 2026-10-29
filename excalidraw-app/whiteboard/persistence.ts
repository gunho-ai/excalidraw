import { createStore, get, set } from "idb-keyval";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

/**
 * Local scene for the bare whiteboard. IndexedDB so a long handwriting
 * session is not capped by localStorage. A reload reads this back.
 */
const store = createStore("excalidraw-whiteboard", "scene");
const SCENE_KEY = "scene";

export type PersistedWhiteboard = {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  scrollX: number;
  scrollY: number;
  zoom: number;
};

export const loadWhiteboard = async (): Promise<PersistedWhiteboard | null> => {
  try {
    const saved = await get<PersistedWhiteboard>(SCENE_KEY, store);
    if (!saved || !Array.isArray(saved.elements)) {
      return null;
    }
    return saved;
  } catch (error) {
    console.error("whiteboard: failed to load scene", error);
    return null;
  }
};

export const saveWhiteboard = async (
  scene: PersistedWhiteboard,
): Promise<void> => {
  try {
    await set(SCENE_KEY, scene, store);
  } catch (error) {
    console.error("whiteboard: failed to save scene", error);
  }
};
