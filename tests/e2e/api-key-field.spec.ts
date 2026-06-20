import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./auth"

test("api key field persists on the account screen", async ({ page }) => {
    await loginAsAdmin(page)
    const apiKey = `sk-e2e-test-key-${Date.now()}`

    await page.goto("/admin/account")

    const apiKeyInput = page.locator('input[name="aiApiKey"]')

    await expect(apiKeyInput).toBeVisible()
    await apiKeyInput.fill(apiKey)
    await apiKeyInput.press("Tab")

    const saveButton = page.getByRole("button", { name: /^Save$/ }).first()

    await expect(saveButton).toBeEnabled()
    await saveButton.click()

    await expect
        .poll(async () => {
            const response = await page.request.get("/api/users/me")
            const result = (await response.json()) as {
                user?: {
                    aiApiKey?: string | null
                }
            }

            return result.user?.aiApiKey || null
        })
        .toBe(apiKey)

    await page.reload()

    await expect(apiKeyInput).toHaveValue(apiKey)
})
