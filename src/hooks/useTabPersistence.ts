import { useEffect, useRef } from 'react';

interface TabState {
  scrollPosition: number;
  data: any;
  timestamp: number;
}

class TabPersistenceManager {
  private states = new Map<string, TabState>();
  private maxAge = 10 * 60 * 1000;

  saveState(key: string, state: Partial<TabState>): void {
    const existing = this.states.get(key);
    this.states.set(key, {
      scrollPosition: state.scrollPosition ?? existing?.scrollPosition ?? 0,
      data: state.data ?? existing?.data ?? null,
      timestamp: Date.now(),
    });
  }

  getState(key: string): TabState | null {
    const state = this.states.get(key);
    if (!state) return null;

    if (Date.now() - state.timestamp > this.maxAge) {
      this.states.delete(key);
      return null;
    }

    return state;
  }

  clearState(key: string): void {
    this.states.delete(key);
  }

  clearAll(): void {
    this.states.clear();
  }
}

export const tabPersistenceManager = new TabPersistenceManager();

export const useTabPersistence = (tabKey: string) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    const state = tabPersistenceManager.getState(tabKey);
    if (state && containerRef.current) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = state.scrollPosition;
        }
      });
    }
  }, [tabKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      scrollPositionRef.current = container.scrollTop;
      tabPersistenceManager.saveState(tabKey, {
        scrollPosition: container.scrollTop,
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [tabKey]);

  const saveData = (data: any) => {
    tabPersistenceManager.saveState(tabKey, { data });
  };

  const getData = () => {
    const state = tabPersistenceManager.getState(tabKey);
    return state?.data ?? null;
  };

  return {
    containerRef,
    saveData,
    getData,
  };
};
