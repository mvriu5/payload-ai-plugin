"use client"

import { formatAdminURL } from "payload/shared"
import { useEffect, useState } from "react"
import type { AIProviderProfile } from "../../ai/providerOptions.js"
import { isAbortError } from "../../payload/shared.js"

type CurrentUserResponse = {
    user?: {
        aiProvider?: string | null
    } | null
}

type FetchCurrentUserProviderOptions = {
    adminUserSlug: string
    apiRoute: string
    signal: AbortSignal
}

interface UseAISettingsOptions {
    adminUserSlug?: string
    apiRoute: string
    managedProviders: boolean
    providerProfiles: AIProviderProfile[]
}

type StoredManagedSelection = {
    model: string
    provider: string
}

const managedSelectionKey = "payload-ai:selected-managed-model"
const getStoredModelKey = (provider: string) => `payload-ai:selected-model:${provider}`

const getStoredModel = (provider: string) => {
    if (typeof window === "undefined") return null
    return window.localStorage.getItem(getStoredModelKey(provider))
}

const storeModel = (provider: string, model: string) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(getStoredModelKey(provider), model)
}

const getStoredManagedSelection = (): StoredManagedSelection | null => {
    if (typeof window === "undefined") return null

    try {
        const value = JSON.parse(window.localStorage.getItem(managedSelectionKey) || "null") as StoredManagedSelection | null
        return value && typeof value.provider === "string" && typeof value.model === "string" ? value : null
    } catch {
        return null
    }
}

const storeManagedSelection = (selection: StoredManagedSelection) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(managedSelectionKey, JSON.stringify(selection))
}

const fetchCurrentUserProvider = async ({ adminUserSlug, apiRoute, signal }: FetchCurrentUserProviderOptions) => {
    const res = await fetch(formatAdminURL({ apiRoute, path: `/${adminUserSlug}/me` }), { signal })
    if (!res.ok) return null

    const result = (await res.json()) as CurrentUserResponse
    return result.user?.aiProvider || null
}

const hasModel = (profile: AIProviderProfile, model: string) => profile.models.some((option) => option.value === model)

export const useAISettings = ({ adminUserSlug, apiRoute, managedProviders, providerProfiles }: UseAISettingsOptions) => {
    const [settingsProvider, setSettingsProvider] = useState<string | null>(null)
    const [selectedModel, setSelectedModelState] = useState("")

    const setSelectedProviderModel = (provider: string, model: string) => {
        const profile = providerProfiles.find((candidate) => candidate.id === provider)
        if (!profile || !hasModel(profile, model)) return

        setSettingsProvider(provider)
        setSelectedModelState(model)

        if (managedProviders) {
            storeManagedSelection({ model, provider })
        } else {
            storeModel(provider, model)
        }
    }

    const setSelectedModel = (model: string) => {
        if (settingsProvider) setSelectedProviderModel(settingsProvider, model)
    }

    useEffect(() => {
        if (managedProviders) {
            const storedSelection = getStoredManagedSelection()
            const storedProfile = storedSelection
                ? providerProfiles.find((profile) => profile.id === storedSelection.provider && hasModel(profile, storedSelection.model))
                : null
            const profile = storedProfile || providerProfiles[0]
            const model = storedProfile && storedSelection ? storedSelection.model : profile?.defaultModel

            setSettingsProvider(profile?.id || null)
            setSelectedModelState(model || "")
            return
        }

        if (!adminUserSlug) {
            setSettingsProvider(null)
            setSelectedModelState("")
            return
        }

        const abortController = new AbortController()
        const loadCurrentUserProvider = async () => {
            try {
                const provider = await fetchCurrentUserProvider({
                    adminUserSlug,
                    apiRoute,
                    signal: abortController.signal,
                })
                const profile = providerProfiles.find((candidate) => candidate.id === provider)

                if (!profile) {
                    setSettingsProvider(null)
                    setSelectedModelState("")
                    return
                }

                const storedModel = getStoredModel(profile.id)
                setSettingsProvider(profile.id)
                setSelectedModelState(storedModel && hasModel(profile, storedModel) ? storedModel : profile.defaultModel)
            } catch (err) {
                if (isAbortError(err)) return
                setSettingsProvider(null)
                setSelectedModelState("")
            }
        }
        void loadCurrentUserProvider()
        return () => abortController.abort()
    }, [adminUserSlug, apiRoute, managedProviders, providerProfiles])

    return {
        selectedModel,
        setSelectedModel,
        setSelectedProviderModel,
        settingsProvider,
    }
}
