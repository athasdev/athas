/**
 * Parse OSC 7 sequence for working directory tracking
 * OSC 7 format: ESC]7;file://hostname/pathBEL
 */
export function parseOSC7(data: string): string | null {
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const osc7Regex = new RegExp(`${ESC}\\]7;file://[^/]*([^${BEL}]+)${BEL}`);
  const match = data.match(osc7Regex);

  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return null;
}
