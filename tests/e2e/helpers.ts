import { expect, type Page } from "@playwright/test"

export const getEditor = (page: Page) => page.getByRole("textbox")

export const selectMention = async ({ page, query, visibleLabel }: { page: Page; query: string; visibleLabel: string }) => {
    await page.keyboard.type(query)

    const option = page.getByRole("button").filter({ hasText: visibleLabel }).first()

    await expect(option).toBeVisible()
    await option.click()
}
