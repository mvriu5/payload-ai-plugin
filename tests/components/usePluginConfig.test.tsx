// @vitest-environment jsdom

import React from "react"
import { afterEach, describe, expect, it } from "vitest"

import { usePluginConfig } from "../../src/components/hooks/usePluginConfig.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const HookTest = ({ config }: { config: Parameters<typeof usePluginConfig>[0] }) => {
    const { aiModelConfig, defaultLocale, enabledCollectionSlugSet, isCollectionMentionEnabled, locales, managedProviders, media, providerProfiles } =
        usePluginConfig(config)

    return (
        <div>
            <span data-testid="default-locale">{defaultLocale || ""}</span>
            <span data-testid="locales">{locales.map((locale) => (typeof locale === "string" ? locale : locale.code)).join(",")}</span>
            <span data-testid="posts-enabled">{String(isCollectionMentionEnabled("posts"))}</span>
            <span data-testid="pages-enabled">{String(isCollectionMentionEnabled("pages"))}</span>
            <span data-testid="has-slug-filter">{String(Boolean(enabledCollectionSlugSet))}</span>
            <span data-testid="media-enabled">{String(Boolean(media?.enabled))}</span>
            <span data-testid="media-collection">{media?.collectionSlug || ""}</span>
            <span data-testid="media-mime-types">{media?.acceptedMimeTypes?.join(",") || ""}</span>
            <span data-testid="openai-default">{aiModelConfig.defaults.openai}</span>
            <span data-testid="openai-models">{aiModelConfig.providers.openai.map((model) => model.value).join(",")}</span>
            <span data-testid="managed-providers">{String(managedProviders)}</span>
            <span data-testid="provider-profiles">{providerProfiles.map((provider) => provider.id).join(",")}</span>
        </div>
    )
}

describe("usePluginConfig", () => {
    afterEach(() => {
        cleanupRoots()
    })

    it("uses plugin collection filters and localization settings", () => {
        const { container } = render(
            <HookTest
                config={{
                    admin: {
                        custom: {
                            payloadAiPlugin: {
                                collectionSlugs: ["posts"],
                                media: {
                                    acceptedMimeTypes: ["image/*"],
                                    collectionSlug: "media",
                                    enabled: true,
                                    maxFileSize: 1024,
                                },
                                models: {
                                    defaults: {
                                        openai: "custom-openai",
                                    },
                                    providers: {
                                        openai: [{ label: "Custom OpenAI", value: "custom-openai" }],
                                    },
                                },
                            },
                        },
                    },
                    localization: {
                        defaultLocale: "en",
                        locales: [
                            { code: "en", label: "English" },
                            { code: "de", label: "Deutsch" },
                        ],
                    },
                }}
            />
        )

        expect(container.querySelector('[data-testid="default-locale"]')?.textContent).toBe("en")
        expect(container.querySelector('[data-testid="locales"]')?.textContent).toBe("en,de")
        expect(container.querySelector('[data-testid="posts-enabled"]')?.textContent).toBe("true")
        expect(container.querySelector('[data-testid="pages-enabled"]')?.textContent).toBe("false")
        expect(container.querySelector('[data-testid="has-slug-filter"]')?.textContent).toBe("true")
        expect(container.querySelector('[data-testid="media-enabled"]')?.textContent).toBe("true")
        expect(container.querySelector('[data-testid="media-collection"]')?.textContent).toBe("media")
        expect(container.querySelector('[data-testid="media-mime-types"]')?.textContent).toBe("image/*")
        expect(container.querySelector('[data-testid="openai-default"]')?.textContent).toBe("custom-openai")
        expect(container.querySelector('[data-testid="openai-models"]')?.textContent).toBe("custom-openai")
        expect(container.querySelector('[data-testid="managed-providers"]')?.textContent).toBe("false")
        expect(container.querySelector('[data-testid="provider-profiles"]')?.textContent).toContain("openai")
    })

    it("enables all collections when no collection filter is configured", () => {
        const { container } = render(<HookTest config={{ localization: false }} />)

        expect(container.querySelector('[data-testid="default-locale"]')?.textContent).toBe("")
        expect(container.querySelector('[data-testid="locales"]')?.textContent).toBe("")
        expect(container.querySelector('[data-testid="posts-enabled"]')?.textContent).toBe("true")
        expect(container.querySelector('[data-testid="pages-enabled"]')?.textContent).toBe("true")
        expect(container.querySelector('[data-testid="has-slug-filter"]')?.textContent).toBe("false")
        expect(container.querySelector('[data-testid="media-enabled"]')?.textContent).toBe("false")
        expect(container.querySelector('[data-testid="openai-default"]')?.textContent).toBe("gpt-4.1-mini")
    })

    it("exposes configured provider profiles in managed mode", () => {
        const { container } = render(
            <HookTest
                config={{
                    admin: {
                        custom: {
                            payloadAiPlugin: {
                                managedProviders: true,
                                providers: [
                                    {
                                        defaultModel: "llama3.3",
                                        id: "ollama",
                                        label: "Ollama",
                                        models: [{ label: "Llama 3.3", value: "llama3.3" }],
                                        provider: "openai",
                                    },
                                ],
                            },
                        },
                    },
                }}
            />
        )

        expect(container.querySelector('[data-testid="managed-providers"]')?.textContent).toBe("true")
        expect(container.querySelector('[data-testid="provider-profiles"]')?.textContent).toBe("ollama")
    })
})
