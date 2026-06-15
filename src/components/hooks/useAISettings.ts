"use client";

import { formatAdminURL } from "payload/shared";
import { useEffect, useState } from "react";

import {
  defaultAIModels,
  isAIProvider,
  type AIProvider,
} from "../../ai/providerOptions.js";

type CurrentUserResponse = {
  user?: {
    aiProvider?: string | null;
  } | null;
};

const isAbortError = (err: unknown) => {
  return err instanceof DOMException && err.name === "AbortError";
};

export const useAISettings = ({ adminUserSlug, apiRoute }: { adminUserSlug?: string, apiRoute: string }) => {
  const [settingsProvider, setSettingsProvider] = useState<AIProvider | null>(null,);
  const [selectedModel, setSelectedModel] = useState("");

  useEffect(() => {
    if (!adminUserSlug) {
      setSettingsProvider(null);
      setSelectedModel("");
      return;
    }

    const abortController = new AbortController();

    const fetchCurrentUser = async () => {
      try {
        const res = await fetch(
          formatAdminURL({
            apiRoute,
            path: `/${adminUserSlug}/me`,
          }),
          {
            signal: abortController.signal,
          },
        );

        if (!res.ok) {
          setSettingsProvider(null);
          setSelectedModel("");
          return;
        }

        const result = (await res.json()) as CurrentUserResponse;
        const provider = result.user?.aiProvider;

        if (!provider || !isAIProvider(provider)) {
          setSettingsProvider(null);
          setSelectedModel("");
          return;
        }

        setSettingsProvider(provider);
        setSelectedModel(defaultAIModels[provider]);
      } catch (err) {
        if (isAbortError(err)) return;

        setSettingsProvider(null);
        setSelectedModel("");
      }
    };

    void fetchCurrentUser();

    return () => abortController.abort();
  }, [adminUserSlug, apiRoute]);

  return {
    selectedModel,
    setSelectedModel,
    settingsProvider,
  };
};
