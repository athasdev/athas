export function parseErrorBlockData(errorData: string) {
  const fields = new Map<string, string>();
  let currentKey: string | null = null;

  for (const line of errorData.split("\n")) {
    const fieldMatch = line.match(/^([a-z]+):\s?(.*)$/);

    if (fieldMatch) {
      currentKey = fieldMatch[1];
      fields.set(currentKey, fieldMatch[2]);
      continue;
    }

    if (currentKey) {
      const currentValue = fields.get(currentKey);
      fields.set(currentKey, currentValue ? `${currentValue}\n${line}` : line);
    }
  }

  return {
    title: fields.get("title")?.trim() ?? "",
    code: fields.get("code")?.trim() ?? "",
    message: fields.get("message")?.trim() ?? "",
    details: fields.get("details")?.trim() ?? "",
  };
}

export function extractProviderSetupCommand(value: string): string | null {
  const explicitSetup = value.match(/\brun\s+`?([^`.\n]*?\b--setup(?:\s+[\w.:/@=-]+)*)`?/i);
  if (explicitSetup?.[1]) {
    return explicitSetup[1].trim();
  }

  const bareSetup = value.match(/`([\w.-]+(?:\s+[\w.:/@=-]+)*\s+--setup(?:\s+[\w.:/@=-]+)*)`/i);
  return bareSetup?.[1]?.trim() ?? null;
}
