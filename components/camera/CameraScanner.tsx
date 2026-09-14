"use client";

import React, { useEffect, useRef, useState } from "react";
import { modelManager } from "@/lib/ai/modelManager";
import { runInferencePipeline, ScoredOnion } from "@/lib/ai/pipeline";
import { useOpenCV } from "@/lib/cv/useOpenCV";
import { calculateReferenceRatio, estimateOnionDiameter } from "@/lib/cv/dimension";
import { determineProcurementGrade, GradingResult } from "@/lib/grading/engine";
import { useBatchStore } from "@/lib/store/useBatchStore";
import BatchDashboard from "@/components/dashboard/BatchDashboard";

const CLASS_BADGE_COLORS: Record<string, string> = {
  healthy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  mold: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  rotten: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  sprouted: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export default function CameraScanner() {
  const { addOnions } = useBatchStore();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const isOpenCvLoaded = useOpenCV();

  const [isModelLoading, setIsModelLoading] = useState(true);
  const [modelStatus, setModelStatus] = useState("Initializing inference engine...");
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scoredOnions, setScoredOnions] = useState<ScoredOnion[]>([]);
  const [inferenceTimeMs, setInferenceTimeMs] = useState<number | null>(null);
  const [measurementRatio, setMeasurementRatio] = useState<number | null>(null);

  // 1. Initialize ONNX models on mount
  useEffect(() => {
    let isMounted = true;
    async function loadModels() {
      try {
        await modelManager.initModels((status) => {
          if (isMounted) setModelStatus(status);
        });

        if (isMounted) {
          setIsModelLoading(false);
          setModelStatus("Models loaded & cached in IndexedDB");
        }
      } catch (err) {
        console.error("Failed to load ONNX models:", err);
        if (isMounted) setModelStatus("Failed to load models. Check console.");
      }
    }

    loadModels();
    return () => {
      isMounted = false;
      stopCamera();
    };
  }, []);

  // 2. Camera Controls
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment", // Use mobile rear camera if available
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch (err) {
      console.error("Camera access denied or unavailable:", err);
      alert("Unable to access camera. Please test using the image upload option.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
  };

  // 3. Draw Bounding Boxes on Overlay Canvas
  const drawDetections = (
    onions: ScoredOnion[],
    targetWidth: number,
    targetHeight: number
  ) => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    overlay.width = targetWidth;
    overlay.height = targetHeight;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, targetWidth, targetHeight);

    onions.forEach((onion, idx) => {
      const [x1, y1, x2, y2] = onion.bbox;
      const w = x2 - x1;
      const h = y2 - y1;
      const { label, confidence } = onion.classification;

      // Box styling based on health
      const color =
        label === "healthy"
          ? "#10b981"
          : label === "rotten"
          ? "#f43f5e"
          : label === "mold"
          ? "#f59e0b"
          : "#a855f7";

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, w, h);

      // Label background & text
      const text = `#${idx + 1} ${label.toUpperCase()} (${(confidence * 100).toFixed(0)}%)`;
      ctx.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
      const textMetrics = ctx.measureText(text);
      const textHeight = 18;
      const padding = 6;

      ctx.fillStyle = color;
      ctx.fillRect(
        x1,
        Math.max(0, y1 - textHeight - padding),
        textMetrics.width + padding * 2,
        textHeight + padding
      );

      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x1 + padding, Math.max(textHeight, y1 - padding));
    });
  };

  // 4. Run Edge Inference on Captured Frame / Image
  const processFrame = async () => {
    if (
      !canvasRef.current ||
      isProcessing ||
      isModelLoading ||
      !isOpenCvLoaded
    )
      return;
    setIsProcessing(true);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      setIsProcessing(false);
      return;
    }

    // Transfer current video frame to canvas
    if (cameraActive && videoRef.current) {
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 640;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    }

    const t0 = performance.now();
    try {
      // 1. Calculate physical reference from QR marker
      let currentRatio = measurementRatio;
      if (!currentRatio) {
        currentRatio = calculateReferenceRatio(canvasRef.current);
        if (currentRatio) setMeasurementRatio(currentRatio);
      }

      // 2. Run AI Inference (YOLO + EfficientNet)
      const results = await runInferencePipeline(canvasRef.current, 0.35);

      // 3. Append physical diameters using OpenCV Contour isolation
      const resultsWithDimensions = results.map((onion) => {
        let diameter = 0;
        if (currentRatio) {
          diameter = estimateOnionDiameter(onion.cropCanvas, currentRatio);
        }

        // Calculate the official grade
        const grading = determineProcurementGrade(onion.classification, diameter);

        return { ...onion, diameterMm: diameter, grading };
      });

      const t1 = performance.now();
      if (canvasRef.current) {
        setInferenceTimeMs(Math.round(t1 - t0));
        setScoredOnions(resultsWithDimensions);
        drawDetections(resultsWithDimensions, canvas.width, canvas.height);

        // Push results to the cumulative batch
        addOnions(resultsWithDimensions);
      }
    } catch (err) {
      console.error("Pipeline inference failed:", err);
    } finally {
      if (canvasRef.current) setIsProcessing(false);
    }
  };

  // 5. Desktop File Upload Handler for immediate testing
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    stopCamera();

    // Process each image one by one to avoid canvas race conditions
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = async () => {
          if (!canvasRef.current) return resolve();
          
          const canvas = canvasRef.current;
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) ctx.drawImage(img, 0, 0);

          // Run inference and wait for it to finish before loading the next image
          await processFrame(); 
          resolve();
        };
        img.src = URL.createObjectURL(file);
      });
    }

    // Reset the input value so the user can select the same files again if needed
    e.target.value = "";
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      {/* Top Status Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-neutral-900/80 border border-neutral-800 p-4 rounded-xl backdrop-blur-md">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
            Edge Pipeline Inspector
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isModelLoading ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
              }`}
            />
          </h2>
          <p className="text-xs text-neutral-400 mt-0.5">{modelStatus}</p>
        </div>

        {inferenceTimeMs !== null && (
          <div className="text-right">
            <span className="text-xs uppercase tracking-wider text-neutral-500 font-mono">
              Latency
            </span>
            <p className="text-sm font-mono font-medium text-neutral-200">
              {inferenceTimeMs} ms
            </p>
          </div>
        )}
      </div>

      {/* Main Viewport */}
      <div className="relative aspect-video w-full bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden flex items-center justify-center shadow-2xl">
        {/* Hidden internal video element */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`w-full h-full object-contain ${
            cameraActive ? "block" : "hidden"
          }`}
        />

        {/* Working Base Canvas */}
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-contain ${
            !cameraActive ? "block" : "hidden"
          }`}
        />

        {/* Bounding Box Overlay Canvas */}
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        />

        {!cameraActive && scoredOnions.length === 0 && (
          <div className="text-center p-6 space-y-3 z-10">
            <div className="inline-flex p-3 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400">
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0118.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <p className="text-sm text-neutral-400">
              Start the camera or upload a test onion image
            </p>
          </div>
        )}

        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-20">
            <div className="flex items-center gap-3 bg-neutral-900 border border-neutral-700 px-4 py-2.5 rounded-lg shadow-xl">
              <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-neutral-200 font-medium">
                Inferring (YOLO + EfficientNet)...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Control Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!cameraActive ? (
            <button
              onClick={startCamera}
              disabled={isModelLoading}
              className="px-4 py-2 bg-neutral-100 hover:bg-white text-neutral-950 text-sm font-medium rounded-lg disabled:opacity-50 transition"
            >
              Start Camera
            </button>
          ) : (
            <button
              onClick={stopCamera}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-medium rounded-lg transition"
            >
              Stop Camera
            </button>
          )}

          {cameraActive && (
            <button
              onClick={processFrame}
              disabled={isProcessing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition shadow-lg shadow-emerald-900/20"
            >
              Capture & Inspect
            </button>
          )}
        </div>

        <div>
          <label className="cursor-pointer px-4 py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Upload Test Photo
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isModelLoading}
            />
          </label>
        </div>
      </div>

      {/* Inference Results Inspector */}
      {scoredOnions.length > 0 && (
        <div className="space-y-3 pt-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 font-mono">
            Detected Onions ({scoredOnions.length})
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {scoredOnions.map((onion, i) => {
              const { label, confidence, probabilities } = onion.classification;
              return (
                <div
                  key={i}
                  className="bg-neutral-900/60 border border-neutral-800 p-3.5 rounded-xl space-y-3 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-neutral-400">
                      ID #{i + 1}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-md border font-medium uppercase tracking-wider ${
                        CLASS_BADGE_COLORS[label] ||
                        "bg-neutral-800 text-neutral-300 border-neutral-700"
                      }`}
                    >
                      {label}
                    </span>
                  </div>

                  <div className="space-y-1 font-mono text-xs">
                    <div className="flex justify-between text-neutral-300">
                      <span>Conf:</span>
                      <span className="font-semibold">
                        {(confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-neutral-500 text-[11px]">
                      <span>BBox:</span>
                      <span>
                        [{onion.bbox.map((n) => Math.round(n)).join(", ")}]
                      </span>
                    </div>
                  </div>

                  {/* Micro probability breakdown bars */}
                  <div className="space-y-1 pt-1 border-t border-neutral-800 text-[11px]">
                    {["healthy", "mold", "rotten", "sprouted"].map(
                      (c, cIdx) => (
                        <div
                          key={c}
                          className="flex items-center justify-between text-neutral-400"
                        >
                          <span className="capitalize">{c}</span>
                          <span>
                            {((probabilities[cIdx] || 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Render the cumulative batch analytics at the bottom */}
      <BatchDashboard />
    </div>
  );
}