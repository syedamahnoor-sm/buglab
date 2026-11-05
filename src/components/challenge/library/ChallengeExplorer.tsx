"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { parseDiscoveryQuery, serializeDiscoveryQuery, type DiscoveryQuery } from "@/lib/catalog/discovery";
import type { PublicChallenge } from "@/types/catalog";
import { ExplorerView, type QueryChangeOptions } from "./ExplorerView";

/**
 * The discovery view, with its query kept in the URL (?q, category, difficulty,
 * tech, sort) so a filtered view can be shared and survives a reload. Each
 * filter change is a history entry, so back and forward step through them;
 * typing a search replaces the entry instead of adding one per keystroke.
 */
export function ChallengeExplorer({ challenges }: { challenges: PublicChallenge[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const query = useMemo(() => parseDiscoveryQuery(searchParams, challenges), [searchParams, challenges]);

  const onQueryChange = useCallback(
    (next: DiscoveryQuery, options?: QueryChangeOptions) => {
      const search = serializeDiscoveryQuery(next);
      const href = search ? `${pathname}?${search}` : pathname;
      if (options?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router, pathname],
  );

  return <ExplorerView challenges={challenges} query={query} onQueryChange={onQueryChange} />;
}
