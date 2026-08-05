export function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]*_<>])/g, "\\$1")
    .replace(/[\r\n]+/g, " ");
}

export function escapeCodeSpan(value: string): string {
  return value.replace(/`/g, "'").replace(/[\r\n]+/g, " ");
}

export function singleLine(value: string, max?: number): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return max == null ? normalized : normalized.slice(0, max);
}
