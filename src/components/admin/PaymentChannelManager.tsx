import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Power, PowerOff, CreditCard, Wallet, DollarSign, Save, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  getAllPaymentChannels, 
  createPaymentChannel, 
  updatePaymentChannel, 
  deletePaymentChannel, 
  togglePaymentChannelStatus,
  validateChannelConfig,
  PaymentChannel, 
  PaymentChannelConfig 
} from '../../lib/paymentChannels';

interface PaymentChannelFormData {
  channel_name: string;
  channel_type: 'paystack' | 'flutterwave' | 'usdt';
  is_enabled: boolean;
  icon_url: string;
  display_order: number;
  configuration: {
    public_key?: string;
    secret_key?: string;
    encryption_key?: string;
    api_version?: 'v3' | 'v4';
    webhook_url?: string;
    wallet_address?: string;
    network?: string;
  };
}

export const PaymentChannelManager: React.FC = () => {
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<PaymentChannel | null>(null);
  const [formData, setFormData] = useState<PaymentChannelFormData>({
    channel_name: '',
    channel_type: 'paystack',
    is_enabled: true,
    icon_url: '',
    display_order: 1,
    configuration: {}
  });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadChannels();
  }, []);

  const loadChannels = async () => {
    try {
      setIsLoading(true);
      const data = await getAllPaymentChannels();
      setChannels(data);
    } catch (error) {
      console.error('Error loading payment channels:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate configuration
    const validation = validateChannelConfig(formData.channel_type, formData.configuration);
    if (!validation.isValid) {
      setFormErrors(validation.errors);
      return;
    }

    setIsSubmitting(true);
    setFormErrors([]);

    try {
      const channelConfig: PaymentChannelConfig = {
        channel_name: formData.channel_name,
        channel_type: formData.channel_type,
        is_enabled: formData.is_enabled,
        icon_url: formData.icon_url || undefined,
        configuration: formData.configuration,
        display_order: formData.display_order
      };

      if (editingChannel) {
        await updatePaymentChannel(editingChannel.id, channelConfig);
      } else {
        await createPaymentChannel(channelConfig);
      }

      await loadChannels();
      resetForm();
    } catch (error) {
      console.error('Error saving payment channel:', error);
      setFormErrors(['Failed to save payment channel']);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (channel: PaymentChannel) => {
    setEditingChannel(channel);
    setFormData({
      channel_name: channel.channel_name,
      channel_type: channel.channel_type as 'paystack' | 'flutterwave' | 'usdt',
      is_enabled: channel.is_enabled,
      icon_url: channel.icon_url || '',
      display_order: channel.display_order,
      configuration: channel.configuration || {}
    });
    setShowForm(true);
  };

  const handleDelete = async (channelId: string) => {
    if (!confirm('Are you sure you want to delete this payment channel?')) {
      return;
    }

    try {
      await deletePaymentChannel(channelId);
      await loadChannels();
    } catch (error) {
      console.error('Error deleting payment channel:', error);
    }
  };

  const handleToggleStatus = async (channelId: string) => {
    try {
      await togglePaymentChannelStatus(channelId);
      await loadChannels();
    } catch (error) {
      console.error('Error toggling payment channel status:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      channel_name: '',
      channel_type: 'paystack',
      is_enabled: true,
      icon_url: '',
      display_order: 1,
      configuration: {}
    });
    setEditingChannel(null);
    setShowForm(false);
    setFormErrors([]);
  };

  const getChannelIcon = (channelType: string) => {
    switch (channelType) {
      case 'paystack':
        return <CreditCard className="w-5 h-5" />;
      case 'flutterwave':
        return <CreditCard className="w-5 h-5" />;
      case 'usdt':
        return <Wallet className="w-5 h-5" />;
      default:
        return <DollarSign className="w-5 h-5" />;
    }
  };

  const renderConfigurationFields = () => {
    switch (formData.channel_type) {
      case 'paystack':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Public Key
              </label>
              <input
                type="text"
                value={formData.configuration.public_key || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, public_key: e.target.value }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                placeholder="pk_test_..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Secret Key
              </label>
              <input
                type="password"
                value={formData.configuration.secret_key || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, secret_key: e.target.value }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                placeholder="sk_test_..."
              />
            </div>
          </>
        );

      case 'flutterwave':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                API Version
              </label>
              <select
                value={formData.configuration.api_version || 'v3'}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, api_version: e.target.value as 'v3' | 'v4' }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-[#309605]"
              >
                <option value="v3">V3 API (Legacy)</option>
                <option value="v4">V4 API (New)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Public Key
              </label>
              <input
                type="text"
                value={formData.configuration.public_key || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, public_key: e.target.value }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                placeholder={formData.configuration.api_version === 'v4' ? 'FLWPUBK-...' : 'FLWPUBK_TEST-...'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Secret Key
              </label>
              <input
                type="password"
                value={formData.configuration.secret_key || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, secret_key: e.target.value }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                placeholder={formData.configuration.api_version === 'v4' ? 'FLWSECK-...' : 'FLWSECK_TEST-...'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Encryption Key {formData.configuration.api_version === 'v4' && <span className="text-red-400">*</span>}
              </label>
              <input
                type="password"
                value={formData.configuration.encryption_key || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, encryption_key: e.target.value }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                placeholder={formData.configuration.api_version === 'v4' ? 'FLWSECK_ENC-... (Required for V4)' : 'FLWSECK_ENC-... (Optional for V3)'}
              />
              <p className="mt-1 text-xs text-white/60">
                {formData.configuration.api_version === 'v4'
                  ? 'V4 API requires an encryption key for enhanced security'
                  : 'Optional for V3 API, but recommended for enhanced security'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Webhook URL (Optional)
              </label>
              <input
                type="url"
                value={formData.configuration.webhook_url || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, webhook_url: e.target.value }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                placeholder="https://your-domain.com/webhook"
              />
              <p className="mt-1 text-xs text-white/60">
                Leave empty to use auto-generated webhook URL
              </p>
            </div>
          </>
        );

      case 'usdt':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Wallet Address
              </label>
              <input
                type="text"
                value={formData.configuration.wallet_address || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, wallet_address: e.target.value }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                placeholder="TRC-20 or ERC-20 wallet address"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Network
              </label>
              <select
                value={formData.configuration.network || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  configuration: { ...formData.configuration, network: e.target.value }
                })}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-[#309605]"
              >
                <option value="">Select Network</option>
                <option value="TRC-20">TRC-20 (Tron)</option>
                <option value="ERC-20">ERC-20 (Ethereum)</option>
                <option value="BEP-20">BEP-20 (BSC)</option>
              </select>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-[#309605] border-t-transparent rounded-full animate-spin"></div>
        <p className="font-['Inter',sans-serif] text-white/70 text-sm ml-3">
          Loading payment channels...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl">
          Payment Channels
        </h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] rounded-lg font-['Inter',sans-serif] font-medium text-white transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          Add Channel
        </button>
      </div>

      {/* Payment Channels List */}
      <div className="grid gap-4">
        {channels.map((channel) => (
          <Card key={channel.id} className="bg-white/5 border-white/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    channel.is_enabled ? 'bg-[#309605]/20 text-[#309605]' : 'bg-white/10 text-white/50'
                  }`}>
                    {channel.icon_url ? (
                      <img 
                        src={channel.icon_url} 
                        alt={channel.channel_name}
                        className="w-8 h-8 object-contain"
                      />
                    ) : (
                      getChannelIcon(channel.channel_type)
                    )}
                  </div>
                  <div>
                    <h3 className="font-['Inter',sans-serif] font-medium text-white text-base">
                      {channel.channel_name}
                    </h3>
                    <p className="font-['Inter',sans-serif] text-white/60 text-sm">
                      {channel.channel_type.toUpperCase()} • Order: {channel.display_order}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleStatus(channel.id)}
                    className={`p-2 rounded-lg transition-all duration-200 ${
                      channel.is_enabled
                        ? 'bg-[#309605]/20 text-[#309605] hover:bg-[#309605]/30'
                        : 'bg-white/10 text-white/50 hover:bg-white/20'
                    }`}
                    title={channel.is_enabled ? 'Disable' : 'Enable'}
                  >
                    {channel.is_enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleEdit(channel)}
                    className="p-2 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white rounded-lg transition-all duration-200"
                    title="Edit"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(channel.id)}
                    className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 rounded-lg transition-all duration-200"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {channels.length === 0 && (
          <Card className="bg-white/5 border-white/20">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CreditCard className="w-8 h-8 text-white/50" />
              </div>
              <h3 className="font-['Inter',sans-serif] font-medium text-white text-base mb-2">
                No Payment Channels
              </h3>
              <p className="font-['Inter',sans-serif] text-white/60 text-sm">
                Add your first payment channel to start accepting payments.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="bg-[#1a1a1a] border-white/20 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle className="font-['Inter',sans-serif] text-white flex items-center justify-between">
                {editingChannel ? 'Edit Payment Channel' : 'Add Payment Channel'}
                <button
                  onClick={resetForm}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                {formErrors.length > 0 && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                    {formErrors.map((error, index) => (
                      <p key={index} className="font-['Inter',sans-serif] text-red-400 text-sm">
                        {error}
                      </p>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Channel Name
                  </label>
                  <input
                    type="text"
                    value={formData.channel_name}
                    onChange={(e) => setFormData({ ...formData, channel_name: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                    placeholder="e.g., Paystack Nigeria"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Channel Type
                  </label>
                  <select
                    value={formData.channel_type}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      channel_type: e.target.value as 'paystack' | 'flutterwave' | 'usdt',
                      configuration: {} // Reset configuration when type changes
                    })}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-[#309605]"
                    required
                  >
                    <option value="paystack">Paystack</option>
                    <option value="flutterwave">Flutterwave</option>
                    <option value="usdt">USDT</option>
                  </select>
                </div>

                {renderConfigurationFields()}

                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Icon URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={formData.icon_url}
                    onChange={(e) => setFormData({ ...formData, icon_url: e.target.value })}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                    placeholder="https://example.com/icon.png"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Display Order
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.display_order}
                    onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-[#309605]"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_enabled"
                    checked={formData.is_enabled}
                    onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                    className="w-4 h-4 text-[#309605] bg-white/10 border-white/20 rounded focus:ring-[#309605]"
                  />
                  <label htmlFor="is_enabled" className="text-sm font-medium text-white">
                    Enable this payment channel
                  </label>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="flex-1 h-10 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-['Inter',sans-serif] font-medium text-white transition-all duration-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 h-10 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:opacity-50 rounded-lg font-['Inter',sans-serif] font-medium text-white transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        {editingChannel ? 'Update' : 'Create'}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};