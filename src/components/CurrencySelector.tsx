import React, { useState } from 'react';
import { Globe, Check, ChevronDown, Search } from 'lucide-react';
import { Currency, getAllCurrencies, setCurrencyPreference } from '../lib/currencyDetection';
import { isAlmcConsoleApp } from '../lib/almcPayments';
import { consoleTheme } from '../console/consoleTheme';
import { cn } from '../lib/utils';

interface CurrencySelectorProps {
  selectedCurrency: Currency;
  onCurrencyChange: (_currency: Currency) => void;
  detectedCountry?: string;
  isDetected?: boolean;
  theme?: 'consumer' | 'almc';
}

export const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  selectedCurrency,
  onCurrencyChange,
  detectedCountry,
  isDetected = false,
  theme = 'consumer',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const currencies = getAllCurrencies();
  const isAlmc = theme === 'almc' || isAlmcConsoleApp();

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
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex w-full items-center justify-between rounded-xl border px-4 py-3 transition-all duration-200',
          isAlmc
            ? 'border-border bg-background text-foreground hover:bg-muted'
            : 'border-white/20 bg-white/10 text-white backdrop-blur-sm hover:bg-white/15'
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              isAlmc ? consoleTheme.iconWell : 'bg-gradient-to-r from-blue-600 to-cyan-600'
            )}
          >
            <Globe className={cn('h-4 w-4', isAlmc ? 'text-[var(--almc-lime-deep)]' : 'text-white')} />
          </div>
          <div className="min-w-0 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "font-['Inter',sans-serif] text-sm font-medium",
                  isAlmc ? 'text-foreground' : 'text-white'
                )}
              >
                {selectedCurrency.symbol} {selectedCurrency.code}
              </span>
              {isDetected && detectedCountry ? (
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs',
                    isAlmc
                      ? 'border-[var(--almc-lime)]/40 bg-[var(--almc-lime)]/15 text-[var(--almc-lime-deep)]'
                      : 'border-green-500/30 bg-green-600/20 text-green-400'
                  )}
                >
                  Detected
                </span>
              ) : null}
            </div>
            <p
              className={cn(
                "break-words font-['Inter',sans-serif] text-xs",
                isAlmc ? 'text-muted-foreground' : 'text-white/60'
              )}
            >
              {selectedCurrency.name}
              {isDetected && detectedCountry ? ` - ${detectedCountry}` : ''}
            </p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 transition-transform duration-200',
            isAlmc ? 'text-muted-foreground' : 'text-white/60',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen ? (
        <div
          className={cn(
            'absolute left-0 right-0 top-full z-50 mt-2 flex max-h-96 flex-col overflow-hidden rounded-xl border shadow-2xl',
            isAlmc
              ? 'border-border bg-card text-card-foreground'
              : 'border-white/20 bg-gray-900/95 text-white backdrop-blur-xl'
          )}
        >
          <div className={cn('border-b p-3', isAlmc ? 'border-border' : 'border-white/10')}>
            <div className="relative">
              <Search
                className={cn(
                  'absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2',
                  isAlmc ? 'text-muted-foreground' : 'text-white/60'
                )}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search currency..."
                className={cn(
                  'h-10 w-full rounded-lg border pl-10 pr-4 text-sm focus:outline-none focus:ring-2',
                  isAlmc
                    ? 'border-border bg-background text-foreground placeholder:text-muted-foreground focus:ring-[var(--almc-lime)]/30'
                    : 'border-white/20 bg-white/10 text-white placeholder-white/60 focus:border-blue-500/50 focus:ring-blue-500/50'
                )}
                autoFocus
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredCurrencies.length > 0 ? (
              filteredCurrencies.map((currency) => (
                <button
                  key={currency.code}
                  type="button"
                  onClick={() => handleCurrencySelect(currency)}
                  className={cn(
                    'flex w-full items-center justify-between px-4 py-3 text-left transition-all duration-150',
                    isAlmc
                      ? selectedCurrency.code === currency.code
                        ? 'bg-[var(--almc-lime)]/10'
                        : 'hover:bg-muted'
                      : selectedCurrency.code === currency.code
                        ? 'bg-white/5 hover:bg-white/10'
                        : 'hover:bg-white/10'
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-['Inter',sans-serif] text-sm font-medium",
                          isAlmc ? 'text-foreground' : 'text-white'
                        )}
                      >
                        {currency.symbol} {currency.code}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "font-['Inter',sans-serif] text-xs",
                        isAlmc ? 'text-muted-foreground' : 'text-white/60'
                      )}
                    >
                      {currency.name}
                    </p>
                  </div>
                  {selectedCurrency.code === currency.code ? (
                    <Check
                      className={cn(
                        'h-5 w-5 shrink-0',
                        isAlmc ? 'text-[var(--almc-lime-deep)]' : 'text-green-400'
                      )}
                    />
                  ) : null}
                </button>
              ))
            ) : (
              <div className="p-4 text-center">
                <p
                  className={cn(
                    "font-['Inter',sans-serif] text-sm",
                    isAlmc ? 'text-muted-foreground' : 'text-white/60'
                  )}
                >
                  No currencies found
                </p>
              </div>
            )}
          </div>

          <div
            className={cn(
              'border-t p-3',
              isAlmc ? 'border-border bg-muted/50' : 'border-white/10 bg-blue-500/10'
            )}
          >
            <p
              className={cn(
                "text-center font-['Inter',sans-serif] text-xs",
                isAlmc ? 'text-muted-foreground' : 'text-white/70'
              )}
            >
              Currency rates are approximate and may vary
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
};
