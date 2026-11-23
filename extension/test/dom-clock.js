import { jest } from 'bun:test';
import { MessageChannel } from 'node:worker_threads';

export function useDOMClock() {
  jest.useFakeTimers({ now: Date.UTC(2026, 0, 2, 12) });
}

// Bun 1.4.4 fakes setImmediate too. A message gives DOM observers and mocked
// Chrome replies a real event-loop turn without moving the test clock.
export function settleDOM() {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.once('message', () => {
      port1.close();
      port2.close();
      resolve();
    });
    port2.postMessage(null);
  });
}

export async function advanceDOMTime(ms) {
  await settleDOM();
  jest.advanceTimersByTime(ms);
  await settleDOM();
}

export async function restoreTimedDOM(win, previous) {
  try {
    // Settle released replies while their globals are still installed.
    await settleDOM();
    // Discard pending content timers. Happy DOM needs real timers to close.
    if (jest.isFakeTimers()) {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
    await win.happyDOM.close();
  } finally {
    Object.assign(globalThis, previous);
  }
}
