/**
 * analysis — pure functions behind the "smart start" (no DOM, unit-tested).
 */

/** RMS loudness per `step` seconds, averaged over channels. */
export function rmsProfile(channels, sampleRate, step = 1) {
  const len = channels[0].length;
  const hop = Math.floor(sampleRate * step);
  const out = [];
  for (let start = 0; start + hop <= len; start += hop) {
    let sum = 0;
    for (const ch of channels) {
      for (let i = start; i < start + hop; i++) sum += ch[i] * ch[i];
    }
    out.push(Math.sqrt(sum / (hop * channels.length)));
  }
  return out;
}

/** Start (in steps) of the window of `size` steps with the highest average energy. */
export function bestWindowStart(rms, size) {
  if (rms.length <= size) return 0;
  let sum = 0;
  for (let i = 0; i < size; i++) sum += rms[i];
  let best = sum;
  let bestStart = 0;
  for (let i = size; i < rms.length; i++) {
    sum += rms[i] - rms[i - size];
    if (sum > best + 1e-9) {
      best = sum;
      bestStart = i - size + 1;
    }
  }
  return bestStart;
}
