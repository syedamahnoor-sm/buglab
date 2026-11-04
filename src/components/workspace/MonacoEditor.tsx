"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Editor, { loader, type Monaco } from "@monaco-editor/react";
import { getModelUri, releaseModels, syncModel, type ModelSource } from "@/lib/monaco-models";
import { BUGLAB_THEME, setupMonaco } from "@/lib/monaco-setup";
import type { EditorLanguage } from "@/types/workspace";
import { EditorLoading } from "./EditorLoading";
import { useRemountKey } from "./useRemountKey";

// Monaco's runtime is served from our own origin (public/monaco/<version>/vs,
// copied by scripts/monaco-assets.mjs). next.config.ts sets the path from the
// pinned `monaco-editor` version, so runtime, copied files and types match.
// Without it the editor isn't started at all: the loader's built-in default
// would fetch Monaco from a third-party CDN.
const MONACO_VS_PATH = process.env.MONACO_VS_PATH;
if (MONACO_VS_PATH) loader.config({ paths: { vs: MONACO_VS_PATH } });

interface MonacoEditorProps {
  challengeId: string;
  path: string;
  content: string;
  language: EditorLanguage;
  /** Paths of the files open in tabs. Their models are kept; others are disposed. */
  openPaths: readonly string[];
}

// Each file gets its own Monaco model, named after its challenge and path (see
// lib/monaco-models.ts), so switching tabs keeps content, scroll position, and
// cursor per file, and two challenges never share a model.
export function MonacoEditor({ challengeId, path, content, language, openPaths }: MonacoEditorProps) {
  const [loadFailed, setLoadFailed] = useState(!MONACO_VS_PATH);
  const monacoRef = useRef<Monaco | null>(null);
  const uri = getModelUri(challengeId, path);
  const sourceRef = useRef<ModelSource>({ uri, content, language });
  // When Next.js hides this page and later shows it again, the library has
  // disposed its editor but would never create another: a new key gives it a
  // fresh one. Its model comes back from sourceRef in beforeMount.
  const editorKey = useRemountKey();

  useEffect(() => {
    if (!MONACO_VS_PATH) return;
    const init = loader.init();
    init.catch((error: { type?: string }) => {
      if (error?.type !== "cancelation") setLoadFailed(true);
    });
    return () => init.cancel();
  }, []);

  // The library looks a model up by `path` in its own (passive) effects and
  // reuses whatever it finds, so the model is synced first, in a layout effect.
  // Before the editor exists, beforeMount does the same from sourceRef.
  useLayoutEffect(() => {
    sourceRef.current = { uri, content, language };
    if (monacoRef.current) syncModel(monacoRef.current, sourceRef.current);
  }, [uri, content, language]);

  // Closed tabs and other challenges' files no longer need a model. The model
  // shown in the editor is never disposed here; the library disposes it on unmount.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    releaseModels(monaco, openPaths.map((openPath) => getModelUri(challengeId, openPath)));
  }, [challengeId, openPaths, uri]);

  useEffect(
    () => () => {
      if (monacoRef.current) releaseModels(monacoRef.current, []);
    },
    [],
  );

  function handleBeforeMount(monaco: Monaco) {
    setupMonaco(monaco);
    monacoRef.current = monaco;
    syncModel(monaco, sourceRef.current);
  }

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
      key={editorKey}
      path={uri}
      defaultValue={content}
      language={language}
      theme={BUGLAB_THEME}
      beforeMount={handleBeforeMount}
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
