"use client"

import { formatAdminURL } from "payload/shared"
import { useEffect, useState } from "react"
import { isAIProvider, type AIProvider } from "../../ai/providerOptions.js"
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
    defaultModels: Record<AIProvider, string>
}

const getStoredModelKey = (provider: AIProvider) => `payload-ai:selected-model:${provider}`

const getStoredModel = (provider: AIProvider) => {
    if (typeof window === "undefined") return null
    return window.localStorage.getItem(getStoredModelKey(provider))
}

const storeModel = (provider: AIProvider, model: string) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(getStoredModelKey(provider), model)
}

const fetchCurrentUserProvider = async ({ adminUserSlug, apiRoute, signal }: FetchCurrentUserProviderOptions) => {
    const res = await fetch(formatAdminURL({ apiRoute, path: `/${adminUserSlug}/me` }), { signal })
    if (!res.ok) return null

    const result = (await res.json()) as CurrentUserResponse
    const provider = result.user?.aiProvider

    return provider && isAIProvider(provider) ? provider : null
}

export const useAISettings = ({ adminUserSlug, apiRoute, defaultModels }: UseAISettingsOptions) => {
    const [fetchedProvider, setFetchedProvider] = useState<AIProvider | null>(null)

    const [selectedModel, setSelectedModel] = useState("")
    const setStoredSelectedModel = (model: string) => {
        setSelectedModel(model)
        if (fetchedProvider && model) {
            storeModel(fetchedProvider, model)
        }
    }

    useEffect(() => {
        if (!adminUserSlug) return

        const abortController = new AbortController()
        const loadCurrentUserProvider = async () => {
            try {
                const provider = await fetchCurrentUserProvider({
                    adminUserSlug,
                    apiRoute,
                    signal: abortController.signal,
                })

                if (!provider) {
                    setFetchedProvider(null)
                    setSelectedModel("")
                    return
                }

                setFetchedProvider(provider)
                setSelectedModel(getStoredModel(provider) || defaultModels[provider])
            } catch (err) {
                if (isAbortError(err)) return
                setFetchedProvider(null)
                setSelectedModel("")
            }
        }
        void loadCurrentUserProvider()
        return () => abortController.abort()
    }, [adminUserSlug, apiRoute, defaultModels])

    const settingsProvider = adminUserSlug ? fetchedProvider : null

    return { selectedModel: adminUserSlug ? selectedModel : "", setSelectedModel: setStoredSelectedModel, settingsProvider }
}
