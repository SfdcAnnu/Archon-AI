import type { RouteObject } from 'react-router';
import HomePage from './pages/HomePage';
import AgentBuilder from './pages/AgentBuilder';
import SettingsPage from './pages/SettingsPage';
import TemplatesPage from './pages/TemplatesPage';
import ConversationsPage from './pages/ConversationsPage';
import ExecutionLogsPage from './pages/ExecutionLogsPage';
import ApprovalsPage from './pages/ApprovalsPage';
import AiConnectionsPage from './pages/AiConnectionsPage';
import ConnectorsAdminPage from './pages/ConnectorsAdminPage';
import SetupPage from './pages/SetupPage';
import ChatPage from './pages/ChatPage';
import NotFound from './pages/NotFound';

// Each page owns its own <AppShell> wrapper (topbar + palette/canvas/
// properties workspace for AgentBuilder, a simple content column for the
// rest) — no generic AppLayout wrapper here, since AppShell IS this app's
// layout. '/' is the agent list (was a single hardcoded agent before Home
// existed); a specific agent's canvas now lives at /agent/:apiName.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <HomePage />,
    handle: { showInNavigation: true, label: 'Workflows' },
  },
  {
    path: '/agent/:apiName',
    element: <AgentBuilder />,
    handle: { showInNavigation: false, label: 'Agent Builder' },
  },
  {
    path: '/settings',
    element: <SettingsPage />,
    handle: { showInNavigation: true, label: 'Settings' },
  },
  {
    path: '/templates',
    element: <TemplatesPage />,
    handle: { showInNavigation: true, label: 'Templates' },
  },
  {
    path: '/conversations',
    element: <ConversationsPage />,
    handle: { showInNavigation: true, label: 'Conversations' },
  },
  {
    path: '/executions',
    element: <ExecutionLogsPage />,
    handle: { showInNavigation: true, label: 'Executions' },
  },
  {
    path: '/approvals',
    element: <ApprovalsPage />,
    handle: { showInNavigation: true, label: 'Approvals' },
  },
  {
    path: '/ai-connections',
    element: <AiConnectionsPage />,
    handle: { showInNavigation: true, label: 'AI Connections' },
  },
  {
    path: '/connectors',
    element: <ConnectorsAdminPage />,
    handle: { showInNavigation: true, label: 'Connectors' },
  },
  {
    path: '/setup',
    element: <SetupPage />,
    handle: { showInNavigation: false, label: 'Setup' },
  },
  {
    path: '/chat',
    element: <ChatPage />,
    handle: { showInNavigation: true, label: 'Chat' },
  },
  {
    path: '*',
    element: <NotFound />,
  },
];
