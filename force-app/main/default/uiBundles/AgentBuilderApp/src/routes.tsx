import type { RouteObject } from 'react-router';

// Each page owns its own <AppShell> wrapper (topbar + palette/canvas/
// properties workspace for AgentBuilder, a simple content column for the
// rest) — no generic AppLayout wrapper here, since AppShell IS this app's
// layout. '/' is the agent list (was a single hardcoded agent before Home
// existed); a specific agent's canvas now lives at /agent/:apiName.
//
// Every route is code-split: the router downloads a page's chunk on first
// visit instead of shipping the whole app (canvas engine included) up
// front. React Router keeps the current page on screen while the next
// chunk loads, so navigation needs no Suspense fallbacks here.
const page = (loader: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await loader()).default,
});

export const routes: RouteObject[] = [
  {
    path: '/',
    lazy: page(() => import('./pages/HomePage')),
    handle: { showInNavigation: true, label: 'Agents' },
  },
  {
    path: '/home',
    lazy: page(() => import('./pages/HomeDashboardPage')),
    handle: { showInNavigation: true, label: 'Home' },
  },
  {
    path: '/environments',
    lazy: page(() => import('./pages/EnvironmentsPage')),
    handle: { showInNavigation: true, label: 'Environments' },
  },
  {
    path: '/agent/:apiName',
    lazy: page(() => import('./pages/AgentBuilder')),
    handle: { showInNavigation: false, label: 'Agent Builder' },
  },
  {
    path: '/settings',
    lazy: page(() => import('./pages/SettingsPage')),
    handle: { showInNavigation: true, label: 'Settings' },
  },
  {
    path: '/templates',
    lazy: page(() => import('./pages/TemplatesPage')),
    handle: { showInNavigation: true, label: 'Templates' },
  },
  {
    path: '/conversations',
    lazy: page(() => import('./pages/ConversationsPage')),
    handle: { showInNavigation: true, label: 'Conversations' },
  },
  {
    path: '/executions',
    lazy: page(() => import('./pages/ExecutionLogsPage')),
    handle: { showInNavigation: true, label: 'Executions' },
  },
  {
    path: '/approvals',
    lazy: page(() => import('./pages/ApprovalsPage')),
    handle: { showInNavigation: true, label: 'Approvals' },
  },
  {
    path: '/ai-connections',
    lazy: page(() => import('./pages/AiConnectionsPage')),
    handle: { showInNavigation: true, label: 'AI Models' },
  },
  {
    path: '/connectors',
    lazy: page(() => import('./pages/ConnectorsAdminPage')),
    handle: { showInNavigation: true, label: 'Connectors' },
  },
  {
    path: '/setup',
    lazy: page(() => import('./pages/SetupPage')),
    handle: { showInNavigation: false, label: 'Setup' },
  },
  {
    path: '/chat',
    lazy: page(() => import('./pages/ChatPage')),
    handle: { showInNavigation: true, label: 'Chat' },
  },
  {
    path: '*',
    lazy: page(() => import('./pages/NotFound')),
  },
];
