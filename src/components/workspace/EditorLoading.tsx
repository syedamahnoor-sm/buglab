export function EditorLoading() {
  return (
    <div
      role="status"
      className="flex h-full flex-col gap-2.5 p-4 motion-safe:animate-pulse"
    >
      <span className="sr-only">Loading editor…</span>
      {[72, 48, 64, 36, 80, 52, 40].map((width, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{ width: `${width}%` }}
          className="h-3 rounded bg-surface-raised"
        />
      ))}
    </div>
  );
}
