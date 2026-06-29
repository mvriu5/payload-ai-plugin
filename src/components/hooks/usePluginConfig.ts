import { useMemo } from "react"
import {
    getLegacyAIProviderProfiles,
    getResolvedAIModelConfig,
    type AIModelConfig,
    type AIProviderProfile,
} from "../../ai/providerOptions.js"

type PayloadAIAdminCustom = {
    payloadAiPlugin?: {
        collectionSlugs?: string[]
        media?: MediaConfig
        managedProviders?: boolean
        models?: AIModelConfig
        providers?: AIProviderProfile[]
    }
}

type MediaConfig = {
    acceptedMimeTypes?: string[]
    collectionSlug: string
    enabled: boolean
    maxFileSize?: number
}

type LocaleConfig =
    | string
    | {
          code?: string
          label?: unknown
      }

type LocalizationConfig =
    | false
    | {
          defaultLocale?: string
          locales?: LocaleConfig[]
      }

export const usePluginConfig = (config: {
    admin?: {
        custom?: unknown
    }
    localization?: LocalizationConfig
}) => {
    const pluginConfig = (config.admin?.custom as PayloadAIAdminCustom | undefined)?.payloadAiPlugin

    const aiModelConfig = useMemo(() => getResolvedAIModelConfig(pluginConfig?.models), [pluginConfig?.models])
    const providerProfiles = useMemo(
        () => (pluginConfig?.managedProviders ? pluginConfig.providers || [] : getLegacyAIProviderProfiles(pluginConfig?.models)),
        [pluginConfig?.managedProviders, pluginConfig?.models, pluginConfig?.providers]
    )

    const enabledCollectionSlugSet = useMemo(
        () => (pluginConfig?.collectionSlugs ? new Set(pluginConfig.collectionSlugs) : null),
        [pluginConfig?.collectionSlugs]
    )

    const localization = config.localization && typeof config.localization === "object" ? config.localization : null

    return {
        aiModelConfig,
        defaultLocale: localization?.defaultLocale,
        enabledCollectionSlugSet,
        isCollectionMentionEnabled: (slug: string) => !enabledCollectionSlugSet || enabledCollectionSlugSet.has(slug),
        locales: localization?.locales ?? [],
        managedProviders: Boolean(pluginConfig?.managedProviders),
        media: pluginConfig?.media,
        providerProfiles,
    }
}
