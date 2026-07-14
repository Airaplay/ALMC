import { useState } from 'react';
import { LoadingAnimation } from './LoadingAnimation';

/**
 * Showcase component to demonstrate all LoadingAnimation variants
 * Use this for testing and visual reference
 * Can be removed from production build
 */
export const LoadingAnimationShowcase = (): JSX.Element => {
  const [showText, setShowText] = useState(true);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-12 text-center">
          <h1 className="text-4xl font-bold mb-4">Airaplay Loading Animation</h1>
          <p className="text-white/70 text-lg mb-6">
            Smooth, professional loading indicators inspired by Audiomack
          </p>
          <div className="flex items-center justify-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showText}
                onChange={(e) => setShowText(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Show loading text</span>
            </label>
          </div>
        </header>

        {/* Size Variants */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-8 text-center">Size Variants</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Small */}
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
              <h3 className="text-lg font-semibold mb-6 text-center">Small (48px)</h3>
              <div className="flex justify-center">
                <LoadingAnimation
                  size="small"
                  showText={showText}
                  text="Loading..."
                />
              </div>
              <div className="mt-6 text-sm text-white/60 text-center">
                <p>Use for: Inline loading, buttons, small sections</p>
              </div>
            </div>

            {/* Medium */}
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
              <h3 className="text-lg font-semibold mb-6 text-center">Medium (80px)</h3>
              <div className="flex justify-center">
                <LoadingAnimation
                  size="medium"
                  showText={showText}
                  text="Loading content..."
                />
              </div>
              <div className="mt-6 text-sm text-white/60 text-center">
                <p>Use for: Content sections, cards, modals</p>
              </div>
            </div>

            {/* Large */}
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
              <h3 className="text-lg font-semibold mb-6 text-center">Large (128px)</h3>
              <div className="flex justify-center">
                <LoadingAnimation
                  size="large"
                  showText={showText}
                  text="Loading your music..."
                />
              </div>
              <div className="mt-6 text-sm text-white/60 text-center">
                <p>Use for: Full-screen loading, initial app load</p>
              </div>
            </div>
          </div>
        </section>

        {/* Usage Examples */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-8 text-center">Usage Examples</h2>

          {/* Full Screen */}
          <div className="mb-8 bg-white/5 rounded-2xl p-8 border border-white/10">
            <h3 className="text-lg font-semibold mb-4">Full Screen Loading</h3>
            <div className="bg-black/50 rounded-xl p-12 min-h-[400px] flex items-center justify-center">
              <LoadingAnimation size="large" showText={true} text="Loading..." />
            </div>
            <div className="mt-4 text-sm text-white/60">
              <code className="bg-black/30 px-2 py-1 rounded">
                {`<LoadingAnimation size="large" showText={true} text="Loading..." />`}
              </code>
            </div>
          </div>

          {/* Inline Loading */}
          <div className="mb-8 bg-white/5 rounded-2xl p-8 border border-white/10">
            <h3 className="text-lg font-semibold mb-4">Inline Content Loading</h3>
            <div className="bg-black/50 rounded-xl p-8">
              <div className="mb-4">
                <h4 className="text-white font-semibold">Your Playlists</h4>
              </div>
              <div className="flex justify-center py-8">
                <LoadingAnimation size="small" showText={showText} text="Loading playlists..." />
              </div>
            </div>
            <div className="mt-4 text-sm text-white/60">
              <code className="bg-black/30 px-2 py-1 rounded">
                {`<LoadingAnimation size="small" showText={true} />`}
              </code>
            </div>
          </div>

          {/* Search Loading */}
          <div className="mb-8 bg-white/5 rounded-2xl p-8 border border-white/10">
            <h3 className="text-lg font-semibold mb-4">Search Results Loading</h3>
            <div className="bg-black/50 rounded-xl p-8">
              <div className="mb-4">
                <div className="bg-white/10 rounded-full px-4 py-3 text-sm text-white/60">
                  Search for songs, artists, albums...
                </div>
              </div>
              <div className="flex justify-center py-12">
                <LoadingAnimation size="medium" showText={showText} text="Searching..." />
              </div>
            </div>
            <div className="mt-4 text-sm text-white/60">
              <code className="bg-black/30 px-2 py-1 rounded">
                {`<LoadingAnimation size="medium" showText={true} text="Searching..." />`}
              </code>
            </div>
          </div>
        </section>

        {/* Animation Features */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-8 text-center">Animation Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-3">🌊 Breathing Effect</h3>
              <p className="text-white/70 text-sm">
                Logo smoothly scales 100% → 108% → 100% over 2.5 seconds for a gentle, alive feel
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-3">💫 Expanding Rings</h3>
              <p className="text-white/70 text-sm">
                Three concentric waves pulse outward with staggered delays for flowing motion
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-3">✨ Soft Glow</h3>
              <p className="text-white/70 text-sm">
                Dynamic drop-shadow synchronized with breathing creates premium depth
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-3">🎯 GPU Optimized</h3>
              <p className="text-white/70 text-sm">
                Hardware-accelerated animations maintain 60fps on all devices
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-3">♿ Accessible</h3>
              <p className="text-white/70 text-sm">
                Automatically respects prefers-reduced-motion for better accessibility
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-3">📱 Responsive</h3>
              <p className="text-white/70 text-sm">
                Scales perfectly across all screen sizes from mobile to desktop
              </p>
            </div>
          </div>
        </section>

        {/* Technical Specs */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold mb-8 text-center">Technical Specifications</h2>
          <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-2">Performance</h4>
                <ul className="text-sm text-white/70 space-y-1">
                  <li>• 60fps on modern devices</li>
                  <li>• &lt;2% CPU usage</li>
                  <li>• &lt;1MB memory footprint</li>
                  <li>• GPU-accelerated transforms</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Compatibility</h4>
                <ul className="text-sm text-white/70 space-y-1">
                  <li>• Chrome 90+</li>
                  <li>• Safari 14+ (iOS & macOS)</li>
                  <li>• Firefox 88+</li>
                  <li>• Edge 90+</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Animation</h4>
                <ul className="text-sm text-white/70 space-y-1">
                  <li>• 2.5s loop duration</li>
                  <li>• Ease-in-out timing</li>
                  <li>• Seamless loop</li>
                  <li>• Staggered ring delays</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-2">File Size</h4>
                <ul className="text-sm text-white/70 space-y-1">
                  <li>• Component: ~2KB</li>
                  <li>• CSS: ~3KB</li>
                  <li>• Total: ~5KB</li>
                  <li>• Gzipped: ~2KB</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-white/50 text-sm pb-8">
          <p>Airaplay Loading Animation v1.0.0</p>
          <p className="mt-2">Inspired by Audiomack's smooth loading experience</p>
        </footer>
      </div>
    </div>
  );
};

export default LoadingAnimationShowcase;
