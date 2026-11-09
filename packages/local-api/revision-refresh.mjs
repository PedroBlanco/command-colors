/**
 * Browser-only SSE revision inbox. The server remains the source of truth;
 * this module transports revision counters, never game or private state.
 * Only a successful inspection acknowledges a revision. Errors retry with
 * bounded backoff, and reset cancels work from a previous match/session.
 */
function revisionParts(value) {
  if (typeof value !== 'string' || !/^\d+:(?:\d+|null)$/.test(value)) return null;
  const [lobby, game] = value.split(':');
  const a = Number(lobby), b = game === 'null' ? -1 : Number(game);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
  return [a, b];
}

function newer(candidate, old) {
  if (old === null) return true;
  const a = revisionParts(candidate), b = revisionParts(old);
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

export function createRevisionRefresh({inspect, onError = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = timer => clearTimeout(timer), retryMs = 3000} = {}) {
  if (typeof inspect !== 'function' || typeof onError !== 'function' ||
      typeof schedule !== 'function' || typeof cancel !== 'function' ||
      !Number.isSafeInteger(retryMs) || retryMs < 1 || retryMs > 60000) {
    throw new TypeError('INVALID_REVISION_REFRESH_OPTIONS');
  }
  let epoch = 0, pending = null, acknowledged = null, active = null;
  let paused = false, timer = null, failures = 0;
  const clearRetry = () => {
    if (timer !== null) {cancel(timer); timer = null;}
  };
  function pump() {
    if (paused || active || timer !== null || pending === null || pending === acknowledged) return;
    const task = {epoch, target: pending};
    active = task;
    void Promise.resolve().then(() => inspect()).then(result => {
      if (epoch !== task.epoch || active !== task) return;
      if (result === false) retry();
      else {acknowledged = task.target; failures = 0;}
    }, error => {
      if (epoch !== task.epoch || active !== task) return;
      try {onError(error);} catch { /* UI errors must not prevent retry */ }
      retry();
    }).finally(() => {
      if (active === task) active = null;
      pump();
    });
  }
  function retry() {
    failures = Math.min(failures + 1, 5);
    const ms = retryMs * (2 ** (failures - 1));
    timer = schedule(() => {timer = null; pump();}, ms);
  }
  function notice(key) {
    if (!revisionParts(key)) return false;
    if (!newer(key, pending ?? acknowledged)) return false;
    pending = key;
    clearRetry(); // Newer information should not wait for an old retry.
    failures = 0;
    pump();
    return true;
  }
  function setPaused(value) {
    paused = Boolean(value);
    if (paused) clearRetry();
    else pump();
  }
  function reset() {
    epoch++;
    pending = null;
    acknowledged = null;
    active = null;
    failures = 0;
    clearRetry();
  }
  return Object.freeze({notice, setPaused, reset});
}
