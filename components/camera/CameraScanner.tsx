"use client";

import React, { useEffect, useRef, useState } from "react";
import { modelManager } from "@/lib/ai/modelManager";
import { runInferencePipeline } from "@/lib/ai/pipeline";
import { useOpenCV } from "@/lib/cv/useOpenCV";
import { calculateReferenceRatio, estimateOnionDiameter, OnionDimensions } from "@/lib/cv/dimension";
import { determineProcurementGrade, GradingResult } from "@/lib/grading/engine";
import { ScoredOnion as BaseScoredOnion } from "@/lib/ai/pipeline";
import { useBatchStore } from "@/lib/store/useBatchStore";
import BatchDashboard from "@/components/dashboard/BatchDashboard";

interface ScoredOnion extends BaseScoredOnion {
  dimensions?: OnionDimensions;
  grading?: GradingResult;
}

const CLASS_BADGE_COLORS: Record<string, string> = {
  healthy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  mold: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  rotten: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  sprouted: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export default function CameraScanner() {
  const isOpenCvLoaded = useOpenCV();
  const { currentBatch, addProcessedImage } = useBatchStore();
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const [isModelLoading, setIsModelLoading] = useState(true);
  const [modelStatus, setModelStatus] = useState("Initializing inference engine...");
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  
  const [scoredOnions, setScoredOnions] = useState<ScoredOnion[]>([]); // For live camera/latest upload
  const [activeHistoryIndex, setActiveHistoryIndex] = useState<number | null>(null); // For viewing past batch frames
  
  const [inferenceTimeMs, setInferenceTimeMs] = useState<number | null>(null);
  const [measurementRatio, setMeasurementRatio] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadModels() {
      try {
        await modelManager.initModels((status) => { if (isMounted) setModelStatus(status); });
        if (isMounted) { setIsModelLoading(false); setModelStatus("Models loaded & cached in IndexedDB"); }
      } catch (err) {
        if (isMounted) setModelStatus("Failed to load models. Check console.");
      }
    }
    loadModels();
    return () => { isMounted = false; stopCamera(); };
  }, []);

  const startCamera = async () => {
    setActiveHistoryIndex(null); // Return to live view
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setCameraActive(true); }
    } catch (err) { alert("Unable to access camera."); }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
    }
  };

  const drawDetections = (onions: ScoredOnion[], targetWidth: number, targetHeight: number) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.width = targetWidth;
    overlay.height = targetHeight;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, targetWidth, targetHeight);

    onions.forEach((onion, idx) => {
      const [x1, y1, x2, y2] = onion.bbox;
      const w = x2 - x1; const h = y2 - y1;
      const { label, confidence } = onion.classification;
      const color = label === "healthy" ? "#10b981" : label === "rotten" ? "#f43f5e" : label === "mold" ? "#f59e0b" : "#a855f7";

      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([]); ctx.strokeRect(x1, y1, w, h);

      if (onion.dimensions?.circlePx) {
        const { cx, cy, radius } = onion.dimensions.circlePx;
        ctx.beginPath();
        ctx.arc(x1 + cx, y1 + cy, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
      }

      const text = `#${idx + 1} ${label.toUpperCase()} (${(confidence * 100).toFixed(0)}%)`;
      ctx.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
      const textMetrics = ctx.measureText(text); const textHeight = 18; const padding = 6;
      ctx.fillStyle = color; ctx.fillRect(x1, Math.max(0, y1 - textHeight - padding), textMetrics.width + padding * 2, textHeight + padding);
      ctx.fillStyle = "#ffffff"; ctx.fillText(text, x1 + padding, Math.max(textHeight, y1 - padding));
    });
  };

  // Redraw bounding boxes whenever the user switches between history frames
  useEffect(() => {
    if (activeHistoryIndex !== null && currentBatch[activeHistoryIndex]) {
      const imgRecord = currentBatch[activeHistoryIndex];
      const img = new Image();
      img.onload = () => drawDetections(imgRecord.onions, img.width, img.height);
      img.src = imgRecord.imageUrl;
    } else if (activeHistoryIndex === null && canvasRef.current) {
      drawDetections(scoredOnions, canvasRef.current.width, canvasRef.current.height);
    }
  }, [activeHistoryIndex, currentBatch, scoredOnions]);

  const processFrame = async () => {
    if (!canvasRef.current || isProcessing || isModelLoading || !isOpenCvLoaded) return;
    setIsProcessing(true);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { setIsProcessing(false); return; }

    if (cameraActive && videoRef.current) {
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 640;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    }

    const t0 = performance.now();
    try {
      let currentRatio = measurementRatio;
      if (!currentRatio) { currentRatio = calculateReferenceRatio(canvas); if (currentRatio) setMeasurementRatio(currentRatio); }

      const results = await runInferencePipeline(canvas, 0.15);
      const resultsWithDimensions: ScoredOnion[] = results.map(onion => {
        let dims: OnionDimensions = { diameterMm: 0, circlePx: null };
        if (currentRatio) dims = estimateOnionDiameter(onion.cropCanvas, currentRatio);
        return { ...onion, dimensions: dims, grading: determineProcurementGrade(onion.classification, dims.diameterMm) };
      });

      const imageUrl = canvas.toDataURL("image/jpeg", 0.7);
      addProcessedImage({ id: `img_${Date.now()}_${Math.floor(Math.random() * 1000)}`, imageUrl, onions: resultsWithDimensions });

      const t1 = performance.now();
      if (canvasRef.current) {
        setInferenceTimeMs(Math.round(t1 - t0));
        setScoredOnions(resultsWithDimensions);
        drawDetections(resultsWithDimensions, canvas.width, canvas.height);
        setActiveHistoryIndex(currentBatch.length); // Auto-jump to newly added image
      }
    } catch (err) { console.error("Pipeline failed:", err); } 
    finally { if (canvasRef.current) setIsProcessing(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    stopCamera();
    setIsProcessing(true); // Keep the loading overlay up for the entire batch

    for (let i = 0; i < files.length; i++) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = async () => {
          if (!canvasRef.current) return resolve();
          
          const canvas = canvasRef.current; 
          canvas.width = img.width; 
          canvas.height = img.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) ctx.drawImage(img, 0, 0);

          try {
            // 1. Calculate QR Ratio specifically for this frame
            let currentRatio = measurementRatio;
            if (!currentRatio) {
              currentRatio = calculateReferenceRatio(canvas);
              if (currentRatio) setMeasurementRatio(currentRatio);
            }

            // 2. Run Inference directly (bypassing processFrame UI logic)
            const results = await runInferencePipeline(canvas, 0.15);
            
            // 3. Append Dimensions & Grading
            const resultsWithDimensions: ScoredOnion[] = results.map(onion => {
              let dims: OnionDimensions = { diameterMm: 0, circlePx: null };
              if (currentRatio) {
                dims = estimateOnionDiameter(onion.cropCanvas, currentRatio);
              }
              const grading = determineProcurementGrade(onion.classification, dims.diameterMm);
              return { ...onion, dimensions: dims, grading };
            });

            // 4. Save directly to the global store
            const imageUrl = canvas.toDataURL("image/jpeg", 0.7);
            addProcessedImage({ 
              id: `img_${Date.now()}_${Math.floor(Math.random() * 1000)}`, 
              imageUrl, 
              onions: resultsWithDimensions 
            });

          } catch (err) {
            console.error(`Batch inference failed for image ${i + 1}:`, err);
          }
          
          resolve();
        };
        img.src = URL.createObjectURL(files[i]);
      });
    }

    // Wait a tiny tick to ensure Zustand's global state has fully propagated
    setTimeout(() => {
      // Use getState() to fetch the true length, bypassing stale React closures
      const freshBatchLength = useBatchStore.getState().currentBatch.length;
      if (freshBatchLength > 0) {
        setActiveHistoryIndex(freshBatchLength - 1); // Auto-jump to the last image in the batch
      }
      setIsProcessing(false);
    }, 100);
    
    e.target.value = ""; // Reset input so the user can upload more later
  };
  const activeImage = activeHistoryIndex !== null ? currentBatch[activeHistoryIndex] : null;
  const displayOnions = activeImage ? activeImage.onions : scoredOnions;

  return (
    <div className="w-full max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-neutral-900/80 border border-neutral-800 p-4 rounded-xl backdrop-blur-md">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
            Edge Pipeline Inspector
            <span className={`w-2.5 h-2.5 rounded-full ${isModelLoading || !isOpenCvLoaded ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
          </h2>
          <p className="text-xs text-neutral-400 mt-0.5">{!isOpenCvLoaded ? "Loading OpenCV WASM..." : modelStatus}</p>
        </div>
        {inferenceTimeMs !== null && (
          <div className="text-right">
            <span className="text-xs uppercase tracking-wider text-neutral-500 font-mono">Latency</span>
            <p className="text-sm font-mono font-medium text-neutral-200">{inferenceTimeMs} ms</p>
          </div>
        )}
      </div>

      <div className="relative aspect-video w-full bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden flex items-center justify-center shadow-2xl">
        {activeImage ? (
          <img src={activeImage.imageUrl} className="w-full h-full object-contain" alt="Batch History" />
        ) : (
          <>
            <video ref={videoRef} playsInline muted className={`w-full h-full object-contain ${cameraActive ? "block" : "hidden"}`} />
            <canvas ref={canvasRef} className={`w-full h-full object-contain ${!cameraActive ? "block" : "hidden"}`} />
          </>
        )}
        <canvas ref={overlayRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-20">
            <div className="flex items-center gap-3 bg-neutral-900 border border-neutral-700 px-4 py-2.5 rounded-lg shadow-xl">
              <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-neutral-200 font-medium">Inferring (YOLO + EfficientNet + OpenCV)...</span>
            </div>
          </div>
        )}
      </div>

      {/* Filmstrip Gallery */}
      {currentBatch.length > 0 && (
        <div className="flex items-center gap-3 overflow-x-auto py-2 bg-neutral-900/50 p-3 rounded-xl border border-neutral-800">
          <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest shrink-0">Batch Queue</span>
          {currentBatch.map((img, idx) => (
            <button 
              key={img.id} 
              onClick={() => { stopCamera(); setActiveHistoryIndex(idx); }}
              className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition ${activeHistoryIndex === idx ? 'border-emerald-500 opacity-100' : 'border-neutral-700 opacity-50 hover:opacity-100'}`}
            >
              <img src={img.imageUrl} className="w-full h-full object-cover" alt="Thumbnail" />
            </button>
          ))}
          {activeHistoryIndex !== null && (
            <button onClick={() => { setActiveHistoryIndex(null); }} className="shrink-0 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-lg transition ml-auto">
              Clear View
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {!cameraActive ? (
            <button onClick={startCamera} disabled={isModelLoading || !isOpenCvLoaded} className="px-4 py-2 bg-neutral-100 hover:bg-white text-neutral-950 text-sm font-medium rounded-lg disabled:opacity-50 transition">
              Start Camera
            </button>
          ) : (
            <button onClick={stopCamera} className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-medium rounded-lg transition">
              Stop Camera
            </button>
          )}

          {cameraActive && activeHistoryIndex === null && (
            <button onClick={processFrame} disabled={isProcessing} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition shadow-lg shadow-emerald-900/20">
              Capture & Inspect
            </button>
          )}
        </div>

        <div>
          <label className="cursor-pointer px-4 py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            Upload Test Photo(s)
            <input type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" disabled={isModelLoading || !isOpenCvLoaded} />
          </label>
        </div>
      </div>

      {/* Dynamic Onion Cards for the Active Frame */}
      {displayOnions.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 font-mono">
              Detected Onions ({displayOnions.length})
            </h3>
            {measurementRatio ? (
              <span className="text-xs text-emerald-400 font-mono bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">QR Marker Active</span>
            ) : (
              <span className="text-xs text-rose-400 font-mono bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20">Missing QR Marker</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {displayOnions.map((onion, i) => {
              const { label, confidence, probabilities } = onion.classification;
              return (
                <div key={i} className="bg-neutral-900/60 border border-neutral-800 p-3.5 rounded-xl space-y-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-neutral-400">ID #{i + 1}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-md border font-medium uppercase tracking-wider ${CLASS_BADGE_COLORS[label] || "bg-neutral-800 text-neutral-300 border-neutral-700"}`}>
                      {label}
                    </span>
                  </div>
                  <div className="space-y-1 font-mono text-xs">
                    <div className="flex justify-between text-neutral-300"><span>Conf:</span><span className="font-semibold">{(confidence * 100).toFixed(1)}%</span></div>
                    <div className="flex justify-between text-neutral-300"><span>Size:</span><span className="font-semibold">{onion.diameterMm ? `${onion.diameterMm.toFixed(1)} mm` : '0 mm'}</span></div>
                  </div>
                  {onion.grading && (
                    <div className="mt-2 p-2 bg-neutral-950 rounded-lg border border-neutral-800">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] uppercase text-neutral-500 font-bold tracking-widest">Tier</span>
                        <span className={`text-xs font-bold ${onion.grading.grade === 'Grade A' ? 'text-emerald-400' : onion.grading.grade === 'Grade URS' ? 'text-amber-400' : onion.grading.grade === 'Reject' ? 'text-rose-400' : 'text-neutral-400'}`}>
                          {onion.grading.grade}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400 leading-tight">{onion.grading.reason}</p>
                    </div>
                  )}
                  <div className="space-y-1 pt-1 border-t border-neutral-800 text-[11px]">
                    {["healthy", "mold", "rotten", "sprouted"].map((c, cIdx) => (
                      <div key={c} className="flex items-center justify-between text-neutral-400"><span className="capitalize">{c}</span><span>{((probabilities[cIdx] || 0) * 100).toFixed(0)}%</span></div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <BatchDashboard />
    </div>
  );
}