import React, { useState } from 'react';
import { Globe, Check, ChevronDown, Search } from 'lucide-react';
import { Currency, getAllCurrencies, setCurrencyPreference } from '../lib/currencyDetection';

interface CurrencySelectorProps {
  selectedCurrency: Currency;
  onCurrencyChange: (_currency: Currency) => void;
  detectedCountry?: string;
  isDetected?: boolean;
}

export const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  selectedCurrency,
  onCurrencyChange,
  detectedCountry,
  isDetected = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const currencies = getAllCurrencies();

  const filteredCurrencies = currencies.filter(currency =>
    currency.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    currency.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCurrencySelect = (selectedCurrency: Currency) => {
    onCurrencyChange(selectedCurrency);
    setCurrencyPreference(selectedCurrency.code);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative">
      {/* Currency Display Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white hover:bg-white/15 transition-all duration-200 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-full flex items-center justify-center">
            <Globe className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-['Inter',sans-serif] font-medium text-white text-sm">
                {selectedCurrency.symbol} {selectedCurrency.code}
              </span>
              {isDetected && detectedCountry && (
                <span className="px-2 py-0.5 bg-green-600/20 border border-green-500/30 rounded-full text-green-400 text-xs">
                  Detected
                </span>
              )}
            </div>
            <p className="font-['Inter',sans-serif] text-white/60 text-xs">
              {selectedCurrency.name}
              {isDetected && detectedCountry && ` - ${detectedCountry}`}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-5 h-5 text-white/60 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl z-50 max-h-96 overflow-hidden flex flex-col">
          {/* Search Box */}
          <div className="p-3 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/60" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search currency..."
                className="w-full h-10 pl-10 pr-4 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/60 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                autoFocus
              />
            </div>
          </div>

          {/* Currency List */}
          <div className="overflow-y-auto flex-1">
            {filteredCurrencies.length > 0 ? (
              filteredCurrencies.map((currency) => (
                <button
                  key={currency.code}
                  onClick={() => handleCurrencySelect(currency)}
                  className={`w-full px-4 py-3 text-left hover:bg-white/10 transition-all duration-150 flex items-center justify-between ${
                    selectedCurrency.code === currency.code ? 'bg-white/5' : ''
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-['Inter',sans-serif] font-medium text-white text-sm">
                        {currency.symbol} {currency.code}
                      </span>
                    </div>
                    <p className="font-['Inter',sans-serif] text-white/60 text-xs">
                      {currency.name}
                    </p>
                  </div>
                  {selectedCurrency.code === currency.code && (
                    <Check className="w-5 h-5 text-green-400" />
                  )}
                </button>
              ))
            ) : (
              <div className="p-4 text-center">
                <p className="font-['Inter',sans-serif] text-white/60 text-sm">
                  No currencies found
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-white/10 bg-blue-500/10">
            <p className="font-['Inter',sans-serif] text-white/70 text-xs text-center">
              Currency rates are approximate and may vary
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
