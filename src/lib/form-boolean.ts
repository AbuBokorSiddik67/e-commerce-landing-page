/** Normalize only the boolean literals emitted by HTML controls and older forms. */
export function normalizeBooleanLiteral(value: unknown): unknown {
  if (value === "true" || value === "on") return true;
  if (value === "false" || value === "off") return false;
  return value;
}
