"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { styles } from "./styles";

let observer: IntersectionObserver | null = null;

// One observer for every reveal on the page; each element reveals once.
function getObserver() {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.reveal = "shown";
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.15 },
  );
  return observer;
}

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger, in milliseconds. */
  delay?: number;
}

/*
 * Server-rendered content is always visible: only elements that are still
 * below the fold when the page hydrates are hidden, and they come back as they
 * scroll into view. Without JavaScript, or with reduced motion, nothing hides.
 */
export function Reveal({ children, className = "", delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight) return;

    element.dataset.reveal = "pending";
    const io = getObserver();
    io.observe(element);
    return () => io.unobserve(element);
  }, []);

  return (
    <div
      ref={ref}
      className={`${styles.reveal} ${className}`}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
