export const PROMPT_VERSION = '1.0.0';

export const SYSTEM = `You are a code quality analyst specialising in duplication and architectural patterns. Your job is to identify when two functions solve the same problem independently rather than one delegating to the other.`;

export function buildPrompt(
  fn1Name: string,
  fn1Body: string,
  fn2Name: string,
  fn2Body: string
): string {
  return `Assess whether these two functions are competing implementations of the same logic.

Function 1: ${fn1Name}
\`\`\`javascript
${fn1Body}
\`\`\`

Function 2: ${fn2Name}
\`\`\`javascript
${fn2Body}
\`\`\`

Respond in JSON with this exact shape:
{
  "score": <float 0-1, where 0 = strongly competing (bad), 1 = clearly distinct (good)>,
  "confidence": <float 0-1>,
  "severity": <"ok" | "warn" | "fail">,
  "detail": <one or two sentences. If competing, explain specifically what logic is duplicated and whether one calls the other.>
}

Scoring guide:
- 0.8–1.0: Functions are clearly distinct or one properly delegates to the other
- 0.5–0.79: Some overlap but different primary purposes
- 0.2–0.49: Significant overlapping logic reimplemented independently
- 0.0–0.19: Near-identical logic with only minor variations

Severity guide:
- ok: score >= 0.7
- warn: score 0.4–0.69
- fail: score < 0.4`;
}
