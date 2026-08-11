/**
 * SM-2 spaced repetition scheduling (the same core algorithm Anki is built on).
 * quality: 0-5 rating of how well the card was recalled.
 *   0-2 = fail / hard to recall -> card resets and comes back soon
 *   3   = recalled with effort
 *   4   = recalled comfortably
 *   5   = recalled instantly / trivial
 */
function schedule(card, quality) {
  let { ease_factor: ef, interval_days: interval, repetitions: reps } = card;

  if (quality < 3) {
    reps = 0;
    interval = 1 / 24; // 1 hour, come back soon within the same session
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ef * 10) / 10;
    reps += 1;
  }

  ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ef < 1.3) ef = 1.3;

  const dueAt = new Date(Date.now() + interval * 24 * 60 * 60 * 1000);

  return {
    ease_factor: Math.round(ef * 100) / 100,
    interval_days: interval,
    repetitions: reps,
    due_at: dueAt.toISOString(),
  };
}

module.exports = { schedule };
