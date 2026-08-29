import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Sparkles,
  Package,
  Rocket,
  FileText,
  TrendingUp,
  Search,
  BarChart3,
  Bot,
  Plug,
  CreditCard,
  Settings,
  ShieldCheck,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Promote", href: "/promote", icon: Sparkles },
  { label: "Products", href: "/products", icon: Package },
  { label: "Campaigns", href: "/campaigns", icon: Rocket },
  { label: "Content", href: "/content", icon: FileText },
  { label: "Growth", href: "/growth", icon: TrendingUp },
  { label: "SEO", href: "/seo", icon: Search },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "AI Marketing", href: "/ai-marketing", icon: Bot },
  { label: "Connections", href: "/connections", icon: Plug },
  { label: "Approvals", href: "/approvals", icon: ShieldCheck },
  { label: "Billing", href: "/billing", icon: CreditCard },
  { label: "Settings", href: "/settings", icon: Settings },
];
