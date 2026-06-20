import { describe, expect, it } from "vitest"

import { containsSensitiveData, redactSensitiveData } from "../../../src/ai/sensitiveData.js"

describe("sensitive data helpers", () => {
    it("detects sensitive keys recursively", () => {
        expect(
            containsSensitiveData({
                profile: {
                    name: "Ada",
                },
                settings: [
                    {
                        accessToken: "token",
                    },
                ],
            })
        ).toBe(true)
    })

    it("ignores safe scalar and record values", () => {
        expect(
            containsSensitiveData({
                title: "Public",
                nested: {
                    enabled: true,
                },
            })
        ).toBe(false)
    })

    it("redacts sensitive keys while preserving safe structure", () => {
        expect(
            redactSensitiveData({
                apiKey: "secret",
                nested: {
                    refreshToken: "token",
                    title: "Visible",
                },
                rows: [
                    {
                        authorization: "Bearer token",
                    },
                ],
            })
        ).toEqual({
            apiKey: "[redacted]",
            nested: {
                refreshToken: "[redacted]",
                title: "Visible",
            },
            rows: [
                {
                    authorization: "[redacted]",
                },
            ],
        })
    })
})
