"use client";

import { useState } from "react";
import { defaultSampleRequestId, sampleRequests, showcase } from "@/data/landing";
import { styles } from "../styles";
import { ShowcaseTile } from "./ShowcaseTile";

function statusClass(status: number) {
  if (status >= 400) return "text-danger";
  if (status >= 300) return "text-warning";
  return "text-success";
}

// A working miniature of the network inspector: pick a request, read it.
export function NetworkTile() {
  const [selectedId, setSelectedId] = useState(defaultSampleRequestId);
  const selected = sampleRequests.find((request) => request.id === selectedId) ?? sampleRequests[0];

  return (
    <ShowcaseTile content={showcase.network}>
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface-sunken font-mono text-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <ul aria-label="Sample requests" className="border-b border-border py-1 md:border-b-0 md:border-r">
          {sampleRequests.map((request) => {
            const isSelected = request.id === selected.id;
            return (
              <li key={request.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(request.id)}
                  className={`grid w-full grid-cols-[2.25rem_2.75rem_minmax(0,1fr)] items-center gap-x-2 border-l-2 px-3 py-1.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/70 ${
                    isSelected ? "border-accent bg-accent/10" : "border-transparent hover:bg-surface-raised"
                  }`}
                >
                  <span className={`font-semibold ${statusClass(request.status)}`}>{request.status}</span>
                  <span className="text-muted">{request.method}</span>
                  <span className="truncate text-foreground/90">{request.path}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <section aria-label="Request details" aria-live="polite" className="min-w-0">
          <div key={selected.id} className={`px-3 py-2.5 ${styles.slideIn}`} style={{ animationDelay: "0ms" }}>
            <p className="truncate text-foreground">
              {selected.method} {selected.path}
            </p>
            <dl className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-subtle">Status</dt>
              <dd className={statusClass(selected.status)}>
                {selected.status} {selected.statusText}
              </dd>
              <dt className="text-subtle">Type</dt>
              <dd className="text-foreground/85">{selected.type}</dd>
              <dt className="text-subtle">Duration</dt>
              <dd className="text-foreground/85">{selected.durationMs} ms</dd>
            </dl>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-subtle">
              Response headers
            </p>
            <dl className="mt-1 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
              {selected.headers.map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="truncate text-subtle">{name}</dt>
                  <dd className="text-foreground/85 wrap-break-word">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>
    </ShowcaseTile>
  );
}
