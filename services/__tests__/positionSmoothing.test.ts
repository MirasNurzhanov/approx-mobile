// The dot that used to teleport.
//
// The bug in one sentence: `watchPositionAsync` reports every ten metres, so a
// car got a new position roughly twice a second and the marker was drawn at
// each of them and nowhere in between — a row of stills, not a journey.
//
// What these pin is not "it animates" but the four judgement calls that decide
// whether the animation is an improvement or a new kind of lie:
//
//   - it moves *between* fixes, so the dot is somewhere the GPS never said;
//   - it never runs the timer when there is nothing to move, because this is a
//     module-level interval on a screen people leave open for hours;
//   - a jump that is not travel — a re-lock, a return from the background —
//     snaps, because gliding it would narrate a drive that did not happen;
//   - Reduce Motion turns all of it off.

import {
  __testing,
  getSmoothedPosition,
  pushFix,
  resetPositionSampleClock,
  resetPositionSmoothing,
  setSmoothingActive,
  setSmoothingReduceMotion,
  subscribeToSmoothedPosition,
} from '../positionSmoothing';

const { FRAME_MS, MAX_GLIDE_MS, TELEPORT_M, roughMeters, state } = __testing;

const ALMATY = { latitude: 43.238949, longitude: 76.889709 };
let stopScreen: () => void;

/** A point `north` metres north of Almaty. Latitude only, so the distance is
 *  the offset and nothing has to be worked back out of a longitude. */
function north(meters: number) {
  return { latitude: ALMATY.latitude + meters / 111_320, longitude: ALMATY.longitude };
}

/** How far the drawn dot is from Almaty, in metres. */
function drawnMeters(): number {
  const at = getSmoothedPosition();
  if (!at) throw new Error('nothing drawn');
  return roughMeters(ALMATY, at);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-10T09:00:00Z'));
  setSmoothingReduceMotion(false);
  setSmoothingActive(true);
  resetPositionSmoothing();
  // A mounted marker/camera consumes the animated store in the app.
  stopScreen = subscribeToSmoothedPosition(() => {});
});

afterEach(() => {
  stopScreen();
  resetPositionSmoothing();
  jest.useRealTimers();
});

/** Advance both the clock the interpolation reads and the timer that drives
 *  it. `jest.advanceTimersByTime` moves both when the fake clock is modern,
 *  but being explicit here is what makes the assertions legible. */
function tick(ms: number) {
  jest.advanceTimersByTime(ms);
}

it('rebases acquisition ordering without clearing the marker or stopping its glide', () => {
  pushFix(ALMATY, 3600000);
  tick(1000);
  pushFix(north(20), 3601000);
  tick(200);
  const before = getSmoothedPosition();
  resetPositionSampleClock();
  expect(getSmoothedPosition()).toBe(before);
  expect(state().gliding).toBe(true);
  expect(pushFix(north(30), 1000)).toBe(true);
  expect(pushFix(north(40), 999)).toBe(false);
  tick(MAX_GLIDE_MS);
  expect(drawnMeters()).toBeCloseTo(30, 2);
});

describe('the first fix', () => {
  it('appears where it is, with no glide from nowhere', () => {
    pushFix(ALMATY);
    expect(getSmoothedPosition()).toEqual(ALMATY);
    expect(state().gliding).toBe(false);
  });

  it('does not start the timer', () => {
    pushFix(ALMATY);
    expect(state().ticking).toBe(false);
  });
});

describe('moving', () => {
  /** Two fixes a second apart, the second `meters` further north — the shape
   *  of walking or driving in a straight line. */
  function travel(meters: number) {
    pushFix(ALMATY);
    tick(1_000);
    pushFix(north(meters));
  }

  it('draws the dot between the two fixes, not at either', () => {
    travel(20);
    // Half way through the glide it should be about half way up the road.
    tick(500);
    const at = drawnMeters();
    expect(at).toBeGreaterThan(3);
    expect(at).toBeLessThan(17);
  });

  it('keeps moving across successive frames', () => {
    travel(20);
    tick(FRAME_MS * 2);
    const early = drawnMeters();
    tick(FRAME_MS * 4);
    const later = drawnMeters();
    expect(later).toBeGreaterThan(early);
  });

  it('arrives at the fix rather than stopping short', () => {
    travel(20);
    tick(MAX_GLIDE_MS + FRAME_MS);
    expect(getSmoothedPosition()).toEqual(north(20));
  });

  it('stops ticking once it has arrived', () => {
    travel(20);
    expect(state().ticking).toBe(true);
    tick(MAX_GLIDE_MS + FRAME_MS);
    expect(state().ticking).toBe(false);
  });

  it('continues from where the dot is when a fix lands mid-glide', () => {
    travel(20);
    tick(300);
    const interrupted = drawnMeters();
    // A second leg arrives before the first finished. The dot must carry on
    // from where it is — restarting from the *previous fix* would jerk it
    // backwards, which is the failure this is here to catch.
    pushFix(north(40));
    tick(FRAME_MS);
    expect(drawnMeters()).toBeGreaterThanOrEqual(interrupted);
  });

  it('notifies subscribers as it moves', () => {
    const seen = jest.fn();
    const stop = subscribeToSmoothedPosition(seen);
    travel(20);
    seen.mockClear();
    tick(FRAME_MS * 3);
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });

  it('stops notifying once unsubscribed', () => {
    const seen = jest.fn();
    subscribeToSmoothedPosition(seen)();
    travel(20);
    seen.mockClear();
    tick(FRAME_MS * 3);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('what is not travel', () => {
  it('snaps a jump too far to be movement', () => {
    pushFix(ALMATY);
    tick(1_000);
    const faraway = north(TELEPORT_M + 1_000);
    pushFix(faraway);
    // No glide: the dot is simply there. Sliding the camera across a city
    // would narrate a journey nobody made.
    expect(getSmoothedPosition()).toEqual(faraway);
    expect(state().gliding).toBe(false);
    expect(state().ticking).toBe(false);
  });

  it('still glides a jump just inside the threshold', () => {
    pushFix(ALMATY);
    tick(1_000);
    pushFix(north(TELEPORT_M - 50));
    expect(state().gliding).toBe(true);
  });

  it('ignores a fix that has not actually moved', () => {
    pushFix(ALMATY);
    tick(1_000);
    pushFix(ALMATY);
    // Standing still, the platform still reports the odd fix as its estimate
    // wobbles. Re-arming a glide for each would run the timer forever on a
    // screen people leave open.
    expect(state().ticking).toBe(false);
  });
});

describe('Reduce Motion', () => {
  it('puts every fix straight on the map', () => {
    setSmoothingReduceMotion(true);
    pushFix(ALMATY);
    tick(1_000);
    pushFix(north(20));
    expect(getSmoothedPosition()).toEqual(north(20));
    expect(state().ticking).toBe(false);
  });

  it('lands a glide already in flight when it is turned on', () => {
    pushFix(ALMATY);
    tick(1_000);
    pushFix(north(20));
    expect(state().gliding).toBe(true);
    setSmoothingReduceMotion(true);
    expect(getSmoothedPosition()).toEqual(north(20));
    expect(state().ticking).toBe(false);
  });
});

describe('teardown', () => {
  it('clears the position and stops the timer', () => {
    pushFix(ALMATY);
    tick(1_000);
    pushFix(north(20));
    expect(state().ticking).toBe(true);

    resetPositionSmoothing();
    expect(getSmoothedPosition()).toBeNull();
    expect(state().ticking).toBe(false);
  });

  it('tells subscribers, so a marker does not keep the old point', () => {
    const seen = jest.fn();
    const stop = subscribeToSmoothedPosition(seen);
    pushFix(ALMATY);
    seen.mockClear();
    resetPositionSmoothing();
    expect(seen).toHaveBeenCalled();
    stop();
  });

  it('leaves no interval behind for the next screen to inherit', () => {
    pushFix(ALMATY);
    tick(1_000);
    pushFix(north(20));
    resetPositionSmoothing();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('glide duration', () => {
  it('follows the measured gap between fixes rather than a fixed guess', () => {
    // Fixes arriving quickly should produce a short glide, so the dot is not
    // still crawling toward fix 2 when fix 5 lands.
    pushFix(ALMATY);
    tick(200);
    pushFix(north(5));
    tick(200);
    pushFix(north(10));
    tick(200);
    pushFix(north(15));
    expect(state().cadenceMs).toBeLessThan(600);
  });

  it('caps the glide so a long pause does not leave the dot creeping', () => {
    pushFix(ALMATY);
    tick(60_000);
    pushFix(north(30));
    // Whatever the measured gap was, one glide may not outlast MAX_GLIDE_MS.
    tick(MAX_GLIDE_MS + FRAME_MS);
    expect(getSmoothedPosition()).toEqual(north(30));
  });
});

describe('fix validation and timestamps', () => {
  it.each([
    { latitude: NaN, longitude: 10 },
    { latitude: 10, longitude: Infinity },
    { latitude: 91, longitude: 10 },
    { latitude: 10, longitude: -181 },
  ])('rejects an invalid fix without poisoning the snapshot or timer: %j', point => {
    expect(pushFix(point)).toBe(false);
    expect(getSmoothedPosition()).toBeNull();
    expect(state().ticking).toBe(false);
    pushFix(ALMATY, 1000);
    const snapshot = getSmoothedPosition();
    expect(pushFix(point, 2000)).toBe(false);
    expect(getSmoothedPosition()).toBe(snapshot);
    expect(pushFix(north(10), 1500)).toBe(true);
  });

  it('rejects stale and duplicate GPS samples before changing the current journey', () => {
    pushFix(ALMATY, 1000);
    tick(1000);
    pushFix(north(20), 2000);
    expect(pushFix(north(-1000), 1500)).toBe(false);
    expect(pushFix(north(-1000), 2000)).toBe(false);
    tick(MAX_GLIDE_MS + FRAME_MS);
    expect(getSmoothedPosition()).toEqual(north(20));
  });

  it.each([NaN, Infinity, -1])('rejects an invalid sample timestamp %s', timestamp => {
    expect(pushFix(ALMATY, timestamp)).toBe(false);
    expect(getSmoothedPosition()).toBeNull();
  });

  it('uses sample timestamps for cadence when delivery is batched', () => {
    pushFix(ALMATY, 0);
    pushFix(north(5), 1000);
    pushFix(north(10), 2000);
    expect(state().cadenceMs).toBe(1000);
  });

  it('does not move backwards when the wall clock is corrected', () => {
    pushFix(ALMATY);
    tick(1000);
    pushFix(north(20));
    tick(300);
    const before = drawnMeters();
    jest.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    tick(FRAME_MS * 2);
    expect(drawnMeters()).toBeGreaterThan(before);
    tick(1000);
    expect(getSmoothedPosition()).toEqual(north(20));
  });

  it('does not let a long stop inflate several subsequent glides', () => {
    pushFix(ALMATY);
    tick(60000);
    pushFix(north(20));
    tick(200);
    pushFix(north(30));
    tick(200);
    pushFix(north(40));
    expect(state().cadenceMs).toBeLessThan(600);
  });
});

describe('interrupted and wrapped travel', () => {
  it('crosses the date line without teleporting or traveling around the world', () => {
    const from = { latitude: 0, longitude: 179.9995 };
    const to = { latitude: 0, longitude: -179.9995 };
    expect(roughMeters(from, to)).toBeCloseTo(111.32, 1);
    pushFix(from);
    tick(1000);
    pushFix(to);
    expect(state().gliding).toBe(true);
    tick(500);
    const point = getSmoothedPosition()!;
    expect(Math.abs(point.longitude)).toBeGreaterThan(179.999);
    expect(Math.abs(point.longitude)).toBeLessThanOrEqual(180);
    expect(roughMeters(from, point)).toBeGreaterThan(30);
    expect(roughMeters(from, point)).toBeLessThan(90);
    tick(1000);
    expect(getSmoothedPosition()).toEqual(to);
  });

  it('does not restart a glide whenever the same destination is reported again', () => {
    pushFix(ALMATY);
    tick(1000);
    pushFix(north(20));
    for (let i = 0; i < 6; i++) {
      tick(200);
      pushFix(north(20));
    }
    expect(getSmoothedPosition()).toEqual(north(20));
    expect(state().ticking).toBe(false);
  });

  it('cancels an outdated destination when GPS corrects back to the shown point', () => {
    pushFix(ALMATY);
    tick(1000);
    pushFix(north(20));
    tick(300);
    const correction = { ...getSmoothedPosition()! };
    pushFix(correction);
    tick(3000);
    expect(getSmoothedPosition()).toEqual(correction);
    expect(state().ticking).toBe(false);
  });
});

describe('store lifetime and notification cost', () => {
  it('stops frame timers on the last unsubscribe and stays current without observers', () => {
    pushFix(ALMATY);
    tick(1000);
    pushFix(north(20));
    stopScreen();
    expect(getSmoothedPosition()).toEqual(north(20));
    expect(jest.getTimerCount()).toBe(0);
    pushFix(north(40));
    expect(getSmoothedPosition()).toEqual(north(40));
    expect(jest.getTimerCount()).toBe(0);
  });

  it('suspends drawing in the background and resumes only for new fixes', () => {
    pushFix(ALMATY, 1000);
    tick(1000);
    pushFix(north(20), 2000);
    setSmoothingActive(false);
    expect(getSmoothedPosition()).toEqual(north(20));
    expect(jest.getTimerCount()).toBe(0);
    pushFix(north(40), 3000);
    expect(getSmoothedPosition()).toEqual(north(40));
    setSmoothingActive(true);
    expect(jest.getTimerCount()).toBe(0);
    pushFix(north(60), 4000);
    expect(state().gliding).toBe(true);
  });

  it('keeps Reduce Motion across reset and active-state changes', () => {
    setSmoothingReduceMotion(true);
    resetPositionSmoothing();
    setSmoothingActive(false);
    setSmoothingActive(true);
    pushFix(ALMATY);
    tick(1000);
    pushFix(north(20));
    expect(getSmoothedPosition()).toEqual(north(20));
    expect(state().ticking).toBe(false);
  });

  it('owns immutable snapshots and does not notify for an unchanged snap', () => {
    setSmoothingReduceMotion(true);
    const source = { ...ALMATY };
    pushFix(source);
    const snapshot = getSmoothedPosition();
    source.latitude += 1;
    expect(snapshot).toEqual(ALMATY);
    expect(Object.isFrozen(snapshot)).toBe(true);
    const seen = jest.fn();
    const stop = subscribeToSmoothedPosition(seen);
    pushFix(ALMATY);
    expect(getSmoothedPosition()).toBe(snapshot);
    expect(seen).not.toHaveBeenCalled();
    stop();
  });

  it('keeps independent subscriptions even when their callbacks are identical', () => {
    const seen = jest.fn();
    const first = subscribeToSmoothedPosition(seen);
    const second = subscribeToSmoothedPosition(seen);
    first();
    pushFix(ALMATY);
    expect(seen).toHaveBeenCalledTimes(1);
    second();
  });
});
