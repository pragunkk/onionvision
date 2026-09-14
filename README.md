# OnionVision: Edge AI for Automated Onion Quality Grading

## Vision and the Need

Agricultural procurement in India, particularly for essential commodities like onions, relies heavily on manual visual inspection. This introduces human subjectivity, inconsistent application of quality standards, and massive bottlenecks at procurement centers. Furthermore, these centers often operate in remote areas with unreliable internet connectivity, rendering cloud-based AI solutions impractical. Project OnionVision (SIH 2026 PS SIH26031) was conceived to address these exact challenges. The goal is to provide a standardized, objective, and lightning-fast quality inspection tool that operates entirely offline on the edge, ensuring fair compensation for farmers and rapid throughput for procurement officers.

## The Idea

OnionVision moves the entire computer vision and agricultural measurement pipeline directly into the browser using WebAssembly (WASM). By packaging complex neural networks and OpenCV routines into a Progressive Web App (PWA), any mid-range Android smartphone can function as an intelligent grading station. The system leverages a dual-model AI architecture to identify and classify defects, combined with a deterministic computer vision layer to physically measure the onions against a standardized 50x50 mm physical QR code marker. These visual and physical metrics are then passed through a rule engine strictly mirroring the Department of Consumer Affairs' procurement guidelines.

## High-Level Architecture

The application is built on a Next.js (App Router) monorepo configured as an offline-first PWA.

1. **Camera/Input:** Frames are captured via WebRTC or bulk file upload and rendered to an HTML5 Canvas.
2. **Inference Bridge:** ONNXRuntime-Web loads quantized model weights from IndexedDB and processes them using a single-threaded WASM backend to prevent browser security blocks.
3. **Computer Vision:** OpenCV.js processes the image matrix for spatial scaling and contour mapping.
4. **State & Storage:** Zustand aggregates the batch data in memory, periodically syncing to an offline IndexedDB wrapper, ready to push to a Supabase backend when the device regains connectivity.

## Pipeline Deep Dive

### 1. Object Detection Layer (YOLO11n)

The first stage relies on a lightweight YOLO11n model trained to detect individual onions within dense clusters.

* **Implementation:** The camera frame is extracted, letterboxed (padded with gray borders to preserve its native aspect ratio), and normalized to a `[1, 3, 640, 640]` tensor.
* **Execution:** ONNXRuntime executes the model. The output matrix undergoes Non-Maximum Suppression (NMS) with an IoU threshold of 0.45 and a confidence threshold of 0.35. The padding math is reversed to map the bounding boxes back to the original image dimensions.

### 2. Classification Layer (EfficientNet-B0)

Each detected bounding box is cropped from the original high-resolution canvas and passed to an EfficientNet-B0 classifier.

* **Implementation:** The crop is resized to 224x224 and normalized using exact ImageNet mean `[0.485, 0.456, 0.406]` and standard deviation `[0.229, 0.224, 0.225]`.
* **Execution:** The classifier outputs logits which are passed through a numerically stable Softmax function. This assigns each crop a probability distribution across four classes: `healthy`, `mold`, `rotten`, and `sprouted`.

### 3. Dimensional Estimation Module (OpenCV.js)

Bounding boxes alone are inaccurate for determining onion diameter because they often include stems and roots. This layer translates pixels to true millimeters.

* **Reference Scaling:** A printed 50x50 mm QR code must be present in the frame. `cv.QRCodeDetector()` calculates the pixel width of this marker, establishing the ratio $R = \frac{50}{W_{px}}$.
* **Bulb Isolation:** For every YOLO crop, OpenCV converts the image to grayscale, applies a Gaussian Blur, and executes Otsu's Thresholding to separate the onion from the background. `cv.findContours()` identifies the largest contiguous mass. A Minimum Enclosing Circle is wrapped around this contour, discarding linear stems, to output the true bulb diameter multiplied by $R$.

### 4. Indian Procurement Grading Engine

This pure TypeScript deterministic rule engine translates the AI and OpenCV outputs into official NCCF procurement tiers based on June 2026 guidelines.

* **Grade A:** Perfectly healthy classification AND a diameter between 35 mm and 70 mm.
* **Grade URS (Under Relaxed Specifications):** Diameter between 35 mm and 70 mm, but exhibiting low-confidence, superficial defects (e.g., minor staining or light sprouting).
* **Reject:** Any onion exhibiting severe rot, or failing the size constraints (undersized at < 35 mm or oversized at > 70 mm).
* **Manual Review:** Triggers if the AI classification confidence is below 0.35 or if no QR code reference is detected in the frame.

### 5. Offline Data Persistence & Analytics

As onions are processed, the grading results are pushed to a global Zustand state manager.

* **Aggregation:** The dashboard utilizes Recharts to map the batch into distribution histograms (size profiles) and pie charts (defect frequencies).
* **PDF Generation:** Using `html-to-image` and `jspdf`, the application natively captures the DOM utilizing SVG rendering (supporting modern `oklch` color spaces) to generate a downloadable procurement receipt.
* **Offline Sync:** The finalized batch, stripped of heavy HTML canvas objects, is securely stored in IndexedDB. A background listener waits for the `navigator.onLine` event to sync the backlog to the cloud.

## Running Instructions

1. **Install Dependencies:**
```bash
npm install

```


2. **Download WASM Binaries:** Ensure `opencv.js` (v4.8.0) and all `.wasm` / `.mjs` files from `onnxruntime-web` are placed in the `public/` directory.
3. **Start Development Server:**
```bash
npm run dev --webpack

```


4. **Access the Application:** Open `http://localhost:3000` in Google Chrome or Edge.

## What to Expect

Upon loading the application, you will see an initialization status indicating that the ONNX weights and OpenCV WASM binaries are caching into IndexedDB. Once the status turns green, the camera and upload controls will unlock.

Uploading a single photo or selecting multiple photos will trigger the batch processing loop. The UI will display a persistent loading overlay as the AI silently processes each frame. Once complete, the application will render an interactive filmstrip of the batch. Selecting any thumbnail will display the image with overlaid YOLO bounding boxes (solid lines) and OpenCV bulb isolation boundaries (dashed circles), alongside a breakdown of each onion's classification, size, and official procurement tier. At the bottom of the page, the dashboard will dynamically reflect the aggregate metrics of the entire scanned batch, ready to be exported as a finalized PDF receipt.