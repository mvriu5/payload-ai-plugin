import { Mention } from "../hooks/useMentions.js"
import { MentionOption } from "../mention-popover/MentionPopover.js"

const appendSvgPath = (svg: SVGSVGElement, d: string) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")

    path.setAttribute("d", d)
    svg.append(path)
}

const createBadgeIcon = (type: Mention["type"], styles: { [key: string]: string }) => {
    if (type === "locale") return null

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")

    svg.setAttribute("aria-hidden", "true")
    svg.setAttribute("class", styles.badgeIcon)
    svg.setAttribute("fill", "none")
    svg.setAttribute("stroke", "currentColor")
    svg.setAttribute("stroke-linecap", "round")
    svg.setAttribute("stroke-linejoin", "round")
    svg.setAttribute("stroke-width", "2")
    svg.setAttribute("viewBox", "0 0 24 24")

    if (type === "collection") {
        appendSvgPath(svg, "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2")
    }

    if (type === "doc") {
        appendSvgPath(svg, "M14 3v4a1 1 0 0 0 1 1h4")
        appendSvgPath(svg, "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2")
    }

    if (type === "global") {
        appendSvgPath(svg, "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0")
        appendSvgPath(svg, "M3.6 9h16.8")
        appendSvgPath(svg, "M3.6 15h16.8")
        appendSvgPath(svg, "M11.5 3a17 17 0 0 0 0 18")
        appendSvgPath(svg, "M12.5 3a17 17 0 0 1 0 18")
    }

    if (type === "block") {
        appendSvgPath(svg, "M14 4a1 1 0 0 1 1 -1h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1l0 -5")
        appendSvgPath(svg, "M3 14h12a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h3a2 2 0 0 1 2 2v12")
    }

    return svg
}

export const createBadgePrefix = (suggestion: MentionOption, styles: { [key: string]: string }) => {
    const prefix = document.createElement("span")
    const icon = createBadgeIcon(suggestion.type, styles)

    prefix.className = styles.prefix

    if (icon) {
        prefix.append(icon)
    }

    if (suggestion.type === "doc") {
        prefix.append(document.createTextNode(`${suggestion.collection || "document"}:`))
    } else if (suggestion.type === "locale") {
        prefix.textContent = "locale:"
    }

    return prefix
}

export const getTextNodeAtOffset = (element: HTMLElement, offset: number) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let currentOffset = 0
    let node = walker.nextNode()

    while (node) {
        const nextOffset = currentOffset + (node.textContent?.length || 0)

        if (offset <= nextOffset) {
            return {
                node,
                offset: offset - currentOffset,
            }
        }

        currentOffset = nextOffset
        node = walker.nextNode()
    }

    const textNode = document.createTextNode("")
    element.append(textNode)

    return {
        node: textNode,
        offset: 0,
    }
}

export const replaceTextRangeWithBadge = ({ badge, editor, end, start }: { badge: HTMLSpanElement; editor: HTMLElement; end: number; start: number }) => {
    const startPosition = getTextNodeAtOffset(editor, start)
    const endPosition = getTextNodeAtOffset(editor, end)
    const range = document.createRange()
    const trailingSpace = document.createTextNode(" ")

    range.setStart(startPosition.node, startPosition.offset)
    range.setEnd(endPosition.node, endPosition.offset)
    range.deleteContents()
    range.insertNode(trailingSpace)
    range.insertNode(badge)

    const selection = window.getSelection()
    const caretRange = document.createRange()

    caretRange.setStartAfter(trailingSpace)
    caretRange.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(caretRange)
}
