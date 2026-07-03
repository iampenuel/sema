import { GoogleGenAI } from "@google/genai";
import { getLiveConfig } from "./liveConfig";
import { buildLiveTokenTimes } from "./liveTokenPolicy";

export async function mintGeminiLiveToken(now = Date.now()) {
  const config = getLiveConfig();
  if (!config.tokenMintingAllowed) throw new Error("Live token minting is disabled.");
  const { expiresAt, newSessionExpiresAt } = buildLiveTokenTimes(now, config.maxSessionMinutes);
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: expiresAt.toISOString(),
      newSessionExpireTime: newSessionExpiresAt.toISOString(),
      httpOptions: { apiVersion: "v1alpha" }
    }
  });
  if (!token.name) throw new Error("Gemini did not return an ephemeral token.");
  return { token: token.name, expiresAt: expiresAt.toISOString() };
}
