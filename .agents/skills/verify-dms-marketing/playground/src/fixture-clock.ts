import { Controller, JSONBody, Post } from "@antelopejs/interface-api";
import { z } from "zod";

const clockSchema = z.object({ aheadMs: z.number().int().min(0) });

const realNow = Date.now.bind(Date);
let aheadMs = 0;
Date.now = () => realNow() + aheadMs;

/**
 * Moves the backend's `Date.now()` forward, so a journey can step past a
 * window the module keeps in memory (the ten minutes of a warned retention
 * cut) without waiting for it. Only the verification playground serves it;
 * `new Date()` and timers keep the real clock.
 */
export class VerifyClockController extends Controller("/verify-marketing/clock") {
  @Post("")
  set(@JSONBody() body: unknown) {
    aheadMs = clockSchema.parse(body).aheadMs;
    return { aheadMs, now: Date.now() };
  }
}
