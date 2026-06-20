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

export const useAISettings = ({ adminUserSlug, apiRoute, defaultModels }: UseAISettingsOptions) => {
    const [settingsProvider, setSettingsProvider] = useState<AIProvider | null>(null)
    const [selectedModel, setSelectedModel] = useState("")
    const setStoredSelectedModel = (model: string) => {
        setSelectedModel(model)

        if (settingsProvider && model) {
            storeModel(settingsProvider, model)
        }
    }

    useEffect(() => {
        if (!adminUserSlug) {
            setSettingsProvider(null)
            setSelectedModel("")
            return
        }

        const abortController = new AbortController()

        const fetchCurrentUser = async () => {
            try {
                const res = await fetch(
                    formatAdminURL({
                        apiRoute,
                        path: `/${adminUserSlug}/me`,
                    }),
                    {
                        signal: abortController.signal,
                    }
                )

                if (!res.ok) {
                    setSettingsProvider(null)
                    setSelectedModel("")
                    return
                }

                const result = (await res.json()) as CurrentUserResponse
                const provider = result.user?.aiProvider

                if (!provider || !isAIProvider(provider)) {
                    setSettingsProvider(null)
                    setSelectedModel("")
                    return
                }

                setSettingsProvider(provider)
                setSelectedModel(getStoredModel(provider) || defaultModels[provider])
            } catch (err) {
                if (isAbortError(err)) return

                setSettingsProvider(null)
                setSelectedModel("")
            }
        }

        void fetchCurrentUser()

        return () => abortController.abort()
    }, [adminUserSlug, apiRoute, defaultModels])

    return {
        selectedModel,
        setSelectedModel: setStoredSelectedModel,
        settingsProvider,
    }
}
