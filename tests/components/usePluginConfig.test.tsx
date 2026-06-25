// @vitest-environment jsdom

import React from "react"
import { afterEach, describe, expect, it } from "vitest"

import { usePluginConfig } from "../../src/components/hooks/usePluginConfig.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const HookTest = ({ config }: { config: Parameters<typeof usePluginConfig>[0] }) => {
    const { aiModelConfig, defaultLocale, enabledCollectionSlugSet, isCollectionMentionEnabled, locales } = usePluginConfig(config)

    return (
        <div>
            <span data-testid="default-locale">{defaultLocale || ""}</span>
            <span data-testid="locales">{locales.map((locale) => (typeof locale === "string" ? locale : locale.code)).join(",")}</span>
            <span data-testid="posts-enabled">{String(isCollectionMentionEnabled("posts"))}</span>
            <span data-testid="pages-enabled">{String(isCollectionMentionEnabled("pages"))}</span>
            <span data-testid="has-slug-filter">{String(Boolean(enabledCollectionSlugSet))}</span>
            <span data-testid="openai-default">{aiModelConfig.defaults.openai}</span>
            <span data-testid="openai-models">{aiModelConfig.providers.openai.map((model) => model.value).join(",")}</span>
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
        expect(container.querySelector('[data-testid="openai-default"]')?.textContent).toBe("custom-openai")
        expect(container.querySelector('[data-testid="openai-models"]')?.textContent).toBe("custom-openai")
    })

    it("enables all collections when no collection filter is configured", () => {
        const { container } = render(<HookTest config={{ localization: false }} />)

        expect(container.querySelector('[data-testid="default-locale"]')?.textContent).toBe("")
        expect(container.querySelector('[data-testid="locales"]')?.textContent).toBe("")
        expect(container.querySelector('[data-testid="posts-enabled"]')?.textContent).toBe("true")
        expect(container.querySelector('[data-testid="pages-enabled"]')?.textContent).toBe("true")
        expect(container.querySelector('[data-testid="has-slug-filter"]')?.textContent).toBe("false")
        expect(container.querySelector('[data-testid="openai-default"]')?.textContent).toBe("gpt-4.1-mini")
    })
})
