import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./auth"

test("translate action appears for an empty secondary locale", async ({ page }) => {
    await loginAsAdmin(page)
    const slug = `translation-button-${Date.now()}`
    const post = await page.evaluate(async (documentSlug) => {
        const response = await fetch("/api/posts?locale=en", {
            body: JSON.stringify({
                slug: documentSlug,
                status: "draft",
                title: "English translation source",
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
        })
        return response.json()
    }, slug)

    await page.goto(`/admin/collections/posts/${post.doc.id}?locale=de`)

    await expect(page.getByRole("button", { name: "Translate", exact: true })).toBeVisible()
})
