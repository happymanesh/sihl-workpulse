import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * workPulse design tokens.
 *
 * Every colour here resolves through a CSS variable defined in app/globals.css
 * rather than being a literal. Two reasons:
 *
 *  1. Theming. Light and dark are the same class names with different variable
 *     values, so no component ever branches on theme.
 *  2. The SIHL brand palette has not landed yet. The navy scale below is built
 *     around the placeholder #1F3A5F from the original scaffold. When the real
 *     brand arrives, it is a one-file change in globals.css - no JSX touches.
 *
 * Semantic colours (success/warning/danger/info) and priority colours are
 * deliberately separate from `primary`. Status must never be conveyed by the
 * brand hue, or a rebrand silently changes what "critical" looks like.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // ---- surfaces ----
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",

        // ---- brand ----
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        navy: {
          50: "hsl(210 40% 97%)",
          100: "hsl(213 40% 93%)",
          200: "hsl(213 38% 85%)",
          300: "hsl(214 36% 72%)",
          400: "hsl(215 38% 55%)",
          500: "hsl(215 45% 40%)",
          600: "hsl(215 51% 32%)",
          700: "hsl(215 51% 25%)", // #1F3A5F - the scaffold's placeholder brand navy
          800: "hsl(216 50% 19%)",
          900: "hsl(217 48% 13%)",
          950: "hsl(218 50% 8%)",
        },

        // ---- semantic state ----
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          subtle: "hsl(var(--success-subtle))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          subtle: "hsl(var(--warning-subtle))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
          subtle: "hsl(var(--danger-subtle))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          subtle: "hsl(var(--info-subtle))",
        },

        // ---- task priority (BRS Appendix D: Critical/Urgent/High/Medium/Low) ----
        priority: {
          critical: "hsl(var(--priority-critical))",
          urgent: "hsl(var(--priority-urgent))",
          high: "hsl(var(--priority-high))",
          medium: "hsl(var(--priority-medium))",
          low: "hsl(var(--priority-low))",
        },
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },

      fontSize: {
        // Tightened from Tailwind's defaults. Enterprise data screens read
        // better dense, provided the hierarchy is real - which is exactly
        // where the incumbent product falls down.
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
        xl: ["1.125rem", { lineHeight: "1.625rem", letterSpacing: "-0.01em" }],
        "2xl": ["1.375rem", { lineHeight: "1.875rem", letterSpacing: "-0.015em" }],
        "3xl": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em" }],
      },

      boxShadow: {
        subtle: "0 1px 2px 0 hsl(var(--shadow-color) / 0.04)",
        raised: "0 1px 3px 0 hsl(var(--shadow-color) / 0.08), 0 1px 2px -1px hsl(var(--shadow-color) / 0.06)",
        overlay: "0 10px 30px -10px hsl(var(--shadow-color) / 0.25)",
      },

      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 140ms ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
