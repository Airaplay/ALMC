import { useState, useEffect } from 'react';
import { X, Gift, Calendar, Sparkles, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface CheckinConfig {
  day_number: number;
  treat_reward: number;
  is_bonus_day: boolean;
  ad_enabled: boolean;
}

interface UserStreak {
  current_streak: number;
  last_checkin_date: string | null;
  total_checkins: number;
}

export const DailyCheckinScreen = () => {
  const navigate = useNavigate();
  const [checkinConfig, setCheckinConfig] = useState<CheckinConfig[]>([]);
  const [userStreak, setUserStreak] = useState<UserStreak>({
    current_streak: 0,
    last_checkin_date: null,
    total_checkins: 0
  });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [canCheckInToday, setCanCheckInToday] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/');
        return;
      }

      const [configResult, streakResult] = await Promise.all([
        supabase
          .from('daily_checkin_config')
          .select('*')
          .order('day_number'),
        supabase
          .from('user_checkin_streaks')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle()
      ]);

      if (configResult.data) {
        setCheckinConfig(configResult.data);
      }

      if (streakResult.data) {
        setUserStreak(streakResult.data);
        setCanCheckInToday(checkIfCanCheckIn(streakResult.data.last_checkin_date));
      } else {
        await supabase
          .from('user_checkin_streaks')
          .insert({
            user_id: user.id,
            current_streak: 0,
            total_checkins: 0
          });
        setCanCheckInToday(true);
      }
    } catch (error) {
      console.error('Error loading check-in data:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkIfCanCheckIn = (lastCheckinDate: string | null): boolean => {
    if (!lastCheckinDate) return true;

    const today = new Date().toISOString().split('T')[0];
    return lastCheckinDate !== today;
  };

  const getTodayDayNumber = (): number => {
    if (!canCheckInToday) return -1;

    if (userStreak.last_checkin_date) {
      const lastDate = new Date(userStreak.last_checkin_date);
      const today = new Date();
      const dayDiff = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

      if (dayDiff === 1) {
        return (userStreak.current_streak % 7) + 1;
      } else if (dayDiff > 1) {
        return 1;
      }
    }

    return 1;
  };

  const handleDayClick = async (dayNumber: number) => {
    if (processing) return;

    const todayDay = getTodayDayNumber();
    if (dayNumber !== todayDay || !canCheckInToday) {
      return;
    }

    const dayConfig = checkinConfig.find(c => c.day_number === dayNumber);
    if (!dayConfig) {
      alert('Error: Could not find reward configuration for this day.');
      return;
    }

    setSelectedDay(dayNumber);

    if (dayConfig.ad_enabled) {
      setShowAdModal(true);
    } else {
      // Set processing immediately to prevent double-clicks
      setProcessing(true);
      await processCheckin(dayNumber, dayConfig.treat_reward);
    }
  };

  const handleAdComplete = async () => {
    if (processing || !selectedDay) return;

    // Set processing immediately to prevent double-clicks
    setProcessing(true);

    const dayConfig = checkinConfig.find(c => c.day_number === selectedDay);
    if (!dayConfig) {
      alert('Error: Could not find reward configuration. Please try again.');
      setShowAdModal(false);
      setSelectedDay(null);
      setProcessing(false);
      return;
    }

    setShowAdModal(false);
    await processCheckin(selectedDay, dayConfig.treat_reward);
  };

  const processCheckin = async (dayNumber: number, rewardAmount: number) => {
    try {
      // Processing flag is already set by caller (handleDayClick or handleAdComplete)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = new Date().toISOString().split('T')[0];

      // Check if user already checked in today
      const { data: existingCheckin } = await supabase
        .from('daily_checkin_history')
        .select('id')
        .eq('user_id', user.id)
        .eq('checkin_date', today)
        .maybeSingle();

      if (existingCheckin) {
        alert('You have already checked in today! Come back tomorrow.');
        await loadData();
        return;
      }

      const lastDate = userStreak.last_checkin_date
        ? new Date(userStreak.last_checkin_date)
        : null;
      const todayDate = new Date();
      const dayDiff = lastDate
        ? Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      let newStreak = 1;
      if (lastDate && dayDiff === 1) {
        newStreak = userStreak.current_streak + 1;
      }

      // Update streak first
      const streakUpdate = await supabase
        .from('user_checkin_streaks')
        .update({
          current_streak: newStreak,
          last_checkin_date: today,
          total_checkins: userStreak.total_checkins + 1
        })
        .eq('user_id', user.id);

      if (streakUpdate.error) {
        console.error('Streak update error:', streakUpdate.error);
        throw streakUpdate.error;
      }

      // Insert check-in history
      const historyInsert = await supabase
        .from('daily_checkin_history')
        .insert({
          user_id: user.id,
          checkin_date: today,
          day_number: dayNumber,
          treat_reward: rewardAmount,
          streak_count: newStreak
        });

      if (historyInsert.error) {
        console.error('History insert error:', historyInsert.error);
        throw historyInsert.error;
      }

      // Add treat balance
      const walletUpdate = await supabase.rpc('add_treat_balance', {
        p_user_id: user.id,
        p_amount: rewardAmount,
        p_transaction_type: 'daily_checkin',
        p_description: `Daily Check-in Reward - Day ${dayNumber}`
        // p_reference_id is optional and defaults to NULL, so we omit it
      });

      if (walletUpdate.error) {
        console.error('Wallet update error:', walletUpdate.error);
        console.error('Wallet update error details:', {
          message: walletUpdate.error.message,
          details: walletUpdate.error.details,
          hint: walletUpdate.error.hint,
          code: walletUpdate.error.code
        });
        throw walletUpdate.error;
      }

      showSuccessToast(rewardAmount);
      
      // Update local state immediately for better UX
      setUserStreak(prev => ({
        ...prev,
        current_streak: newStreak,
        last_checkin_date: today,
        total_checkins: prev.total_checkins + 1
      }));
      setCanCheckInToday(false);
      
      // Reload data to ensure consistency
      await loadData();
    } catch (error: any) {
      console.error('Error processing check-in:', error);
      console.error('Error details:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code
      });
      
      // Show user-friendly error message
      const errorMessage = error?.message || error?.details || 'Unknown error occurred';
      alert(`Failed to process check-in: ${errorMessage}\n\nPlease try again or contact support if the problem persists.`);
      
      // Reload data to reset state
      await loadData();
    } finally {
      setProcessing(false);
      setSelectedDay(null);
    }
  };

  const showSuccessToast = (amount: number) => {
    const toast = document.createElement('div');
    toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-gradient-to-r from-green-600 to-green-500 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-2 animate-slide-down';
    
    // Create SVG icon safely
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'w-5 h-5');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', 'M5 13l4 4L19 7');
    svg.appendChild(path);
    
    // Create text span safely
    const span = document.createElement('span');
    span.className = 'font-semibold';
    span.textContent = `You earned +${amount} Treats for checking in today!`;
    
    toast.appendChild(svg);
    toast.appendChild(span);
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 3000);
  };

  const getDayStatus = (dayNumber: number): 'completed' | 'today' | 'upcoming' | 'locked' => {
    const todayDay = getTodayDayNumber();

    if (!canCheckInToday && dayNumber === userStreak.current_streak) {
      return 'completed';
    }

    if (dayNumber < todayDay) {
      return 'completed';
    }

    if (dayNumber === todayDay && canCheckInToday) {
      return 'today';
    }

    if (dayNumber === todayDay + 1 || (todayDay === 7 && dayNumber === 1)) {
      return 'upcoming';
    }

    return 'locked';
  };

  const formatDate = (dayNumber: number): string => {
    const today = new Date();
    const targetDate = new Date(today);
    const todayDay = getTodayDayNumber();

    if (todayDay > 0) {
      targetDate.setDate(today.getDate() + (dayNumber - todayDay));
    }

    const day = targetDate.getDate();
    const monthShort = targetDate.toLocaleDateString('en-US', { month: 'short' });

    return `${day} ${monthShort}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#309605]"></div>
      </div>
    );
  }

  const todayDay = getTodayDayNumber();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] content-with-nav overflow-y-auto">
      <div className="max-w-[390px] mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-full bg-white/5 backdrop-blur-sm flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-2xl font-bold text-white">Daily Check-in</h1>
          <div className="w-10" />
        </div>

        <div className="bg-gradient-to-br from-[#309605]/20 to-[#3ba208]/20 border border-[#309605]/30 rounded-2xl p-6 mb-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-white/60 text-sm mb-1">Current Streak</p>
              <p className="text-3xl font-bold text-white">{userStreak.current_streak} {userStreak.current_streak === 1 ? 'Day' : 'Days'}</p>
            </div>
            <div className="w-16 h-16 bg-gradient-to-br from-[#309605] to-[#3ba208] rounded-full flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-4 text-white/80 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>Total: {userStreak.total_checkins}</span>
            </div>
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Gift className="w-5 h-5 text-[#309605]" />
            7-Day Rewards
          </h2>

          <div className="grid grid-cols-3 gap-3 mb-4">
            {checkinConfig.slice(0, 6).map((config) => {
              const status = getDayStatus(config.day_number);
              return (
                <button
                  key={config.day_number}
                  onClick={() => handleDayClick(config.day_number)}
                  disabled={status !== 'today' || processing}
                  className={`relative aspect-square rounded-2xl p-3 flex flex-col items-center justify-center transition-all ${
                    status === 'completed'
                      ? 'bg-gradient-to-br from-[#309605] to-[#3ba208] border-2 border-[#309605]'
                      : status === 'today'
                      ? 'bg-gradient-to-br from-yellow-600 to-orange-600 border-2 border-yellow-500 animate-pulse'
                      : status === 'upcoming'
                      ? 'bg-white/10 border-2 border-white/20'
                      : 'bg-white/5 border-2 border-white/10 opacity-50'
                  } ${status === 'today' && !processing ? 'hover:scale-105 cursor-pointer' : ''}`}
                >
                  {status === 'completed' && (
                    <CheckCircle2 className="absolute top-2 right-2 w-4 h-4 text-white" />
                  )}
                  <p className="text-white/60 text-xs mb-1">{formatDate(config.day_number)}</p>
                  <p className={`text-lg font-bold mb-1 ${
                    status === 'today' ? 'text-white' : status === 'completed' ? 'text-white' : 'text-white/40'
                  }`}>
                    +{config.treat_reward}
                  </p>
                  <p className="text-white/60 text-xs">Day {config.day_number}</p>
                </button>
              );
            })}
          </div>

          {checkinConfig[6] && (
            <button
              onClick={() => handleDayClick(7)}
              disabled={getDayStatus(7) !== 'today' || processing}
              className={`w-full aspect-[3/1] rounded-2xl p-4 flex items-center justify-between transition-all relative overflow-hidden ${
                getDayStatus(7) === 'completed'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 border-2 border-purple-500'
                  : getDayStatus(7) === 'today'
                  ? 'bg-gradient-to-r from-yellow-600 to-orange-600 border-2 border-yellow-500 animate-pulse'
                  : 'bg-white/10 border-2 border-white/20 opacity-50'
              } ${getDayStatus(7) === 'today' && !processing ? 'hover:scale-105 cursor-pointer' : ''}`}
            >
              {getDayStatus(7) === 'completed' && (
                <CheckCircle2 className="absolute top-3 right-3 w-5 h-5 text-white" />
              )}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                  <Gift className="w-6 h-6 text-white" />
                </div>
                <div className="text-left">
                  <p className="text-white/80 text-sm">Day 7 - Bonus</p>
                  <p className="text-xl font-bold text-white">+{checkinConfig[6].treat_reward} Treats</p>
                </div>
              </div>
              <div className="text-white text-sm font-semibold">Extra Gifts!</div>
            </button>
          )}

          {!canCheckInToday && (
            <div className="mt-4 bg-blue-600/20 border border-blue-500/30 rounded-xl p-4">
              <p className="text-blue-400 text-sm text-center">
                You've already checked in today! Come back tomorrow for your next reward.
              </p>
            </div>
          )}

          {canCheckInToday && todayDay > 0 && (
            <div className="mt-4 bg-green-600/20 border border-green-500/30 rounded-xl p-4">
              <p className="text-green-400 text-sm text-center font-medium">
                Tap Day {todayDay} to check in and earn your reward!
              </p>
            </div>
          )}
        </div>
      </div>

      {showAdModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] rounded-2xl p-6 max-w-sm w-full border border-white/10">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-yellow-600 to-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Watch Ad to Claim Reward</h3>
              <p className="text-white/60 text-sm">
                Watch a short ad to earn your daily check-in reward
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-8 mb-6 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-pulse text-white/40 mb-2">Ad will play here</div>
                <div className="text-xs text-white/40">Simulated for demo</div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (processing) return;
                  setShowAdModal(false);
                  setSelectedDay(null);
                }}
                disabled={processing}
                className="flex-1 py-3 rounded-xl bg-white/5 text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAdComplete();
                }}
                disabled={processing || !selectedDay}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#309605] to-[#3ba208] text-white font-semibold hover:from-[#3ba208] hover:to-[#3ba208] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processing ? 'Processing...' : 'Claim Reward'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
