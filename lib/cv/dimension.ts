export interface MeasurementResult {
  diameterMm: number;
  qrDetected: boolean;
  ratioPxToMm?: number;
}

export interface OnionDimensions {
  diameterMm: number;
  circlePx: { cx: number; cy: number; radius: number } | null;
}

const QR_PHYSICAL_SIZE_MM = 50.0;

export function calculateReferenceRatio(fullFrameCanvas: HTMLCanvasElement): number | null {
  const cv = (window as any).cv;
  if (!cv) throw new Error("OpenCV not loaded");

  let src = cv.imread(fullFrameCanvas);
  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  let qrcode = new cv.QRCodeDetector();
  let points = new cv.Mat();
  
  const found = qrcode.detect(gray, points);

  if (found && !points.empty()) {
    const pt0 = { x: points.floatPtr(0, 0)[0], y: points.floatPtr(0, 0)[1] };
    const pt1 = { x: points.floatPtr(0, 1)[0], y: points.floatPtr(0, 1)[1] };
    const qrWidthPx = Math.sqrt(Math.pow(pt1.x - pt0.x, 2) + Math.pow(pt1.y - pt0.y, 2));
    
    src.delete(); gray.delete(); qrcode.delete(); points.delete();
    return QR_PHYSICAL_SIZE_MM / qrWidthPx; 
  }

  src.delete(); gray.delete(); qrcode.delete(); points.delete();
  return null;
}

export function estimateOnionDiameter(
  cropCanvas: HTMLCanvasElement, 
  ratioPxToMm: number
): OnionDimensions {
  const cv = (window as any).cv;
  
  let src = cv.imread(cropCanvas);
  let gray = new cv.Mat();
  let blur = new cv.Mat();
  let thresh = new cv.Mat();
  
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
  cv.threshold(blur, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let largestArea = 0;
  let targetContour = null;

  for (let i = 0; i < contours.size(); i++) {
    let cnt = contours.get(i);
    let area = cv.contourArea(cnt);
    if (area > largestArea) {
      largestArea = area;
      targetContour = cnt;
    }
  }

  let diameterPx = 0;
  let circlePx = null;

  if (targetContour) {
    let circle = cv.minEnclosingCircle(targetContour);
    diameterPx = circle.radius * 2;
    // Save the center (x,y) and radius relative to this specific YOLO crop
    circlePx = { cx: circle.center.x, cy: circle.center.y, radius: circle.radius };
  } else {
    diameterPx = cropCanvas.width;
  }

  src.delete(); gray.delete(); blur.delete(); thresh.delete();
  contours.delete(); hierarchy.delete();

  return {
    diameterMm: diameterPx * ratioPxToMm,
    circlePx: circlePx
  };
}