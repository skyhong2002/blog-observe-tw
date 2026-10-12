/** Passive observations are partial evidence, never a claim that other technologies are absent. */
export const TECH_RULE_VERSION = 'passive-tech-v1';
export const TECH_LIMITS = Object.freeze({
  htmlBytes: 512 * 1024,
  nodes: 2000,
  detections: 24,
  evidencePerDetection: 3,
  payloadBytes: 24 * 1024,
  storeTimeoutMs: 2500,
});
export type TechCategory = 'cms' | 'framework' | 'theme' | 'plugin' | 'analytics' | 'hosting' | 'cdn';
export type TechSourceType = 'html' | 'body-fragment' | 'header';
export type TechStatus = 'detected' | 'unknown' | 'failed' | 'blocked';
export type TechErrorCode = 'robots' | 'waf' | 'rate-limit' | 'http-error' | 'timeout' | 'network' | 'invalid-response';
export type SafeTechEvidence = { kind: 'generator' | 'asset' | 'marker' | 'header'; value: string };
export type TechDetection = {
  id: string;
  name: string;
  category: TechCategory;
  confidence: number;
  version: string;
  ruleId: string;
  ruleVersion: string;
  observedAt: string;
  evidence: SafeTechEvidence[];
};
export type TechCoverage = {
  partial: true;
  method: 'passive-existing-response';
  sourceType: TechSourceType;
  htmlTruncated: boolean;
  inspectedNodes: number;
};
export type DetectorInput = {
  url: string;
  html?: string;
  headers?: Headers | Record<string, string | undefined>;
  httpStatus?: number;
  sourceType?: TechSourceType;
  observedAt?: Date;
  blockedReason?: 'robots' | 'waf' | 'rate-limit';
  failureReason?: 'timeout' | 'network' | 'invalid-response';
};
export type TechObservation = {
  status: TechStatus;
  sourceUrl: string | null;
  sourceType: TechSourceType;
  coverage: TechCoverage;
  detections: TechDetection[];
  ruleVersion: string;
  lastAttemptAt: string;
  observedAt: string | null;
  errorCode: TechErrorCode | null;
};
export type RecordTechObservationInput = {
  blogId: number;
  /** Mandatory for an article/body-fragment observation; this provenance remains attached to the success snapshot. */
  sourcePostId?: number | null;
  /** Original final URL, used only in-memory for publication ownership before query/hash redaction. */
  sourceUrl: string;
  observation: TechObservation;
};
export type RecordTechObservationResult = {
  written: boolean;
  reason: 'stored' | 'not-public' | 'ownership-mismatch' | 'stale' | 'invalid-input' | 'unavailable';
};
