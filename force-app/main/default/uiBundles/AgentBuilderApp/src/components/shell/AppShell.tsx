import { useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Home,
  Workflow,
  LayoutGrid,
  Activity,
  MessageCircle,
  MessageSquare,
  CheckSquare,
  Users,
  Layers,
  KeyRound,
  Plug,
  Settings,
  Search,
  ChevronsLeft,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  icon: typeof Home;
  label: string;
  href?: string;
  comingSoon?: boolean;
}

const BUILD_ITEMS: NavItem[] = [
  { icon: Home, label: 'Home', href: '/home' },
  { icon: Workflow, label: 'Workflows', href: '/' },
  { icon: LayoutGrid, label: 'Templates', href: '/templates' },
  { icon: MessageCircle, label: 'Chat', href: '/chat' },
];
const MONITOR_ITEMS: NavItem[] = [
  { icon: Activity, label: 'Executions', href: '/executions' },
  { icon: MessageSquare, label: 'Conversations', href: '/conversations' },
  { icon: CheckSquare, label: 'Approvals', href: '/approvals' },
];
const ADMIN_ITEMS: NavItem[] = [
  { icon: Users, label: 'Users & Roles', comingSoon: true },
  { icon: Layers, label: 'Environments', href: '/environments' },
  { icon: KeyRound, label: 'Credentials', href: '/ai-connections' },
  { icon: Plug, label: 'Connectors', href: '/connectors' },
  { icon: Settings, label: 'Settings', href: '/settings' },
];

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="px-3">
      <div className="px-2 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-wider text-[var(--sidebar-muted)]">
        {title}
      </div>
      {items.map(item => {
        const Icon = item.icon;
        const active = item.href != null && location.pathname === item.href;
        return (
          <button
            key={item.label}
            type="button"
            onClick={
              item.href
                ? () => navigate(item.href!)
                : () => window.alert(`${item.label} — coming soon.`)
            }
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
              active
                ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)]'
                : 'text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--sidebar-foreground)]'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function AppShell({
  children,
  defaultCollapsed = false,
  railExtra,
}: {
  children: ReactNode;
  /** Start with just the icon rail — the agent canvas needs its width
   *  for the graph, not the full nav; still expandable via the toggle. */
  defaultCollapsed?: boolean;
  /** Page-specific rail button (e.g. AgentBuilder's "add node" trigger) —
   *  AppShell stays a generic shell, the page owns what this renders/does. */
  railExtra?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-full w-full">
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col bg-[var(--sidebar)] transition-[width] duration-150',
          collapsed ? 'w-[68px]' : 'w-[280px]'
        )}
      >
        <div className="p-3">
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-[var(--sidebar-accent)]/60"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-primary)] text-[13px] font-bold text-white">
              A
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[13px] font-semibold text-[var(--sidebar-foreground)]">
                    Archon AI
                  </div>
                  <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--archon-success)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--archon-success)]" /> Production
                  </div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-muted)]" />
              </>
            )}
          </button>
        </div>

        {railExtra && <div className={cn('px-3 pb-2', collapsed && 'flex justify-center')}>{railExtra}</div>}

        {!collapsed && (
          <div className="px-3 pb-1">
            <div className="flex items-center gap-2 rounded-lg bg-[var(--sidebar-accent)]/70 px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-muted)]" />
              <span className="flex-1 text-[12px] text-[var(--sidebar-muted)]">Search</span>
              <kbd className="rounded border border-[var(--sidebar-border)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--sidebar-muted)]">
                &#8984;K
              </kbd>
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto pb-2">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 pt-3">
              {[...BUILD_ITEMS, ...MONITOR_ITEMS, ...ADMIN_ITEMS].map(item => {
                const Icon = item.icon;
                const active = item.href != null && location.pathname === item.href;
                return (
                  <button
                    key={item.label}
                    type="button"
                    title={item.label}
                    onClick={
                      item.href
                        ? () => navigate(item.href!)
                        : () => window.alert(`${item.label} — coming soon.`)
                    }
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-lg',
                      active
                        ? 'bg-[var(--sidebar-accent)] text-white'
                        : 'text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-accent)]/60'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <NavSection title="Build" items={BUILD_ITEMS} />
              <NavSection title="Monitor" items={MONITOR_ITEMS} />
              <NavSection title="Admin" items={ADMIN_ITEMS} />
            </>
          )}
        </nav>

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--node-amber)] text-[12px] font-bold text-white">
              U
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-[var(--sidebar-foreground)]">
                    Agent Builder
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--sidebar-primary)]">
                    Admin
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-accent)] hover:text-white"
                  aria-label="Collapse sidebar"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {collapsed && (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-accent)] hover:text-white"
                aria-label="Expand sidebar"
              >
                <ChevronsLeft className="h-3.5 w-3.5 rotate-180" />
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
