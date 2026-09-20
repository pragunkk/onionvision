import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
  },
});

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
      // Ignore missing .wasm files from onnxruntime-web that webpack tries to bundle
        config.resolve.alias = {
        ...config.resolve.alias,
        "ort-wasm-simd-threaded.jsep.wasm": false,
        "ort-wasm-simd.jsep.wasm": false,
        "ort-wasm-threaded.jsep.wasm": false,
        "ort-wasm.jsep.wasm": false,
        "ort-wasm-simd-threaded.wasm": false,
        "ort-wasm-simd.wasm": false,
        "ort-wasm-threaded.wasm": false,
        "ort-wasm.wasm": false,
      };
    }
    return config;
  },
};

export default withPWA(nextConfig);