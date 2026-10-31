interface BodyViewProps {
  body?: string;
  emptyMessage: string;
}

function formatBody(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

// Scenario bodies are always rendered as inert text inside <pre>; React
// escapes them, so markup or scripts are never interpreted.
export function BodyView({ body, emptyMessage }: BodyViewProps) {
  if (body === undefined || body === "") {
    return <p className="text-xs text-subtle">{emptyMessage}</p>;
  }

  return (
    <pre className="overflow-auto rounded-md border border-border bg-background p-2.5 font-mono text-xs leading-5 text-foreground/90">
      {formatBody(body)}
    </pre>
  );
}
