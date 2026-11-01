import { Reveal } from "./Reveal";

interface EditorialHeadingProps {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  description: string;
  /** Which side the trace arrives on, from lg. Below lg both read left-aligned. */
  align: "start" | "end";
}

/*
 * An off-centre section heading. "start": title on the left, description
 * beside it. "end": the mirror image, so the trace can come down the right.
 */
export function EditorialHeading({ id, index, eyebrow, title, description, align }: EditorialHeadingProps) {
  const end = align === "end";
  return (
    <Reveal
      className={`grid gap-5 lg:items-end lg:gap-16 ${
        end ? "lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]"
      }`}
    >
      <div className={end ? "lg:col-start-2 lg:text-right" : ""}>
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
      </div>
      <p
        className={`max-w-md text-pretty leading-relaxed text-muted lg:pb-1.5 ${
          end ? "lg:col-start-1 lg:row-start-1" : "lg:justify-self-end"
        }`}
      >
        {description}
      </p>
    </Reveal>
  );
}
