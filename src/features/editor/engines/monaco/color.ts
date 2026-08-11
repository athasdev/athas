function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

export function toMonacoColor(value: string, fallback: string): string {
  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized)) return normalized;
  if (/^#[0-9a-fA-F]{3,4}$/.test(normalized)) {
    const [, red, green, blue, alpha = "f"] = normalized;
    return `#${red}${red}${green}${green}${blue}${blue}${alpha}${alpha}`;
  }

  const rgbaMatch = normalized.match(
    /^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)(?:\s*,\s*([.\d]+)\s*)?\)$/i,
  );
  if (!rgbaMatch) return fallback;

  const [, red, green, blue, alpha = "1"] = rgbaMatch;
  const alphaByte = toHexByte(Number(alpha) * 255);
  return `#${toHexByte(Number(red))}${toHexByte(Number(green))}${toHexByte(Number(blue))}${alphaByte}`;
}

export function toMonacoTokenForeground(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const color = toMonacoColor(value, "");
  return color ? color.slice(1) : undefined;
}
