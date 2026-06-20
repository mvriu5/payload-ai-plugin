import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./auth"

test("admin dashboard shows deterministic AI proposal flow", async ({ page }) => {
    await loginAsAdmin(page)

    await page.goto("/admin")

    await expect(page.getByText("AI Assistant")).toBeVisible()

    const input = page.getByRole("textbox")

    await input.click()
    await page.keyboard.type("Create a post about Mars for proposal review")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.locator("div").filter({ hasText: "Create proposal review draft post about Mars" }).first()).toBeVisible()

    await page.getByRole("button", { name: "Review" }).first().click()

    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByText("Tokens")).toBeVisible()
    await expect(page.getByText("69 (42 in / 27 out)")).toBeVisible()
})
