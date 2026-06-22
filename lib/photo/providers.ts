import { load, type ModelDefinition, type NSFWJS } from "nsfwjs/core";
import type * as tf from "@tensorflow/tfjs";
import { PHOTO_PRIVACY_CONFIG } from "./config";
import { resultFromPredictions, unavailableResult } from "./privacyPolicy";
import type { PhotoFrameSource, PhotoPrivacyProvider, PhotoPrivacyResult } from "./types";

type ModelGlobals = typeof globalThis & {
  model?: tf.io.ModelJSON;
  group1_shard1of1?: string;
};

const modelDefinition: ModelDefinition = {
  name: "MobileNetV2",
  numOfWeightBundles: 1,
  modelJson: async () => {
    const model = (globalThis as ModelGlobals).model;
    if (!model) throw new Error("model_manifest_missing");
    return { default: model };
  },
  weightBundles: [async () => {
    const weights = (globalThis as ModelGlobals).group1_shard1of1;
    if (!weights) throw new Error("model_weights_missing");
    return { default: weights };
  }]
};

async function importSameOriginAsset(path: string) {
  const url = new URL(path, globalThis.location?.origin ?? "http://localhost").href;
  await import(/* webpackIgnore: true */ url);
}

export class LocalModelPhotoPrivacyProvider implements PhotoPrivacyProvider {
  readonly id = "local_model" as const;
  private model?: NSFWJS;
  private loading?: Promise<void>;

  load() {
    if (this.model) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.loadModel().finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async loadModel() {
    await Promise.all([
      importSameOriginAsset(`${PHOTO_PRIVACY_CONFIG.modelAssetBase}/model.min.js`),
      importSameOriginAsset(`${PHOTO_PRIVACY_CONFIG.modelAssetBase}/group1-shard1of1.min.js`)
    ]);
    this.model = await load("MobileNetV2", { size: 224, modelDefinitions: [modelDefinition] });
  }

  async evaluate(frame: PhotoFrameSource): Promise<PhotoPrivacyResult> {
    if (!this.model) return unavailableResult("model_unavailable");
    const startedAt = performance.now();
    try {
      const predictions = await Promise.race([
        this.model.classify(frame as ImageData),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("inference_timeout")), PHOTO_PRIVACY_CONFIG.inferenceTimeoutMs))
      ]);
      return resultFromPredictions(predictions, Date.now(), performance.now() - startedAt);
    } catch {
      return unavailableResult("model_error");
    }
  }

  dispose() {
    this.model?.dispose();
    this.model = undefined;
    delete (globalThis as ModelGlobals).model;
    delete (globalThis as ModelGlobals).group1_shard1of1;
  }
}

export class UnavailablePhotoPrivacyProvider implements PhotoPrivacyProvider {
  readonly id = "unavailable" as const;
  async load() { throw new Error("privacy_guard_unavailable"); }
  async evaluate() { return unavailableResult("model_unavailable"); }
  dispose() {}
}

export class MockPhotoPrivacyProvider implements PhotoPrivacyProvider {
  readonly id = "mock" as const;
  readonly isDevelopmentSimulation = true;
  private index = 0;
  constructor(private readonly results: PhotoPrivacyResult[]) {}
  async load() {}
  async evaluate() {
    const result = this.results[Math.min(this.index, this.results.length - 1)] ?? unavailableResult("model_unavailable");
    this.index += 1;
    return { ...result, evaluatedAt: Date.now() };
  }
  dispose() {}
}
