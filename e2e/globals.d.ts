export {};

declare global {
  interface Window {
    dmsMarketing?: {
      track: (name: string, data?: { plan?: string; text?: string }) => void;
      variation: (key: string) => Promise<string | null>;
      exposure: (experiment: string, variation: string) => void;
    };
  }
}
