import * as ort from "onnxruntime-web";

class ModelManager {
  private static instance: ModelManager;
  private yoloSession: ort.InferenceSession | null = null;
  private efficientNetSession: ort.InferenceSession | null = null;
  private isInitializing = false;

  private constructor() {
    // 1. Point to the local directory containing .wasm AND .mjs files
    ort.env.wasm.wasmPaths = "/onnx-wasm/";
    ort.env.wasm.proxy = false;
    
    // 2. Force single-threading to prevent crossOriginIsolated security errors
    ort.env.wasm.numThreads = 1;
  }

  public static getInstance(): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager();
    }
    return ModelManager.instance;
  }

  public async initModels(onProgress?: (msg: string) => void): Promise<void> {
    if (this.yoloSession && this.efficientNetSession) return;
    if (this.isInitializing) return;

    this.isInitializing = true;

    // 3. Force WASM execution provider (most stable for offline browser edge)
    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    };

    try {
      if (!this.yoloSession) {
        onProgress?.("Loading YOLO11n detector...");
        this.yoloSession = await ort.InferenceSession.create(
          "/models/yolo11n_best.onnx",
          options
        );
      }

      if (!this.efficientNetSession) {
        onProgress?.("Loading EfficientNet-B0 classifier...");
        this.efficientNetSession = await ort.InferenceSession.create(
          "/models/efficientnet_b0_onion_best.onnx",
          options
        );
      }

      onProgress?.("Models loaded & cached in IndexedDB");
    } catch (err) {
      console.error("Failed to initialize ONNX sessions:", err);
      onProgress?.("Failed to load models. Check console.");
    } finally {
      this.isInitializing = false;
    }
  }

  public getYOLO(): ort.InferenceSession {
    if (!this.yoloSession) throw new Error("YOLO model not initialized. Call initModels() first.");
    return this.yoloSession;
  }

  public getEfficientNet(): ort.InferenceSession {
    if (!this.efficientNetSession) throw new Error("EfficientNet model not initialized. Call initModels() first.");
    return this.efficientNetSession;
  }
}

export const modelManager = ModelManager.getInstance();