import type { Field } from "payload"

export type TranslationFieldType = "json" | "richText" | "text" | "textarea" | "unknown"

export type TranslationPageContext = {
    fields: Field[]
    label: string
    slug: string
    type: "collection" | "global"
}

export type TranslationValue = {
    fieldType: TranslationFieldType
    path: string
    value: unknown
}

const hasValue = (value: unknown): boolean => {
    if (value === null || value === undefined || value === "") return false
    if (Array.isArray(value)) return value.some(hasValue)
    if (typeof value === "object") return Object.values(value).some(hasValue)
    return true
}

const hasRichTextValue = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false
    if (Array.isArray(value)) return value.some(hasRichTextValue)

    const node = value as Record<string, unknown>
    if (node.type === "text") return typeof node.text === "string" && node.text.trim().length > 0
    if (["block", "inlineBlock", "relationship", "upload"].includes(String(node.type))) return true
    if (node.root) return hasRichTextValue(node.root)
    return Array.isArray(node.children) && node.children.some(hasRichTextValue)
}

const getFieldType = (field: Field): TranslationFieldType =>
    ["json", "richText", "text", "textarea"].includes(field.type) ? (field.type as TranslationFieldType) : "unknown"

const collectFields = ({
    data,
    fields,
    parentPath = "",
    result,
}: {
    data: Record<string, unknown>
    fields: Field[]
    parentPath?: string
    result: TranslationValue[]
}) => {
    for (const field of fields) {
        if (field.type === "tabs") {
            for (const tab of field.tabs) {
                const tabData = "name" in tab && tab.name ? (data[tab.name] as Record<string, unknown>) || {} : data
                collectFields({
                    data: tabData,
                    fields: tab.fields,
                    parentPath: "name" in tab && tab.name ? (parentPath ? `${parentPath}.${tab.name}` : tab.name) : parentPath,
                    result,
                })
            }
            continue
        }

        if (!("name" in field) || !field.name) {
            if ("fields" in field && Array.isArray(field.fields)) collectFields({ data, fields: field.fields, parentPath, result })
            continue
        }

        const path = parentPath ? `${parentPath}.${field.name}` : field.name
        const value = data[field.name]

        if ("localized" in field && field.localized) {
            const valueExists = field.type === "richText" ? hasRichTextValue(value) : hasValue(value)
            if (valueExists) {
                result.push({
                    fieldType: getFieldType(field),
                    path,
                    value,
                })
            }
            continue
        }

        if (field.type === "array" && Array.isArray(value)) {
            value.forEach((row, index) => {
                if (row && typeof row === "object") {
                    collectFields({
                        data: row as Record<string, unknown>,
                        fields: field.fields,
                        parentPath: `${path}.${index}`,
                        result,
                    })
                }
            })
            continue
        }

        if (field.type === "blocks" && Array.isArray(value)) {
            value.forEach((row, index) => {
                if (!row || typeof row !== "object") return
                const rowData = row as Record<string, unknown>
                const block = field.blocks.find((candidate) => typeof candidate === "object" && candidate.slug === rowData.blockType)
                if (block && typeof block === "object") {
                    collectFields({
                        data: rowData,
                        fields: block.fields,
                        parentPath: `${path}.${index}`,
                        result,
                    })
                }
            })
            continue
        }

        if ("fields" in field && Array.isArray(field.fields) && value && typeof value === "object") {
            collectFields({
                data: value as Record<string, unknown>,
                fields: field.fields,
                parentPath: path,
                result,
            })
        }
    }
}

export const getTranslationValues = (fields: Field[], data: unknown): TranslationValue[] => {
    if (!data || typeof data !== "object") return []
    const result: TranslationValue[] = []
    collectFields({ data: data as Record<string, unknown>, fields, result })
    return result
}

export const hasLocalizedFields = (fields: Field[]): boolean => {
    for (const field of fields) {
        if ("localized" in field && field.localized) return true
        if (field.type === "tabs" && field.tabs.some((tab) => hasLocalizedFields(tab.fields))) return true
        if (field.type === "blocks" && field.blocks.some((block) => typeof block === "object" && hasLocalizedFields(block.fields))) return true
        if ("fields" in field && Array.isArray(field.fields) && hasLocalizedFields(field.fields)) return true
    }
    return false
}
