import { modelManager } from "./modelManager";
import { preprocessYOLO, preprocessEfficientNetCrop } from "./preprocess";
import { postprocessYOLO, postprocessEfficientNet, DetectionBox, ClassificationResult } from "./postprocess";
import { GradingResult } from "../grading/engine";

export interface ScoredOnion {
  bbox: [number, number, number, number];
  detectionConfidence: number;
  classification: ClassificationResult;
  cropCanvas: HTMLCanvasElement;
  diameterMm: number;
  grading?: GradingResult; // <--- Add this
}

export async function runInferencePipeline(
  sourceCanvas: HTMLCanvasElement,
  confThreshold: number = 0.35
): Promise<ScoredOnion[]> {
  const yoloSession = modelManager.getYOLO();
  const efficientNetSession = modelManager.getEfficientNet();

  // 1. Detect onions with YOLO
// 1. Detect onions with YOLO
  const yoloInputTensor = preprocessYOLO(sourceCanvas, sourceCanvas.width, sourceCanvas.height);  const yoloInputName = yoloSession.inputNames[0]; 
  const yoloOutputs = await yoloSession.run({ [yoloInputName]: yoloInputTensor });
  const yoloOutputTensor = yoloOutputs[yoloSession.outputNames[0]];

  const detections: DetectionBox[] = postprocessYOLO(
    yoloOutputTensor.data as Float32Array,
    sourceCanvas.width,
    sourceCanvas.height,
    confThreshold,
    0.45,
    yoloOutputTensor.dims
  );

  const results: ScoredOnion[] = [];

  // 2. Crop each detected onion & classify
  for (const det of detections) {
    const { tensor: cropTensor, cropCanvas } = preprocessEfficientNetCrop(
      sourceCanvas,
      det.bbox
    );

    const effInputName = efficientNetSession.inputNames[0]; 
    const effOutputs = await efficientNetSession.run({ [effInputName]: cropTensor });
    const logits = effOutputs[efficientNetSession.outputNames[0]].data as Float32Array;

    const classification = postprocessEfficientNet(logits);

    results.push({
      bbox: det.bbox,
      detectionConfidence: det.confidence,
      classification,
      cropCanvas, 
      diameterMm: 0,
    });
  }

  return results;
}