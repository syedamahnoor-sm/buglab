/*
 * Monaco model identity and lifecycle for scenario files.
 *
 * Monaco keeps text models in one page-wide registry keyed by URI, and
 * @monaco-editor/react reuses an existing model for a URI without updating its
 * text. Two challenges with the same file path would therefore share a model,
 * and the second would show the first one's code. So every model URI names
 * its challenge, the active model is synced to the current content before the
 * editor shows it, and models no longer open are disposed.
 */
import type { EditorLanguage } from "@/types/workspace";

/** Root of every scenario model URI; nothing else in the page uses it. */
export const MODEL_URI_ROOT = "file:///challenges/";

// The subset of Monaco this module uses, so tests can supply a stand-in.
interface ModelUri {
  readonly path: string;
  toString(): string;
}

export interface TextModel {
  readonly uri: ModelUri;
  getValue(): string;
  setValue(value: string): void;
  getLanguageId(): string;
  isDisposed(): boolean;
  dispose(): void;
}

export interface MonacoModelHost {
  Uri: { parse(value: string): ModelUri };
  editor: {
    getModel(uri: ModelUri): TextModel | null;
    createModel(value: string, language: string, uri: ModelUri): TextModel;
    getModels(): TextModel[];
    getEditors(): { getModel(): TextModel | null }[];
    setModelLanguage(model: TextModel, languageId: string): void;
  };
}

/**
 * The model URI for one file of one challenge, such as
 * "file:///challenges/challenge-001/src/server.ts". The file name stays last,
 * so Monaco's TypeScript worker still sees ".tsx" and ".jsx" extensions.
 */
export function getModelUri(challengeId: string, path: string): string {
  if (!challengeId || /[/\\]/.test(challengeId)) {
    throw new Error(`Invalid challenge ID for a model URI: "${challengeId}"`);
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error(`Invalid file path for a model URI: "${path}"`);
  return MODEL_URI_ROOT + [challengeId, ...segments].map(encodeURIComponent).join("/");
}

export interface ModelSource {
  uri: string;
  content: string;
  language: EditorLanguage;
}

/**
 * Returns the model for `source.uri`, creating it or bringing an existing
 * one's text and language up to date, so the editor never shows stale code.
 */
export function syncModel(monaco: MonacoModelHost, source: ModelSource): TextModel {
  const uri = monaco.Uri.parse(source.uri);
  const existing = monaco.editor.getModel(uri);
  if (!existing || existing.isDisposed()) {
    return monaco.editor.createModel(source.content, source.language, uri);
  }
  if (existing.getValue() !== source.content) existing.setValue(source.content);
  if (existing.getLanguageId() !== source.language) {
    monaco.editor.setModelLanguage(existing, source.language);
  }
  return existing;
}

/**
 * Disposes every scenario model that is neither in `keep` nor shown in a live
 * editor. Models outside MODEL_URI_ROOT are never touched. Returns the number
 * of models disposed.
 */
export function releaseModels(monaco: MonacoModelHost, keep: Iterable<string>): number {
  const keepKeys = new Set(Array.from(keep, (uri) => monaco.Uri.parse(uri).toString()));
  const inUse = new Set<string>();
  for (const editor of monaco.editor.getEditors()) {
    const model = editor.getModel();
    if (model) inUse.add(model.uri.toString());
  }

  const rootPath = monaco.Uri.parse(MODEL_URI_ROOT).path;
  let disposed = 0;
  for (const model of monaco.editor.getModels()) {
    const key = model.uri.toString();
    if (!key.startsWith("file:") || !model.uri.path.startsWith(rootPath)) continue;
    if (keepKeys.has(key) || inUse.has(key) || model.isDisposed()) continue;
    model.dispose();
    disposed++;
  }
  return disposed;
}
