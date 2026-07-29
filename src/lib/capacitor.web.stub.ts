const noopAsync = async () => undefined;
const noopListener = async () => ({ remove: noopAsync });

export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
};

export function registerPlugin(_name: string, _opts?: unknown): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'then') return undefined;
        if (prop === 'addListener') return noopListener;
        if (prop === 'removeAllListeners') return noopAsync;
        return noopAsync;
      },
    }
  );
}

export class WebPlugin {}
