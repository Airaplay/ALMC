const noopAsync = async () => undefined;

export const AdMob = new Proxy(
  {},
  {
    get: () => noopAsync,
  }
);

export const BannerAdSize = {
  BANNER: 'BANNER',
  ADAPTIVE_BANNER: 'ADAPTIVE_BANNER',
};

export const BannerAdPosition = {
  TOP_CENTER: 'TOP_CENTER',
  BOTTOM_CENTER: 'BOTTOM_CENTER',
};

export const BannerAdPluginEvents = {};
export const RewardAdPluginEvents = {};
export const RewardInterstitialAdPluginEvents = {};
export const InterstitialAdPluginEvents = {};

export type AdMobRewardItem = { type: string; amount: number };
export type AdMobRewardInterstitialItem = { type: string; amount: number };
