import type { CollectionConfig } from "payload"

import { tokenUsageCollectionSlug } from "../features/tokenUsage.js"

export const createAIChangesCollection = (): CollectionConfig => ({
    slug: "payload-ai-auditlog",
    access: {
        create: () => false,
        delete: () => false,
        read: ({ req }) => Boolean(req.user),
        update: () => false,
    },
    admin: {
        defaultColumns: ["title", "action", "additions", "removals", "createdAt"],
        group: "AI",
        useAsTitle: "title",
    },
    labels: {
        plural: "AI Changes",
        singular: "AI Change",
    },
    fields: [
        {
            name: "title",
            type: "text",
            required: true,
        },
        {
            name: "action",
            type: "select",
            options: ["create", "update", "delete", "updateGlobal"],
            required: true,
        },
        {
            name: "targetType",
            type: "select",
            options: ["collection", "global"],
            required: true,
        },
        {
            name: "collection",
            type: "text",
        },
        {
            name: "slug",
            type: "text",
        },
        {
            name: "documentID",
            type: "text",
        },
        {
            name: "targetURL",
            type: "text",
        },
        {
            name: "additions",
            type: "number",
            defaultValue: 0,
        },
        {
            name: "removals",
            type: "number",
            defaultValue: 0,
        },
        {
            name: "before",
            type: "json",
        },
        {
            name: "after",
            type: "json",
        },
        {
            name: "proposal",
            type: "json",
        },
        {
            name: "prompt",
            type: "textarea",
        },
        {
            name: "inputTokens",
            type: "number",
        },
        {
            name: "outputTokens",
            type: "number",
        },
        {
            name: "totalTokens",
            type: "number",
        },
        {
            name: "aiResponse",
            type: "textarea",
        },
        {
            name: "userID",
            type: "text",
        },
        {
            name: "userLabel",
            type: "text",
        },
    ],
    timestamps: true,
})

export const createAITokenUsageCollection = (): CollectionConfig => ({
    slug: tokenUsageCollectionSlug,
    access: {
        create: () => false,
        delete: () => false,
        read: () => false,
        update: () => false,
    },
    admin: {
        hidden: true,
    },
    fields: [
        {
            name: "userID",
            type: "text",
            index: true,
            required: true,
        },
        {
            name: "provider",
            type: "text",
            required: true,
        },
        {
            name: "model",
            type: "text",
            required: true,
        },
        {
            name: "inputTokens",
            type: "number",
        },
        {
            name: "outputTokens",
            type: "number",
        },
        {
            name: "totalTokens",
            type: "number",
            required: true,
        },
        {
            name: "recordedAt",
            type: "date",
            index: true,
            required: true,
        },
    ],
    timestamps: true,
})
