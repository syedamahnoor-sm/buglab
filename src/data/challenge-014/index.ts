/*
 * Challenge 014: Autosave Saves Nothing. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-19";
const COOKIE = { cookie: "inkwell_sid=b02f9d61e7" };
const OPENING = "Retro notes";
const TYPED =
  "Retro notes\n- Deploys took too long on Thursday\n- Pager rotation needs a second person\n- Celebrate the search launch";
const draft = (text: string) => JSON.stringify({ text });
const saved = (version: number, chars: number) => JSON.stringify({ saved: true, version, chars });

export const challenge014 = defineChallenge({
  number: "014",
  title: "Autosave Saves Nothing",
  incident: "Notes written in the editor are lost on reload even though autosave reports success every five seconds.",
  difficulty: "advanced",
  tags: ["React", "Closures", "Timers"],
  estimatedMinutes: 35,
  description:
    "People type for minutes, see \"Saved\" tick over every five seconds, close the tab, and come back to the text they started with. Pressing Save by hand keeps everything.",
  category: "frontend",
  technologies: ["TypeScript", "React", "Node.js"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://inkwell.example",
  files: {
    "INCIDENT.md": `# INC-014 · Autosave Saves Nothing

**Opened:** ${DATE} 15:10 UTC
**Severity:** SEV-2 (data loss)
**Service:** inkwell-web v3.4.0 (introduced autosave)

## Summary
A user typed their retrospective notes for about a minute, watched the
"Saved" indicator update, closed the tab and reopened the document. Only
the title line, "Retro notes", was there.

## Notes
- The document had one editor open: no other tab or device was editing it
- Every autosave request succeeded (200)
- Pressing the Save button stores the full text

## Evidence attached
- API logs and session-replay events for the session (replay events are tagged [replay])
- The user's browser capture

## Your task
Explain why autosave keeps the old text.
`,
    "package.json": `{
  "name": "inkwell-web",
  "version": "3.4.0",
  "private": true,
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" }
}
`,
    "src/editor/DocumentEditor.tsx": `import { useEffect, useState } from "react";
import { saveDraft } from "./api";
import { SaveStatus } from "./SaveStatus";

const AUTOSAVE_MS = 5000;

export function DocumentEditor({ docId, initialText }: { docId: string; initialText: string }) {
  const [draft, setDraft] = useState(initialText);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Start the autosave timer once when the editor opens; restarting it on
  // every keystroke would mean it never fires while someone is typing.
  useEffect(() => {
    const timer = setInterval(async () => {
      await saveDraft(docId, draft);
      setLastSaved(new Date());
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  async function saveNow() {
    await saveDraft(docId, draft);
    setLastSaved(new Date());
  }

  return (
    <section>
      <textarea aria-label="Document" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={saveNow}>Save</button>
      <SaveStatus lastSaved={lastSaved} />
    </section>
  );
}
`,
    "src/editor/api.ts": `export async function saveDraft(docId: string, text: string) {
  const response = await fetch(\`/api/docs/\${docId}/draft\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(\`save failed: \${response.status}\`);
  return response.json() as Promise<{ saved: true; version: number; chars: number }>;
}

export async function loadDocument(docId: string) {
  const response = await fetch(\`/api/docs/\${docId}\`);
  return response.json() as Promise<{ id: string; text: string; version: number }>;
}
`,
    "src/editor/SaveStatus.tsx": `export function SaveStatus({ lastSaved }: { lastSaved: Date | null }) {
  if (!lastSaved) return <span className="status">Not saved yet</span>;
  return <span className="status">Saved {lastSaved.toLocaleTimeString()}</span>;
}
`,
    "server/routes/docs.ts": `import { Router } from "express";
import { docs } from "../store";
import { log } from "../log";

export const docsRouter = Router();

docsRouter.get("/api/docs/:id", async (req, res) => res.json(await docs.get(req.params.id)));

docsRouter.post("/api/docs/:id/draft", async (req, res) => {
  const text = String(req.body.text ?? "");
  const version = await docs.saveText(req.params.id, text);
  log.info("docs", \`Draft saved doc=\${req.params.id} chars=\${text.length} version=\${version}\`);
  res.json({ saved: true, version, chars: text.length });
});
`,
  },
  logs: [
    ["14:52:00.114", "INFO", "http", "GET /api/docs/d_77 200 7ms"],
    ["14:52:00.302", "INFO", "replay", "Editor opened doc=d_77 length=11"],
    ["14:52:03.880", "INFO", "replay", "Typing in Document length=46"],
    ["14:52:05.318", "INFO", "docs", "Draft saved doc=d_77 chars=11 version=42"],
    ["14:52:05.320", "INFO", "http", "POST /api/docs/d_77/draft 200 5ms"],
    ["14:52:09.441", "INFO", "replay", "Typing in Document length=86"],
    ["14:52:10.317", "INFO", "docs", "Draft saved doc=d_77 chars=11 version=43"],
    ["14:52:10.318", "INFO", "http", "POST /api/docs/d_77/draft 200 4ms"],
    ["14:52:14.207", "INFO", "replay", "Typing in Document length=116"],
    ["14:52:15.318", "INFO", "docs", "Draft saved doc=d_77 chars=11 version=44"],
    ["14:52:15.319", "INFO", "http", "POST /api/docs/d_77/draft 200 4ms"],
    ["14:52:16.020", "INFO", "replay", "Status text \"Saved 14:52:15\""],
    ["14:52:18.770", "INFO", "replay", "Tab closed"],
    ["14:53:40.501", "INFO", "http", "GET /api/docs/d_77 200 6ms"],
    ["14:53:40.690", "INFO", "replay", "Editor opened doc=d_77 length=11"],
    ["14:54:22.904", "INFO", "replay", "Typing in Document length=116 (retyped)"],
    ["14:54:23.512", "INFO", "replay", "Click button=\"Save\""],
    ["14:54:23.530", "INFO", "docs", "Draft saved doc=d_77 chars=116 version=45"],
    ["14:54:23.531", "INFO", "http", "POST /api/docs/d_77/draft 200 6ms"],
  ],
  network: [
    { log: 1, initiator: "src/editor/api.ts", requestHeaders: COOKIE, response: JSON.stringify({ id: "d_77", text: OPENING, version: 41 }) },
    { log: 5, initiator: "src/editor/api.ts", requestHeaders: COOKIE, body: draft(OPENING), response: saved(42, 11) },
    { log: 8, initiator: "src/editor/api.ts", requestHeaders: COOKIE, body: draft(OPENING), response: saved(43, 11) },
    { log: 11, initiator: "src/editor/api.ts", requestHeaders: COOKIE, body: draft(OPENING), response: saved(44, 11) },
    { log: 14, initiator: "src/editor/api.ts", requestHeaders: COOKIE, response: JSON.stringify({ id: "d_77", text: OPENING, version: 44 }) },
    { log: 19, initiator: "src/editor/api.ts", requestHeaders: COOKIE, body: draft(TYPED), response: saved(45, 116) },
  ],
  options: [
    [
      "server-drops-writes",
      "The server accepts autosaves but does not store them",
      "The draft endpoint answers 200 without persisting the text it was sent.",
    ],
    [
      "stale-closure-in-interval",
      "The autosave timer keeps using the text from when it was created",
      "The interval's callback was created once, so it always sees the draft value from the first render.",
    ],
    [
      "other-tab-overwrites",
      "Another open copy of the document overwrites the changes",
      "A second editor saves its older text on top of the user's edits.",
    ],
    [
      "local-copy-on-reload",
      "On reload the editor restores an old local copy instead of the server's text",
      "A copy kept in the browser replaces the saved text when the document opens.",
    ],
    [
      "unmount-cancels-save",
      "Closing the tab cancels the save that was in progress",
      "The last edits are lost because the final save is aborted when the page unloads.",
    ],
  ],
});
