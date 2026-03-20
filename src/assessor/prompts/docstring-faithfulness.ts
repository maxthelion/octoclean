export const PROMPT_VERSION = '1.0.0';

export const SYSTEM = `You are a code quality analyst. Your job is to assess whether a function's JSDoc comment accurately describes what the implementation actually does.

Be concise and specific. Focus only on factual discrepancies — not style preferences.`;

export function buildPrompt(functionName: string, jsdoc: string, implementation: string): string {
  return `Assess whether this JSDoc comment faithfully describes the implementation.

Function: ${functionName}

JSDoc:
\`\`\`
${jsdoc}
\`\`\`

Implementation:
\`\`\`javascript
${implementation}
\`\`\`

Respond in JSON with this exact shape:
{
  "score": <float 0-1, where 1 = fully faithful>,
  "confidence": <float 0-1, how confident you are in this assessment>,
  "severity": <"ok" | "warn" | "fail">,
  "detail": <one or two plain sentences describing any discrepancy, or "Documentation matches implementation." if faithful>,
  "lines_of_concern": <array of line numbers with issues, or []>
}

Scoring guide:
- 0.8–1.0: Documentation closely matches implementation
- 0.5–0.79: Minor gaps or stale details
- 0.2–0.49: Significant discrepancies (missing steps, wrong return values, etc.)
- 0.0–0.19: Documentation describes a fundamentally different behaviour

Severity guide:
- ok: score >= 0.7
- warn: score 0.4–0.69
- fail: score < 0.4`;
}
