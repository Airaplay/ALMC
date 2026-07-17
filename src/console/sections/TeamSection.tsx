import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Plus, UserPlus, X } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  createOrganizationCustomRole,
  inviteOrganizationMember,
  listOrganizationMembers,
  listOrganizationRoles,
  OrgMemberItem,
  OrgPendingInviteItem,
  OrgPermission,
  OrgRoleItem,
  removeOrganizationMember,
  updateOrganizationMember,
} from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { LoadingLogo } from '../../components/LoadingLogo';
import { CUSTOM_ROLE_PERMISSION_OPTIONS, INVITE_ROLE_FALLBACKS } from '../constants/teamManagement';
import { consoleTheme } from '../consoleTheme';

export function TeamSection() {
  const { organization, hasPermission } = useOrganization();
  const [members, setMembers] = useState<OrgMemberItem[]>([]);
  const [pendingInvites, setPendingInvites] = useState<OrgPendingInviteItem[]>([]);
  const [roles, setRoles] = useState<OrgRoleItem[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('content_manager');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const [customRoleOpen, setCustomRoleOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customPermissions, setCustomPermissions] = useState<OrgPermission[]>([
    'artists.view',
    'content.view',
    'analytics.view',
  ]);
  const [savingRole, setSavingRole] = useState(false);

  const [editingMember, setEditingMember] = useState<OrgMemberItem | null>(null);
  const [editRoleKey, setEditRoleKey] = useState('');
  const [editScope, setEditScope] = useState<'all' | 'selected'>('all');
  const [savingMember, setSavingMember] = useState(false);

  const canInvite = hasPermission('team.invite');
  const canManage = hasPermission('team.manage');

  const inviteRoles = useMemo(() => {
    const fromApi = roles.filter((r) => r.key !== 'owner');
    if (fromApi.length > 0) return fromApi.map((r) => ({ key: r.key, label: r.name }));
    return INVITE_ROLE_FALLBACKS.map((r) => ({ key: r.key, label: r.label }));
  }, [roles]);

  const load = async () => {
    if (!organization?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [team, roleList] = await Promise.all([
        listOrganizationMembers(organization.id),
        listOrganizationRoles(organization.id),
      ]);
      setMembers(team.members);
      setPendingInvites(team.pending_invitations);
      setMemberCount(team.member_count);
      setRoles(roleList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [organization?.id]);

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization?.id) return;
    setInviting(true);
    setError(null);
    try {
      const { token } = await inviteOrganizationMember(organization.id, email.trim(), roleKey);
      setInviteLink(almcRoutes.acceptTeamInviteUrl(token));
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite member');
    } finally {
      setInviting(false);
    }
  };

  const handleCreateRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization?.id) return;
    setSavingRole(true);
    setError(null);
    try {
      await createOrganizationCustomRole(organization.id, {
        name: customName.trim(),
        description: customDescription.trim() || undefined,
        permissions: customPermissions,
      });
      setCustomName('');
      setCustomDescription('');
      setCustomPermissions(['artists.view', 'content.view', 'analytics.view']);
      setCustomRoleOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setSavingRole(false);
    }
  };

  const openEditMember = (member: OrgMemberItem) => {
    setEditingMember(member);
    setEditRoleKey(member.role_key);
    setEditScope(member.artist_scope === 'selected' ? 'selected' : 'all');
  };

  const handleSaveMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization?.id || !editingMember) return;
    setSavingMember(true);
    setError(null);
    try {
      await updateOrganizationMember(organization.id, editingMember.id, {
        roleKey: editRoleKey,
        artistScope: editScope,
        artistProfileIds: editScope === 'all' ? [] : undefined,
      });
      setEditingMember(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member');
    } finally {
      setSavingMember(false);
    }
  };

  const handleRemoveMember = async (member: OrgMemberItem) => {
    if (!organization?.id || member.role_key === 'owner') return;
    const ok = window.confirm(`Remove ${member.display_name ?? member.email} from this organization?`);
    if (!ok) return;
    setError(null);
    try {
      await removeOrganizationMember(organization.id, member.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const togglePermission = (key: OrgPermission) => {
    setCustomPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <LoadingLogo />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">
            Team {memberCount > 0 ? `(${memberCount} member${memberCount === 1 ? '' : 's'})` : ''}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage who can access this organization workspace
          </p>
        </div>
        {canInvite && (
          <button
            type="button"
            onClick={() => {
              setInviteOpen(true);
              setInviteLink(null);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-[#309605] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3ba208]"
          >
            <UserPlus className="h-4 w-4" />
            Invite Member
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className={`${consoleTheme.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Artists</th>
                <th className="px-4 py-3 font-medium">Last Active</th>
                {canManage && <th className="px-4 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {member.avatar_url ? (
                        <img
                          src={member.avatar_url}
                          alt=""
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                          {(member.display_name ?? member.email).charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-foreground">
                          {member.display_name ?? member.email}
                        </p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-secondary-foreground">{member.role_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {member.artists_label ?? 'All'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {member.last_active_label ?? '—'}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      {member.role_key === 'owner' ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEditMember(member)}
                            className="text-xs font-medium text-[#3ba208] hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member)}
                            className="text-xs font-medium text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {pendingInvites.map((invite) => (
                <tr key={`invite-${invite.id}`} className="opacity-80 hover:bg-secondary/40">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-foreground">{invite.email}</p>
                      <p className="text-xs text-amber-400/90">Pending invite</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-secondary-foreground">{invite.role_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{invite.artists_label ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {invite.last_active_label ?? 'Invited'}
                  </td>
                  {canManage && <td className="px-4 py-3 text-xs text-muted-foreground">—</td>}
                </tr>
              ))}
              {members.length === 0 && pendingInvites.length === 0 && (
                <tr>
                  <td
                    colSpan={canManage ? 5 : 4}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No team members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${consoleTheme.card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Roles & Permissions</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              System roles plus custom roles for this organization
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setCustomRoleOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              Custom Role
            </button>
          )}
        </div>
        <ul className="mt-4 divide-y divide-border">
          {roles.map((role) => (
            <li key={role.key} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <p className="font-medium text-foreground">
                  {role.name}
                  {!role.is_system && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">Custom</span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {role.permission_summary || role.description}
                </p>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {role.member_count} member{role.member_count === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`${consoleTheme.card} w-full max-w-md p-5`}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Invite Member</h3>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleInvite} className="mt-4 space-y-3">
              <input
                type="email"
                required
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={consoleTheme.input + ' w-full'}
              />
              <select
                value={roleKey}
                onChange={(e) => setRoleKey(e.target.value)}
                className={consoleTheme.input + ' w-full'}
              >
                {inviteRoles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={inviting}
                className="w-full rounded-xl bg-[#309605] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3ba208] disabled:opacity-50"
              >
                {inviting ? 'Sending…' : 'Send invite'}
              </button>
            </form>
            {inviteLink && (
              <div className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
                Share invite link:
                <code className="mt-1 block break-all text-xs">{inviteLink}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {customRoleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`${consoleTheme.card} max-h-[90vh] w-full max-w-lg overflow-y-auto p-5`}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Custom Role</h3>
              <button
                type="button"
                onClick={() => setCustomRoleOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateRole} className="mt-4 space-y-4">
              <input
                required
                minLength={2}
                placeholder="Role name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className={consoleTheme.input + ' w-full'}
              />
              <input
                placeholder="Short description (optional)"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                className={consoleTheme.input + ' w-full'}
              />
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Permissions
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CUSTOM_ROLE_PERMISSION_OPTIONS.map((opt) => (
                    <label
                      key={opt.key}
                      className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={customPermissions.includes(opt.key)}
                        onChange={() => togglePermission(opt.key)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-foreground">{opt.label}</span>
                        <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={savingRole || customPermissions.length === 0}
                className="w-full rounded-xl bg-[#309605] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3ba208] disabled:opacity-50"
              >
                {savingRole ? 'Creating…' : 'Create role'}
              </button>
            </form>
          </div>
        </div>
      )}

      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`${consoleTheme.card} w-full max-w-md p-5`}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Edit member</h3>
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {editingMember.display_name ?? editingMember.email}
            </p>
            <form onSubmit={handleSaveMember} className="mt-4 space-y-3">
              <label className="block text-xs text-muted-foreground">
                Role
                <select
                  value={editRoleKey}
                  onChange={(e) => setEditRoleKey(e.target.value)}
                  className={consoleTheme.input + ' mt-1 w-full'}
                >
                  {inviteRoles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                Artist access
                <select
                  value={editScope}
                  onChange={(e) => setEditScope(e.target.value as 'all' | 'selected')}
                  className={consoleTheme.input + ' mt-1 w-full'}
                >
                  <option value="all">All artists</option>
                  <option value="selected">Selected artists (configure later)</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={savingMember}
                className="w-full rounded-xl bg-[#309605] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3ba208] disabled:opacity-50"
              >
                {savingMember ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
