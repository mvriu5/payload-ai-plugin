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

const getFieldClassName = ({ className, isReadOnly, showError }: { className?: string, isReadOnly?: boolean, showError?: boolean }) =>
    ["field-type", "password", className, showError ? "error" : null, isReadOnly ? "read-only" : null]
        .filter(Boolean)
        .join(" ");

export const AIApiKeyField: TextFieldClientComponent = ({ field, inputRef, path, readOnly }) => {
    const { disabled, errorMessage, setValue, showError, value } = useField<string>({ path });
    const fieldID = `field-${path.replace(/\./g, "__")}`;
    const isReadOnly = readOnly || disabled || field.admin?.disabled;

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        setValue(event.target.value);
    };

    return (
        <div
            className={getFieldClassName({
                className: field.admin?.className,
                isReadOnly,
                showError,
            })}
        >
            <label className="field-label" htmlFor={fieldID}>
                {field?.label?.toString()}
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
                    placeholder={field.admin?.placeholder?.toString()}
                    ref={inputRef}
                    type="password"
                    value={value || ""}
                />
                <div className="field-description">{field.admin?.description?.toString()}</div>
            </div>
        </div>
    );
};
