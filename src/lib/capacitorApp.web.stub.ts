const noopAsync = async () => undefined;
const noopListener = async () => ({ remove: noopAsync });

export const App = {
  addListener: noopListener,
  removeAllListeners: noopAsync,
};
