import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { showToast } from '../components/Toast';
import Modal from '../components/Modal';
import Avatar from '../components/Avatar';
import PillButton from '../components/PillButton';
import { X, Calendar, User, AlignLeft, MessageSquare, Send, Trash2, Lock, UserCheck, Shield, AlertCircle } from 'lucide-react';

export default function TaskDetailSlideOver() {
  const { workspaceSlug, projectSlug, taskId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    tasks,
    activeWorkspace,
    role,
    updateTask,
    deleteTask,
    addComment
  } = useWorkspace();

  const task = tasks.find(t => t.id === parseInt(taskId) || t.id === taskId);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [status, setStatus] = useState('todo');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [reassignReason, setReassignReason] = useState('');
  const [pendingAssigneeId, setPendingAssigneeId] = useState(null);
  const [isDeleteTaskModalOpen, setIsDeleteTaskModalOpen] = useState(false);

  // Comments State
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');

  const fetchComments = useCallback(async () => {
    if (!taskId) return;
    setCommentsLoading(true);
    try {
      const data = await api.get(`/tasks/${taskId}/comments`);
      if (data) {
        // Map comments structure for UI
        const mapped = data.map(c => {
          const authorEmail = c.author?.email || 'someone@example.com';
          const name = authorEmail.split('@')[0];
          return {
            id: c.id,
            authorName: name.charAt(0).toUpperCase() + name.slice(1),
            authorInitials: authorEmail.substring(0, 2).toUpperCase(),
            text: c.content,
            timestamp: c.created_at,
          };
        });
        setComments(mapped);
      }
    } catch (e) {
      console.error('Fetch comments error:', e);
    } finally {
      setCommentsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (task) {
      setTitle(task.title || '');
      setDesc(task.description || '');
      setStatus(task.status || 'todo');
      setAssigneeId(task.assignee_id ? task.assignee_id.toString() : '');
      setDueDate(task.due_date ? task.due_date.substring(0, 10) : '');
      fetchComments();
    }
  }, [task, taskId, fetchComments]);

  if (!task) {
    return null;
  }

  const handleClose = () => {
    navigate(`/workspaces/${workspaceSlug}/${projectSlug}`);
  };

  const handleSaveField = (field, value, extraData = {}) => {
    if (role.isViewer) return;
    // Check assignee lock when changing status
    if (field === 'status' && task.assignee_id && task.assignee_id !== user?.id && !role.isAdmin) {
      showToast('error', 'Permission Denied: You can only move tasks assigned to you.');
      return;
    }
    // Check Done status irreversibility for non-admins
    if (task.status === 'done' && field === 'status' && value !== 'done' && !role.isAdmin) {
      showToast('error', 'Permission Denied: Only Admins can move tasks out of Done status.');
      return;
    }
    let finalValue = value;
    if (typeof value === 'string') {
      finalValue = value.trim();
    }
    
    // Prevent empty title
    if (field === 'title' && !finalValue) {
      showToast('error', 'Task title cannot be empty.');
      return;
    }

    updateTask(task.id, { [field]: finalValue, ...extraData });
  };

  const handleDelete = async () => {
    await deleteTask(task.id);
    setIsDeleteTaskModalOpen(false);
    handleClose();
  };

  const handlePostComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    await addComment(task.id, commentText);
    setCommentText('');
    await fetchComments(); // refresh list
  };

  const assignee = activeWorkspace?.members?.find(m => m.id === parseInt(assigneeId));

  const isCreator = task.assignor_id === user?.id;
  const isAssignee = task.assignee_id === user?.id;
  const isAdmin = role.isAdmin;
  const isViewer = role.isViewer;

  let canEditAllDetails = false;
  if (isCreator) {
    canEditAllDetails = true;
  } else if (isAdmin && !isAssignee) {
    canEditAllDetails = true;
  }

  let canEditStatus = false;
  if (isCreator || isAdmin || isAssignee) {
    canEditStatus = true;
  }

  let isStatusLocked = !canEditStatus;
  if (canEditStatus && (task.status === 'done' || task.status === 'Done')) {
    if (isCreator) {
      isStatusLocked = false;
    } else if (isAdmin && !isAssignee) {
      isStatusLocked = false;
    } else if (isAdmin && isAssignee) {
      isStatusLocked = false; // Oversight Override allowed
    } else {
      isStatusLocked = true;
    }
  }

  if (isViewer) {
    canEditAllDetails = false;
    canEditStatus = false;
    isStatusLocked = true;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/15 backdrop-blur-xs transition-opacity"
        onClick={handleClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-lg md:w-[480px] bg-white h-full shadow-2xl flex flex-col z-50 border-l border-gray-200 animate-slide-in">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex-1 mr-2">
            {role.isEditor && canEditAllDetails ? (
              <>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    if (e.target.value.length <= 100) setTitle(e.target.value);
                  }}
                  maxLength={100}
                  onBlur={() => handleSaveField('title', title)}
                  className="w-full text-lg font-extrabold tracking-tight text-gray-900 border-b border-transparent hover:border-gray-200 focus:border-fuchsia-500 focus:outline-none py-0.5"
                />
                {title.length >= 100 && <p className="text-[10px] text-amber-500 mt-1 font-bold">Character limit reached (100).</p>}
              </>
            ) : (
              <h3 className="text-lg font-extrabold tracking-tight text-gray-900 truncate">
                {task.title}
              </h3>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {role.isEditor && canEditAllDetails && (
              <button
                onClick={handleDelete}
                className="p-1.5 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors mr-1"
                title="Delete Task"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-3.5 text-xs font-semibold text-gray-600">
            
            {/* Status */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-gray-400 font-bold">
                <AlignLeft size={14} /> Status
              </span>
              {role.isEditor ? (
                <div className="flex items-center gap-2">
                  {isStatusLocked && (
                    <span className="text-[10px] text-amber-600 flex items-center gap-0.5 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                      <Lock size={10} /> Locked
                    </span>
                  )}
                  <select
                    value={status}
                    disabled={isStatusLocked}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      handleSaveField('status', e.target.value);
                    }}
                    className={`bg-white border border-gray-200 rounded-full px-3 py-1 font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 ${isStatusLocked ? 'opacity-60 cursor-not-allowed bg-gray-100' : ''}`}
                  >
                    <option value="todo">To Do</option>
                    <option value="inprogress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              ) : (
                <span className="uppercase text-[10px] font-black text-fuchsia-600">{status}</span>
              )}
            </div>

            {/* Assignee */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-gray-400 font-bold">
                <User size={14} /> Assignee
              </span>
              {role.isEditor && canEditAllDetails ? (
                <select
                  value={assigneeId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    if (newId !== assigneeId) {
                      setPendingAssigneeId(newId);
                      setIsReassignModalOpen(true);
                    }
                  }}
                  className="bg-white border border-gray-200 rounded-full px-3 py-1 font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20"
                >
                  {activeWorkspace?.members?.filter(m => (m.status || '').toLowerCase() === 'accepted')?.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <span className="text-gray-800">{assignee ? assignee.name : 'Unassigned'}</span>
              )}
            </div>

            {/* Assignor */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-gray-400 font-bold">
                <UserCheck size={14} /> Assignor
              </span>
              <span className="text-gray-800">{task.assignor ? task.assignor.name : 'System/Unassigned'}</span>
            </div>

            {/* Due Date */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-gray-400 font-bold">
                <Calendar size={14} /> Due Date
              </span>
              {role.isEditor && canEditAllDetails ? (
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    handleSaveField('dueDate', e.target.value);
                  }}
                  className="bg-white border border-gray-200 rounded-full px-3 py-1 font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20"
                />
              ) : (
                <span className="text-gray-800">{dueDate || 'No due date'}</span>
              )}
            </div>

          </div>

          {/* Description */}
          <div className="space-y-2">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">
              Description
            </h4>
            {role.isEditor && canEditAllDetails ? (
              <>
                <textarea
                  value={desc}
                  onChange={(e) => {
                    if (e.target.value.length <= 2000) setDesc(e.target.value);
                  }}
                  maxLength={2000}
                  onBlur={() => handleSaveField('description', desc)}
                  placeholder="Details of scope..."
                  rows={4}
                  className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-xs font-semibold resize-none leading-relaxed"
                />
                {desc.length >= 2000 && <p className="text-[10px] text-amber-500 mt-1 font-bold">Character limit reached (2000).</p>}
              </>
            ) : (
              <p className="text-xs text-gray-700 leading-relaxed font-semibold bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                {task.description || 'No description provided.'}
              </p>
            )}
          </div>

          {/* Reassignment Reason */}
          {task.reassignment_reason && (
            <div className="space-y-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-500 flex items-center gap-1">
                <AlertCircle size={14} /> Reassignment Note
              </h4>
              <p className="text-xs text-amber-700 leading-relaxed font-semibold bg-amber-50/50 p-4 rounded-2xl border border-amber-100">
                {task.reassignment_reason}
              </p>
            </div>
          )}

          {/* Activity / Change Log */}
          {task.edit_histories && task.edit_histories.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-gray-100">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                <Shield size={14} /> Activity History ({task.edit_histories.length})
              </h4>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {[...task.edit_histories].reverse().map((h) => {
                  const editorName = h.editor?.name || 'Someone';
                  const fieldLabel = h.field_name.charAt(0).toUpperCase() + h.field_name.slice(1).replace('_', ' ');
                  return (
                    <div key={h.id} className="text-[11px] text-gray-500 bg-gray-50/50 p-2.5 rounded-xl border border-gray-100 flex flex-col gap-1">
                      <div className="flex justify-between items-center">
                        <span className="font-extrabold text-gray-800">{editorName}</span>
                        <span className="text-[9px] text-gray-400 font-bold">
                          {new Date(h.edited_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="font-medium text-gray-600">
                        Changed <span className="font-extrabold text-fuchsia-600">{fieldLabel}</span> from <span className="italic font-bold text-gray-600">"{h.old_value || 'None'}"</span> to <span className="italic font-bold text-emerald-600">"{h.new_value || 'None'}"</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Discussion */}
          <div className="space-y-4 pt-4 border-t border-gray-100 flex-1 flex flex-col">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-400 flex items-center gap-1">
              <MessageSquare size={14} /> Discussion ({comments.length})
            </h4>
            
            {commentsLoading ? (
              <div className="text-center text-[10px] text-gray-400 py-4">Syncing comments...</div>
            ) : (
              <div className="space-y-4">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex items-start gap-3">
                    <Avatar initials={comment.authorInitials} name={comment.authorName} size="xs" />
                    <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100 flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-extrabold text-gray-900">{comment.authorName}</span>
                        <span className="text-[9px] text-gray-400 font-bold">
                          {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 font-medium leading-relaxed">{comment.text}</p>
                    </div>
                  </div>
                ))}
                {comments.length === 0 && (
                  <p className="text-xs italic text-gray-400 text-center py-4">No comments posted yet.</p>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Comments Input Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-white shrink-0">
          <form onSubmit={handlePostComment} className="flex gap-2">
            <input
              type="text"
              placeholder="Post a comment..."
              value={commentText}
              onChange={(e) => {
                if (e.target.value.length <= 2000) setCommentText(e.target.value);
              }}
              maxLength={2000}
              className="flex-1 px-4 py-2.5 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-xs font-medium"
            />
            <PillButton type="submit" variant="primary" size="sm" className="w-10 h-10 px-0 flex items-center justify-center shrink-0">
              <Send size={14} />
            </PillButton>
          </form>
        </div>

      </div>

      {/* Reassign Reason Modal */}
      {isReassignModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setIsReassignModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-extrabold text-gray-900 mb-4">Reason for Reassignment</h3>
            <p className="text-xs text-gray-500 mb-4">
              You can optionally provide a reason for changing the assignee. If provided, this will be shared with the previous and new assignees.
            </p>
            <textarea
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 text-sm mb-4"
              rows={3}
              placeholder="e.g. Current assignee is on leave..."
              value={reassignReason}
              onChange={(e) => {
                if (e.target.value.length <= 500) setReassignReason(e.target.value);
              }}
              maxLength={500}
            />
            {reassignReason.length >= 500 && <p className="text-[10px] text-amber-500 mb-4 font-bold">Character limit reached (500).</p>}
            <div className="flex justify-end gap-2">
              <PillButton onClick={() => setIsReassignModalOpen(false)} variant="secondary">Cancel</PillButton>
              <PillButton onClick={() => {
                setAssigneeId(pendingAssigneeId);
                handleSaveField('assignee_id', pendingAssigneeId, { reassignment_reason: reassignReason.trim() || null });
                setIsReassignModalOpen(false);
                setReassignReason('');
              }} variant="primary">Confirm</PillButton>
            </div>
          </div>
        </div>
      )}

      {/* Delete Task Modal */}
      <Modal
        isOpen={isDeleteTaskModalOpen}
        onClose={() => setIsDeleteTaskModalOpen(false)}
        title="Delete Task"
      >
        <div className="text-sm text-gray-700 mb-6">
          <p className="mb-2">Are you sure you want to permanently delete this task?</p>
          <div className="p-3 bg-red-50 text-red-800 rounded-lg border border-red-100 flex items-start gap-2">
            <Trash2 size={16} className="mt-0.5 shrink-0" />
            <p className="font-semibold text-xs">This action is permanent and cannot be undone.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setIsDeleteTaskModalOpen(false)}
            className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Delete Task
          </button>
        </div>
      </Modal>
    </div>
  );
}
