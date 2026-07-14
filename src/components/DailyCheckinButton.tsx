import { useState, useEffect, useCallback } from 'react';
import { Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const DailyCheckinButton = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const [hasNotification, setHasNotification] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(true);

  const checkFeatureStatus = async () => {
    try {
      const { data } = await supabase
        .from('daily_checkin_settings')
        .select('feature_enabled')
        .limit(1)
        .maybeSingle();

      setFeatureEnabled(data?.feature_enabled ?? true);
    } catch (error) {
      console.error('Error checking feature status:', error);
      setFeatureEnabled(true);
    }
  };

  const checkStreak = useCallback(async () => {
    if (!user?.id) return;

    try {
      const { data } = await supabase
        .from('user_checkin_streaks')
        .select('last_checkin_date')
        .eq('user_id', user.id)
        .maybeSingle();

      const today = new Date().toISOString().split('T')[0];
      const canCheckIn = !data || data.last_checkin_date !== today;
      setHasNotification(canCheckIn);
    } catch (error) {
      console.error('[DailyCheckinButton] Error checking streak:', error);
    }
  }, [user]);

  useEffect(() => {
    checkFeatureStatus();
  }, []);

  useEffect(() => {
    if (isInitialized && isAuthenticated && user) {
      checkStreak();
    } else {
      setHasNotification(false);
    }
  }, [isAuthenticated, user, isInitialized, checkStreak]);

  if (!isAuthenticated || !featureEnabled) {
    return null;
  }

  return (
    <button
      onClick={() => navigate('/daily-checkin')}
      className="relative flex items-center gap-1.5 px-2 py-1.5 bg-gradient-to-r from-[#309605]/20 to-[#3ba208]/20 backdrop-blur-sm border border-[#309605]/30 rounded-full hover:from-[#309605]/30 hover:to-[#3ba208]/30 transition-all duration-200"
    >
      {hasNotification && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full border border-[#1a1a1a] animate-pulse" />
      )}
      <div className="w-5 h-5 bg-gradient-to-r from-[#309605] to-[#3ba208] rounded-full flex items-center justify-center">
        <Calendar className="w-2.5 h-2.5 text-white" />
      </div>
      <span className="font-['Inter',sans-serif] font-regular text-[#309605] text-xs">
        Check-in
      </span>
    </button>
  );
};
