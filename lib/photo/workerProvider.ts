import { LocalModelPhotoPrivacyProvider, MockPhotoPrivacyProvider, UnavailablePhotoPrivacyProvider } from "./providers";
import { unavailableResult } from "./privacyPolicy";
import type { PhotoFrameSource, PhotoPrivacyProvider, PhotoPrivacyResult } from "./types";

type Pending = { resolve: (result: PhotoPrivacyResult) => void; timeout: ReturnType<typeof setTimeout> };

export class WorkerPhotoPrivacyProvider implements PhotoPrivacyProvider {
  readonly id = "local_model" as const;
  private worker?: Worker;
  private fallback?: LocalModelPhotoPrivacyProvider;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private loadPromise?: Promise<void>;

  async load() {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.supportsWorkerPath() ? this.loadWorker() : this.loadFallback();
    return this.loadPromise;
  }

  private supportsWorkerPath() {
    return typeof Worker !== "undefined" && typeof createImageBitmap === "function" && typeof OffscreenCanvas !== "undefined";
  }

  private loadWorker() {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL("./photoPrivacy.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      const timeout = window.setTimeout(() => reject(new Error("privacy_guard_load_timeout")), 15_000);
      worker.onmessage = (event: MessageEvent<{ type: string; id?: number; result?: PhotoPrivacyResult }>) => {
        if (event.data.type === "loaded") {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (event.data.type === "load_error") {
          window.clearTimeout(timeout);
          reject(new Error("privacy_guard_unavailable"));
          return;
        }
        if (event.data.type === "result" && typeof event.data.id === "number" && event.data.result) {
          const pending = this.pending.get(event.data.id);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pending.delete(event.data.id);
          pending.resolve(event.data.result);
        }
      };
      worker.onerror = () => reject(new Error("privacy_guard_worker_error"));
      worker.postMessage({ type: "load" });
    });
  }

  private async loadFallback() {
    this.fallback = new LocalModelPhotoPrivacyProvider();
    await this.fallback.load();
  }

  async evaluate(frame: PhotoFrameSource) {
    if (this.fallback) return this.fallback.evaluate(frame);
    if (!this.worker || typeof createImageBitmap !== "function") return unavailableResult("model_unavailable");
    try {
      const bitmap = await createImageBitmap(frame as ImageBitmapSource);
      const id = ++this.sequence;
      return await new Promise<PhotoPrivacyResult>((resolve) => {
        const timeout = setTimeout(() => {
          this.pending.delete(id);
          bitmap.close();
          resolve(unavailableResult("model_error"));
        }, 8_000);
        this.pending.set(id, { resolve, timeout });
        this.worker?.postMessage({ type: "evaluate", id, bitmap }, [bitmap]);
      });
    } catch {
      return unavailableResult("frame_invalid");
    }
  }

  dispose() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.resolve(unavailableResult("model_error"));
    }
    this.pending.clear();
    this.worker?.postMessage({ type: "dispose" });
    this.worker?.terminate();
    this.worker = undefined;
    this.fallback?.dispose();
    this.fallback = undefined;
    this.loadPromise = undefined;
  }
}

export function createProductionPhotoPrivacyProvider(): PhotoPrivacyProvider {
  if (typeof window === "undefined") return new UnavailablePhotoPrivacyProvider();
  if (process.env.NODE_ENV !== "production") {
    const simulated = new URL(window.location.href).searchParams.get("photoPrivacyMock");
    if (simulated === "allowed" || simulated === "blocked" || simulated === "uncertain") {
      const result: PhotoPrivacyResult = {
        decision: simulated,
        reasonCode: simulated === "allowed" ? "clear" : simulated === "blocked" ? "potentially_intimate" : "low_confidence",
        evaluatedAt: Date.now(),
        modelVersion: "development-simulation"
      };
      return new MockPhotoPrivacyProvider([result]);
    }
  }
  return new WorkerPhotoPrivacyProvider();
}
