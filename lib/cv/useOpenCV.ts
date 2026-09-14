import { useState, useEffect } from "react";

export function useOpenCV() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let pollInterval: NodeJS.Timeout;

    const checkOpenCVReady = () => {
      const cv = (window as any).cv;
      if (cv && typeof cv.Mat === "function") {
        if (isMounted) setIsLoaded(true);
        if (pollInterval) clearInterval(pollInterval);
        return true;
      }
      return false;
    };

    if (checkOpenCVReady()) return;

    if (!document.getElementById("opencv-script")) {
      const script = document.createElement("script");
      script.id = "opencv-script";
      script.src = "/opencv.js";
      script.async = true;
      
      script.onload = () => {
        const cv = (window as any).cv;
        if (cv instanceof Promise) {
          cv.then((target) => {
            (window as any).cv = target;
          });
        }
      };

      script.onerror = () => {
        console.error("CRITICAL: Failed to load /opencv.js from the public directory.");
      };

      document.body.appendChild(script);
    }

    pollInterval = setInterval(() => {
      checkOpenCVReady();
    }, 250);

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  return isLoaded;
}