/** Passive observations are partial evidence, never a claim that other technologies are absent. */
export const TECH_LIMITS = Object.freeze({
  htmlBytes: 512 * 1024,
  nodes: 2000,
});
export type TechCategory =
  | 'cms'
  | 'framework'
  | 'theme'
  | 'plugin'
  | 'analytics'
  | 'hosting'
  | 'cdn'
  | 'library'
  | 'server'
  | 'ads'
  | 'consent'
  | 'media'
  | 'social'
  | 'security'
  | 'other';
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
