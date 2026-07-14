declare const __APP_TARGET__: string;

export const BUILD_TARGET = typeof __APP_TARGET__ !== 'undefined' ? __APP_TARGET__ : 'app';

export const isWebTarget = () => BUILD_TARGET === 'web';
export const isAppTarget = () => BUILD_TARGET === 'app';

export const throwIfWrongTarget = (expectedTarget: 'web' | 'app') => {
  if (BUILD_TARGET !== expectedTarget) {
    throw new Error(
      `This build is for ${BUILD_TARGET} but you're trying to use web-only or app-only code. ` +
      `Use "npm run build:${expectedTarget}" instead of "npm run build:${BUILD_TARGET}".`
    );
  }
};
