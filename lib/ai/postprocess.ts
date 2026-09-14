export const CLASS_NAMES = ["healthy", "mold", "rotten", "sprouted"] as const;
export type OnionClass = (typeof CLASS_NAMES)[number];

export interface ClassificationResult {
  classId: number;
  label: OnionClass;
  confidence: number;
  probabilities: number[];
}

export interface DetectionBox {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  confidence: number;
}

export function softmax(logits: Float32Array | number[]): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] > max) max = logits[i];
  }

  const exp = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    exp[i] = Math.exp(logits[i] - max);
    sum += exp[i];
  }

  const probs = new Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    probs[i] = exp[i] / sum;
  }
  return probs;
}

export function postprocessEfficientNet(logits: Float32Array): ClassificationResult {
  const probabilities = softmax(logits);
  
  let bestId = 0;
  let maxProb = -Infinity;

  for (let i = 0; i < probabilities.length; i++) {
    if (probabilities[i] > maxProb) {
      maxProb = probabilities[i];
      bestId = i;
    }
  }

  return {
    classId: bestId,
    label: CLASS_NAMES[bestId],
    confidence: maxProb,
    probabilities,
  };
}

export function postprocessYOLO(
  output: Float32Array,
  originalWidth: number,
  originalHeight: number,
  confThreshold: number = 0.35,
  iouThreshold: number = 0.45
): DetectionBox[] {
  const numCandidates = 8400; 

  // 1. Calculate the exact same scaling and padding used in preprocessing
  const scale = Math.min(640 / originalWidth, 640 / originalHeight);
  const padX = (640 - originalWidth * scale) / 2;
  const padY = (640 - originalHeight * scale) / 2;

  const boxes: DetectionBox[] = [];

  for (let i = 0; i < numCandidates; i++) {
    const confidence = output[4 * numCandidates + i];
    if (confidence >= confThreshold) {
      // 2. Reverse the letterbox math to get true original coordinates
      const cx = (output[0 * numCandidates + i] - padX) / scale;
      const cy = (output[1 * numCandidates + i] - padY) / scale;
      const w = output[2 * numCandidates + i] / scale;
      const h = output[3 * numCandidates + i] / scale;

      const x1 = Math.max(0, cx - w / 2);
      const y1 = Math.max(0, cy - h / 2);
      const x2 = Math.min(originalWidth, cx + w / 2);
      const y2 = Math.min(originalHeight, cy + h / 2);

      boxes.push({ bbox: [x1, y1, x2, y2], confidence });
    }
  }

  boxes.sort((a, b) => b.confidence - a.confidence);

  const finalDetections: DetectionBox[] = [];
  while (boxes.length > 0) {
    const current = boxes.shift()!;
    finalDetections.push(current);
    for (let j = boxes.length - 1; j >= 0; j--) {
      if (calculateIoU(current.bbox, boxes[j].bbox) > iouThreshold) {
        boxes.splice(j, 1);
      }
    }
  }
  return finalDetections;
}

function calculateIoU(boxA: [number, number, number, number], boxB: [number, number, number, number]): number {
  const xA = Math.max(boxA[0], boxB[0]);
  const yA = Math.max(boxA[1], boxB[1]);
  const xB = Math.min(boxA[2], boxB[2]);
  const yB = Math.min(boxA[3], boxB[3]);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
  const boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);

  return interArea / (boxAArea + boxBArea - interArea);
}