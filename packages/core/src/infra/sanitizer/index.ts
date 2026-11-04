export type SanitizerSurface = "evidence" | "report" | "log" | "diagnostics";

export interface RedactionHit {
  readonly type: string;
  readonly count: number;
}

export interface RedactionResult {
  readonly text: string;
  readonly hits: readonly RedactionHit[];
}

interface Rule {
  readonly type: string;
  readonly pattern: RegExp;
  readonly replace: (match: string) => string;
}

const RULES: readonly Rule[] = [
  {
    type: "openai-key",
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    replace: () => "[REDACTED:OPENAI_KEY]"
  },
  {
    type: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replace: () => "[REDACTED:GITHUB_TOKEN]"
  },
  {
    type: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replace: () => "[REDACTED:AWS_KEY]"
  },
  {
    type: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
    replace: () => "Bearer [REDACTED:TOKEN]"
  },
  {
    type: "password-assignment",
    pattern: /\b(password|passwd|pwd)\s*[:=]\s*["']?[^"'\s]{6,}/gi,
    replace: (match) => {
      const prefix = match.split(/[:=]/, 1)[0] ?? "password";
      return `${prefix}=[REDACTED:PASSWORD]`;
    }
  },
  {
    type: "id-card",
    pattern: /\b\d{17}[\dXx]\b/g,
    replace: () => "[REDACTED:ID_CARD]"
  },
  {
    type: "phone",
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    replace: () => "[REDACTED:PHONE]"
  },
  {
    type: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: () => "[REDACTED:EMAIL]"
  },
  {
    type: "private-ip",
    pattern: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g,
    replace: () => "[REDACTED:PRIVATE_IP]"
  }
];

export function redact(text: string, _surface: SanitizerSurface): RedactionResult {
  let output = text;
  const counts = new Map<string, number>();

  for (const rule of RULES) {
    let count = 0;
    output = output.replace(rule.pattern, (match) => {
      count += 1;
      return rule.replace(match);
    });
    if (count > 0) {
      counts.set(rule.type, (counts.get(rule.type) ?? 0) + count);
    }
  }

  return {
    text: output,
    hits: [...counts.entries()].map(([type, count]) => ({ type, count }))
  };
}

export function totalHits(result: RedactionResult): number {
  return result.hits.reduce((sum, hit) => sum + hit.count, 0);
}