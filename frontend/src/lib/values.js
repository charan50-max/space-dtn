export function na(value, fallback = "N/A") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number" && !Number.isFinite(value)) return fallback;
  return value;
}

export function fmt(value, digits = 1, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return `${number.toFixed(digits)}${suffix}`;
}

export function fmtInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return String(Math.round(number));
}

export function pct(value) {
  return fmt(value, 1, "%");
}

export function ticks(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return `${number} ticks`;
}

export function signed(value) {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  if (number === 0) return "—";
  return `${number > 0 ? "+" : ""}${number}`;
}

export function urgencyPct(message) {
  const probability = Number(message?.priority_probability);
  if (Number.isFinite(probability)) return Math.round(probability * 100);
  const score = Number(message?.priority_score);
  if (Number.isFinite(score)) return Math.round(score);
  return null;
}
