/*
 * Challenge 012: Search Results From the Past. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-22";
const results = (titles: string[], total: number) =>
  JSON.stringify({ total, results: titles.map((title, index) => ({ id: `pkg_${index + 1}`, title })) });

const R = ["Rails guides", "Redis client", "Rust book", "Realm database"];
const RE = ["Redis client", "Realm database", "Regex cheatsheet", "React hooks primer"];
const REA = ["Realm database", "Readable streams", "React hooks primer", "Reactive extensions"];
const REAC = ["React hooks primer", "Reactive extensions", "React Native setup"];
const REACT = ["React hooks primer", "React Native setup", "React testing library"];

export const challenge012 = defineChallenge({
  number: "012",
  title: "Search Results From the Past",
  incident: "The docs search box sometimes shows results for an earlier, shorter version of what was typed.",
  difficulty: "intermediate",
  tags: ["React", "Race condition", "fetch"],
  estimatedMinutes: 20,
  description:
    "Type \"react\" into the docs search and you may get results for \"rea\": Realm, Readable streams and friends. It happens mostly on slower connections, and typing one more letter usually fixes it.",
  category: "frontend",
  technologies: ["TypeScript", "React", "Node.js"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://docs.quarry.example",
  files: {
    "INCIDENT.md": `# INC-012 · Search Results From the Past

**Opened:** ${DATE} 10:20 UTC
**Severity:** SEV-4
**Service:** quarry-docs-web v5.2.0

## Summary
A user typed "react" into the search box. The box says "react", but the
results are about Realm and readable streams. Our analytics show the same
pattern a few hundred times a day.

## Notes
- Search results come from /api/search, which is fast for long queries
  and slower for short, broad ones
- The browser capture is from the user's laptop on hotel Wi-Fi
- Times in the Network tab are when each response finished

## Your task
Explain why the results do not match the query on screen.
`,
    "package.json": `{
  "name": "quarry-docs-web",
  "version": "5.2.0",
  "private": true,
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" }
}
`,
    "src/search/SearchBox.tsx": `import { useEffect, useState } from "react";
import { searchDocs, type SearchResult } from "./api";
import { ResultList } from "./ResultList";

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (query.trim() === "") {
      setResults([]);
      return;
    }
    searchDocs(query).then((response) => setResults(response.results));
  }, [query]);

  return (
    <div role="search">
      <input type="search" aria-label="Search the docs" value={query} onChange={(event) => setQuery(event.target.value)} />
      <ResultList results={results} />
    </div>
  );
}
`,
    "src/search/api.ts": `export interface SearchResult {
  id: string;
  title: string;
}

export async function searchDocs(query: string): Promise<{ total: number; results: SearchResult[] }> {
  const response = await fetch(\`/api/search?q=\${encodeURIComponent(query)}\`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(\`search failed: \${response.status}\`);
  return response.json();
}
`,
    "src/search/ResultList.tsx": `import type { SearchResult } from "./api";

export function ResultList({ results }: { results: SearchResult[] }) {
  if (results.length === 0) return null;
  return (
    <ul className="results">
      {results.map((result) => (
        <li key={result.id}>{result.title}</li>
      ))}
    </ul>
  );
}
`,
    "server/search.ts": `import { Router } from "express";
import { index } from "./search-index";
import { log } from "./log";

export const search = Router();

search.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const started = Date.now();
  const { total, hits } = await index.query(q, { limit: 20 });
  log.info("search", \`Search q=\${q} hits=\${total} took=\${Date.now() - started}ms\`);
  res.set("Cache-Control", "no-store").json({ total, results: hits });
});
`,
  },
  logs: [
    ["10:02:41.381", "INFO", "search", "Search q=r hits=812 took=197ms"],
    ["10:02:41.392", "INFO", "http", "GET /api/search?q=r 200 210ms"],
    ["10:02:41.611", "INFO", "search", "Search q=re hits=301 took=276ms"],
    ["10:02:41.618", "INFO", "http", "GET /api/search?q=re 200 285ms"],
    ["10:02:41.902", "INFO", "search", "Search q=reac hits=26 took=58ms"],
    ["10:02:41.905", "INFO", "http", "GET /api/search?q=reac 200 64ms"],
    ["10:02:41.988", "INFO", "search", "Search q=react hits=19 took=41ms"],
    ["10:02:41.990", "INFO", "http", "GET /api/search?q=react 200 47ms"],
    ["10:02:42.090", "INFO", "replay", "Input value=\"react\""],
    ["10:02:42.096", "INFO", "replay", "Rendered results: React hooks primer, React Native setup, React testing library"],
    ["10:02:42.742", "INFO", "search", "Search q=rea hits=48 took=1203ms"],
    ["10:02:42.746", "INFO", "http", "GET /api/search?q=rea 200 1212ms"],
    ["10:02:42.761", "INFO", "replay", "Rendered results: Realm database, Readable streams, React hooks primer, Reactive extensions"],
    ["10:02:50.004", "INFO", "replay", "Input value=\"react\" (no change for 8 s)"],
  ],
  network: [
    { log: 2, initiator: "src/search/api.ts", ms: 402, response: results(R, 812), responseHeaders: { "cache-control": "no-store" } },
    { log: 4, initiator: "src/search/api.ts", ms: 451, response: results(RE, 301), responseHeaders: { "cache-control": "no-store" } },
    { log: 6, initiator: "src/search/api.ts", ms: 233, response: results(REAC, 26), responseHeaders: { "cache-control": "no-store" } },
    { log: 8, initiator: "src/search/api.ts", ms: 214, response: results(REACT, 19), responseHeaders: { "cache-control": "no-store" } },
    { log: 12, initiator: "src/search/api.ts", ms: 1388, response: results(REA, 48), responseHeaders: { "cache-control": "no-store" } },
  ],
  options: [
    [
      "server-wrong-results",
      "The search API returns results for the wrong query",
      "The server mixes up queries, so a request for \"react\" returns another query's matches.",
    ],
    [
      "cached-response",
      "A cached response for an earlier query is reused",
      "The browser or a proxy serves a stored response instead of asking the server.",
    ],
    [
      "out-of-order-responses",
      "Responses arrive out of order and the last one to arrive wins",
      "Every keystroke starts a request, and whichever finishes last replaces the results, even if it was for an older query.",
    ],
    [
      "input-state-lags",
      "The input's state lags one keystroke behind what is displayed",
      "The query state is updated before the latest character is applied, so each search is for the previous value.",
    ],
  ],
});
