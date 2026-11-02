"use client";

import { useEffect, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { BUGLAB_THEME, setupMonaco } from "@/lib/monaco-setup";
import type { EditorLanguage } from "@/types/workspace";
import { EditorLoading } from "./EditorLoading";

// Monaco's runtime is served from our own origin (public/monaco/<version>/vs,
// copied by scripts/monaco-assets.mjs). next.config.ts sets the path from the
// pinned `monaco-editor` version, so runtime, copied files and types match.
// Without it the editor isn't started at all: the loader's built-in default
// would fetch Monaco from a third-party CDN.
const MONACO_VS_PATH = process.env.MONACO_VS_PATH;
if (MONACO_VS_PATH) loader.config({ paths: { vs: MONACO_VS_PATH } });

interface MonacoEditorProps {
  path: string;
  content: string;
  language: EditorLanguage;
}

// Each file gets its own Monaco model keyed by `path`, so switching tabs
// keeps content, scroll position, and cursor per file.
export function MonacoEditor({ path, content, language }: MonacoEditorProps) {
  const [loadFailed, setLoadFailed] = useState(!MONACO_VS_PATH);

  useEffect(() => {
    if (!MONACO_VS_PATH) return;
    const init = loader.init();
    init.catch((error: { type?: string }) => {
      if (error?.type !== "cancelation") setLoadFailed(true);
    });
    return () => init.cancel();
  }, []);

  if (loadFailed) {
    return (
      <div role="alert" className="flex h-full items-center justify-center p-6 text-center">
        <p className="max-w-sm text-sm text-muted">
          The code editor couldn&apos;t be loaded. Check your network connection
          and reload the page.
        </p>
      </div>
    );
  }

  return (
    <Editor
      path={`file:///${path}`}
      defaultValue={content}
      language={language}
      theme={BUGLAB_THEME}
      beforeMount={setupMonaco}
      loading={<EditorLoading />}
      options={{
        readOnly: true,
        domReadOnly: true,
        readOnlyMessage: { value: "Files in this workspace are read-only." },
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: "line",
        smoothScrolling: true,
        contextmenu: false,
        tabSize: 2,
        fixedOverflowWidgets: true,
        ariaLabel: `${path} (read-only)`,
      }}
    />
  );
}
