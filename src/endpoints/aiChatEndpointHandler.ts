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

type FieldConfig = {
    fields?: FieldConfig[];
    hasMany?: boolean;
    name?: string;
    relationTo?: unknown;
    required?: boolean;
    type?: string;
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

const getProviderConfig = ({
    apiKey,
    model,
    provider,
}: {
    apiKey?: string | null;
    model?: string | null;
    provider: AIProvider;
}) => {
    if (provider === "claude") {
        return {
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
            modelID:
                model || process.env.ANTHROPIC_MODEL || defaultAIModels.claude,
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

const getModel = ({
    apiKey,
    modelID,
    provider,
}: {
    apiKey: string;
    modelID: string;
    provider: AIProvider;
}) => {
    if (provider === "claude") {
        return createAnthropic({ apiKey })(modelID);
    }

    if (provider === "google") {
        return createGoogleGenerativeAI({ apiKey })(modelID);
    }

    if (provider === "groq") {
        return createGroq({ apiKey })(modelID);
    }

    if (provider === "mistral") {
        return createMistral({ apiKey })(modelID);
    }

    return createOpenAI({ apiKey })(modelID);
};

const getErrorDetails = (err: unknown) => {
    if (err instanceof Error) {
        return {
            message: err.message,
            name: err.name,
            stack:
                process.env.NODE_ENV === "development" ? err.stack : undefined,
        };
    }

    return {
        message: String(err),
        name: "UnknownError",
    };
};

const describeField = (field: FieldConfig): Record<string, unknown> => {
    return {
        ...(field.name ? { name: field.name } : {}),
        ...(field.type ? { type: field.type } : {}),
        ...(field.required ? { required: field.required } : {}),
        ...(field.hasMany ? { hasMany: field.hasMany } : {}),
        ...(field.relationTo ? { relationTo: field.relationTo } : {}),
        ...(field.fields ? { fields: field.fields.map(describeField) } : {}),
    };
};

export const aiChatEndpointHandler: PayloadHandler = async (req) => {
    if (!req.user) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = req.json
        ? ((await req.json().catch(() => null)) as AIChatBody | null)
        : null;
    const prompt = body?.prompt?.trim();

    if (!prompt) {
        return Response.json({ error: "Prompt is required" }, { status: 400 });
    }

    const user = req.user as AIUser;
    const requestedProvider = body?.provider || user.aiProvider || "openai";

    if (!isAIProvider(requestedProvider)) {
        return Response.json(
            { error: `Unsupported AI provider: ${requestedProvider}` },
            { status: 400 },
        );
    }

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
        const collectionSlugs = req.payload.config.collections.map(
            (collection) => collection.slug,
        );
        const collectionSlugSchema = z.enum(
            collectionSlugs as [string, ...string[]],
        );
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
                    return req.payload.config.collections.map((collection) => ({
                        fields: (collection.fields as FieldConfig[]).map(
                            describeField,
                        ),
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
                    const globalConfig = req.payload.config.globals?.find(
                        (global) => global.slug === slug,
                    );

                    if (!globalConfig) {
                        return { error: `Unknown global: ${slug}` };
                    }

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
                            fields: global.fields.map((field) =>
                                "name" in field
                                    ? {
                                          name: field.name,
                                          type: field.type,
                                      }
                                    : {
                                          type: field.type,
                                      },
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
                execute: async ({
                    collection,
                    data,
                    label,
                }: CollectionInput & DataInput & LabelInput) => {
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
                execute: async ({
                    collection,
                    data,
                    id,
                    label,
                }: CollectionInput & DataInput & DocIDInput & LabelInput) => {
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
                execute: async ({
                    data,
                    label,
                    slug,
                }: DataInput & LabelInput & SlugInput) => {
                    const globalConfig = req.payload.config.globals?.find(
                        (global) => global.slug === slug,
                    );

                    if (!globalConfig) {
                        return { error: `Unknown global: ${slug}` };
                    }

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
                execute: async ({
                    collection,
                    limit,
                    query,
                }: CollectionInput & { limit: number; query?: string }) => {
                    const collectionConfig =
                        req.payload.config.collections.find(
                            (item) => item.slug === collection,
                        );
                    const searchableFields =
                        collectionConfig?.fields
                            .filter(
                                (field) =>
                                    "name" in field &&
                                    ["email", "text", "textarea"].includes(
                                        field.type,
                                    ),
                            )
                            .map((field) =>
                                "name" in field ? field.name : null,
                            )
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
            model: getModel({
                apiKey: providerConfig.apiKey,
                modelID: providerConfig.modelID,
                provider,
            }),
            prompt,
            stopWhen: stepCountIs(6),
            system: [
                "You are a CMS assistant inside Payload CMS.",
                "Use tools to inspect CMS schema and content before answering content questions.",
                "Never claim that a write has been applied unless the user confirms an action proposal in the UI.",
                "For create, update, and delete requests, call the proposal tools instead of directly changing data.",
                "Keep responses concise and mention proposed actions when relevant.",
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
