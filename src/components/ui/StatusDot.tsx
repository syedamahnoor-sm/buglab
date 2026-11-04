import type { BadgeTone } from "./Badge";

const dotClasses: Record<BadgeTone, string> = {
  neutral: "bg-subtle",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

interface StatusDotProps {
  tone?: BadgeTone;
  pulse?: boolean;
}

export function StatusDot({ tone = "neutral", pulse = false }: StatusDotProps) {
  return (
    <span aria-hidden="true" className="relative inline-flex size-2">
      {pulse && (
        <span
          className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${dotClasses[tone]}`}
        />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${dotClasses[tone]}`} />
    </span>
  );
}
