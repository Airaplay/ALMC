import { useEffect, useState } from "react";
import { isWebTarget } from "../lib/buildTarget";
import { webAdService } from "../lib/webAdService";
import { WEB_AD_PLACEMENT_KEYS } from "../lib/webAdPlacementKeys";
import { WebAdBanner } from "./web/WebAdBanner";

interface WebAdSidebarProps {
  side: "left" | "right";
}

export function WebAdSidebar({ side }: WebAdSidebarProps) {
  const [ready, setReady] = useState(webAdService.isInitialized);

  useEffect(() => {
    if (!isWebTarget()) return;
    if (ready) return;
    return webAdService.onReady(() => setReady(true));
  }, [ready]);

  if (!isWebTarget() || !ready) return null;

  return (
    <aside
      className={`hidden lg:block w-64 flex-shrink-0 p-4 space-y-4 ${side === "left" ? "order-first" : "order-last"}`}
      aria-label="Advertisement sidebar"
    >
      <WebAdBanner placement="sidebar" placementKey={WEB_AD_PLACEMENT_KEYS.HOME_SIDEBAR} />
      <WebAdBanner placement="in_feed" placementKey={WEB_AD_PLACEMENT_KEYS.HOME_IN_FEED} />
    </aside>
  );
}
