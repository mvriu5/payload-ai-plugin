import { createHmac, timingSafeEqual } from "node:crypto";

export type AIActionSignature = {
  expiresAt: string;
  value: string;
};

type SignableProposal = Record<string, unknown> & {
  _aiSignature?: AIActionSignature;
};

const signatureTTL = 10 * 60 * 1000;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "_aiSignature")
      .sort(([a], [b]) => a.localeCompare(b));

    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
};

const getSigningSecret = () => {
  const secret = process.env.PAYLOAD_SECRET;

  if (!secret) {
    throw new Error("PAYLOAD_SECRET is required to sign AI proposals.");
  }

  return secret;
};

const getSignaturePayload = (proposal: SignableProposal, expiresAt: string) => {
  return stableStringify({
    expiresAt,
    proposal,
  });
};

const signPayload = (payload: string) => {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("hex");
};

export const signAIActionProposal = <Proposal extends SignableProposal>(
  proposal: Proposal,
): Proposal & { _aiSignature: AIActionSignature } => {
  const expiresAt = new Date(Date.now() + signatureTTL).toISOString();
  const value = signPayload(getSignaturePayload(proposal, expiresAt));

  return {
    ...proposal,
    _aiSignature: {
      expiresAt,
      value,
    },
  };
};

export const verifyAIActionProposal = (proposal: SignableProposal) => {
  const signature = proposal._aiSignature;

  if (!signature?.expiresAt || !signature.value) return false;
  if (Number.isNaN(new Date(signature.expiresAt).getTime())) return false;
  if (new Date(signature.expiresAt).getTime() < Date.now()) return false;

  const expected = signPayload(
    getSignaturePayload(proposal, signature.expiresAt),
  );
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature.value, "hex");

  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
};
