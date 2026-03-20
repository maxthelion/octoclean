export const PROMPT_VERSION = '1.0.0';

export const SYSTEM = `You are a code quality analyst specialising in naming and responsibility coherence. Your job is to assess whether a function's name accurately reflects everything it does.`;

export function buildPrompt(functionName: string, implementation: string): string {
  return `Assess whether the function name accurately reflects its current responsibilities.

Function: ${functionName}

Implementation:
\`\`\`javascript
${implementation}
\`\`\`

Respond in JSON with this exact shape:
{
  "score": <float 0-1, where 1 = name fully reflects responsibilities>,
  "confidence": <float 0-1>,
  "severity": <"ok" | "warn" | "fail">,
  "detail": <one or two plain sentences. If the name is misleading, describe what responsibilities are unstated.>
}

Scoring guide:
- 0.8–1.0: Name accurately describes the function's primary and secondary responsibilities
- 0.5–0.79: Name covers the primary responsibility but understates secondary ones
- 0.2–0.49: Function does significantly more than the name implies
- 0.0–0.19: Name is fundamentally misleading

Severity guide:
- ok: score >= 0.7
- warn: score 0.4–0.69
- fail: score < 0.4`;
}
