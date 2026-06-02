import type { PayloadHandler } from "payload";

import type { AIActionProposal } from "./aiChatEndpointHandler.js";

type AIApplyActionBody = {
    proposal?: AIActionProposal;
};

type FieldConfig = {
    fields?: FieldConfig[];
    name?: string;
    type?: string;
};

type NormalizedData = {
    coercedFields: string[];
    data: Record<string, unknown>;
    droppedFields: string[];
};

const isKnownCollection = (
    req: Parameters<PayloadHandler>[0],
    collection: string,
) => {
    return req.payload.config.collections.some(
        (item) => item.slug === collection,
    );
};

const isKnownGlobal = (req: Parameters<PayloadHandler>[0], slug: string) => {
    return (
        req.payload.config.globals?.some((item) => item.slug === slug) || false
    );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const getNamedFields = (fields: FieldConfig[]) => {
    return fields.filter((field): field is FieldConfig & { name: string } =>
        Boolean(field.name),
    );
};

const createLexicalText = (value: unknown) => {
    if (isRecord(value) && isRecord(value.root)) return value;

    const text = Array.isArray(value) ? value.join("\n") : String(value || "");
    const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    return {
        root: {
            children: (lines.length ? lines : [""]).map((line) => ({
                children: [
                    {
                        detail: 0,
                        format: 0,
                        mode: "normal",
                        style: "",
                        text: line,
                        type: "text",
                        version: 1,
                    },
                ],
                direction: null,
                format: "",
                indent: 0,
                type: "paragraph",
                version: 1,
            })),
            direction: null,
            format: "",
            indent: 0,
            type: "root",
            version: 1,
        },
    };
};

const normalizeArrayValue = (field: FieldConfig, value: unknown) => {
    if (!Array.isArray(value)) return value;

    const childFields = getNamedFields(field.fields || []);
    const itemLabelField =
        childFields.find((childField) => childField.name === "label") ||
        childFields.find((childField) => childField.name === "title") ||
        childFields.find((childField) => childField.name === "name") ||
        childFields.find((childField) => childField.name === "value") ||
        childFields[0];

    if (!itemLabelField) return value;

    return value.map((item) => {
        if (!isRecord(item)) {
            return { [itemLabelField.name]: item };
        }

        return normalizeDataForFields(childFields, item).data;
    });
};

const normalizeFieldValue = (field: FieldConfig, value: unknown): unknown => {
    if (value === undefined) return value;

    if (field.type === "array") return normalizeArrayValue(field, value);
    if (field.type === "checkbox")
        return typeof value === "boolean" ? value : value === "true";
    if (field.type === "date") {
        const date = new Date(String(value));
        return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
    if (field.type === "group" && isRecord(value)) {
        return normalizeDataForFields(field.fields || [], value).data;
    }
    if (field.type === "richText") return createLexicalText(value);
    if (
        ["email", "radio", "select", "text", "textarea"].includes(
            field.type || "",
        )
    ) {
        return value === null ? value : String(value);
    }

    return value;
};

const getAliasFieldName = (
    key: string,
    fieldsByName: Map<string, FieldConfig>,
) => {
    if (fieldsByName.has(key)) return key;

    if (key.endsWith("Date")) {
        const dateAlias = `${key.slice(0, -4)}At`;
        if (fieldsByName.has(dateAlias)) return dateAlias;
    }

    return null;
};

const normalizeLooseKnownFieldValue = (key: string, value: unknown) => {
    if (key === "tags" && Array.isArray(value)) {
        return value.map((item) => (isRecord(item) ? item : { label: item }));
    }

    return value;
};

const normalizeDataForFields = (
    fields: FieldConfig[],
    data: Record<string, unknown>,
): NormalizedData => {
    const namedFields = getNamedFields(fields);
    const fieldsByName = new Map(
        namedFields.map((field) => [field.name, field]),
    );
    const normalizedData: Record<string, unknown> = {};
    const droppedFields: string[] = [];
    const coercedFields: string[] = [];

    for (const [key, value] of Object.entries(data)) {
        const fieldName = getAliasFieldName(key, fieldsByName);

        if (!fieldName) {
            const looseValue = normalizeLooseKnownFieldValue(key, value);

            if (looseValue !== value) {
                normalizedData[key] = looseValue;
                coercedFields.push(key);
                continue;
            }

            droppedFields.push(key);
            continue;
        }

        const field = fieldsByName.get(fieldName);
        if (!field) continue;

        const normalizedValue = normalizeFieldValue(field, value);

        if (fieldName !== key || normalizedValue !== value) {
            coercedFields.push(key);
        }

        normalizedData[fieldName] = normalizedValue;
    }

    return {
        coercedFields,
        data: normalizedData,
        droppedFields,
    };
};

const getErrorDetails = (err: unknown) => {
    if (err instanceof Error) {
        return {
            message: err.message,
            name: err.name,
            stack:
                process.env.NODE_ENV === "development" ? err.stack : undefined,
        };
    }

    return {
        message: String(err),
        name: "UnknownError",
    };
};

export const aiApplyActionEndpointHandler: PayloadHandler = async (req) => {
    if (!req.user)
        return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = req.json
        ? ((await req.json().catch(() => null)) as AIApplyActionBody | null)
        : null;

    const proposal = body?.proposal;
    if (!proposal)
        return Response.json(
            { error: "Proposal is required" },
            { status: 400 },
        );

    let normalized: NormalizedData | undefined;

    try {
        if (proposal.action === "updateGlobal") {
            if (!isKnownGlobal(req, proposal.slug))
                return Response.json(
                    { error: "Unknown global" },
                    { status: 400 },
                );

            const globalConfig = req.payload.config.globals?.find(
                (global) => global.slug === proposal.slug,
            );
            normalized = normalizeDataForFields(
                (globalConfig?.fields || []) as FieldConfig[],
                proposal.data,
            );
            const doc = await req.payload.updateGlobal({
                data: normalized.data,
                overrideAccess: false,
                req,
                slug: proposal.slug as never,
            });

            return Response.json({ doc, normalized, status: "applied" });
        }

        if (!isKnownCollection(req, proposal.collection))
            return Response.json(
                { error: "Unknown collection" },
                { status: 400 },
            );

        if (proposal.action === "delete") {
            const doc = await req.payload.delete({
                collection: proposal.collection as never,
                id: proposal.id,
                overrideAccess: false,
                req,
            });

            return Response.json({ doc, status: "applied" });
        }

        const collectionConfig = req.payload.config.collections.find(
            (collection) => collection.slug === proposal.collection,
        );
        normalized = normalizeDataForFields(
            (collectionConfig?.fields || []) as FieldConfig[],
            proposal.data,
        );

        if (proposal.action === "create") {
            const doc = await req.payload.create({
                collection: proposal.collection as never,
                data: normalized.data,
                overrideAccess: false,
                req,
            });

            return Response.json({ doc, normalized, status: "applied" });
        }

        const doc = await req.payload.update({
            collection: proposal.collection as never,
            data: normalized.data,
            id: proposal.id,
            overrideAccess: false,
            req,
        });

        return Response.json({ doc, normalized, status: "applied" });
    } catch (err) {
        const errorDetails = getErrorDetails(err);

        req.payload.logger.error({
            err,
            msg: "AI apply action failed",
            proposal,
        });

        return Response.json(
            {
                error: errorDetails.message,
                errorDetails,
                normalized,
                proposal,
            },
            { status: 400 },
        );
    }
};
