import React, { useState, useEffect } from 'react';
import { X, DollarSign, Wallet, Building2, ChevronRight, Check } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { supabase, withdrawUserFunds } from '../lib/supabase';
import { CustomConfirmDialog } from './CustomConfirmDialog';

interface WithdrawEarningsModalProps {
  onClose: () => void;
  onSuccess: () => void;
  currentEarnings: number;
}

interface WithdrawalMethod {
  id: string;
  method_type: 'usdt_wallet' | 'bank_account';
  wallet_address?: string;
  bank_name?: string;
  account_number?: string;
  account_holder_name?: string;
  swift_code?: string;
  country?: string;
  is_default: boolean;
}

export const WithdrawEarningsModal: React.FC<WithdrawEarningsModalProps> = ({
  onClose,
  onSuccess,
  currentEarnings,
}) => {
  const [withdrawalAmount, setWithdrawalAmount] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDestinationPicker, setShowDestinationPicker] = useState(false);
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [selectedMethodType, setSelectedMethodType] = useState<'usdt_wallet' | 'bank_account' | null>(null);
  const [savedMethods, setSavedMethods] = useState<WithdrawalMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<WithdrawalMethod | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showConfirmWithdraw, setShowConfirmWithdraw] = useState(false);

  const [newMethod, setNewMethod] = useState({
    wallet_address: '',
    bank_name: '',
    account_number: '',
    account_holder_name: '',
    swift_code: '',
    country: '',
  });

  useEffect(() => {
    loadWithdrawalMethods();
  }, []);

  const loadWithdrawalMethods = async () => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error: fetchError } = await supabase
        .from('withdrawal_methods')
        .select('*')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false });

      if (fetchError) throw fetchError;

      setSavedMethods(data || []);
      const defaultMethod = data?.find(m => m.is_default);
      if (defaultMethod) {
        setSelectedMethod(defaultMethod);
      }
    } catch (err) {
      console.error('Error loading withdrawal methods:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setWithdrawalAmount(value);
      setError(null);
    }
  };

  const setMaxAmount = () => {
    setWithdrawalAmount(currentEarnings.toString());
    setError(null);
  };

  const handleSaveMethod = async () => {
    try {
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (selectedMethodType === 'usdt_wallet') {
        if (!newMethod.wallet_address || !newMethod.wallet_address.match(/^T[A-Za-z1-9]{33}$/)) {
          setError('Please enter a valid TRC20 wallet address (starts with T, 34 characters)');
          return;
        }
      } else if (selectedMethodType === 'bank_account') {
        if (!newMethod.bank_name || !newMethod.account_number || !newMethod.account_holder_name || !newMethod.country) {
          setError('Please fill in all required bank account fields');
          return;
        }
      }

      const methodData: any = {
        user_id: user.id,
        method_type: selectedMethodType,
        is_default: savedMethods.length === 0,
      };

      if (selectedMethodType === 'usdt_wallet') {
        methodData.wallet_address = newMethod.wallet_address;
      } else {
        methodData.bank_name = newMethod.bank_name;
        methodData.account_number = newMethod.account_number;
        methodData.account_holder_name = newMethod.account_holder_name;
        methodData.swift_code = newMethod.swift_code || null;
        methodData.country = newMethod.country;
      }

      const { data, error: insertError } = await supabase
        .from('withdrawal_methods')
        .insert(methodData)
        .select()
        .single();

      if (insertError) throw insertError;

      setSavedMethods([...savedMethods, data]);
      setSelectedMethod(data);
      setShowAddMethod(false);
      setSelectedMethodType(null);
      setNewMethod({
        wallet_address: '',
        bank_name: '',
        account_number: '',
        account_holder_name: '',
        swift_code: '',
        country: '',
      });
    } catch (err) {
      console.error('Error saving withdrawal method:', err);
      setError('Failed to save withdrawal method');
    }
  };

  const handleWithdrawClick = (e: React.FormEvent) => {
    e.preventDefault();

    const amount = parseFloat(withdrawalAmount);
    if (!amount || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (amount > currentEarnings) {
      setError('Insufficient earnings');
      return;
    }

    if (!selectedMethod) {
      setError('Please select a withdrawal method');
      return;
    }

    setShowConfirmWithdraw(true);
  };

  const handleConfirmWithdraw = async () => {
    setShowConfirmWithdraw(false);
    const e = { preventDefault: () => {} } as React.FormEvent;
    await handleSubmit(e);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amount = parseFloat(withdrawalAmount);

    if (!withdrawalAmount || isNaN(amount)) {
      setError('Please enter a valid withdrawal amount');
      return;
    }

    if (amount <= 0) {
      setError('Withdrawal amount must be greater than 0');
      return;
    }

    if (amount > currentEarnings) {
      setError('Withdrawal amount cannot exceed your current earnings');
      return;
    }

    if (amount < 10) {
      setError('Minimum withdrawal amount is $10.00');
      return;
    }

    if (!selectedMethod) {
      setError('Please select a withdrawal destination');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await withdrawUserFunds(amount, selectedMethod.id);

      if (result?.success) {
        setShowConfirmation(true);

        setTimeout(() => {
          onSuccess();
          onClose();
        }, 5000);
      }
    } catch (err) {
      console.error('Error processing withdrawal:', err);
      setError(err instanceof Error ? err.message : 'An error occurred while processing your withdrawal');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (amount: number): string => {
    return `$${amount.toFixed(2)}`;
  };

  if (showConfirmation) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn">
        <div className="relative flex flex-col items-center justify-center p-8 rounded-3xl bg-gradient-to-br from-[#309605]/20 via-[#3ba208]/20 to-[#3ba208]/20 border border-[#309605]/30 shadow-2xl max-w-sm mx-4 animate-scaleIn">
          {/* Done Animation */}
          <div className="relative w-40 h-40 mb-6 flex items-center justify-center">
            <img
              src="/assets/animations/Done.gif"
              alt="Success"
              className="w-full h-full object-contain"
              onError={(e) => {
                // Fallback to Check icon if GIF fails to load
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.nextElementSibling;
                if (fallback) fallback.classList.remove('hidden');
              }}
            />
            <div className="hidden w-20 h-20 bg-gradient-to-r from-[#309605] to-[#3ba208] rounded-full flex items-center justify-center shadow-xl">
              <Check className="w-10 h-10 text-white" />
            </div>
          </div>

          {/* Success Message */}
          <h3 className="font-bold text-white text-2xl mb-2 text-center">
            Withdrawal Submitted!
          </h3>

          {/* Amount Display */}
          <div className="flex items-baseline gap-1 mb-3">
            <span className="text-[#309605] text-4xl font-bold">
              ${withdrawalAmount}
            </span>
            <span className="text-white/70 text-lg font-medium">USD</span>
          </div>

          <p className="text-white/80 text-base text-center mb-4">
            Your withdrawal is being processed
          </p>

          {/* Progress Indicator */}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-[#309605] rounded-full animate-pulse"></div>
            <p className="text-white/60 text-sm">Processing 1-3 business days</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[90vh] bg-gradient-to-b from-gray-900/95 to-black/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden flex flex-col">
        <CardContent className="p-6 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl">
              Withdraw Earnings
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200"
            >
              <X className="w-5 h-5 text-white/80" />
            </button>
          </div>

          {/* Current Balance */}
          <div className="mb-6 p-4 bg-gradient-to-r from-green-600/20 to-emerald-600/20 backdrop-blur-sm border border-green-500/30 rounded-xl text-center">
            <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-green-600/25">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-['Inter',sans-serif] font-bold text-white text-2xl mb-1">
              {formatCurrency(currentEarnings)}
            </h3>
            <p className="font-['Inter',sans-serif] text-white/80 text-sm">
              Available Balance
            </p>
          </div>

          {/* Destination Selection */}
          <div className="mb-4">
            <label className="font-['Inter',sans-serif] font-medium text-white/80 text-sm mb-2 block">
              Destination
            </label>

            {!showAddMethod && !showDestinationPicker && selectedMethod && (
              <div
                onClick={() => setShowDestinationPicker(true)}
                className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/20 cursor-pointer transition-all duration-200 group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedMethod.method_type === 'usdt_wallet' ? (
                      <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-blue-400" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-green-400" />
                      </div>
                    )}
                    <div>
                      <p className="font-['Inter',sans-serif] text-white text-sm font-medium">
                        {selectedMethod.method_type === 'usdt_wallet' ? 'USDT Wallet' : 'Bank Account'}
                      </p>
                      <p className="font-['Inter',sans-serif] text-white/60 text-xs">
                        {selectedMethod.method_type === 'usdt_wallet'
                          ? `${selectedMethod.wallet_address?.slice(0, 8)}...${selectedMethod.wallet_address?.slice(-6)}`
                          : `${selectedMethod.bank_name} - ${selectedMethod.account_number?.slice(-4)}`
                        }
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-white/40 group-hover:text-white/60 transition-colors duration-200 group-hover:translate-x-1" />
                </div>
              </div>
            )}

            {!showAddMethod && !selectedMethod && !isLoading && (
              <button
                onClick={() => setShowDestinationPicker(true)}
                className="w-full p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/20 border-dashed cursor-pointer transition-all duration-200 text-center"
              >
                <p className="font-['Inter',sans-serif] text-white/70 text-sm">
                  Select Withdrawal Destination
                </p>
              </button>
            )}

            {showDestinationPicker && (
              <div className="space-y-3">
                {savedMethods.length > 0 && (
                  <div className="space-y-2">
                    {savedMethods.map(method => (
                      <div
                        key={method.id}
                        onClick={() => {
                          setSelectedMethod(method);
                          setShowDestinationPicker(false);
                        }}
                        className="p-3 bg-white/5 hover:bg-white/10 rounded-lg border border-white/20 cursor-pointer transition-all duration-200 group"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {method.method_type === 'usdt_wallet' ? (
                              <Wallet className="w-5 h-5 text-blue-400" />
                            ) : (
                              <Building2 className="w-5 h-5 text-green-400" />
                            )}
                            <div>
                              <p className="font-['Inter',sans-serif] text-white text-sm">
                                {method.method_type === 'usdt_wallet' ? 'USDT Wallet' : method.bank_name}
                              </p>
                              <p className="font-['Inter',sans-serif] text-white/60 text-xs">
                                {method.method_type === 'usdt_wallet'
                                  ? `${method.wallet_address?.slice(0, 8)}...${method.wallet_address?.slice(-6)}`
                                  : `${method.account_number?.slice(-4)}`
                                }
                              </p>
                            </div>
                          </div>
                          {method.is_default && (
                            <span className="px-2 py-1 bg-green-500/20 rounded text-green-400 text-xs">Default</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    setShowDestinationPicker(false);
                    setShowAddMethod(true);
                  }}
                  className="w-full p-3 bg-white/5 hover:bg-white/10 rounded-lg border border-white/20 border-dashed transition-all duration-200"
                >
                  <p className="font-['Inter',sans-serif] text-white/70 text-sm">+ Add New Destination</p>
                </button>

                <button
                  onClick={() => setShowDestinationPicker(false)}
                  className="w-full p-2 text-white/50 text-sm hover:text-white/70 transition-colors duration-200"
                >
                  Cancel
                </button>
              </div>
            )}

            {showAddMethod && !selectedMethodType && (
              <div className="space-y-3">
                <button
                  onClick={() => setSelectedMethodType('usdt_wallet')}
                  className="w-full p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/20 transition-all duration-200 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="text-left">
                      <p className="font-['Inter',sans-serif] text-white text-sm font-medium">USDT Wallet Address</p>
                      <p className="font-['Inter',sans-serif] text-white/60 text-xs">TRC20 Network</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedMethodType('bank_account')}
                  className="w-full p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/20 transition-all duration-200 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-green-400" />
                    </div>
                    <div className="text-left">
                      <p className="font-['Inter',sans-serif] text-white text-sm font-medium">Bank Account Details</p>
                      <p className="font-['Inter',sans-serif] text-white/60 text-xs">International Transfer</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowAddMethod(false);
                    if (savedMethods.length > 0) {
                      setShowDestinationPicker(true);
                    }
                  }}
                  className="w-full p-2 text-white/50 text-sm hover:text-white/70 transition-colors duration-200"
                >
                  Cancel
                </button>
              </div>
            )}

            {showAddMethod && selectedMethodType === 'usdt_wallet' && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={newMethod.wallet_address}
                  onChange={(e) => setNewMethod({...newMethod, wallet_address: e.target.value})}
                  placeholder="T..."
                  className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-200 text-sm"
                />
                <p className="font-['Inter',sans-serif] text-white/50 text-xs">Enter your TRC20 wallet address (34 characters, starts with T)</p>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedMethodType(null);
                      setNewMethod({...newMethod, wallet_address: ''});
                    }}
                    className="flex-1 h-10 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-['Inter',sans-serif] text-white text-sm transition-all duration-200"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSaveMethod}
                    className="flex-1 h-10 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-lg font-['Inter',sans-serif] text-white text-sm transition-all duration-200"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {showAddMethod && selectedMethodType === 'bank_account' && (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                <input
                  type="text"
                  value={newMethod.country}
                  onChange={(e) => setNewMethod({...newMethod, country: e.target.value})}
                  placeholder="Country"
                  className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all duration-200 text-sm"
                />
                <input
                  type="text"
                  value={newMethod.bank_name}
                  onChange={(e) => setNewMethod({...newMethod, bank_name: e.target.value})}
                  placeholder="Bank Name"
                  className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all duration-200 text-sm"
                />
                <input
                  type="text"
                  value={newMethod.account_number}
                  onChange={(e) => setNewMethod({...newMethod, account_number: e.target.value})}
                  placeholder="Account Number"
                  className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all duration-200 text-sm"
                />
                <input
                  type="text"
                  value={newMethod.account_holder_name}
                  onChange={(e) => setNewMethod({...newMethod, account_holder_name: e.target.value})}
                  placeholder="Account Holder Name"
                  className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all duration-200 text-sm"
                />
                <input
                  type="text"
                  value={newMethod.swift_code}
                  onChange={(e) => setNewMethod({...newMethod, swift_code: e.target.value})}
                  placeholder="SWIFT/BIC Code (Optional)"
                  className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all duration-200 text-sm"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedMethodType(null);
                      setNewMethod({
                        wallet_address: '',
                        bank_name: '',
                        account_number: '',
                        account_holder_name: '',
                        swift_code: '',
                        country: '',
                      });
                    }}
                    className="flex-1 h-10 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-['Inter',sans-serif] text-white text-sm transition-all duration-200"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSaveMethod}
                    className="flex-1 h-10 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 rounded-lg font-['Inter',sans-serif] text-white text-sm transition-all duration-200"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleWithdrawClick} className="space-y-4">
            {/* Withdrawal Amount */}
            <div>
              <label className="font-['Inter',sans-serif] font-medium text-white/80 text-sm mb-2 block">
                Withdrawal Amount (USD)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-['Inter',sans-serif] text-white/60 text-lg">
                  $
                </span>
                <input
                  type="text"
                  value={withdrawalAmount}
                  onChange={handleAmountChange}
                  disabled={!selectedMethod}
                  className="w-full h-12 pl-8 pr-20 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                  placeholder="0.00"
                />
                <button
                  type="button"
                  onClick={setMaxAmount}
                  disabled={!selectedMethod}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 rounded-lg text-green-400 text-xs font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  MAX
                </button>
              </div>
              <div className="flex justify-between mt-2">
                <p className="font-['Inter',sans-serif] text-white/50 text-xs">
                  Minimum: $10.00
                </p>
                <p className="font-['Inter',sans-serif] text-white/50 text-xs">
                  Available: {formatCurrency(currentEarnings)}
                </p>
              </div>
            </div>

            {/* Processing Info */}
            <div className="p-3 bg-blue-500/10 backdrop-blur-sm border border-blue-500/20 rounded-lg">
              <h4 className="font-['Inter',sans-serif] font-medium text-blue-400 text-sm mb-2">
                Withdrawal Information
              </h4>
              <ul className="space-y-1 text-xs text-white/70">
                <li>• Processing time: 1-3 business days</li>
                <li>• Network: USDT (TRC-20)</li>
                <li>• No withdrawal fees</li>
                <li>• Minimum withdrawal: $10.00</li>
              </ul>
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                <p className="font-['Inter',sans-serif] text-red-400 text-sm">{error}</p>
              </div>
            )}


            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-12 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !selectedMethod || !withdrawalAmount || parseFloat(withdrawalAmount) <= 0 || showAddMethod}
                className="flex-1 h-12 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200 shadow-lg shadow-green-600/25"
              >
                {isSubmitting ? 'Processing...' : 'Withdraw'}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Withdrawal Confirmation */}
      <CustomConfirmDialog
        isOpen={showConfirmWithdraw}
        title="Confirm Withdrawal?"
        message={`You are about to withdraw $${withdrawalAmount} USD to your ${selectedMethod?.method_type === 'usdt_wallet' ? 'USDT wallet' : 'bank account'}. Withdrawals typically take 1-3 business days to process. This action cannot be undone.`}
        confirmText="Withdraw"
        cancelText="Cancel"
        variant="warning"
        onConfirm={handleConfirmWithdraw}
        onCancel={() => setShowConfirmWithdraw(false)}
        isLoading={isSubmitting}
      />
    </div>
  );
};