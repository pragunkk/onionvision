import { ClassificationResult } from "../ai/postprocess";

export type ProcurementGrade = "Grade A" | "Grade URS" | "Reject" | "Manual Review";

export interface GradingResult {
  grade: ProcurementGrade;
  reason: string;
}

/**
 * Translates AI classifications and physical dimensions into NCCF official procurement tiers.
 * Based on June 2026 Department of Consumer Affairs guidelines.
 */
export function determineProcurementGrade(
  classification: ClassificationResult,
  diameterMm: number
): GradingResult {
  
  // 1. Check for physical reference failure
  if (diameterMm === 0) {
    return {
      grade: "Manual Review",
      reason: "Missing physical dimension (No QR code detected)."
    };
  }

  // 2. Check for AI Uncertainty
  if (classification.confidence < 0.35) {
    return {
      grade: "Manual Review",
      reason: `Low AI confidence (${(classification.confidence * 100).toFixed(1)}%). Requires human inspection.`
    };
  }

  const isWithinSizeLimits = diameterMm >= 35.0 && diameterMm <= 70.0;
  const isUndersized = diameterMm < 35.0;
  const isOversized = diameterMm > 70.0;

  // 3. Size Rejections (Overrides all health metrics)
  if (isUndersized) {
    return {
      grade: "Reject",
      reason: `Undersized (${diameterMm.toFixed(1)} mm). Minimum requirement is 35 mm.`
    };
  }
  
  if (isOversized) {
    return {
      grade: "Reject",
      reason: `Oversized (${diameterMm.toFixed(1)} mm). Maximum allowance is 70 mm.`
    };
  }

  // 4. Health and Quality Tiering
  if (classification.label === "healthy") {
    // If it's healthy and we already know it's within 35-70mm
    return {
      grade: "Grade A",
      reason: "Meets all Grade A specifications (Healthy, 35-70mm)."
    };
  }

  if (classification.label === "rotten") {
    // Rot is an immediate rejection regardless of size
    return {
      grade: "Reject",
      reason: "Severe defect detected (Rotten)."
    };
  }

  // Handle minor defects (Mold/Sprouted) for the new URS category
  if (classification.label === "mold" || classification.label === "sprouted") {
    // If confidence is extremely high (>0.85), the defect is severe and should be rejected
    if (classification.confidence > 0.85) {
      return {
        grade: "Reject",
        reason: `Severe defect detected (${classification.label}).`
      };
    } else {
      // If confidence is moderate (0.35 - 0.85), treat it as superficial staining/damage
      return {
        grade: "Grade URS",
        reason: `Minor defect detected (${classification.label}). Fits Under Relaxed Specifications.`
      };
    }
  }

  // Fallback
  return {
    grade: "Manual Review",
    reason: "Unhandled classification state."
  };
}