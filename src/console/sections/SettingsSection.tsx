import { useOrganization } from '../contexts/OrganizationContext';

export function SettingsSection() {
  const { organization } = useOrganization();

  if (!organization) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Organization profile and workspace preferences</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground/80">Organization</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{organization.name}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground/80">Type</p>
            <p className="mt-1 capitalize text-secondary-foreground">{organization.type}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground/80">Slug</p>
            <p className="mt-1 text-secondary-foreground">{organization.slug}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground/80">Your role</p>
            <p className="mt-1 text-secondary-foreground">{organization.role_name}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground/80">
          Advanced settings (branding, billing, API keys, audit logs) ship in Phase 2.
        </p>
      </div>
    </div>
  );
}
