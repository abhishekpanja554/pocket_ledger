import {
  CreditCard,
  FileText,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  RefreshCw,
  Settings as SettingsIcon,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type RouteId =
  | "dashboard"
  | "transactions"
  | "recurring"
  | "subscriptions"
  | "budgets"
  | "goals"
  | "documents"
  | "rules"
  | "settings";

export interface NavEntry {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  subtitle: string;
}

/** Order is fixed by the product spec. */
export const NAV: NavEntry[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    subtitle: "Your money at a glance",
  },
  {
    id: "transactions",
    label: "Transactions",
    icon: Receipt,
    subtitle: "Search, filter and categorize every entry",
  },
  {
    id: "recurring",
    label: "Recurring",
    icon: RefreshCw,
    subtitle: "Detected and confirmed recurring payments",
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    icon: CreditCard,
    subtitle: "What renews, and what it costs",
  },
  {
    id: "budgets",
    label: "Budgets",
    icon: Wallet,
    subtitle: "Monthly limits measured against real spending",
  },
  {
    id: "goals",
    label: "Goals",
    icon: Target,
    subtitle: "What you are saving toward",
  },
  {
    id: "documents",
    label: "Documents",
    icon: FileText,
    subtitle: "Receipts, statements and your Drive inbox",
  },
  {
    id: "rules",
    label: "Rules",
    icon: PiggyBank,
    subtitle: "Categorization rules and tags",
  },
  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    subtitle: "Net worth, lists, sync and data controls",
  },
];

export const ROUTE_IDS = NAV.map((entry) => entry.id);

export function routeFromHash(hash: string): RouteId {
  const clean = hash.replace(/^#\/?/, "").split("?")[0];
  return (ROUTE_IDS as string[]).includes(clean)
    ? (clean as RouteId)
    : "dashboard";
}
