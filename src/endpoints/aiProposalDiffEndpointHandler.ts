import type { PayloadHandler } from "payload";

import { verifyAIActionProposal } from "../ai/proposals.js";
import { redactSensitiveData } from "../ai/sensitiveData.js";
import {
  getCollectionFields,
  normalizeAuthData,
  normalizeDataForFields,
  type CollectionConfig,
  type FieldConfig,
} from "../payload/normalizeData.js";
import {
  isCollectionActionAllowed,
  type ResolvedAICollectionPermissionMap,
} from "../payload/collectionPermissions.js";
import type { AIActionProposal } from "./aiChatEndpointHandler.js";

type AIProposalDiffBody = {
  proposal?: AIActionProposal;
};

type AIProposalDiffEndpointOptions = {
  collections?: ResolvedAICollectionPermissionMap;
};

type LocalizedDataInput = Record<string, Record<string, unknown>>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const hasLocalizedData = (
  proposal: Partial<AIActionProposal>,
): proposal is Partial<AIActionProposal> & { localizedData: LocalizedDataInput } => {
  return "localizedData" in proposal && isRecord(proposal.localizedData);
};

const isActionProposal = (proposal: unknown): proposal is AIActionProposal => {
  if (!isRecord(proposal) || typeof proposal.label !== "string") return false;

  if (proposal.action === "create") {
    return (
      typeof proposal.collection === "string" &&
      (isRecord(proposal.data) || isRecord(proposal.localizedData))
    );
  }

  if (proposal.action === "update") {
    return (
      typeof proposal.collection === "string" &&
      typeof proposal.id === "string" &&
      (isRecord(proposal.data) || isRecord(proposal.localizedData))
    );
  }

  if (proposal.action === "delete") {
    return (
      typeof proposal.collection === "string" && typeof proposal.id === "string"
    );
  }

  if (proposal.action === "updateGlobal") {
    return (
      typeof proposal.slug === "string" &&
      (isRecord(proposal.data) || isRecord(proposal.localizedData))
    );
  }

  return false;
};

const mergeData = (
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries({
      ...current,
      ...next,
    }).map(([key, value]) => {
      const currentValue = current[key];

      if (isRecord(currentValue) && isRecord(value)) {
        return [key, mergeData(currentValue, value)];
      }

      return [key, value];
    }),
  );
};

export const createAIProposalDiffEndpointHandler =
  (options: AIProposalDiffEndpointOptions = {}): PayloadHandler =>
  async (req) => {
    if (!req.user)
      return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = req.json
      ? ((await req.json().catch(() => null)) as AIProposalDiffBody | null)
      : null;

    const proposal = body?.proposal;
    if (!proposal)
      return Response.json({ error: "Proposal is required" }, { status: 400 });
    if (!verifyAIActionProposal(proposal))
      return Response.json(
        { error: "Proposal signature is invalid or expired." },
        { status: 400 },
      );
    if (!isActionProposal(proposal))
      return Response.json({ error: "Proposal is invalid." }, { status: 400 });

    try {
      if (proposal.action === "updateGlobal") {
        const globalConfig = req.payload.config.globals?.find(
          (global) => global.slug === proposal.slug,
        );
        if (!globalConfig)
          return Response.json({ error: "Unknown global" }, { status: 400 });

        if (hasLocalizedData(proposal)) {
          const beforeByLocale: Record<string, unknown> = {};
          const afterByLocale: Record<string, unknown> = {};

          for (const [locale, localeData] of Object.entries(
            proposal.localizedData,
          )) {
            const normalized = normalizeDataForFields(
              (globalConfig.fields || []) as FieldConfig[],
              localeData,
            );
            const doc = (await req.payload.findGlobal({
              depth: 2,
              locale,
              overrideAccess: false,
              req,
              slug: proposal.slug as never,
            })) as Record<string, unknown>;

            beforeByLocale[locale] = redactSensitiveData(doc);
            afterByLocale[locale] = redactSensitiveData(
              mergeData(doc, normalized.data),
            );
          }

          return Response.json({
            after: afterByLocale,
            before: beforeByLocale,
          });
        }

        const normalized = normalizeDataForFields(
          (globalConfig.fields || []) as FieldConfig[],
          proposal.data,
        );
        const doc = (await req.payload.findGlobal({
          depth: 2,
          ...(proposal.locale ? { locale: proposal.locale } : {}),
          overrideAccess: false,
          req,
          slug: proposal.slug as never,
        })) as Record<string, unknown>;

        return Response.json({
          after: redactSensitiveData(mergeData(doc, normalized.data)),
          before: redactSensitiveData(doc),
        });
      }

      if (
        !isCollectionActionAllowed({
          action: proposal.action === "delete" ? "delete" : "read",
          permissions: options.collections,
          req,
          slug: proposal.collection,
        })
      )
        return Response.json({ error: "Unknown collection" }, { status: 400 });

      if (proposal.action === "delete") {
        const doc = await req.payload.findByID({
          collection: proposal.collection as never,
          depth: 2,
          id: proposal.id,
          ...(proposal.locale ? { locale: proposal.locale } : {}),
          overrideAccess: false,
          req,
        });

        return Response.json({
          after: {},
          before: redactSensitiveData(doc),
        });
      }

      const collectionConfig = req.payload.config.collections.find(
        (collection) => collection.slug === proposal.collection,
      ) as CollectionConfig | undefined;
      const normalizeCollectionData = (data: Record<string, unknown>) =>
        normalizeAuthData(
          collectionConfig,
          normalizeDataForFields(getCollectionFields(collectionConfig), data),
        );

      if (hasLocalizedData(proposal)) {
        const afterByLocale: Record<string, unknown> = {};
        const beforeByLocale: Record<string, unknown> = {};

        for (const [locale, localeData] of Object.entries(
          proposal.localizedData,
        )) {
          const normalized = normalizeCollectionData(localeData);

          if (proposal.action === "create") {
            beforeByLocale[locale] = {};
            afterByLocale[locale] = redactSensitiveData(normalized.data);
            continue;
          }

          const doc = (await req.payload.findByID({
            collection: proposal.collection as never,
            depth: 2,
            id: proposal.id,
            locale,
            overrideAccess: false,
            req,
          })) as Record<string, unknown>;

          beforeByLocale[locale] = redactSensitiveData(doc);
          afterByLocale[locale] = redactSensitiveData(
            mergeData(doc, normalized.data),
          );
        }

        return Response.json({
          after: afterByLocale,
          before: beforeByLocale,
        });
      }

      const normalized = normalizeCollectionData(proposal.data);

      if (proposal.action === "create") {
        return Response.json({
          after: redactSensitiveData(normalized.data),
          before: {},
        });
      }

      const doc = (await req.payload.findByID({
        collection: proposal.collection as never,
        depth: 2,
        id: proposal.id,
        ...(proposal.locale ? { locale: proposal.locale } : {}),
        overrideAccess: false,
        req,
      })) as Record<string, unknown>;

      return Response.json({
        after: redactSensitiveData(mergeData(doc, normalized.data)),
        before: redactSensitiveData(doc),
      });
    } catch (err) {
      req.payload.logger.error({
        err,
        msg: "AI proposal diff failed",
      });

      return Response.json(
        {
          error: "Could not load proposal diff.",
        },
        { status: 400 },
      );
    }
  };
