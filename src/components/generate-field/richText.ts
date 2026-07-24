type LexicalTextNode = {
    detail: number
    format: number
    mode: "normal"
    style: string
    text: string
    type: "text"
    version: 1
}

type LexicalParagraphNode = {
    children: LexicalTextNode[]
    direction: "ltr"
    format: ""
    indent: number
    type: "paragraph"
    version: 1
}

export type GeneratedRichTextValue = {
    root: {
        children: LexicalParagraphNode[]
        direction: "ltr"
        format: ""
        indent: number
        type: "root"
        version: 1
    }
}

export const createGeneratedRichTextValue = (value: string): GeneratedRichTextValue => {
    const paragraphs = value
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
        .filter(Boolean)

    return {
        root: {
            children: paragraphs.map((text) => ({
                children: [
                    {
                        detail: 0,
                        format: 0,
                        mode: "normal",
                        style: "",
                        text,
                        type: "text",
                        version: 1,
                    },
                ],
                direction: "ltr",
                format: "",
                indent: 0,
                type: "paragraph",
                version: 1,
            })),
            direction: "ltr",
            format: "",
            indent: 0,
            type: "root",
            version: 1,
        },
    }
}
