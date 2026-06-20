import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./auth"
import { getEditor } from "./helpers"

test("proposal apply writes an audit entry visible in recent changes", async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto("/admin")

    await getEditor(page).click()
    await page.keyboard.type("Create a post about Mars for apply flow")
    await page.getByRole("button", { name: "Send" }).click()

    await expect(page.getByRole("button", { name: "Apply proposal: Create apply flow draft post about Mars" })).toBeVisible()

    await page.getByRole("button", { name: "Apply proposal: Create apply flow draft post about Mars" }).click()

    const recentChanges = page.locator("aside").filter({ hasText: "Recent changes" })

    await expect(recentChanges.getByText("Create apply flow draft post about Mars", { exact: true }).first()).toBeVisible()

    await recentChanges.getByRole("button", { name: "Review" }).first().click()

    const dialog = page.getByRole("dialog")

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("User", { exact: true })).toBeVisible()
    await expect(dialog.getByText("Tokens", { exact: true })).toBeVisible()
    await expect(dialog.getByText("69 (42 in / 27 out)", { exact: true })).toBeVisible()
})
