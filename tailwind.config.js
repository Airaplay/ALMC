module.exports = {
  content: [
    "./src/**/*.{html,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // Premium loading animations
        "loading-premium": {
          "0%, 100%": {
            transform: "scale(1) rotate(0deg)",
            opacity: "1",
          },
          "25%": {
            transform: "scale(1.15) rotate(5deg)",
            opacity: "0.9",
          },
          "50%": {
            transform: "scale(1.2) rotate(0deg)",
            opacity: "0.95",
          },
          "75%": {
            transform: "scale(1.15) rotate(-5deg)",
            opacity: "0.9",
          },
        },
        "loading-pulse": {
          "0%, 100%": {
            transform: "scale(1)",
            opacity: "1",
          },
          "50%": {
            transform: "scale(1.05)",
            opacity: "0.9",
          },
        },
        "loading-wave": {
          "0%, 100%": {
            transform: "scale(1) rotate(0deg)",
            opacity: "1",
          },
          "50%": {
            transform: "scale(1.1) rotate(0deg)",
            opacity: "0.85",
          },
        },
        "loading-spin": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "loading-breathe": {
          "0%, 100%": {
            transform: "scale(1)",
            opacity: "1",
          },
          "50%": {
            transform: "scale(1.08)",
            opacity: "0.8",
          },
        },
        "loading-rotate": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "loading-rotate-reverse": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(-360deg)" },
        },
        "loading-glow-1": {
          "0%, 100%": {
            opacity: "0.1",
            transform: "scale(1)",
          },
          "50%": {
            opacity: "0.3",
            transform: "scale(1.2)",
          },
        },
        "loading-glow-2": {
          "0%, 100%": {
            opacity: "0.2",
            transform: "scale(1)",
          },
          "50%": {
            opacity: "0.4",
            transform: "scale(1.3)",
          },
        },
        "loading-wave-ring-1": {
          "0%": {
            transform: "scale(1)",
            opacity: "0.6",
          },
          "100%": {
            transform: "scale(2)",
            opacity: "0",
          },
        },
        "loading-wave-ring-2": {
          "0%": {
            transform: "scale(1)",
            opacity: "0.4",
          },
          "100%": {
            transform: "scale(2.2)",
            opacity: "0",
          },
        },
        "loading-wave-ring-3": {
          "0%": {
            transform: "scale(1)",
            opacity: "0.2",
          },
          "100%": {
            transform: "scale(2.4)",
            opacity: "0",
          },
        },
        "loading-particle-1": {
          "0%, 100%": {
            transform: "translate(-50%, 0) scale(1)",
            opacity: "0.8",
          },
          "50%": {
            transform: "translate(-50%, -20px) scale(1.5)",
            opacity: "0.3",
          },
        },
        "loading-particle-2": {
          "0%, 100%": {
            transform: "translate(0, -50%) scale(1)",
            opacity: "0.6",
          },
          "50%": {
            transform: "translate(20px, -50%) scale(1.8)",
            opacity: "0.2",
          },
        },
        "loading-particle-3": {
          "0%, 100%": {
            transform: "translate(0, 50%) scale(1)",
            opacity: "0.7",
          },
          "50%": {
            transform: "translate(-20px, 50%) scale(1.6)",
            opacity: "0.2",
          },
        },
        "loading-particle-4": {
          "0%, 100%": {
            transform: "translate(0, 0) scale(1)",
            opacity: "0.5",
          },
          "50%": {
            transform: "translate(10px, 15px) scale(2)",
            opacity: "0.1",
          },
        },
        "loading-burst": {
          "0%, 100%": {
            transform: "scale(1)",
            opacity: "0.3",
          },
          "50%": {
            transform: "scale(1.5)",
            opacity: "0.1",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        // Premium loading animations
        "loading-premium": "loading-premium 3s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite",
        "loading-pulse": "loading-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "loading-wave": "loading-wave 2.5s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite",
        "loading-spin": "loading-spin 1.5s linear infinite",
        "loading-breathe": "loading-breathe 3s ease-in-out infinite",
        "loading-rotate": "loading-rotate 3s linear infinite",
        "loading-rotate-reverse": "loading-rotate-reverse 4s linear infinite",
        "loading-glow-1": "loading-glow-1 2s ease-in-out infinite",
        "loading-glow-2": "loading-glow-2 2.5s ease-in-out infinite",
        "loading-wave-ring-1": "loading-wave-ring-1 2s cubic-bezier(0, 0, 0.2, 1) infinite",
        "loading-wave-ring-2": "loading-wave-ring-2 2s cubic-bezier(0, 0, 0.2, 1) 0.4s infinite",
        "loading-wave-ring-3": "loading-wave-ring-3 2s cubic-bezier(0, 0, 0.2, 1) 0.8s infinite",
        "loading-particle-1": "loading-particle-1 2s ease-in-out infinite",
        "loading-particle-2": "loading-particle-2 2.5s ease-in-out infinite",
        "loading-particle-3": "loading-particle-3 2.2s ease-in-out infinite",
        "loading-particle-4": "loading-particle-4 2.8s ease-in-out infinite",
        "loading-burst": "loading-burst 2s ease-in-out infinite",
      },
      spacing: {
        'safe': 'env(safe-area-inset-bottom)',
      },
    },
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
  },
  plugins: [],
  darkMode: ["class"],
};
