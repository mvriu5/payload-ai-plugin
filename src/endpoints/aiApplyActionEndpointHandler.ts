import type { PayloadHandler } from "payload";

import { verifyAIActionProposal } from "../ai/proposals.js";
import { containsSensitiveData } from "../ai/sensitiveData.js";
import {
  getCollectionFields,
  isAuthCollection,
  normalizeAuthData,
  normalizeDataForFields,
  type CollectionConfig,
  type FieldConfig,
  type NormalizedData,
} from "../payload/normalizeData.js";
import type { AIActionProposal } from "./aiChatEndpointHandler.js";
import {
  isCollectionActionAllowed,
  type AICollectionAction,
  type ResolvedAICollectionPermissionMap,
} from "../payload/collectionPermissions.js";

type AIApplyActionBody = {
  proposal?: AIActionProposal;
};

type AIApplyActionEndpointOptions = {
  collections?: ResolvedAICollectionPermissionMap;
};

type AppliedDoc = {
  id?: unknown;
};

type ProposalMeta = {
  action?: unknown;
  collection?: unknown;
  id?: unknown;
  slug?: unknown;
};

const getProposalMeta = (
  proposal?: Partial<AIActionProposal>,
): ProposalMeta => {
  if (!proposal) return {};

  return {
    action: proposal.action,
    collection: "collection" in proposal ? proposal.collection : undefined,
    id: "id" in proposal ? proposal.id : undefined,
    slug: "slug" in proposal ? proposal.slug : undefined,
  };
};

const getAppliedDocReference = (doc: AppliedDoc | null | undefined) => {
  return doc?.id === undefined ? undefined : { id: doc.id };
};

const isKnownCollection = (
  req: Parameters<PayloadHandler>[0],
  collection: string,
) => {
  return req.payload.config.collections.some(
    (item) => item.slug === collection,
  );
};

const isAllowedCollection = (
  req: Parameters<PayloadHandler>[0],
  collection: string,
  collections?: ResolvedAICollectionPermissionMap,
  action: AICollectionAction = "read",
) => {
  return isCollectionActionAllowed({
    action,
    permissions: collections,
    req,
    slug: collection,
  });
};

const isKnownGlobal = (req: Parameters<PayloadHandler>[0], slug: string) => {
  return (
    req.payload.config.globals?.some((item) => item.slug === slug) || false
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const isActionProposal = (proposal: unknown): proposal is AIActionProposal => {
  if (!isRecord(proposal) || typeof proposal.label !== "string") return false;

  if (proposal.action === "create") {
    return typeof proposal.collection === "string" && isRecord(proposal.data);
  }

  if (proposal.action === "update") {
    return (
      typeof proposal.collection === "string" &&
      typeof proposal.id === "string" &&
      isRecord(proposal.data)
    );
  }

  if (proposal.action === "delete") {
    return (
      typeof proposal.collection === "string" && typeof proposal.id === "string"
    );
  }

  if (proposal.action === "updateGlobal") {
    return typeof proposal.slug === "string" && isRecord(proposal.data);
  }

  return false;
};

export const createAIApplyActionEndpointHandler =
  (options: AIApplyActionEndpointOptions = {}): PayloadHandler =>
  async (req) => {
    if (!req.user)
      return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = req.json
      ? ((await req.json().catch(() => null)) as AIApplyActionBody | null)
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
    if ("data" in proposal && containsSensitiveData(proposal.data))
      return Response.json(
        { error: "Proposal contains sensitive fields and cannot be applied." },
        { status: 400 },
      );

    let normalized: NormalizedData | undefined;

    try {
      if (proposal.action === "updateGlobal") {
        if (!isKnownGlobal(req, proposal.slug))
          return Response.json({ error: "Unknown global" }, { status: 400 });

        const globalConfig = req.payload.config.globals?.find(
          (global) => global.slug === proposal.slug,
        );
        normalized = normalizeDataForFields(
          (globalConfig?.fields || []) as FieldConfig[],
          proposal.data,
        );
        const doc = await req.payload.updateGlobal({
          data: normalized.data,
          overrideAccess: false,
          req,
          slug: proposal.slug as never,
        });

        return Response.json({
          doc: getAppliedDocReference(doc),
          status: "applied",
        });
      }

      if (
        !isAllowedCollection(
          req,
          proposal.collection,
          options.collections,
          proposal.action,
        )
      )
        return Response.json({ error: "Unknown collection" }, { status: 400 });

      if (proposal.action === "delete") {
        const doc = await req.payload.delete({
          collection: proposal.collection as never,
          id: proposal.id,
          overrideAccess: false,
          req,
        });

        return Response.json({
          doc: getAppliedDocReference(doc),
          status: "applied",
        });
      }

      const collectionConfig = req.payload.config.collections.find(
        (collection) => collection.slug === proposal.collection,
      ) as CollectionConfig | undefined;
      normalized = normalizeAuthData(
        collectionConfig,
        normalizeDataForFields(
          getCollectionFields(collectionConfig),
          proposal.data,
        ),
      );

      if (
        proposal.action === "create" &&
        isAuthCollection(collectionConfig) &&
        !normalized.data.password
      ) {
        return Response.json(
          {
            error: "Password is required when creating a user.",
          },
          { status: 400 },
        );
      }

      if (
        proposal.action === "create" &&
        isAuthCollection(collectionConfig) &&
        !normalized.data.email
      ) {
        return Response.json(
          {
            error: "Email is required when creating a user.",
          },
          { status: 400 },
        );
      }

      if (proposal.action === "create") {
        const doc = await req.payload.create({
          collection: proposal.collection as never,
          data: normalized.data,
          overrideAccess: false,
          req,
        });

        return Response.json({
          doc: getAppliedDocReference(doc),
          status: "applied",
        });
      }

      const doc = await req.payload.update({
        collection: proposal.collection as never,
        data: normalized.data,
        id: proposal.id,
        overrideAccess: false,
        req,
      });

      return Response.json({
        doc: getAppliedDocReference(doc),
        status: "applied",
      });
    } catch (err) {
      req.payload.logger.error({
        err,
        msg: "AI apply action failed",
        proposal: getProposalMeta(proposal),
      });

      return Response.json(
        {
          error: "Could not apply proposal.",
        },
        { status: 400 },
      );
    }
  };
