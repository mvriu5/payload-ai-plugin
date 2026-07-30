import type { Condition, Config } from "payload"

import {
    aiProviders,
    type getResolvedAIModelConfig,
    type ResolvedAIProviderConfig,
    toClientAIProviderProfiles,
} from "../ai/providerOptions.js"
import type { MediaUploadOptions } from "../handlers/mediaUploadHandler.js"
import { hasLocalizedFields, type TranslationPageContext } from "../payload/documentTranslation.js"
import { isInternalCollection } from "../payload/shared.js"
import { addTextGenerationFields, type TextGenerationPageContext } from "../payload/textFieldGeneration.js"
import type { CollectionTypeAIOptions } from "./types.js"

const hasAuthenticatedUser: Condition = (_data, _siblingData, { user }) => Boolean(user)

export const addAccountFields = ({ allowUserApiKeys, config }: { allowUserApiKeys: boolean; config: Config }) => {
    const adminUserSlug = config.admin?.user
    if (!adminUserSlug || !config.collections) return

    const userCollection = config.collections.find((c) => c.slug === adminUserSlug)
    if (!userCollection) return

    userCollection.fields.push({
        name: "aiProvider",
        type: "select",
        admin: {
            condition: hasAuthenticatedUser,
        },
        defaultValue: "openai",
        label: "AI Provider",
        options: aiProviders,
    })

    if (allowUserApiKeys) {
        userCollection.fields.push({
            name: "aiApiKey",
            type: "text",
            admin: {
                condition: hasAuthenticatedUser,
                components: {
                    Field: "@mvriu5/payload-ai/client#AIApiKeyField",
                },
                description: "Optional. If empty, the plugin uses the provider API key from environment variables.",
            },
            label: "AI API Key",
        })
    }
}

const aiField: any = {
    name: "payloadAi",
    type: "ui",
    admin: {
        condition: hasAuthenticatedUser,
        components: {
            Field: "@mvriu5/payload-ai/client#AIInput",
        },
    },
}

const translateDocumentComponent = "@mvriu5/payload-ai/client#TranslateDocumentButton"

const getEntityLabel = (label: unknown, fallback: string) => {
    if (typeof label === "string") return label
    if (label && typeof label === "object") {
        const translatedLabel = Object.values(label).find((value) => typeof value === "string")
        if (typeof translatedLabel === "string") return translatedLabel
    }

    return fallback
}

export const addAIFieldsToDocumentsAndGlobals = ({
    addGenerateFields,
    addAIInput,
    addTranslation,
    authCollections,
    config,
    uploadCollections,
}: {
    addGenerateFields: boolean
    addAIInput: boolean
    addTranslation: boolean
    authCollections?: CollectionTypeAIOptions
    config: Config
    uploadCollections?: CollectionTypeAIOptions
}) => {
    const pageContexts = new Map<string, TextGenerationPageContext>()
    const translationPageContexts = new Map<string, TranslationPageContext>()

    for (const collection of config.collections || []) {
        if (isInternalCollection(collection.slug)) continue
        if (collection.slug === "payload-ai-auditlog") continue

        const allowAIInput =
            addAIInput &&
            (!collection.auth || authCollections?.aiInput === true) &&
            (!collection.upload || uploadCollections?.aiInput === true)
        const allowGenerateFields =
            addGenerateFields &&
            (!collection.auth || authCollections?.generateFields === true) &&
            (!collection.upload || uploadCollections?.generateFields === true)

        if (allowGenerateFields) {
            const pageContext = addTextGenerationFields({
                fields: collection.fields || [],
                label: getEntityLabel(collection.labels?.singular, collection.slug),
                slug: collection.slug,
                type: "collection",
            })
            pageContexts.set(`collection:${collection.slug}`, pageContext)
        }
        if (allowAIInput) collection.fields = [aiField, ...(collection.fields || [])]
        if (addTranslation && hasLocalizedFields(collection.fields || [])) {
            translationPageContexts.set(`collection:${collection.slug}`, {
                fields: collection.fields || [],
                label: getEntityLabel(collection.labels?.singular, collection.slug),
                slug: collection.slug,
                type: "collection",
            })
            collection.admin = collection.admin || {}
            collection.admin.components = collection.admin.components || {}
            collection.admin.components.edit = collection.admin.components.edit || {}
            const controls = collection.admin.components.edit.beforeDocumentControls || []
            if (!controls.includes(translateDocumentComponent)) {
                collection.admin.components.edit.beforeDocumentControls = [...controls, translateDocumentComponent]
            }
        }
    }

    for (const global of config.globals || []) {
        if (addGenerateFields) {
            const pageContext = addTextGenerationFields({
                fields: global.fields || [],
                label: getEntityLabel(global.label, global.slug),
                slug: global.slug,
                type: "global",
            })
            pageContexts.set(`global:${global.slug}`, pageContext)
        }
        if (addAIInput) global.fields = [aiField, ...(global.fields || [])]
        if (addTranslation && hasLocalizedFields(global.fields || [])) {
            translationPageContexts.set(`global:${global.slug}`, {
                fields: global.fields || [],
                label: getEntityLabel(global.label, global.slug),
                slug: global.slug,
                type: "global",
            })
            global.admin = global.admin || {}
            global.admin.components = global.admin.components || {}
            global.admin.components.elements = global.admin.components.elements || {}
            const controls = global.admin.components.elements.beforeDocumentControls || []
            if (!controls.includes(translateDocumentComponent)) {
                global.admin.components.elements.beforeDocumentControls = [...controls, translateDocumentComponent]
            }
        }
    }

    return {
        textGenerationPageContexts: pageContexts,
        translationPageContexts,
    }
}

export const configureAIAdmin = ({
    allowUserApiKeys,
    collectionSlugs,
    config,
    managedProviders,
    mediaUploadOptions,
    modelConfig,
    providerConfigs,
}: {
    allowUserApiKeys: boolean
    collectionSlugs: string[]
    config: Config
    managedProviders: boolean
    mediaUploadOptions: MediaUploadOptions | null
    modelConfig: ReturnType<typeof getResolvedAIModelConfig>
    providerConfigs: ResolvedAIProviderConfig[]
}) => {
    if (!config.admin) config.admin = {}
    config.admin.custom = {
        ...(config.admin.custom || {}),
        payloadAiPlugin: {
            ...((config.admin.custom?.payloadAiPlugin as Record<string, unknown> | undefined) || {}),
            allowUserApiKeys,
            collectionSlugs,
            managedProviders,
            ...(mediaUploadOptions
                ? {
                      media: {
                          ...mediaUploadOptions,
                          enabled: true,
                      },
                  }
                : {}),
            models: modelConfig,
            providers: toClientAIProviderProfiles(providerConfigs),
        },
    }
    if (!config.admin.components) config.admin.components = {}
    if (!config.admin.components.beforeDashboard) config.admin.components.beforeDashboard = []
    config.admin.components.beforeDashboard.push("@mvriu5/payload-ai/client#Dashboard")
}

