import { resolveLiveConfig } from "./liveConfigCore";

export function getLiveConfig() {
  return resolveLiveConfig(process.env, process.env.NODE_ENV);
}
