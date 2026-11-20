import React, { useState, useEffect } from 'react';
import { Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { supabase as supabaseClient } from './lib/supabase';
import { MarketingChrome } from './components/MarketingChrome';
import { Empty } from './components/ui';

const supabase = supabaseClient!;

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  users: { id: string; email: string; name: string; created_at: string };
}

interface TeamInvitation {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  invited_by: string;
}

const TeamPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'editor'>('editor');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor'>('editor');
  const [processing, setProcessing] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data } = await supabase.from('tenant_members').select('tenant_id').eq('user_id', user.id).limit(1).maybeSingle();
      if (data && active) setTenantId(data.tenant_id);
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (tenantId) void fetchTeamData();
  }, [tenantId]);

  const fetchTeamData = async () => {
    if (!tenantId) return;
    try {
      const { data, error } = await supabase.functions.invoke('team-members', {
        body: { action: 'list', tenant_id: tenantId }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTeamMembers((data?.members ?? []).map((member: { user_id: string; role: string; name: string; email: string }) => ({
        id: member.user_id,
        user_id: member.user_id,
        role: member.role,
        created_at: '',
        users: { id: member.user_id, email: member.email, name: member.name, created_at: '' },
      })));
      // The invite flow adds members directly; there is no separate invitation record.
      setInvitations([]);
    } catch (error) {
      console.error('Error fetching team data:', error);
      setMessage({ type: 'error', text: 'Failed to load team data' });
    } finally {
      setLoading(false);
    }
  };

  // Adding an existing user is the same server flow as inviting by email:
  // team-members resolves the account and creates the workspace membership.
  const handleAddMember = async () => {
    setInviteEmail(newMemberEmail);
    setInviteRole(newMemberRole);
    setShowAddModal(false);
    await handleSendInvitation();
  };

  const handleSendInvitation = async () => {
    if (!inviteEmail || !tenantId) { setMessage({ type: 'error', text: 'Please enter an email address' }); return; }
    setProcessing(true); setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('team-members', {
        body: { action: 'invite', tenant_id: tenantId, email: inviteEmail, role: inviteRole === 'admin' ? 'admin' : 'agent', redirect_origin: window.location.origin }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage({ type: 'success', text: data?.invited ? 'Invitation sent successfully' : 'Teammate added successfully' });
      setShowInviteModal(false); setInviteEmail(''); setInviteRole('editor');
      void fetchTeamData();
    } catch (error) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to send invitation' });
    } finally { setProcessing(false); }
  };

  const handleUnsupportedAction = () => {
    setMessage({ type: 'error', text: 'Role changes and member removal are handled by your workspace owner.' });
  };

  const handleUpdateRole = handleUnsupportedAction;
  const handleRemoveMember = handleUnsupportedAction;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <MarketingChrome>
        <div className="content">
          <div className="panel flex min-h-[12rem] items-center justify-center gap-2" role="status">
            <span className="animate-spin rounded-full h-5 w-5 border-2 border-brand-200 border-t-brand-600" />
            <span className="muted small">Loading team information…</span>
          </div>
        </div>
      </MarketingChrome>
    );
  }

  const adminCount = teamMembers.filter((member) => member.role === 'admin').length;

  const rolePill = (role: string) => (
    <span className={role === 'admin' ? 'status-pill success' : 'status-pill neutral'}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );

  return (
    <MarketingChrome>
      <div className="content">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>Team</h1>
            <p className="page-description">Manage team access, roles and pending invitations for this business account.</p>
          </div>
          <div className="flex flex-none flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(true)}>
              <UserPlus size={15} /> Add member
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowInviteModal(true)}>
              <Mail size={15} /> Invite member
            </button>
          </div>
        </div>

        {message && !showAddModal && !showInviteModal && !showRoleModal && !showRemoveModal && (
          <p className={message.type === 'success' ? 'notice success' : 'notice error'} role="status">
            {message.text}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <article className="kpi-card panel kpi-tone-brand">
            <div className="kpi-body">
              <span className="kpi-icon"><Users size={20} /></span>
              <div className="kpi-copy">
                <span className="kpi-label">Team members</span>
                <strong className="kpi-value">{teamMembers.length.toLocaleString()}</strong>
                <span className="kpi-hint">People with workspace access</span>
              </div>
            </div>
          </article>
          <article className="kpi-card panel kpi-tone-success">
            <div className="kpi-body">
              <span className="kpi-icon"><ShieldCheck size={20} /></span>
              <div className="kpi-copy">
                <span className="kpi-label">Administrators</span>
                <strong className="kpi-value">{adminCount.toLocaleString()}</strong>
                <span className="kpi-hint">Can manage team and settings</span>
              </div>
            </div>
          </article>
          <article className="kpi-card panel kpi-tone-warning">
            <div className="kpi-body">
              <span className="kpi-icon"><Mail size={20} /></span>
              <div className="kpi-copy">
                <span className="kpi-label">Pending invitations</span>
                <strong className="kpi-value">{invitations.length.toLocaleString()}</strong>
                <span className="kpi-hint">Awaiting acceptance</span>
              </div>
            </div>
          </article>
        </div>

        <div className="section-header">
          <div>
            <h2>Team members</h2>
            <p>Everyone who can access this business account.</p>
          </div>
        </div>
        <div className="source-list">
          <div className="source-table-head team-head">
            <span>Member</span><span>Role</span><span>Joined</span><span>Actions</span>
          </div>
          {teamMembers.length === 0 ? (
            <Empty icon={<Users size={22} />} title="No team members yet" text="Invite a teammate to collaborate in this workspace." />
          ) : (
            teamMembers.map((member) => (
              <div className="source-row team-row" key={member.id}>
                <div className="source-main">
                  <span className="source-icon">{member.users.email.slice(0, 1).toUpperCase()}</span>
                  <div className="source-text">
                    <strong>{member.users.email}</strong>
                    <small>{member.role === 'admin' ? 'Full workspace access' : 'Inbox and campaign access'}</small>
                  </div>
                </div>
                <span>{rolePill(member.role)}</span>
                <span className="muted small">{member.created_at ? formatDate(member.created_at) : '—'}</span>
                <div className="row-actions">
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => {
                      setSelectedMember(member);
                      setNewMemberRole(member.role as 'admin' | 'editor');
                      setShowRoleModal(true);
                    }}
                  >
                    Edit role
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact btn-danger"
                    onClick={() => {
                      setSelectedMember(member);
                      setShowRemoveModal(true);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="section-header">
          <div>
            <h2>Pending invitations</h2>
            <p>Invitations that have not been accepted yet.</p>
          </div>
        </div>
        <div className="source-list">
          <Empty icon={<Mail size={22} />} title="No pending invitations" text="Invited teammates join as soon as they accept their email invitation." />
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,36,60,0.45)] p-4">
          <div className="panel w-full max-w-md p-6">
            <div className="section-header">
              <div><h2>Add team member</h2><p>Add an existing MobiWave user to this workspace.</p></div>
              <button type="button" className="icon-btn" aria-label="Close add member dialog" onClick={() => setShowAddModal(false)}><span aria-hidden>×</span></button>
            </div>
            {message && <p className={message.type === 'success' ? 'notice success' : 'notice error'} role="status">{message.text}</p>}
            <div className="flex flex-col gap-4">
              <div className="field">
                <label>Email address</label>
                <input type="email" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} placeholder="teammate@company.co.ke" />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value as 'admin' | 'editor')}>
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button type="button" className="primary-button" onClick={() => void handleAddMember()} disabled={processing}>
                {processing ? 'Adding…' : 'Add member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,36,60,0.45)] p-4">
          <div className="panel w-full max-w-md p-6">
            <div className="section-header">
              <div><h2>Invite team member</h2><p>Send an email invitation to join this workspace.</p></div>
              <button type="button" className="icon-btn" aria-label="Close invite dialog" onClick={() => setShowInviteModal(false)}><span aria-hidden>×</span></button>
            </div>
            {message && <p className={message.type === 'success' ? 'notice success' : 'notice error'} role="status">{message.text}</p>}
            <div className="flex flex-col gap-4">
              <div className="field">
                <label>Email address</label>
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.co.ke" />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'admin' | 'editor')}>
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setShowInviteModal(false)}>Cancel</button>
              <button type="button" className="primary-button" onClick={() => void handleSendInvitation()} disabled={processing}>
                {processing ? 'Sending…' : 'Send invitation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRoleModal && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,36,60,0.45)] p-4">
          <div className="panel w-full max-w-md p-6">
            <div className="section-header">
              <div><h2>Edit role</h2><p>{selectedMember.users.email}</p></div>
              <button type="button" className="icon-btn" aria-label="Close edit role dialog" onClick={() => setShowRoleModal(false)}><span aria-hidden>×</span></button>
            </div>
            {message && <p className={message.type === 'success' ? 'notice success' : 'notice error'} role="status">{message.text}</p>}
            <div className="field">
              <label>Role</label>
              <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value as 'admin' | 'editor')}>
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
              </select>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setShowRoleModal(false)}>Cancel</button>
              <button type="button" className="primary-button" onClick={() => void handleUpdateRole()} disabled={processing}>
                {processing ? 'Updating…' : 'Update role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRemoveModal && selectedMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,36,60,0.45)] p-4">
          <div className="panel w-full max-w-md p-6">
            <div className="section-header">
              <div><h2>Remove team member</h2><p>This action cannot be undone.</p></div>
              <button type="button" className="icon-btn" aria-label="Close remove member dialog" onClick={() => setShowRemoveModal(false)}><span aria-hidden>×</span></button>
            </div>
            {message && <p className={message.type === 'success' ? 'notice success' : 'notice error'} role="status">{message.text}</p>}
            <p className="muted small">
              Remove <strong>{selectedMember.users.email}</strong> from this workspace? They will immediately lose access to the inbox and campaigns.
            </p>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setShowRemoveModal(false)}>Cancel</button>
              <button type="button" className="primary-button btn-danger" onClick={() => void handleRemoveMember()} disabled={processing}>
                {processing ? 'Removing…' : 'Remove member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </MarketingChrome>
  );
};

export default TeamPage;
