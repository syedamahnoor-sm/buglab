import { SECTION_IDS } from "@/data/landing";
import { IncidentReplay } from "./replay/IncidentReplay";
import { ScrollReplay } from "./replay/ScrollReplay";
import { SectionHeading } from "./SectionHeading";
import { styles } from "./styles";

// Without JavaScript neither replay can play, so every width gets the pinned
// layout's markup: all five chapters in full beside a still window.
const noScriptFallback = `.${styles.replayTabs}{display:none!important}.${styles.replayScroll}{display:grid!important}`;

/*
 * Two replays, switched in CSS so nothing shifts at hydration: the tabbed
 * player below lg, the scroll-driven pinned one from lg.
 */
export function ReplaySection() {
  return (
    <section
      id={SECTION_IDS.replay}
      aria-labelledby="replay-title"
      className="scroll-mt-20 px-4 pt-16 sm:px-6 sm:pt-20"
    >
      <noscript>
        <style>{noScriptFallback}</style>
      </noscript>
      <SectionHeading
        id="replay-title"
        index="01"
        eyebrow="Incident replay"
        title="Watch an investigation unfold."
        description="Five steps from the first report to the moment you make the call. Follow along, or jump to any chapter."
      />
      <div className={`mt-12 ${styles.replayTabs}`}>
        <IncidentReplay />
      </div>
      <div className="mt-12 lg:mt-6">
        <ScrollReplay />
      </div>
    </section>
  );
}
