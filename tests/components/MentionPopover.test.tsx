// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MentionPopover } from "../../src/components/mention-popover/MentionPopover.js"
import { mentionOptions } from "../fixtures/docs.js"
import { cleanupRoots, render } from "../fixtures/react.js"

describe("MentionPopover", () => {
    afterEach(() => {
        cleanupRoots()
    })

    it("renders grouped suggestions with visible labels", () => {
        const { container } = render(<MentionPopover onSelect={vi.fn()} suggestions={mentionOptions} />)

        expect(container.textContent).toContain("Collections")
        expect(container.textContent).toContain("@posts")
        expect(container.textContent).toContain("Documents")
        expect(container.textContent).toContain("Jupiter")
        expect(container.textContent).toContain("posts item")
        expect(container.textContent).toContain("Globals")
        expect(container.textContent).toContain("Blocks")
        expect(container.textContent).toContain("Locales")
    })

    it("returns null when there are no suggestions", () => {
        const { container } = render(<MentionPopover onSelect={vi.fn()} suggestions={[]} />)

        expect(container.textContent).toBe("")
    })

    it("calls onSelect on mouse down", () => {
        const onSelect = vi.fn()
        const { container } = render(<MentionPopover onSelect={onSelect} suggestions={mentionOptions} />)
        const documentButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Jupiter"))

        act(() => {
            documentButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
        })

        expect(onSelect).toHaveBeenCalledWith(mentionOptions[1])
    })

    it("supports keyboard selection and arrow navigation", () => {
        const onSelect = vi.fn()
        const { container } = render(<MentionPopover onSelect={onSelect} suggestions={mentionOptions.slice(0, 2)} />)
        const buttons = container.querySelectorAll("button")

        buttons[0].focus()
        act(() => {
            buttons[0].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }))
        })

        expect(document.activeElement).toBe(buttons[1])

        act(() => {
            buttons[1].dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
        })

        expect(onSelect).toHaveBeenCalledWith(mentionOptions[1])
    })
})
