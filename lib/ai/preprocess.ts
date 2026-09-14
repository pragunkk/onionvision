import * as ort from "onnxruntime-web";

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export function preprocessYOLO(
  source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number
): ort.Tensor {
  const targetSize = 640;
  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // 1. Fill background with neutral gray (standard YOLO padding)
  ctx.fillStyle = "#7F7F7F";
  ctx.fillRect(0, 0, targetSize, targetSize);

  // 2. Calculate scale to preserve aspect ratio
  const scale = Math.min(targetSize / sourceWidth, targetSize / sourceHeight);
  const newWidth = sourceWidth * scale;
  const newHeight = sourceHeight * scale;
  
  // 3. Center the image
  const dx = (targetSize - newWidth) / 2;
  const dy = (targetSize - newHeight) / 2;

  ctx.drawImage(source, dx, dy, newWidth, newHeight);
  
  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const { data } = imageData;

  const totalPixels = targetSize * targetSize;
  const float32Data = new Float32Array(3 * totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;
    float32Data[i] = r;                              
    float32Data[totalPixels + i] = g;                
    float32Data[2 * totalPixels + i] = b;            
  }

  return new ort.Tensor("float32", float32Data, [1, 3, targetSize, targetSize]);
}

export function preprocessEfficientNetCrop(
  sourceCanvas: HTMLCanvasElement,
  bbox: [number, number, number, number] // [x1, y1, x2, y2] in source coordinates
): { tensor: ort.Tensor; cropCanvas: HTMLCanvasElement } {
  const [x1, y1, x2, y2] = bbox;
  const cropWidth = Math.max(1, x2 - x1);
  const cropHeight = Math.max(1, y2 - y1);

  // 1. Extract crop and resize to 224x224
  const targetSize = 224;
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = targetSize;
  cropCanvas.height = targetSize;
  const ctx = cropCanvas.getContext("2d", { willReadFrequently: true })!;

  ctx.drawImage(
    sourceCanvas,
    x1, y1, cropWidth, cropHeight, // Source crop rectangle
    0, 0, targetSize, targetSize   // Destination square
  );

  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const { data } = imageData;

  const totalPixels = targetSize * targetSize;
  const float32Data = new Float32Array(3 * totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;

    float32Data[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    float32Data[totalPixels + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    float32Data[2 * totalPixels + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }

  const tensor = new ort.Tensor("float32", float32Data, [1, 3, targetSize, targetSize]);
  return { tensor, cropCanvas };
}