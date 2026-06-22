/// <reference lib="webworker" />

import { LocalModelPhotoPrivacyProvider } from "./providers";

const scope = self as DedicatedWorkerGlobalScope;
const provider = new LocalModelPhotoPrivacyProvider();
let loaded = false;

scope.onmessage = async (event: MessageEvent<{ type: "load" | "evaluate" | "dispose"; id?: number; bitmap?: ImageBitmap }>) => {
  const { type, id, bitmap } = event.data;
  if (type === "dispose") {
    provider.dispose();
    scope.close();
    return;
  }
  if (type === "load") {
    try {
      await provider.load();
      loaded = true;
      scope.postMessage({ type: "loaded" });
    } catch {
      scope.postMessage({ type: "load_error" });
    }
    return;
  }
  if (type !== "evaluate" || !bitmap || typeof id !== "number") return;
  try {
    if (!loaded) throw new Error("model_not_loaded");
    const canvas = new OffscreenCanvas(224, 224);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas_unavailable");
    context.drawImage(bitmap, 0, 0, 224, 224);
    bitmap.close();
    const pixels = context.getImageData(0, 0, 224, 224);
    const result = await provider.evaluate(pixels);
    context.clearRect(0, 0, 224, 224);
    pixels.data.fill(0);
    scope.postMessage({ type: "result", id, result });
  } catch {
    bitmap.close();
    scope.postMessage({ type: "result", id, result: { decision: "uncertain", reasonCode: "model_error", evaluatedAt: Date.now() } });
  }
};

export {};
