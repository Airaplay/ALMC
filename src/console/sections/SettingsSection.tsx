import { useEffect, useState } from 'react';
import { useOrganization } from '../contexts/OrganizationContext';
import { ConsoleThemeToggle } from '../components/ConsoleThemeToggle';
import { getOrgSplitSettings, setOrgSplitSettings } from '../../lib/orgAccess';

export function SettingsSection() {
  const { organization, hasPermission } = useOrganization();
  const [orgSplitPct, setOrgSplitPct] = useState('0');
  const [loadingSplit, setLoadingSplit] = useState(false);
  const [savingSplit, setSavingSplit] = useState(false);
  const [splitMessage, setSplitMessage] = useState<string | null>(null);

  const canEditSplit = hasPermission('org.settings') || hasPermission('org.manage');

  useEffect(() => {
    if (!organization?.id) return;
    let cancelled = false;
    setLoadingSplit(true);
    setSplitMessage(null);
    getOrgSplitSettings(organization.id)
      .then((settings) => {
        if (!cancelled) {
          setOrgSplitPct(String(settings.org_split_pct));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSplitMessage(err instanceof Error ? err.message : 'Failed to load split settings');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSplit(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organization?.id]);

  if (!organization) return null;

  const handleSaveSplit = async () => {
    if (!organization?.id || !canEditSplit) return;
    const parsed = Number(orgSplitPct);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setSplitMessage('Enter a valid org split between 0 and 100.');
      return;
    }
    setSavingSplit(true);
    setSplitMessage(null);
    try {
      const next = await setOrgSplitSettings(organization.id, parsed);
      setOrgSplitPct(String(next.org_split_pct));
      setSplitMessage('Default split saved.');
    } catch (err) {
      setSplitMessage(err instanceof Error ? err.message : 'Failed to save split settings');
    } finally {
      setSavingSplit(false);
    }
  };

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

      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground/80">Revenue split</p>
          <p className="mt-1 text-lg font-semibold text-foreground">Org default split</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Default share applied to linked artists unless an artist override is set.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[180px,1fr] sm:items-center">
          <label htmlFor="org-split-pct" className="text-sm text-secondary-foreground">
            Org share (%)
          </label>
          <input
            id="org-split-pct"
            type="number"
            min={0}
            max={100}
            step={1}
            value={orgSplitPct}
            onChange={(e) => setOrgSplitPct(e.target.value)}
            disabled={loadingSplit || savingSplit || !canEditSplit}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
          />
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Artist share automatically stays at {100 - Math.max(0, Math.min(100, Number(orgSplitPct) || 0))}%.
          </p>
        </div>
        {splitMessage ? <p className="text-sm text-muted-foreground">{splitMessage}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSaveSplit()}
            disabled={loadingSplit || savingSplit || !canEditSplit}
            className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {savingSplit ? 'Saving…' : 'Save split'}
          </button>
          {!canEditSplit ? (
            <span className="text-xs text-muted-foreground">You need org settings access to edit this.</span>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground/80">Appearance</p>
          <p className="mt-1 text-lg font-semibold text-foreground">Theme</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose light, dark, or follow your system setting.
          </p>
        </div>
        <ConsoleThemeToggle />
      </div>
    </div>
  );
}
