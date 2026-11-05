import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon } from "./icons";
import { styles } from "./styles";

const variants = {
  primary: `${styles.ctaPrimary} cta-gradient overflow-hidden bg-accent text-background hover:brightness-110`,
  secondary: `${styles.ctaSecondary} border border-border-strong bg-surface/80 text-foreground hover:bg-surface-raised`,
};

interface CtaLinkProps {
  href: string;
  children: ReactNode;
  variant?: keyof typeof variants;
  size?: "sm" | "md" | "lg";
  arrow?: boolean;
}

const sizes = {
  sm: "h-8 px-3 text-sm",
  md: "h-11 px-5 text-sm sm:text-base",
  lg: "h-12 px-6 text-base",
};

export function CtaLink({ href, children, variant = "primary", size = "md", arrow }: CtaLinkProps) {
  return (
    <Link
      href={href}
      className={`${styles.cta} inline-flex items-center justify-center gap-2 rounded-md font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${sizes[size]} ${variants[variant]}`}
    >
      {children}
      {arrow && <ArrowRightIcon className={styles.arrow} />}
    </Link>
  );
}
