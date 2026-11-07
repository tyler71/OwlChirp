// App sections: the sidebar and the office desk computer's shortcuts.
import type { Feature, View } from "../lib/stores";
import type { IconName } from "./ui";

export const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: "phone", label: "Phone", icon: "phone" },
  { view: "feed", label: "Feed", icon: "chat" },
  { view: "flow", label: "Flow Calls", icon: "queue" },
  { view: "timeline", label: "Timeline", icon: "timeline" },
  { view: "map", label: "Map", icon: "map" },
  { view: "calls", label: "Recent Calls", icon: "clock" },
  { view: "callerids", label: "Caller IDs", icon: "user" },
  { view: "admin", label: "Admin", icon: "shield" },
  { view: "settings", label: "Settings", icon: "cog" },
];

// Views that need a feature; the rest are open to everyone.
const VIEW_FEATURE: Partial<Record<View, Feature>> = {
  calls: "calls",
  feed: "feed",
  flow: "flow",
  timeline: "timeline",
  map: "map",
  callerids: "callerIds",
  admin: "admin",
};

export function canView(view: View, features: Feature[]): boolean {
  const needed = VIEW_FEATURE[view];
  return !needed || features.includes(needed);
}
