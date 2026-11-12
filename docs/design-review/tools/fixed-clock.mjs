// Preload for the Next server during design-review captures:
//   NODE_OPTIONS="--import /abs/path/fixed-clock.mjs" REVIEW_NOW=2026-11-13T10:00:00+08:00 next start
// Moves the server clock to REVIEW_NOW (then lets it run), so relative times
// ("3 小時前", "近 7 天") match the snapshot no matter when a round is shot.
const target = Date.parse(process.env.REVIEW_NOW ?? '');
if (Number.isFinite(target)) {
  const offset = target - Date.now();
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  class ReviewDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(realNow() + offset);
      else super(...args);
    }
    static now() {
      return realNow() + offset;
    }
  }
  // Some runtimes copy only own properties of Date; give the subclass its own parse/UTC.
  for (const name of Object.getOwnPropertyNames(RealDate)) {
    if (!['length', 'name', 'prototype', 'now'].includes(name)) {
      Object.defineProperty(ReviewDate, name, Object.getOwnPropertyDescriptor(RealDate, name));
    }
  }
  globalThis.Date = ReviewDate;
}
