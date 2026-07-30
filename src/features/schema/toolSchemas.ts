import { z } from "zod"

import { getSchemaFields, type CollectionConfig, type FieldConfig } from "./normalize.js"

type ToolSchemaField = FieldConfig & {
    blocks?: readonly {
        fields?: readonly ToolSchemaField[]
        slug: string
    }[]
    fields?: readonly ToolSchemaField[]
    tabs?: readonly {
        fields?: readonly ToolSchemaField[]
        name?: string
    }[]
}

const relationshipIDSchema = z.union([z.string().min(1), z.number()])

const getOptionValues = (field: ToolSchemaField) => {
    return (field.options || []).flatMap((option) => {
        const value = typeof option === "string" ? option : option.value
        return value ? [value] : []
    })
}

const createSelectSchema = (field: ToolSchemaField): z.ZodType => {
    const values = getOptionValues(field)
    const valueSchema = values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string()

    return field.hasMany ? z.array(valueSchema) : valueSchema
}

const createRelationshipSchema = (field: ToolSchemaField): z.ZodType => {
    const polymorphicValueSchema = Array.isArray(field.relationTo)
        ? z.union([
              relationshipIDSchema,
              z
                  .object({
                      relationTo: z.enum(field.relationTo as [string, ...string[]]),
                      value: relationshipIDSchema,
                  })
                  .strict(),
          ])
        : relationshipIDSchema

    return field.hasMany ? z.array(polymorphicValueSchema) : polymorphicValueSchema
}

const createObjectSchema = (fields: readonly ToolSchemaField[]) => {
    const shape: Record<string, z.ZodType> = {}

    const addFields = (nestedFields: readonly ToolSchemaField[]) => {
        for (const field of nestedFields) {
            if (field.type === "ui") continue

            if (!field.name) {
                if (field.fields?.length) addFields(field.fields)
                if (field.tabs?.length) {
                    for (const tab of field.tabs) {
                        if (tab.name) {
                            shape[tab.name] = createObjectSchema(tab.fields || [])
                                .nullable()
                                .optional()
                        } else {
                            addFields(tab.fields || [])
                        }
                    }
                }
                continue
            }

            shape[field.name] = createFieldValueSchema(field).nullable().optional()
        }
    }

    addFields(fields)
    return z.object(shape).strict()
}

const createBlocksSchema = (field: ToolSchemaField): z.ZodType => {
    const blockSchemas = (field.blocks || []).map((block) =>
        createObjectSchema(block.fields || []).extend({
            blockType: z.literal(block.slug),
        })
    )

    if (blockSchemas.length === 0) return z.array(z.record(z.string(), z.unknown()))
    if (blockSchemas.length === 1) return z.array(blockSchemas[0])

    return z.array(z.union(blockSchemas as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]))
}

const createFieldValueSchema = (field: ToolSchemaField): z.ZodType => {
    switch (field.type) {
        case "array":
            return z.array(createObjectSchema(field.fields || []))
        case "blocks":
            return createBlocksSchema(field)
        case "checkbox":
            return z.boolean()
        case "date":
            return z.string().min(1)
        case "email":
            return z.string()
        case "group":
            return createObjectSchema(field.fields || [])
        case "number":
            return z.number()
        case "point":
            return z.tuple([z.number(), z.number()])
        case "radio":
        case "select":
            return createSelectSchema(field)
        case "relationship":
        case "upload":
            return createRelationshipSchema(field)
        case "richText":
            return z.union([z.string(), z.record(z.string(), z.unknown())])
        case "code":
        case "text":
        case "textarea":
            return z.string()
        case "json":
        default:
            return z.unknown()
    }
}

export const genericPayloadDataSchema = z.record(z.string(), z.unknown())

const payloadDataSchemaCache = new WeakMap<CollectionConfig, ReturnType<typeof createObjectSchema>>()

export const createPayloadDataSchema = (config?: CollectionConfig | null) => {
    if (!config) return genericPayloadDataSchema

    const cached = payloadDataSchemaCache.get(config)
    if (cached) return cached

    const schema = createObjectSchema(getSchemaFields(config) as ToolSchemaField[])
    payloadDataSchemaCache.set(config, schema)
    return schema
}

export const createLocalizedPayloadDataSchema = (dataSchema: z.ZodType) => {
    return z.record(z.string(), dataSchema).refine((value) => Object.keys(value).length > 0, {
        message: "localizedData must include at least one locale entry.",
    })
}
