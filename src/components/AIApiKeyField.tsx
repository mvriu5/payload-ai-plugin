"use client";

import type { TextFieldClientComponent } from "payload";
import type { ChangeEvent } from "react";

import { useField } from "@payloadcms/ui";

const getLabel = (label: unknown, fallback: string) => {
    if (typeof label === "string") return label;

    if (label && typeof label === "object") {
        const firstLabel = Object.values(label)[0];
        if (typeof firstLabel === "string") return firstLabel;
    }

    return fallback;
};

export const AIApiKeyField: TextFieldClientComponent = ({
    field,
    inputRef,
    path,
    readOnly,
}) => {
    const { disabled, errorMessage, setValue, showError, value } =
        useField<string>({ path });
    const fieldID = `field-${path.replace(/\./g, "__")}`;
    const label = getLabel(field.label, field.name);
    const description =
        typeof field.admin?.description === "string"
            ? field.admin.description
            : null;
    const placeholder =
        typeof field.admin?.placeholder === "string"
            ? field.admin.placeholder
            : undefined;
    const isReadOnly = readOnly || disabled || field.admin?.disabled;

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        setValue(event.target.value);
    };

    return (
        <div
            className={[
                "field-type",
                "password",
                field.admin?.className,
                showError ? "error" : null,
                isReadOnly ? "read-only" : null,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <label className="field-label" htmlFor={fieldID}>
                {label}
                {field.required ? <span className="required">*</span> : null}
            </label>
            <div className="field-type__wrap">
                {showError && errorMessage ? (
                    <div className="field-error">{errorMessage}</div>
                ) : null}
                <input
                    autoComplete="new-password"
                    disabled={isReadOnly}
                    id={fieldID}
                    name={path}
                    onChange={handleChange}
                    placeholder={placeholder}
                    ref={inputRef}
                    type="password"
                    value={value || ""}
                />
                {description ? (
                    <div className="field-description">{description}</div>
                ) : null}
            </div>
        </div>
    );
};
