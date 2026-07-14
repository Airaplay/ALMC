import { useOrganization } from '../contexts/OrganizationContext';

export function SettingsSection() {
  const { organization } = useOrganization();

  if (!organization) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-white">Settings</h2>
        <p className="mt-1 text-sm text-white/50">Organization profile and workspace preferences</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#141416] p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">Organization</p>
          <p className="mt-1 text-lg font-semibold text-white">{organization.name}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-white/40">Type</p>
            <p className="mt-1 capitalize text-white/80">{organization.type}</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Slug</p>
            <p className="mt-1 text-white/80">{organization.slug}</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Your role</p>
            <p className="mt-1 text-white/80">{organization.role_name}</p>
          </div>
        </div>
        <p className="text-sm text-white/40">
          Advanced settings (branding, billing, API keys, audit logs) ship in Phase 2.
        </p>
      </div>
    </div>
  );
}
