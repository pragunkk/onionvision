"use client";

import dynamic from "next/dynamic";

const CameraScanner = dynamic(
  () => import("@/components/camera/CameraScanner"),
  { ssr: false }
);

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center font-bold text-emerald-400 font-mono">
            OV
          </div>
          <div>
            <h1 className="text-base font-semibold leading-none">OnionVision</h1>
            <span className="text-[11px] text-neutral-500 font-mono">SIH 2026 PS SIH26031</span>
          </div>
        </div>
        <span className="text-xs bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full text-neutral-400 font-mono">
          Edge Wasm/WebGL
        </span>
      </header>

      <section className="flex-1 flex items-center justify-center py-6">
        <CameraScanner />
      </section>
    </main>
  );
}