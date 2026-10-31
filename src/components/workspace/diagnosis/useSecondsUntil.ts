import { useEffect, useState } from "react";

/** Whole seconds remaining until `target` (epoch ms), ticking once a second. */
export function useSecondsUntil(target: number | undefined, initialSeconds: number) {
  const [tick, setTick] = useState<{ target: number; remaining: number } | null>(null);

  useEffect(() => {
    if (target === undefined) return;
    const update = () =>
      setTick({ target, remaining: Math.max(0, Math.ceil((target - Date.now()) / 1000)) });
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [target]);

  if (target === undefined) return 0;
  return tick?.target === target ? tick.remaining : initialSeconds;
}
