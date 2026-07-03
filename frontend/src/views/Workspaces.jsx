import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import PillButton from '../components/PillButton';
import Modal from '../components/Modal';
import Avatar from '../components/Avatar';
import { Plus, ArrowRight, Layers } from 'lucide-react';
import { slugify } from '../utils/slugify';

export default function Workspaces() {
  const { workspaces, createWorkspace, setActiveWorkspaceId, allProjects, setActiveProjectId, invitations, acceptInvitation, rejectInvitation } = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const navigate = useNavigate();

  const handleCreate = async (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    const ws = await createWorkspace(cleanName);
    setName('');
    setIsOpen(false);
    if (ws) {
      navigate(`/workspaces/${slugify(ws.name)}/dashboard`);
    }
  };

  const handleSelectWorkspace = (ws) => {
    setActiveWorkspaceId(ws.id);
    setActiveProjectId(null);
    navigate(`/workspaces/${slugify(ws.name)}/dashboard`);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto font-sans">

      {/* Pending Workspace Invitations */}
      {invitations && invitations.length > 0 && (
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-fuchsia-500/10 to-indigo-500/10 border border-fuchsia-500/20 backdrop-blur-md">
          <h2 className="text-lg font-extrabold tracking-tight text-gray-900 flex items-center gap-2 mb-4">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-fuchsia-500"></span>
            </span>
            Pending Workspace Invitations
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="bg-white/80 border border-fuchsia-200/50 rounded-xl p-4 shadow-sm flex items-center justify-between backdrop-blur-sm"
              >
                <div>
                  <h4 className="text-sm font-extrabold text-gray-950">
                    {inv.workspace?.name || 'Workspace Invitation'}
                  </h4>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Role: <span className="font-bold text-fuchsia-600 capitalize">{inv.role}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <PillButton
                    variant="ghost"
                    onClick={() => rejectInvitation(inv.id)}
                    className="py-1 px-3 text-[11px] font-bold border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    Decline
                  </PillButton>
                  <PillButton
                    variant="primary"
                    onClick={() => acceptInvitation(inv.id)}
                    className="py-1 px-3 text-[11px] font-bold"
                  >
                    Accept
                  </PillButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Header */}

      <div className="flex items-center justify-between pb-8 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
            <Layers className="text-fuchsia-600" size={28} />
            Workspaces
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Choose a workspace to manage projects, tasks, and team collaboration.
          </p>
        </div>
        <PillButton
          variant="primary"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-1.5 shadow-md shadow-fuchsia-500/20"
        >
          <Plus size={16} /> Create Workspace
        </PillButton>
      </div>

      {/* Grid Layout of Workspaces */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
        {workspaces.map((ws) => {
          const wsProjects = allProjects.filter(p => p.workspace_id === ws.id);
          const members = ws.members || [];
          return (
            <div
              key={ws.id}
              onClick={() => handleSelectWorkspace(ws)}
              className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[180px] group"
            >
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-extrabold tracking-tight text-gray-900 group-hover:text-fuchsia-600 transition-colors">
                    {ws.name}
                  </h3>
                  <ArrowRight size={16} className="text-gray-300 group-hover:text-fuchsia-600 group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                  {members.length} {members.length === 1 ? 'member' : 'members'} • {wsProjects.length} {wsProjects.length === 1 ? 'project' : 'projects'}
                  {ws.createdAt && ` • Created ${new Date(ws.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
                </p>
              </div>

              <div className="mt-6 border-t border-gray-50 pt-4 flex items-center justify-between">
                <div className="text-[11px] font-bold text-gray-400">
                  {wsProjects.length} {wsProjects.length === 1 ? 'Project' : 'Projects'}
                </div>
                {/* Team member avatars overlay */}
                <div className="flex -space-x-1.5 overflow-hidden">
                  {members.slice(0, 4).map((m) => (
                    <Avatar
                      key={m.id}
                      initials={m.initials}
                      name={m.name}
                      size="xs"
                      className="ring-2 ring-white"
                    />
                  ))}
                  {members.length > 4 && (
                    <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-[9px] font-extrabold ring-2 ring-white">
                      +{members.length - 4}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {workspaces.length === 0 && (
          <div className="col-span-full border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center text-gray-400">
            <Layers size={32} className="mx-auto mb-3 text-gray-200" />
            <p className="font-semibold">No workspaces yet</p>
            <p className="text-xs mt-1">Create your first workspace to get started.</p>
          </div>
        )}
      </div>

      {/* Create Workspace Modal */}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Create New Workspace">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-1">
              Workspace Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => {
                if (e.target.value.length <= 100) setName(e.target.value);
              }}
              maxLength={100}
              placeholder="e.g. Orbit Marketing Team"
              className="w-full px-5 py-3 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm font-medium transition-all"
            />
            {name.length >= 100 && (
              <p className="text-[10px] text-amber-500 mt-2 ml-2 font-bold">Character limit reached (100).</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <PillButton variant="ghost" onClick={() => setIsOpen(false)}>
              Cancel
            </PillButton>
            <PillButton type="submit" variant="primary">
              Create
            </PillButton>
          </div>
        </form>
      </Modal>

    </div>
  );
}
