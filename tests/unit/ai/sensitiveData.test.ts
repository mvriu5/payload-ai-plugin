import { describe, expect, it } from "vitest"

import { containsSensitiveData, redactSensitiveData } from "../../../src/ai/sensitiveData.js"
import { postJupiter, sensitivePostJupiter } from "../../fixtures/docs.js"

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
        expect(containsSensitiveData({ password: "secret" })).toBe(true)
        expect(containsSensitiveData({ privateKey: "secret" })).toBe(true)
    })

    it("ignores safe scalar and record values", () => {
        expect(containsSensitiveData(postJupiter)).toBe(false)
    })

    it("redacts sensitive keys while preserving safe structure", () => {
        expect(redactSensitiveData(sensitivePostJupiter)).toEqual({
            apiKey: "[redacted]",
            id: "4",
            slug: "jupiter",
            title: "Old Jupiter",
        })
    })
})
