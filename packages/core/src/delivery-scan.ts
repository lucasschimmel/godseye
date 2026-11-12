import { SCAN_SEVERITIES, type ScannerEvidenceView } from "@godseye/contracts";
import { DomainError } from "./errors.js";

export type ScanThreshold = (typeof SCAN_SEVERITIES)[number];
/** Findings at or above the threshold, plus every unclassified finding, block promotion. */
export function blockingFindings(scanner: ScannerEvidenceView, threshold: ScanThreshold) {
  const included = SCAN_SEVERITIES.slice(0, SCAN_SEVERITIES.indexOf(threshold) + 1);
  return (
    scanner.findings.unknown +
    included.reduce((total, severity) => total + scanner.findings[severity], 0)
  );
}
export function assertScanGate(scanner: ScannerEvidenceView, threshold: ScanThreshold) {
  const count = blockingFindings(scanner, threshold);
  if (count > 0)
    throw new DomainError(
      "SCAN_GATE_FAILED",
      `Scanner reported ${count} finding(s) at or above the ${threshold} threshold or unclassified`,
      409,
    );
}
