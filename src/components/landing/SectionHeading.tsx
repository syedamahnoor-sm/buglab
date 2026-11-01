import { Reveal } from "./Reveal";

interface SectionHeadingProps {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  description?: string;
}

// Centred under the trace line, which ends in a node just above the eyebrow.
export function SectionHeading({ id, index, eyebrow, title, description }: SectionHeadingProps) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
        <span className="text-subtle">{index}</span>
        <span aria-hidden="true" className="mx-2 text-border-strong">
          /
        </span>
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-4 text-balance text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl lg:text-5xl"
      >
        {title}
      </h2>
      {description && (
        <p className="mx-auto mt-4 max-w-xl text-pretty leading-relaxed text-muted">{description}</p>
      )}
    </Reveal>
  );
}
