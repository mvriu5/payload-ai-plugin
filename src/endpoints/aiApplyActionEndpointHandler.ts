import type { PayloadHandler } from "payload";

import { verifyAIActionProposal } from "../ai/proposals.js";
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

type AIApplyActionBody = {
  proposal?: AIActionProposal;
};

type AIApplyActionEndpointOptions = {
  collections?: string[];
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
  collections?: string[],
) => {
  if (!collections) return isKnownCollection(req, collection);

  return collections.includes(collection) && isKnownCollection(req, collection);
};

const isKnownGlobal = (req: Parameters<PayloadHandler>[0], slug: string) => {
  return (
    req.payload.config.globals?.some((item) => item.slug === slug) || false
  );
};

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
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

        return Response.json({ doc, normalized, status: "applied" });
      }

      if (!isAllowedCollection(req, proposal.collection, options.collections))
        return Response.json({ error: "Unknown collection" }, { status: 400 });

      if (proposal.action === "delete") {
        const doc = await req.payload.delete({
          collection: proposal.collection as never,
          id: proposal.id,
          overrideAccess: false,
          req,
        });

        return Response.json({ doc, status: "applied" });
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
            normalized,
            proposal,
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
            normalized,
            proposal,
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

        return Response.json({ doc, normalized, status: "applied" });
      }

      const doc = await req.payload.update({
        collection: proposal.collection as never,
        data: normalized.data,
        id: proposal.id,
        overrideAccess: false,
        req,
      });

      return Response.json({ doc, normalized, status: "applied" });
    } catch (err) {
      req.payload.logger.error({
        err,
        msg: "AI apply action failed",
        proposal,
      });

      return Response.json(
        {
          error: getErrorMessage(err),
          normalized,
          proposal,
        },
        { status: 400 },
      );
    }
  };

export const aiApplyActionEndpointHandler =
  createAIApplyActionEndpointHandler();
