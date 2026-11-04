import type { SVGProps } from "react";
import { BrowserIcon, DatabaseIcon, GaugeIcon, GridIcon, LockIcon, PlugIcon, ShieldIcon } from "@/components/ui/icons";
import type { CategoryId } from "@/types/catalog";

const ICONS: Record<CategoryId | "all", (props: SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  all: GridIcon,
  authentication: LockIcon,
  api: PlugIcon,
  frontend: BrowserIcon,
  database: DatabaseIcon,
  security: ShieldIcon,
  performance: GaugeIcon,
};

/** The icon for a category, or for "All challenges". Decorative: the label carries the meaning. */
export function CategoryIcon({ category, className }: { category: CategoryId | "all"; className?: string }) {
  const Icon = ICONS[category];
  return <Icon className={className} />;
}
