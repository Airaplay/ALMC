import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { KeyRound, Plus, Save, Shield, SlidersHorizontal } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAdminActionConfirm } from '../../components/AdminActionConfirmModal';

interface AdminFeature {
  key: string;
  label: string;
  group_key: string;
  sort_order: number;
  is_active: boolean;
}

interface AdminRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  legacy_role: 'admin' | 'manager' | 'editor' | 'account';
  is_system: boolean;
  is_active: boolean;
  feature_keys: string[];
  feature_count: number;
  assigned_count: number;
  created_at: string;
}

interface AdminRolesSectionProps {
  onRolesChanged?: () => void;
}

const LEGACY_ROLE_OPTIONS = [
  { value: 'manager', label: 'Manager backend permissions' },
  { value: 'editor', label: 'Editor backend permissions' },
  { value: 'account', label: 'Account backend permissions' },
] as const;

const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  users: 'Users & Content',
  monetization: 'Monetization',
  accountant: 'Accountant',
  advertising: 'Advertising',
  engagement: 'Engagement',
  system: 'System',
  account: 'Account',
};

export const AdminRolesSection = ({ onRolesChanged }: AdminRolesSectionProps): JSX.Element => {
  const { confirm, ConfirmModal } = useAdminActionConfirm();
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [features, setFeatures] = useState<AdminFeature[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [selectedFeatureKeys, setSelectedFeatureKeys] = useState<Set<string>>(new Set());
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLegacyRole, setEditLegacyRole] = useState<'manager' | 'editor' | 'account'>('manager');
  const [editIsActive, setEditIsActive] = useState(true);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newLegacyRole, setNewLegacyRole] = useState<'manager' | 'editor' | 'account'>('manager');
  const [newFeatureKeys, setNewFeatureKeys] = useState<Set<string>>(new Set(['analytics']));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRole = roles.find(role => role.id === selectedRoleId) || null;

  const groupedFeatures = useMemo(() => {
    return features.reduce<Record<string, AdminFeature[]>>((groups, feature) => {
      if (!groups[feature.group_key]) groups[feature.group_key] = [];
      groups[feature.group_key].push(feature);
      return groups;
    }, {});
  }, [features]);

  const fetchRolesAndFeatures = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [{ data: roleData, error: roleError }, { data: featureData, error: featureError }] = await Promise.all([
        supabase.rpc('admin_list_roles'),
        supabase.rpc('admin_list_features'),
      ]);

      if (roleError) throw roleError;
      if (featureError) throw featureError;

      const nextRoles = (roleData || []) as AdminRole[];
      const nextFeatures = (featureData || []) as AdminFeature[];
      setRoles(nextRoles);
      setFeatures(nextFeatures);

      if (!selectedRoleId && nextRoles.length > 0) {
        setSelectedRoleId(nextRoles[0].id);
      }
    } catch (err) {
      console.error('Error loading admin roles:', err);
      setError(err instanceof Error ? err.message : 'Failed to load roles and features');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRolesAndFeatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedRole) return;
    setSelectedFeatureKeys(new Set(selectedRole.feature_keys || []));
    setEditName(selectedRole.name);
    setEditDescription(selectedRole.description || '');
    setEditLegacyRole(
      selectedRole.legacy_role === 'admin' ? 'manager' : selectedRole.legacy_role
    );
    setEditIsActive(selectedRole.is_active);
  }, [selectedRole]);

  const toggleSetValue = (setValue: Dispatch<SetStateAction<Set<string>>>, key: string) => {
    setValue(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderFeatureGrid = (
    selectedKeys: Set<string>,
    onToggle: (key: string) => void,
    disabled = false
  ) => (
    <div className="space-y-4">
      {Object.entries(groupedFeatures).map(([groupKey, groupFeatures]) => (
        <div key={groupKey} className="border border-gray-200 rounded-lg p-4">
          <h5 className="text-sm font-semibold text-gray-900 mb-3">
            {GROUP_LABELS[groupKey] || groupKey}
          </h5>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {groupFeatures.map(feature => (
              <label key={feature.key} className={`flex items-center gap-2 text-sm ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>
                <input
                  type="checkbox"
                  checked={selectedKeys.has(feature.key)}
                  onChange={() => onToggle(feature.key)}
                  disabled={disabled}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{feature.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const handleCreateRole = async (event: FormEvent) => {
    event.preventDefault();

    if (!newRoleName.trim()) {
      setError('Role name is required');
      return;
    }

    const confirmed = await confirm({
      title: 'Create Admin Role',
      description: `Create the ${newRoleName.trim()} role with ${newFeatureKeys.size} dashboard feature(s)?`,
      actionLabel: 'Create Role',
      actionVariant: 'warning',
      requirePasswordConfirm: true,
    });

    if (!confirmed) return;

    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);

      const { data, error: rpcError } = await supabase.rpc('admin_create_role', {
        name_param: newRoleName.trim(),
        description_param: newRoleDescription.trim() || null,
        legacy_role_param: newLegacyRole,
        feature_keys_param: Array.from(newFeatureKeys),
      });

      if (rpcError) throw rpcError;
      if (data?.error) throw new Error(data.error);

      setMessage('Role created successfully');
      setNewRoleName('');
      setNewRoleDescription('');
      setNewLegacyRole('manager');
      setNewFeatureKeys(new Set(['analytics']));
      await fetchRolesAndFeatures();
      onRolesChanged?.();
      if (data?.role_id) setSelectedRoleId(data.role_id);
    } catch (err) {
      console.error('Error creating admin role:', err);
      setError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveRole = async () => {
    if (!selectedRole) return;

    const confirmed = await confirm({
      title: 'Update Admin Role',
      description: `Save feature access for ${selectedRole.name}? Users with this role will see the updated dashboard access immediately after their next permission check.`,
      actionLabel: 'Save Role',
      actionVariant: selectedRole.key === 'admin' ? 'danger' : 'warning',
      requirePasswordConfirm: true,
    });

    if (!confirmed) return;

    try {
      setIsSaving(true);
      setError(null);
      setMessage(null);

      const { data, error: rpcError } = await supabase.rpc('admin_update_role_features', {
        role_id_param: selectedRole.id,
        feature_keys_param: Array.from(selectedFeatureKeys),
        name_param: editName.trim() || selectedRole.name,
        description_param: editDescription.trim() || null,
        legacy_role_param: editLegacyRole,
        is_active_param: editIsActive,
      });

      if (rpcError) throw rpcError;
      if (data?.error) throw new Error(data.error);

      setMessage('Role updated successfully');
      await fetchRolesAndFeatures();
      onRolesChanged?.();
    } catch (err) {
      console.error('Error updating admin role:', err);
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <ConfirmModal />
      {(message || error) && (
        <div className={`p-4 rounded-lg ${error ? 'bg-red-100 border border-red-200' : 'bg-green-100 border border-green-200'}`}>
          <p className={error ? 'text-red-700' : 'text-green-700'}>{error || message}</p>
        </div>
      )}

      <form onSubmit={handleCreateRole} className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <Plus className="w-5 h-5 text-blue-600" />
          Create Role
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">Role Name *</label>
            <input
              value={newRoleName}
              onChange={(event) => setNewRoleName(event.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Support Agent"
            />
          </div>
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">Backend Compatibility *</label>
            <select
              value={newLegacyRole}
              onChange={(event) => setNewLegacyRole(event.target.value as 'manager' | 'editor' | 'account')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {LEGACY_ROLE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-700 text-sm font-medium mb-2">Description</label>
            <input
              value={newRoleDescription}
              onChange={(event) => setNewRoleDescription(event.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Optional role purpose"
            />
          </div>
        </div>
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Initial Features</h4>
          {renderFeatureGrid(newFeatureKeys, key => toggleSetValue(setNewFeatureKeys, key))}
        </div>
        <button
          type="submit"
          disabled={isSaving || !newRoleName.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Creating...' : 'Create Role'}
        </button>
      </form>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-6">
          <SlidersHorizontal className="w-5 h-5 text-gray-700" />
          Role Feature Access
        </h3>

        {isLoading ? (
          <p className="text-gray-700">Loading roles...</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6">
            <div className="space-y-2">
              {roles.map(role => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`w-full text-left p-3 rounded-lg border ${
                    selectedRoleId === role.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900">{role.name}</span>
                    {role.is_system && <Shield className="w-4 h-4 text-gray-400" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {role.feature_count} feature(s) • {role.assigned_count} assigned
                  </p>
                  {!role.is_active && (
                    <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">
                      Inactive
                    </span>
                  )}
                </button>
              ))}
            </div>

            {selectedRole && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
                    <KeyRound className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900">{selectedRole.name}</h4>
                    <p className="text-sm text-gray-500">
                      {selectedRole.is_system ? 'System role' : 'Custom role'} using {selectedRole.legacy_role} backend permissions.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-2">Role Name</label>
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      disabled={selectedRole.is_system}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-2">Backend Compatibility</label>
                    <select
                      value={editLegacyRole}
                      onChange={(event) => setEditLegacyRole(event.target.value as 'manager' | 'editor' | 'account')}
                      disabled={selectedRole.is_system}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      {LEGACY_ROLE_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 self-end pb-2">
                    <input
                      type="checkbox"
                      checked={editIsActive}
                      onChange={(event) => setEditIsActive(event.target.checked)}
                      disabled={selectedRole.key === 'admin'}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Role is active
                  </label>
                </div>

                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    disabled={selectedRole.is_system}
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500 resize-none"
                  />
                </div>

                <div>
                  <h5 className="text-sm font-semibold text-gray-900 mb-3">Dashboard Features</h5>
                  {renderFeatureGrid(
                    selectedFeatureKeys,
                    key => toggleSetValue(setSelectedFeatureKeys, key),
                    selectedRole.key === 'admin'
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSaveRole}
                  disabled={isSaving || selectedRole.key === 'admin'}
                  className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Saving...' : 'Save Role'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
