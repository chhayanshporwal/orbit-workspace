import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WorkspaceProvider } from './context/WorkspaceContext';

// Views & Layouts
import AppShell from './views/AppShell';
import Login from './views/Login';
import Register from './views/Register';
import OAuthCallback from './views/OAuthCallback';
import Workspaces from './views/Workspaces';
import WorkspaceDetail from './views/WorkspaceDetail';
import KanbanBoard from './views/KanbanBoard';
import TaskDetailSlideOver from './views/TaskDetailSlideOver';
import MyTasks from './views/MyTasks';
import Inbox from './views/Inbox';
import HomeView from './views/Home';
import Settings from './views/Settings';
import NotFound from './views/NotFound';
import LandingPage from './pages/LandingPage';

// Error Boundary & Icons
import ErrorBoundary from './components/ErrorBoundary';
import ToastContainer from './components/Toast';
import { Compass } from 'lucide-react';

// Route Protection wrapper
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center font-sans">
        <div className="w-12 h-12 rounded-2xl bg-fuchsia-600 flex items-center justify-center text-white shadow-lg animate-bounce">
          <img src="/favicon.svg" alt="Orbit" className="w-6 h-6 animate-spin" />
        </div>
        <p className="mt-4 text-xs font-bold text-gray-400 uppercase tracking-wider animate-pulse">
          Orbiting Workspace...
        </p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastContainer />
      <AuthProvider>
        <WorkspaceProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Landing Page */}
              <Route path="/" element={<LandingPage />} />

              {/* Public Auth Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/oauth-callback" element={<OAuthCallback />} />

              {/* Authenticated Application Shell */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                {/* Redirect /app to /home just in case */}
                <Route path="app" element={<Navigate to="/home" replace />} />
                
                {/* Home Dashboard */}
                <Route path="home" element={<HomeView />} />
                
                {/* Workspaces list */}
                <Route path="workspaces" element={<Workspaces />} />
                
                {/* Workspace detail — /workspaces/:workspaceSlug/dashboard */}
                <Route path="workspaces/:workspaceSlug/dashboard" element={<WorkspaceDetail />} />
                
                {/* Kanban board — /workspaces/:workspaceSlug/:projectSlug */}
                <Route path="workspaces/:workspaceSlug/:projectSlug" element={<KanbanBoard />}>
                  {/* Nested Task Detail Slide-over */}
                  <Route path="tasks/:taskId" element={<TaskDetailSlideOver />} />
                </Route>

                {/* My Tasks Page */}
                <Route path="my-tasks" element={<MyTasks />} />

                {/* Inbox Page */}
                <Route path="inbox" element={<Inbox />} />

                {/* Settings Page */}
                <Route path="settings" element={<Settings />} />
              </Route>

              {/* Fallback Catch-All (404 Page) */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </WorkspaceProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}