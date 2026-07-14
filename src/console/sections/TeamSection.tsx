import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { inviteOrganizationMember, listOrganizationMembers, OrgMemberItem } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { LoadingLogo } from '../../components/LoadingLogo';

const INVITE_ROLES = [
  { key: 'admin', label: 'Administrator' },
  { key: 'content_manager', label: 'Content Manager' },
  { key: 'viewer', label: 'Viewer' },
];

export function TeamSection() {
  const { organization, hasPermission } = useOrganization();
  const [members, setMembers] = useState<OrgMemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const loadMembers = async () => {
    if (!organization?.id) return;
    setLoading(true);
    try {
      const list = await listOrganizationMembers(organization.id);
      setMembers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [organization?.id]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization?.id) return;
    setInviting(true);
    setError(null);
    try {
      const { token } = await inviteOrganizationMember(organization.id, email.trim(), roleKey);
      setInviteLink(almcRoutes.acceptTeamInviteUrl(token));
      setEmail('');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite member');
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-white">Team</h2>
        <p className="mt-1 text-sm text-white/50">Manage who can access this organization workspace</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {hasPermission('team.invite') && (
        <div className="rounded-2xl border border-white/10 bg-[#141416] p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <UserPlus className="h-5 w-5 text-[#FF3366]" />
            Invite team member
          </h3>
          <form onSubmit={handleInvite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <input
              type="email"
              required
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:border-[#FF3366]/50 focus:outline-none"
            />
            <select
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value)}
              className="rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:outline-none"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={inviting}
              className="rounded-xl bg-[#FF3366] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Invite
            </button>
          </form>
          {inviteLink && (
            <div className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
              Share invite link:
              <code className="mt-1 block break-all text-xs">{inviteLink}</code>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <LoadingLogo />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#141416] text-white/50">
              <tr>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 bg-[#0f0f11]">
              {members.map((member) => (
                <tr key={member.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {member.avatar_url ? (
                        <img src={member.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs text-white">
                          {(member.display_name ?? member.email).charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-white">{member.display_name ?? member.email}</p>
                        <p className="text-xs text-white/40">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white/80">{member.role_name}</td>
                  <td className="px-4 py-3 capitalize text-white/60">{member.status}</td>
                  <td className="px-4 py-3 text-white/50">
                    {member.joined_at ? new Date(member.joined_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
