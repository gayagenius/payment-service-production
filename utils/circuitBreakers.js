// utils/circuitBreaker.js


class CircuitOpenError extends Error {
constructor(message = 'Circuit is open') {
super(message);
this.name = 'CircuitOpenError';
}
}


const STATES = {
CLOSED: 'CLOSED',
OPEN: 'OPEN',
HALF_OPEN: 'HALF_OPEN',
};


class CircuitBreaker {
/**
* options:
* - failureThreshold: number of failures before opening circuit (N)
* - timeout: ms to stay OPEN before moving to HALF_OPEN
* - halfOpenMaxRequests: concurrent probes allowed in HALF_OPEN (default 1)
* - onStateChange(state, meta): optional callback for logging/metrics
* - onEvent(eventName, meta): optional callback for events (success/failure/probe)
*/
constructor(options = {}) {
const {
failureThreshold = 5,
timeout = 60000,
halfOpenMaxRequests = 1,
onStateChange = () => {},
onEvent = () => {},
} = options;


this.failureThreshold = failureThreshold;
this.timeout = timeout;
this.halfOpenMaxRequests = halfOpenMaxRequests;
this.onStateChange = onStateChange;
this.onEvent = onEvent;


this.state = STATES.CLOSED;
this.failureCount = 0;
this.successCount = 0;
this.concurrentHalfOpenProbes = 0;
this.openUntil = null; // timestamp when OPEN should move to HALF_OPEN
}


_setState(newState, meta = {}) {
const prev = this.state;
this.state = newState;
// reset counters appropriately
if (newState === STATES.CLOSED) {
this.failureCount = 0;
this.successCount = 0;
this.concurrentHalfOpenProbes = 0;
this.openUntil = null;
}
if (newState === STATES.OPEN) {
this.openUntil = Date.now() + this.timeout;
this.concurrentHalfOpenProbes = 0;
}
if (newState === STATES.HALF_OPEN) {
this.concurrentHalfOpenProbes = 0;
}


try { this.onStateChange(newState, { prev, ...meta }); } catch (e) { /* ignore */ }
}


_emit(eventName, meta = {}) {
try { this.onEvent(eventName, meta); } catch (e) { /* ignore */ }
}


_maybeTransitionFromOpen() {
if (this.state !== STATES.OPEN) return;
if (this.openUntil === null) return;
// You may want to add logic here to transition to HALF_OPEN if timeout has passed
}
}

module.exports = { CircuitBreaker, CircuitOpenError, STATES };