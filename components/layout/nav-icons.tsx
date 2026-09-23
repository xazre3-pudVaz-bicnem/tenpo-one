import {
  Home, BookOpen, List, Calendar, CalendarDays, LayoutGrid, MonitorSmartphone,
  ReceiptJapaneseYen, Users, Banknote, Wallet, FileText, Truck, ClipboardList, Package,
  Clock, JapaneseYen, BarChart3, UserCog, Settings, MoreHorizontal, Lock, Bell,
  Ticket, Landmark, Mail, Inbox, Camera, ConciergeBell, SlidersHorizontal, ShoppingBag,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  book: BookOpen,
  list: List,
  calendar: Calendar,
  calendarDays: CalendarDays,
  grid: LayoutGrid,
  pos: ConciergeBell,
  monitor: MonitorSmartphone,
  // 伝票はドル記号ではなく円記号のレシート
  receipt: ReceiptJapaneseYen,
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
  settings: SlidersHorizontal,
  gear: Settings,
  more: MoreHorizontal,
  lock: Lock,
  bell: Bell,
  ticket: Ticket,
  bank: Landmark,
  mail: Mail,
  drawer: Inbox,
  bag: ShoppingBag,
  camera: Camera,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Home;
  return <Icon className={className} aria-hidden="true" />;
}
