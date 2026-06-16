import type { PayloadHandler } from "payload";

import { generateText, stepCountIs } from "ai";
import { z } from "zod";

import {
  signAIActionProposal,
  type AIActionSignature,
} from "../ai/proposals.js";
import { getModel, getProviderConfig } from "../ai/providerRuntime.js";
import {
  isAIProvider,
  type AIProvider,
  type AIModelConfig,
} from "../ai/providerOptions.js";
import { containsSensitiveData } from "../ai/sensitiveData.js";
import {
  buildPromptWithMentionContext,
  collectBlocks,
  describeField,
  getAllowedCollectionSlugs,
  getMentionContext,
  type AIChatMention,
  type FieldConfig,
} from "../payload/schemaContext.js";
import {
  getCollectionPermissions,
  isCollectionActionAllowed,
  type AICollectionAction,
  type ResolvedAICollectionPermissionMap,
} from "../payload/collectionPermissions.js";

type AIChatBody = {
  mentions?: AIChatMention[];
  model?: string;
  prompt?: string;
  provider?: string;
};

type AIUser = {
  aiApiKey?: string | null;
  aiProvider?: AIProvider | string | null;
};

type AIChatDebug = {
  model: string;
  provider: string;
  tools: string[];
};

type CollectionInput = {
  collection: string;
};

type DataInput = {
  data: Record<string, unknown>;
};

type DocIDInput = {
  id: string;
};

type LabelInput = {
  label: string;
};

type SlugInput = {
  slug: string;
};

export type AIActionProposal = (
  | {
      action: "create";
      collection: string;
      data: Record<string, unknown>;
      label: string;
    }
  | {
      action: "delete";
      collection: string;
      id: string;
      label: string;
    }
  | {
      action: "update";
      collection: string;
      data: Record<string, unknown>;
      id: string;
      label: string;
    }
  | {
      action: "updateGlobal";
      data: Record<string, unknown>;
      label: string;
      slug: string;
    }
) & {
  _aiSignature?: AIActionSignature;
};

type AIChatEndpointOptions = {
  allowUserApiKeys?: boolean;
  collections?: ResolvedAICollectionPermissionMap;
  models?: AIModelConfig;
};

export const createAIChatEndpointHandler =
  (options: AIChatEndpointOptions = {}): PayloadHandler =>
  async (req) => {
    if (!req.user)
      return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = req.json
      ? ((await req.json().catch(() => null)) as AIChatBody | null)
      : null;

    const prompt = body?.prompt?.trim();
    if (!prompt)
      return Response.json({ error: "Prompt is required" }, { status: 400 });

    const user = req.user as AIUser;
    const requestedProvider = body?.provider || user.aiProvider || "openai";

    if (!isAIProvider(requestedProvider))
      return Response.json(
        { error: `Unsupported AI provider: ${requestedProvider}` },
        { status: 400 },
      );

    const provider = requestedProvider;
    const userApiKey =
      options.allowUserApiKeys === false ? null : user.aiApiKey;
    const providerConfig = getProviderConfig({
      apiKey: userApiKey,
      defaultModels: options.models?.defaults,
      model: body?.model,
      provider,
    });
    const debug: AIChatDebug = {
      model: providerConfig.modelID,
      provider,
      tools: [
        "getDoc",
        "getGlobal",
        "listCollections",
        "listGlobals",
        "proposeCreateDoc",
        "proposeDeleteDoc",
        "proposeUpdateDoc",
        "proposeUpdateGlobal",
        "searchDocs",
      ],
    };

    if (!providerConfig.apiKey) {
      return Response.json(
        {
          error:
            options.allowUserApiKeys === false
              ? `Configure a ${provider} API key in the server environment first.`
              : `Add a ${provider} API key to your account settings or configure it in the server environment first.`,
        },
        { status: 400 },
      );
    }

    try {
      const proposals: AIActionProposal[] = [];
      const addSignedProposal = <Proposal extends AIActionProposal>(
        proposal: Proposal,
      ) => {
        if ("data" in proposal && containsSensitiveData(proposal.data)) {
          return {
            error: "Proposal contains sensitive fields and cannot be created.",
          };
        }

        const signedProposal = signAIActionProposal(proposal);

        proposals.push(signedProposal);
        return signedProposal;
      };
      const collectionSlugs = getAllowedCollectionSlugs(
        req,
        options.collections,
      );
      const globalSlugs =
        req.payload.config.globals?.map((global) => global.slug) || [];
      const allowedCollections = req.payload.config.collections.filter(
        (collection) => collectionSlugs.includes(collection.slug),
      );

      if (collectionSlugs.length === 0) {
        return Response.json(
          { error: "No AI-enabled collections are configured." },
          { status: 400 },
        );
      }

      const blockContexts = [
        ...allowedCollections.flatMap((collection) =>
          collectBlocks({
            fields: collection.fields as FieldConfig[],
            parent: collection.slug,
          }),
        ),
        ...(req.payload.config.globals?.flatMap((global) =>
          collectBlocks({
            fields: global.fields as FieldConfig[],
            parent: global.slug,
          }),
        ) || []),
      ];
      const mentionContext = await getMentionContext({
        blockContexts,
        collectionSlugs,
        globalSlugs,
        mentions: body?.mentions,
        req,
      });
      const collectionSlugSchema = z.enum(
        collectionSlugs as [string, ...string[]],
      );
      const getDisallowedCollectionActionError = (
        collection: string,
        action: AICollectionAction,
      ) => {
        if (
          isCollectionActionAllowed({
            action,
            permissions: options.collections,
            req,
            slug: collection,
          })
        )
          return null;

        return {
          error: `${action} is not enabled for collection: ${collection}`,
        };
      };
      const tools = {
        getDoc: {
          description: "Read one document by collection slug and document id.",
          inputSchema: z.object({
            collection: collectionSlugSchema,
            id: z.string().min(1),
          }),
          execute: async ({ collection, id }: CollectionInput & DocIDInput) => {
            return req.payload.findByID({
              collection: collection as never,
              depth: 2,
              id,
              overrideAccess: false,
              req,
            });
          },
        },
        listCollections: {
          description:
            "List all Payload CMS collections available in this app.",
          inputSchema: z.object({}),
          execute: async () => {
            return allowedCollections.map((collection) => ({
              fields: (collection.fields as FieldConfig[]).map(describeField),
              label: collection.labels?.plural || collection.slug,
              permissions: getCollectionPermissions({
                permissions: options.collections,
                slug: collection.slug,
              }),
              slug: collection.slug,
            }));
          },
        },
        getGlobal: {
          description: "Read one Payload CMS global by slug.",
          inputSchema: z.object({
            slug: z.string().min(1),
          }),
          execute: async ({ slug }: SlugInput) => {
            const globalConfig = req.payload.config.globals?.find(
              (global) => global.slug === slug,
            );
            if (!globalConfig) return { error: `Unknown global: ${slug}` };

            return req.payload.findGlobal({
              depth: 2,
              overrideAccess: false,
              req,
              slug: slug as never,
            });
          },
        },
        listGlobals: {
          description: "List all Payload CMS globals available in this app.",
          inputSchema: z.object({}),
          execute: async () => {
            return (
              req.payload.config.globals?.map((global) => ({
                fields: (global.fields as FieldConfig[]).map(describeField),
                label: global.label || global.slug,
                slug: global.slug,
              })) || []
            );
          },
        },
        proposeCreateDoc: {
          description:
            "Prepare a CMS document creation proposal. This does not write to the database. Use exact field names from listCollections. For array fields, provide arrays of objects matching their child fields. For richText fields, prefer plain text or omit if unsure.",
          inputSchema: z.object({
            collection: collectionSlugSchema,
            data: z.record(z.string(), z.unknown()),
            label: z.string().min(1),
          }),
          execute: async ({
            collection,
            data,
            label,
          }: CollectionInput & DataInput & LabelInput) => {
            const permissionError = getDisallowedCollectionActionError(
              collection,
              "create",
            );
            if (permissionError) return permissionError;

            const proposal: AIActionProposal = {
              action: "create",
              collection,
              data,
              label,
            };

            return addSignedProposal(proposal);
          },
        },
        proposeDeleteDoc: {
          description:
            "Prepare a CMS document deletion proposal. This does not write to the database.",
          inputSchema: z.object({
            collection: collectionSlugSchema,
            id: z.string().min(1),
            label: z.string().min(1),
          }),
          execute: async ({
            collection,
            id,
            label,
          }: CollectionInput & DocIDInput & LabelInput) => {
            const permissionError = getDisallowedCollectionActionError(
              collection,
              "delete",
            );
            if (permissionError) return permissionError;

            const proposal: AIActionProposal = {
              action: "delete",
              collection,
              id,
              label,
            };

            return addSignedProposal(proposal);
          },
        },
        proposeUpdateDoc: {
          description:
            "Prepare a CMS document update proposal. This does not write to the database. Use exact field names from listCollections. For array fields, provide arrays of objects matching their child fields. For richText fields, prefer plain text or omit if unsure.",
          inputSchema: z.object({
            collection: collectionSlugSchema,
            data: z.record(z.string(), z.unknown()),
            id: z.string().min(1),
            label: z.string().min(1),
          }),
          execute: async ({
            collection,
            data,
            id,
            label,
          }: CollectionInput & DataInput & DocIDInput & LabelInput) => {
            const permissionError = getDisallowedCollectionActionError(
              collection,
              "update",
            );
            if (permissionError) return permissionError;

            const proposal: AIActionProposal = {
              action: "update",
              collection,
              data,
              id,
              label,
            };

            return addSignedProposal(proposal);
          },
        },
        proposeUpdateGlobal: {
          description:
            "Prepare a Payload global update proposal. This does not write to the database.",
          inputSchema: z.object({
            data: z.record(z.string(), z.unknown()),
            label: z.string().min(1),
            slug: z.string().min(1),
          }),
          execute: async ({
            data,
            label,
            slug,
          }: DataInput & LabelInput & SlugInput) => {
            const globalConfig = req.payload.config.globals?.find(
              (global) => global.slug === slug,
            );
            if (!globalConfig) return { error: `Unknown global: ${slug}` };

            const proposal: AIActionProposal = {
              action: "updateGlobal",
              data,
              label,
              slug,
            };

            return addSignedProposal(proposal);
          },
        },
        searchDocs: {
          description:
            "Search documents in one collection. Use query for a loose text search where possible.",
          inputSchema: z.object({
            collection: collectionSlugSchema,
            limit: z.number().int().min(1).max(10).default(5),
            query: z.string().optional(),
          }),
          execute: async ({
            collection,
            limit,
            query,
          }: CollectionInput & { limit: number; query?: string }) => {
            const collectionConfig = allowedCollections.find(
              (item) => item.slug === collection,
            );
            const searchableFields =
              collectionConfig?.fields
                .filter(
                  (field) =>
                    "name" in field &&
                    ["email", "text", "textarea"].includes(field.type),
                )
                .map((field) => ("name" in field ? field.name : null))
                .filter(Boolean) || [];

            const where =
              query && searchableFields.length > 0
                ? {
                    or: searchableFields.map((field) => ({
                      [field as string]: {
                        contains: query,
                      },
                    })),
                  }
                : undefined;

            return req.payload.find({
              collection: collection as never,
              depth: 1,
              limit,
              overrideAccess: false,
              req,
              where,
            });
          },
        },
      };
      const result = await generateText({
        maxOutputTokens: 700,
        model: getModel({
          apiKey: providerConfig.apiKey,
          model: providerConfig.modelID,
          provider,
        }),
        prompt: buildPromptWithMentionContext({
          mentionContext,
          prompt,
        }),
        stopWhen: stepCountIs(6),
        system: [
          "You are a CMS assistant inside Payload CMS.",
          "Use tools to inspect CMS schema and content before answering content questions.",
          "When mention context is provided, use it as the selected CMS scope and prefer it over guessing collection names.",
          "Never claim that a write has been applied unless the user confirms an action proposal in the UI.",
          "For create, update, and delete requests, call the proposal tools instead of directly changing data.",
          "Keep the visible response under 80 words. Put concrete changes in proposal tool calls instead of long prose.",
        ].join("\n"),
        tools,
      });

      return Response.json({ proposals, text: result.text });
    } catch (err) {
      req.payload.logger.error({
        debug,
        err,
        msg: "AI chat request failed",
      });

      return Response.json(
        {
          error: "AI request failed.",
        },
        { status: 500 },
      );
    }
  };
