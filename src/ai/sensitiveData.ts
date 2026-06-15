const sensitiveKeyPatterns = [
  /^apiKey$/i,
  /^api_key$/i,
  /^aiApiKey$/i,
  /^authorization$/i,
  /^accessToken$/i,
  /^refreshToken$/i,
  /^secret$/i,
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const isSensitiveKey = (key: string) => {
  return sensitiveKeyPatterns.some((pattern) => pattern.test(key));
};

export const containsSensitiveData = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsSensitiveData);
  if (!isRecord(value)) return false;

  return Object.entries(value).some(([key, entryValue]) => {
    return isSensitiveKey(key) || containsSensitiveData(entryValue);
  });
};

export const redactSensitiveData = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactSensitiveData(entryValue),
    ]),
  );
};
