import {
  Home, BookOpen, List, Calendar, CalendarDays, LayoutGrid, MonitorSmartphone,
  Receipt, Users, Banknote, Wallet, FileText, Truck, ClipboardList, Package,
  Clock, JapaneseYen, BarChart3, UserCog, Settings, MoreHorizontal,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  book: BookOpen,
  list: List,
  calendar: Calendar,
  calendarDays: CalendarDays,
  grid: LayoutGrid,
  pos: MonitorSmartphone,
  receipt: Receipt,
  users: Users,
  cash: Banknote,
  wallet: Wallet,
  file: FileText,
  truck: Truck,
  clipboard: ClipboardList,
  package: Package,
  clock: Clock,
  yen: JapaneseYen,
  chart: BarChart3,
  userCog: UserCog,
  settings: Settings,
  more: MoreHorizontal,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Home;
  return <Icon className={className} aria-hidden="true" />;
}
