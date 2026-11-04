const NOISE_PATTERNS: readonly RegExp[] = [
  /<environment_context>/i,
  /<filesystem>/i,
  /<permission_profile/i,
  /<workspace_roots>/i,
  /<codex_apps_client_time_context>/i,
  /<skills_instructions>/i,
  /<app-context>/i,
  /<cb_summary>/i,
  /environment_context/i,
  /permission_profile/i,
  /workspace_roots/i,
  /you are codex/i,
  /system prompt/i,
  /tool scaffolding/i,
  /^## Skills\b/i,
  /^执行命令[:：]?\s*$/i
];

export function isNoiseText(text: string | undefined): boolean {
  if (text === undefined) return true;
  const value = text.trim();
  if (value.length === 0) return true;
  if (NOISE_PATTERNS.some((pattern) => pattern.test(value))) return true;
  if (value.startsWith("# Environment") || value.startsWith("<environment")) return true;
  return false;
}