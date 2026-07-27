import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./auth"
import { getEditor, selectMention } from "./helpers"

test("multi-locale proposal review shows separate locale sections", async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto("/admin")

    const editor = getEditor(page)

    await expect(editor).toHaveAttribute("contenteditable", "true")
    await editor.fill("Create a post about Mars for locale review in ")
    await selectMention({
        page,
        query: "@de",
        visibleLabel: "@de",
    })
    await page.keyboard.type(" and ")
    await selectMention({
        page,
        query: "@en",
        visibleLabel: "@en",
    })
    await page.keyboard.type(" please.")

    const sendButton = page.getByRole("button", { name: "Send" })
    await expect(sendButton).toBeEnabled()
    await sendButton.click()

    await expect(page.getByText("Create localized locale review draft post about Mars", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Review proposal: Create localized locale review draft post about Mars" }).click()

    await expect(page.getByRole("dialog")).toBeVisible()
    const dialog = page.getByRole("dialog")

    await expect(dialog.getByText("Locale: de", { exact: true })).toBeVisible()
    await expect(dialog.getByText("Locale: en", { exact: true })).toBeVisible()
})
