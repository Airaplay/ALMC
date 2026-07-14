/**
 * React Hook for Contribution Rewards System
 *
 * Provides easy access to contribution tracking and rewards
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getUserContributionScore,
  getUserContributions,
  getTopContributors,
  getCurrentRewardsBudget,
  getUserRewardHistory,
  subscribeToContributionScore,
  type ContributionScore,
  type ListenerContribution,
  type TopContributor,
  type RewardsBudget
} from '../lib/contributionService';

export function useContributionScore(userId: string | undefined) {
  const [score, setScore] = useState<ContributionScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setScore(null);
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;

    const loadScore = async () => {
      setLoading(true);
      const data = await getUserContributionScore(userId);
      setScore(data);
      setLoading(false);

      // Subscribe to real-time updates
      unsubscribe = subscribeToContributionScore(userId, (newScore) => {
        setScore(newScore);
      });
    };

    loadScore();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [userId]);

  return { score, loading };
}

export function useUserContributions(userId: string | undefined, limit: number = 20) {
  const [contributions, setContributions] = useState<ListenerContribution[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setContributions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const data = await getUserContributions(userId, limit);
    setContributions(data);
    setLoading(false);
  }, [userId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { contributions, loading, refresh };
}

export function useTopContributors(limit: number = 10) {
  const [contributors, setContributors] = useState<TopContributor[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await getTopContributors(limit);
    setContributors(data);
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { contributors, loading, refresh };
}

export function useRewardsBudget() {
  const [budget, setBudget] = useState<RewardsBudget | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadBudget = async () => {
      setLoading(true);
      const data = await getCurrentRewardsBudget();
      setBudget(data);
      setLoading(false);
    };

    loadBudget();
  }, []);

  return { budget, loading };
}

export function useRewardHistory(userId: string | undefined, limit: number = 10) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setHistory([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const data = await getUserRewardHistory(userId, limit);
    setHistory(data);
    setLoading(false);
  }, [userId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { history, loading, refresh };
}
