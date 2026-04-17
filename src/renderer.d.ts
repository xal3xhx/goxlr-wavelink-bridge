import type { BridgeApi } from "../electron/preload";

declare global {
  interface Window {
    api: BridgeApi;
  }
}

export {};
