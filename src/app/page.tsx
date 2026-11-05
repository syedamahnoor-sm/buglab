import type { Metadata } from "next";
import { CaseBridge } from "@/components/landing/CaseBridge";
import { CaseFile } from "@/components/landing/CaseFile";
import { ClosingCta } from "@/components/landing/ClosingCta";
import { Hero } from "@/components/landing/Hero";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingHeader } from "@/components/landing/LandingHeader";
import "@/components/landing/landing.css";
import { styles } from "@/components/landing/styles";
import { MethodBridge } from "@/components/landing/MethodBridge";
import { MethodTimeline } from "@/components/landing/MethodTimeline";
import { ReplaySection } from "@/components/landing/ReplaySection";
import { InstrumentBench } from "@/components/landing/showcase/InstrumentBench";
import { TraceConnector } from "@/components/landing/TraceConnector";
import { SECTION_IDS, hero } from "@/data/landing";

export const metadata: Metadata = {
  title: "BugLab · Every bug leaves a trail",
  description: hero.subtitle,
};

// The landing page. Prerendered as static HTML. The replay, reveals, pointer glow and the two
// live tiles hydrate on top; everything else is server-rendered only.
export default function Home() {
  return (
    <div className={`${styles.root} flex flex-1 flex-col`}>
      <LandingHeader />
      <main id={SECTION_IDS.content} tabIndex={-1} className="flex-1 outline-none">
        <Hero />
        <ReplaySection />
        <TraceConnector height="h-24 sm:h-32" />
        <MethodTimeline />
        <MethodBridge />
        <InstrumentBench />
        <CaseFile />
        <CaseBridge />
        <ClosingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
