import type { HttpHeader } from "@/types/investigation";

interface HeaderTableProps {
  title: string;
  headers: HttpHeader[];
}

export function HeaderTable({ title, headers }: HeaderTableProps) {
  return (
    <section className="space-y-1">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title} <span className="font-normal text-subtle">({headers.length})</span>
      </h4>
      <dl className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-xs">
        {headers.map((header, index) => (
          <div key={`${header.name}-${index}`} className="contents">
            <dt className="max-w-56 text-subtle wrap-anywhere">{header.name}</dt>
            <dd className="break-all text-foreground/90">{header.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
