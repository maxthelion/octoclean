export const PROMPT_VERSION = '1.0.0';

export const SYSTEM = `You are a code quality analyst. Your job is to assess whether a function appears to do what it was intended to do, based on its name, structure, and implementation patterns.`;

export function buildPrompt(functionName: string, implementation: string): string {
  return `Assess whether this function appears to clearly accomplish its intended purpose.

Function: ${functionName}

Implementation:
\`\`\`javascript
${implementation}
\`\`\`

Respond in JSON with this exact shape:
{
  "score": <float 0-1, where 1 = intent is perfectly clear>,
  "confidence": <float 0-1>,
  "severity": <"ok" | "warn" | "fail">,
  "detail": <one or two plain sentences. Note if complexity appears domain-driven vs structural confusion, or if there are signs of unclear intent.>
}

Scoring guide:
- 0.8–1.0: Intent is clear; complexity (if any) is domain-driven
- 0.5–0.79: Mostly clear but some confusing patterns or unclear branches
- 0.2–0.49: Hard to determine what the function is trying to do
- 0.0–0.19: Code appears contradictory or confused in its purpose

Severity guide:
- ok: score >= 0.7
- warn: score 0.4–0.69
- fail: score < 0.4`;
}
