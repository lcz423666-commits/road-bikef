/// <reference types="@rsbuild/core/types" />

// Google Analytics gtag types
interface Window {
  gtag?: (
    command: 'event' | 'config' | 'js' | 'set',
    targetOrAction: string | Date,
    parameters?: Record<string, unknown>
  ) => void;
  dataLayer?: unknown[];
}
