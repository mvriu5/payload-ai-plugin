import type { PayloadHandler } from "payload";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";

import {
    defaultAIModels,
    isAIProvider,
    type AIProvider,
} from "../ai/providerOptions.js";

type AIChatBody = {
    mentions?: AIChatMention[];
    model?: string;
    prompt?: string;
    provider?: string;
};

type AIChatMention = {
    collection?: string;
    id?: string;
    label?: string;
    parent?: string;
    slug?: string;
    type?: "block" | "collection" | "doc" | "global";
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

type FieldConfig = {
    blocks?: BlockConfig[];
    fields?: FieldConfig[];
    hasMany?: boolean;
    label?: unknown;
    name?: string;
    relationTo?: unknown;
    required?: boolean;
    type?: string;
};

type BlockConfig = {
    fields?: FieldConfig[];
    labels?: {
        plural?: unknown;
        singular?: unknown;
    };
    slug: string;
};

export type AIActionProposal =
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
    };

interface ProviderConfig {
    apiKey?: string | null;
    model?: string | null;
    provider: AIProvider;
}

interface ModelConfig {
    apiKey: string;
    model: string;
    provider: AIProvider;
}

interface MentionContext {
    blockContexts: (Record<string, unknown> & {
        parent: string;
        slug: string;
    })[];
    collectionSlugs: string[];
    globalSlugs: string[];
    mentions?: AIChatMention[];
    req: Parameters<PayloadHandler>[0];
}

type AIChatEndpointOptions = {
    collections?: string[];
};

const getProviderConfig = ({ apiKey, model, provider }: ProviderConfig) => {
    if (provider === "claude") {
        return {
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
            modelID: model || process.env.ANTHROPIC_MODEL || defaultAIModels.claude,
        };
    }

    if (provider === "google") {
        return {
            apiKey: apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            modelID:
                model ||
                process.env.GOOGLE_GENERATIVE_AI_MODEL ||
                defaultAIModels.google,
        };
    }

    if (provider === "groq") {
        return {
            apiKey: apiKey || process.env.GROQ_API_KEY,
            modelID: model || process.env.GROQ_MODEL || defaultAIModels.groq,
        };
    }

    if (provider === "mistral") {
        return {
            apiKey: apiKey || process.env.MISTRAL_API_KEY,
            modelID:
                model || process.env.MISTRAL_MODEL || defaultAIModels.mistral,
        };
    }

    return {
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        modelID: model || process.env.OPENAI_MODEL || defaultAIModels.openai,
    };
};

const getModel = ({ apiKey, model, provider }: ModelConfig) => {
    if (provider === "claude") return createAnthropic({ apiKey })(model);
    if (provider === "google") return createGoogleGenerativeAI({ apiKey })(model);
    if (provider === "groq") return createGroq({ apiKey })(model);
    if (provider === "mistral") return createMistral({ apiKey })(model);
    return createOpenAI({ apiKey })(model);
};

const getErrorDetails = (err: unknown) => {
    if (err instanceof Error) {
        return {
            message: err.message,
            name: err.name,
            stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
        };
    }

    return {
        message: String(err),
        name: "UnknownError",
    };
};

const getSerializableLabel = (label: unknown) => {
    if (typeof label === "string") {
        return label;
    }

    if (label && typeof label === "object") {
        const firstLabel = Object.values(label).find(
            (value) => typeof value === "string",
        );

        if (typeof firstLabel === "string") {
            return firstLabel;
        }
    }

    return undefined;
};

const getSerializableRelationTo = (relationTo: unknown) => {
    if (typeof relationTo === "string") {
        return relationTo;
    }

    if (
        Array.isArray(relationTo) &&
        relationTo.every((item) => typeof item === "string")
    ) {
        return relationTo;
    }

    return undefined;
};

const describeField = (field: FieldConfig): Record<string, unknown> => {
    const label = getSerializableLabel(field.label);
    const relationTo = getSerializableRelationTo(field.relationTo);

    return {
        ...(label ? { label } : {}),
        ...(field.name ? { name: field.name } : {}),
        ...(field.type ? { type: field.type } : {}),
        ...(field.required ? { required: field.required } : {}),
        ...(field.hasMany ? { hasMany: field.hasMany } : {}),
        ...(relationTo ? { relationTo } : {}),
        ...(field.fields ? { fields: field.fields.map(describeField) } : {}),
        ...(field.blocks ? { blocks: field.blocks.map(describeBlock) } : {}),
    };
};

const describeBlock = (block: BlockConfig): Record<string, unknown> => {
    return {
        fields: (block.fields || []).map(describeField),
        label: getSerializableLabel(block.labels?.singular) || block.slug,
        slug: block.slug,
    };
};

const collectBlocks = ({ fields, parent }: { fields: FieldConfig[], parent: string }) => {
    const blocks: (Record<string, unknown> & {
        parent: string;
        slug: string;
    })[] = [];

    for (const field of fields) {
        if (field.type === "blocks" && field.blocks) {
            for (const block of field.blocks) {
                blocks.push({
                    ...describeBlock(block),
                    parent,
                    slug: block.slug,
                });

                blocks.push(
                    ...collectBlocks({
                        fields: block.fields || [],
                        parent: `${parent}/${block.slug}`,
                    }),
                );
            }
        }

        if (field.fields) {
            blocks.push(
                ...collectBlocks({
                    fields: field.fields,
                    parent,
                }),
            );
        }
    }

    return blocks;
};

const isInternalCollection = (slug: string) => slug.startsWith("payload-") || slug === "plugin-collection";

const getAllowedCollectionSlugs = (req: Parameters<PayloadHandler>[0], collections?: string[]) => {
    const configuredSlugs = req.payload.config.collections
        .map((collection) => collection.slug)
        .filter((slug) => !isInternalCollection(slug));

    if (!collections) return configuredSlugs;

    return configuredSlugs.filter((slug) => collections.includes(slug));
};

const getMentionContext = async ({ blockContexts, collectionSlugs, globalSlugs, mentions, req }: MentionContext) => {
    if (!mentions || mentions.length === 0) return [];

    const context: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    for (const mention of mentions.slice(0, 8)) {
        if (mention.type === "collection" && mention.slug) {
            const slug = mention.slug;
            const key = `collection:${slug}`;

            if (seen.has(key) || isInternalCollection(slug) || !collectionSlugs.includes(slug)) continue;

            const collectionConfig = req.payload.config.collections.find((collection) => collection.slug === slug)
            if (!collectionConfig) continue;

            seen.add(key);
            context.push({
                fields: (collectionConfig.fields as FieldConfig[]).map(describeField,),
                label:
                    collectionConfig.labels?.plural ||
                    collectionConfig.labels?.singular ||
                    slug,
                slug,
                type: "collection",
            });
        }

        if (mention.type === "global" && mention.slug) {
            const slug = mention.slug;
            const key = `global:${slug}`;

            if (seen.has(key) || !globalSlugs.includes(slug)) continue

            const globalConfig = req.payload.config.globals?.find((global) => global.slug === slug);
            if (!globalConfig) continue;

            const globalDoc = await req.payload
                .findGlobal({
                    depth: 2,
                    overrideAccess: false,
                    req,
                    slug: slug as never,
                })
                .catch(() => null);

            seen.add(key);
            context.push({
                doc: globalDoc,
                fields: (globalConfig.fields as FieldConfig[]).map(describeField),
                label: globalConfig.label || slug,
                slug,
                type: "global",
            });
        }

        if (mention.type === "block" && mention.slug) {
            const matchingBlocks = blockContexts.filter((block) =>
                block.slug === mention.slug &&
                (!mention.parent || block.parent === mention.parent),
            );

            for (const block of matchingBlocks) {
                const key = `block:${block.parent}:${block.slug}`;

                if (seen.has(key)) continue;

                seen.add(key);
                context.push({
                    ...block,
                    type: "block",
                });
            }
        }

        if (mention.type === "doc" && mention.collection && mention.id) {
            const slug = mention.collection;
            const key = `doc:${slug}:${mention.id}`;

            if (seen.has(key) || isInternalCollection(slug) || !collectionSlugs.includes(slug)) continue;

            const doc = await req.payload
                .findByID({
                    collection: slug as never,
                    depth: 2,
                    id: mention.id,
                    overrideAccess: false,
                    req,
                })
                .catch(() => null);

            if (!doc) continue;

            seen.add(key);
            context.push({
                collection: slug,
                doc,
                id: mention.id,
                label: mention.label || mention.id,
                type: "doc",
            });
        }
    }

    return context;
};

const buildPromptWithMentionContext = ({ mentionContext, prompt }: { mentionContext: Record<string, unknown>[], prompt: string }) => {
    if (mentionContext.length === 0) return prompt;

    return [
        "The user selected the following Payload CMS references in the input. Treat inline text like `collection: Name` or `document: Name` as references to this context, not as literal content.",
        JSON.stringify(mentionContext, null, 2),
        "User request:",
        prompt,
    ].join("\n\n");
};

export const createAIChatEndpointHandler = (options: AIChatEndpointOptions = {}): PayloadHandler => async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = req.json ? ((await req.json().catch(() => null)) as AIChatBody | null) : null;

    const prompt = body?.prompt?.trim();
    if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 });

    const user = req.user as AIUser;
    const requestedProvider = body?.provider || user.aiProvider || "openai";

    if (!isAIProvider(requestedProvider))
        return Response.json({ error: `Unsupported AI provider: ${requestedProvider}` }, { status: 400 });

    const provider = requestedProvider;
    const providerConfig = getProviderConfig({
        apiKey: user.aiApiKey,
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
                debug,
                error: `Add a ${provider} API key to your account settings first.`,
            },
            { status: 400 },
        );
    }

    try {
        const proposals: AIActionProposal[] = [];
        const collectionSlugs = getAllowedCollectionSlugs(req, options.collections);
        const globalSlugs = req.payload.config.globals?.map((global) => global.slug) || [];
        const allowedCollections = req.payload.config.collections.filter((collection) =>
            collectionSlugs.includes(collection.slug),
        );

        if (collectionSlugs.length === 0) {
            return Response.json(
                { debug, error: "No AI-enabled collections are configured." },
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
        const collectionSlugSchema = z.enum(collectionSlugs as [string, ...string[]]);
        const tools = {
            getDoc: {
                description:
                    "Read one document by collection slug and document id.",
                inputSchema: z.object({
                    collection: collectionSlugSchema,
                    id: z.string().min(1),
                }),
                execute: async ({
                    collection,
                    id,
                }: CollectionInput & DocIDInput) => {
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
                    const globalConfig = req.payload.config.globals?.find((global) => global.slug === slug);
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
                description:
                    "List all Payload CMS globals available in this app.",
                inputSchema: z.object({}),
                execute: async () => {
                    return (
                        req.payload.config.globals?.map((global) => ({
                            fields: (global.fields as FieldConfig[]).map(
                                describeField,
                            ),
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
                execute: async ({ collection, data, label }: CollectionInput & DataInput & LabelInput) => {
                    const proposal: AIActionProposal = {
                        action: "create",
                        collection,
                        data,
                        label,
                    };

                    proposals.push(proposal);
                    return proposal;
                },
            },
            proposeDeleteDoc: {
                description: "Prepare a CMS document deletion proposal. This does not write to the database.",
                inputSchema: z.object({
                    collection: collectionSlugSchema,
                    id: z.string().min(1),
                    label: z.string().min(1),
                }),
                execute: async ({ collection, id, label }: CollectionInput & DocIDInput & LabelInput) => {
                    const proposal: AIActionProposal = {
                        action: "delete",
                        collection,
                        id,
                        label,
                    };

                    proposals.push(proposal);
                    return proposal;
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
                execute: async ({ collection, data, id, label }: CollectionInput & DataInput & DocIDInput & LabelInput) => {
                    const proposal: AIActionProposal = {
                        action: "update",
                        collection,
                        data,
                        id,
                        label,
                    };

                    proposals.push(proposal);
                    return proposal;
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
                execute: async ({ data, label, slug }: DataInput & LabelInput & SlugInput) => {
                    const globalConfig = req.payload.config.globals?.find((global) => global.slug === slug);
                    if (!globalConfig) return { error: `Unknown global: ${slug}` };

                    const proposal: AIActionProposal = {
                        action: "updateGlobal",
                        data,
                        label,
                        slug,
                    };

                    proposals.push(proposal);
                    return proposal;
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
                execute: async ({ collection, limit, query }: CollectionInput & { limit: number; query?: string }) => {
                    const collectionConfig = allowedCollections.find((item) => item.slug === collection);
                    const searchableFields = collectionConfig?.fields.filter((field) =>
                            "name" in field &&
                            ["email", "text", "textarea"].includes(field.type))
                        .map((field) => "name" in field ? field.name : null)
                        .filter(Boolean) || [];

                    const where = query && searchableFields.length > 0
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

        return Response.json({ debug, proposals, text: result.text });
    } catch (err) {
        const error = getErrorDetails(err);

        req.payload.logger.error({
            debug,
            err,
            msg: "AI chat request failed",
        });

        return Response.json(
            {
                debug,
                error: error.message,
                errorDetails: error,
            },
            { status: 500 },
        );
    }
};

export const aiChatEndpointHandler = createAIChatEndpointHandler();
