import type { ReactNode, SVGProps } from "react";

// Landing-only icons, kept apart from the workspace's shared icon set.
type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </BaseIcon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
    </BaseIcon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2} />
    </BaseIcon>
  );
}

export function ReplayIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 8a5 5 0 1 0 1.5-3.55M3 2.5v2.25h2.25" />
    </BaseIcon>
  );
}

const featureIcons = {
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </>
  ),
  network: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.75 1.75 2.5 3.75 2.5 6s-.75 4.25-2.5 6M8 2C6.25 3.75 5.5 5.75 5.5 8s.75 4.25 2.5 6" />
    </>
  ),
  notes: (
    <>
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </>
  ),
  shield: (
    <>
      <path d="M8 1.75 13 3.5v4c0 3.25-2.25 5.5-5 6.75C5.25 13 3 10.75 3 7.5v-4z" />
      <path d="m5.75 8 1.5 1.5 3-3" />
    </>
  ),
  keyboard: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type LandingIconName = keyof typeof featureIcons;

export function FeatureIcon({ name, ...props }: IconProps & { name: LandingIconName }) {
  return <BaseIcon {...props}>{featureIcons[name]}</BaseIcon>;
}
