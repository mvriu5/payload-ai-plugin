import { z } from "zod"

import { isSensitiveKey } from "../ai/sensitiveData.js"
import { getSchemaFields, type CollectionConfig, type FieldConfig } from "./normalizeData.js"

export const maxToolSelectedFields = 12

type SelectableField = FieldConfig & {
    admin?: {
        readOnly?: boolean
    }
    virtual?: boolean
}

export type ReadCollectionConfig = CollectionConfig & {
    admin?: {
        useAsTitle?: string
    }
    timestamps?: boolean
    upload?: boolean | Record<string, unknown>
}

const cheapFieldTypes = new Set(["checkbox", "date", "email", "number", "point", "radio", "select", "text"])
const populatedFieldTypes = new Set(["relationship", "upload"])
const systemFieldNames = ["id", "createdAt", "updatedAt"]
const uploadFieldNames = ["filename", "mimeType", "filesize", "width", "height", "url", "thumbnailURL"]

const getSelectableFields = (config: ReadCollectionConfig): SelectableField[] => {
    return (getSchemaFields(config) as SelectableField[]).filter((field) => {
        return Boolean(field.name && field.type !== "ui" && !isSensitiveKey(field.name))
    })
}

export const getToolSelectableFieldNames = (config: ReadCollectionConfig) => {
    const names = getSelectableFields(config).flatMap((field) => (field.name ? [field.name] : []))

    names.push("id")
    if (config.timestamps !== false) names.push("createdAt", "updatedAt")
    if (config.upload) names.push(...uploadFieldNames)

    return [...new Set(names)]
}

const getDefaultFieldNames = (config: ReadCollectionConfig, mode: "document" | "search") => {
    const selectableFields = getSelectableFields(config)
    const selectableNames = new Set(getToolSelectableFieldNames(config))
    const candidates = [
        config.admin?.useAsTitle,
        "title",
        "name",
        "label",
        "headline",
        "slug",
        "_status",
        ...(config.upload ? selectableFields.flatMap((field) => (field.name && cheapFieldTypes.has(field.type || "") ? [field.name] : [])).slice(0, 2) : []),
        ...(mode === "document" ? ["updatedAt"] : []),
        ...(config.upload ? ["filename", "mimeType", "filesize", "url"] : []),
    ]
    const defaults = candidates.filter((name): name is string => Boolean(name && (selectableNames.has(name) || systemFieldNames.includes(name))))

    if (!defaults.some((fieldName) => !systemFieldNames.includes(fieldName) && !uploadFieldNames.includes(fieldName))) {
        const firstCheapField = selectableFields.find((field) => field.name && cheapFieldTypes.has(field.type || ""))
        const firstSelectableField = firstCheapField || selectableFields[0]
        defaults.unshift(firstSelectableField?.name || "id")
    }

    return [...new Set(defaults)].slice(0, mode === "search" ? 4 : 6)
}

export const createToolFieldNamesSchema = (configs: ReadCollectionConfig[]) => {
    const names = [...new Set(configs.flatMap(getToolSelectableFieldNames))]
    const fieldNameSchema = names.length > 0 ? z.enum(names as [string, ...string[]]) : z.string().refine(() => false, "No fields are selectable.")

    return z.array(fieldNameSchema).max(maxToolSelectedFields).optional()
}

export const resolveToolFieldSelection = ({
    config,
    mode = "document",
    requestedFields,
}: {
    config: ReadCollectionConfig
    mode?: "document" | "search"
    requestedFields?: string[]
}) => {
    const allowedNames = new Set(getToolSelectableFieldNames(config))
    const normalizedRequestedFields = [
        ...new Set(
            (requestedFields || [])
                .slice(0, maxToolSelectedFields)
                .map((field) => field.trim())
                .filter(Boolean)
        ),
    ]
    const invalidFields = normalizedRequestedFields.filter((field) => !allowedNames.has(field))
    const selectedFields = [
        ...new Set(
            (requestedFields?.length ? requestedFields : getDefaultFieldNames(config, mode))
                .map((field) => field.trim())
                .filter((field) => allowedNames.has(field))
        ),
    ].slice(0, maxToolSelectedFields)
    const fields = selectedFields.length > 0 ? selectedFields : getDefaultFieldNames(config, mode)
    const fieldTypesByName = new Map(getSelectableFields(config).flatMap((field) => (field.name ? [[field.name, field.type]] : [])))

    return {
        allowedFields: [...allowedNames],
        depth: fields.some((field) => populatedFieldTypes.has(fieldTypesByName.get(field) || "")) ? 1 : 0,
        fields,
        invalidFields,
        select: Object.fromEntries(fields.map((field) => [field, true as const])) as Record<string, true>,
    }
}
