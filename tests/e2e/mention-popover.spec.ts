import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./auth"
import { getEditor, selectMention } from "./helpers"

test("mention popover opens immediately and inserts locale badge", async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto("/admin")

    const editor = getEditor(page)

    await editor.click()
    await page.keyboard.type("Translate the content into @")

    await expect(page.getByText("Locales")).toBeVisible()
    await expect(page.getByRole("button").filter({ hasText: "@en" }).first()).toBeVisible()

    await selectMention({
        page,
        query: "en",
        visibleLabel: "@en",
    })

    await expect(editor).toContainText("locale:English")
    await expect(page.getByText("Locales")).toHaveCount(0)
})
