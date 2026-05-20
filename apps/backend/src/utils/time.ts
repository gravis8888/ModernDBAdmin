export function toIsoString(value: number | string | null | undefined) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return new Date(value).toISOString();
}
