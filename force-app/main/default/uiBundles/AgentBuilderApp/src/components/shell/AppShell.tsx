import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Home,
  Bot,
  LayoutGrid,
  Activity,
  MessageCircle,
  MessageSquare,
  CheckSquare,
  Layers,
  BookOpen,
  Plug,
  Search,
  Sun,
  CircleDollarSign,
  ChevronsLeft,
  RotateCw,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadPendingApprovals } from '@/lib/approvals-data';
import { listChatApprovals } from '@/lib/chat-approvals-data';

/** Approved interface spec (Sep 2026): Home on top, then
 *  BUILD · MONITOR · MANAGE. AI Models sits first under BUILD because you
 *  cannot build an agent without a model connection. Approvals carries the
 *  only count badge in the rail. The Agent builder has no nav entry — it
 *  is reached by clicking an agent row. */
interface NavItem {
  icon: typeof Home;
  label: string;
  href: string;
  badge?: number;
}

// Pending-approval count is fetched once per shell mount and shared across
// navigations via module state — a nav badge must never cost a request per
// page view.
let cachedApprovalCount: number | null = null;

function usePendingApprovals(): number {
  const [count, setCount] = useState(cachedApprovalCount ?? 0);
  useEffect(() => {
    if (cachedApprovalCount != null) return;
    cachedApprovalCount = 0;
    Promise.allSettled([loadPendingApprovals(), listChatApprovals({ status: 'Pending' })]).then(
      ([runs, chats]) => {
        const a = runs.status === 'fulfilled' ? runs.value.length : 0;
        const b = chats.status === 'fulfilled' ? chats.value.length : 0;
        cachedApprovalCount = a + b;
        setCount(a + b);
      }
    );
  }, []);
  return count;
}

function NavSection({ title, items }: { title?: string; items: NavItem[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="px-3">
      {title && (
        <div className="px-2 pb-1 pt-4 text-[9.5px] font-bold uppercase tracking-[.09em] text-[#6b7280]">
          {title}
        </div>
      )}
      {items.map(item => {
        const Icon = item.icon;
        const active =
          location.pathname === item.href ||
          (item.href === '/' && location.pathname.startsWith('/agent/'));
        return (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.href)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[12.5px] font-medium transition-colors',
              active
                ? 'bg-[var(--sidebar-accent)] text-white'
                : 'text-[#c8cdd6] hover:bg-[#1d222d] hover:text-white'
            )}
          >
            <Icon className={cn('h-[15px] w-[15px] shrink-0', active ? 'opacity-100' : 'opacity-75')} />
            {item.label}
            {item.badge != null && item.badge > 0 && (
              <span className="ml-auto rounded-full bg-[var(--archon-error)] px-1.5 py-px font-mono text-[9.5px] font-bold text-white">
                {item.badge}
              </span>
            )}
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
  title,
  actions,
  onRefresh,
}: {
  children: ReactNode;
  /** Start with just the icon rail — the agent canvas needs its width
   *  for the graph, not the full nav; still expandable via the toggle. */
  defaultCollapsed?: boolean;
  /** Page-specific rail button (e.g. AgentBuilder's "add node" trigger) —
   *  AppShell stays a generic shell, the page owns what this renders/does. */
  railExtra?: ReactNode;
  /** When set, AppShell renders the spec's global top bar (screen name ·
   *  environment pill · Refresh · New agent). Pages migrated to the
   *  approved design pass this and drop their own header row. */
  title?: string;
  /** Extra page-specific controls rendered before Refresh in the top bar. */
  actions?: ReactNode;
  /** Refresh handler for the top bar — defaults to a full reload. */
  onRefresh?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const navigate = useNavigate();
  const location = useLocation();
  const approvals = usePendingApprovals();

  const HOME_ITEMS: NavItem[] = [{ icon: Home, label: 'Home', href: '/home' }];
  const BUILD_ITEMS: NavItem[] = [
    { icon: Layers, label: 'AI Models', href: '/ai-connections' },
    { icon: Bot, label: 'Agents', href: '/' },
    { icon: BookOpen, label: 'Knowledge', href: '/knowledge' },
    { icon: Plug, label: 'Connectors', href: '/connectors' },
    { icon: LayoutGrid, label: 'Templates', href: '/templates' },
    { icon: MessageCircle, label: 'Chat', href: '/chat' },
  ];
  const MONITOR_ITEMS: NavItem[] = [
    { icon: Activity, label: 'Runs', href: '/executions' },
    { icon: MessageSquare, label: 'Conversations', href: '/conversations' },
    { icon: CheckSquare, label: 'Approvals', href: '/approvals', badge: approvals },
  ];
  const MANAGE_ITEMS: NavItem[] = [
    { icon: CircleDollarSign, label: 'Cost', href: '/cost' },
    { icon: Sun, label: 'Setup', href: '/setup' },
  ];
  const ALL_ITEMS = [...HOME_ITEMS, ...BUILD_ITEMS, ...MONITOR_ITEMS, ...MANAGE_ITEMS];

  return (
    <div className="flex h-full w-full">
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col bg-[var(--sidebar)] transition-[width] duration-150',
          collapsed ? 'w-[64px]' : 'w-[220px]'
        )}
      >
        <div className="p-3 pb-1.5">
          <div className="flex w-full items-center gap-2.5 px-1 py-1.5">
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-white">
              <Layers className="h-4 w-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13px] font-bold leading-tight text-white">Archon AI</div>
                <div className="flex items-center gap-1 text-[9.5px] text-[#7ee2a8]">
                  <span className="h-[5px] w-[5px] rounded-full bg-[#4bce7f]" /> Production
                </div>
              </div>
            )}
          </div>
        </div>

        {railExtra && <div className={cn('px-3 pb-2', collapsed && 'flex justify-center')}>{railExtra}</div>}

        {!collapsed && (
          <div className="px-3 pb-1">
            <div className="flex items-center gap-2 rounded-md bg-[#1d222d] px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-muted)]" />
              <span className="flex-1 text-[11.5px] text-[var(--sidebar-muted)]">Search</span>
              <kbd className="rounded border border-[var(--sidebar-border)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[var(--sidebar-muted)]">
                &#8984;K
              </kbd>
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto pb-2">
          {collapsed ? (
            <div className="flex flex-col items-center gap-1 pt-2">
              {ALL_ITEMS.map(item => {
                const Icon = item.icon;
                const active = location.pathname === item.href;
                return (
                  <button
                    key={item.label}
                    type="button"
                    title={item.label}
                    onClick={() => navigate(item.href)}
                    className={cn(
                      'relative flex h-9 w-9 items-center justify-center rounded-md',
                      active
                        ? 'bg-[var(--sidebar-accent)] text-white'
                        : 'text-[var(--sidebar-muted)] hover:bg-[#1d222d]'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.badge != null && item.badge > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[var(--archon-error)]" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <NavSection items={HOME_ITEMS} />
              <NavSection title="Build" items={BUILD_ITEMS} />
              <NavSection title="Monitor" items={MONITOR_ITEMS} />
              <NavSection title="Manage" items={MANAGE_ITEMS} />
            </>
          )}
        </nav>

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--node-purple)] text-[10.5px] font-bold text-white">
              A
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-white">Agent Builder</div>
                  <div className="text-[9.5px] text-[var(--sidebar-muted)]">Platform admin</div>
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

      <div className="flex min-w-0 flex-1 flex-col">
        {title && (
          <header className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-border bg-card px-5">
            <h1 className="flex-1 text-[14.5px] font-bold text-foreground">{title}</h1>
            {actions}
            <button
              type="button"
              onClick={() => navigate('/environments')}
              title="Environment — click to manage"
              className="flex items-center gap-1.5 rounded-[5px] border-[1.5px] border-[#f3b0b6] bg-card px-2.5 py-[5px] text-[11px] font-bold text-[var(--archon-error)]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--archon-error)]" /> Production
              <span className="opacity-60">›</span>
            </button>
            <button
              type="button"
              onClick={onRefresh ?? (() => window.location.reload())}
              className="flex items-center gap-1.5 rounded-[5px] border border-border bg-card px-2.5 py-[6px] text-[11.5px] font-semibold text-primary hover:bg-secondary/60"
            >
              <RotateCw className="h-3 w-3" /> Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate('/new-agent')}
              className="flex items-center gap-1 rounded-[5px] bg-primary px-2.5 py-[6px] text-[11.5px] font-semibold text-primary-foreground hover:bg-[#0b5cab]"
            >
              <Plus className="h-3 w-3" /> New agent
            </button>
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
