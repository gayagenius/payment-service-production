// utils/circuitBreaker.js


const CircuitBreaker = require('opossum');
const { v4: uuidv4 } = require('uuid');


/**
* Create a circuit breaker for a given async function.
*
* @param {Function} fn - async function to protect (e.g. gateway call)
* @param {Object} options - opossum options
* @param {number} [options.timeout=3000] - time in ms before considering a call a failure
* @param {number} [options.errorThresholdPercentage=50] - % of failures to trip circuit OPEN
* @param {number} [options.resetTimeout=10000] - time in ms before attempting HALF_OPEN
* @returns {CircuitBreaker}
*/
function createCircuitBreaker(fn, options = {}) {
const breaker = new CircuitBreaker(fn, {
timeout: options.timeout || 3000,
errorThresholdPercentage: options.errorThresholdPercentage || 50,
resetTimeout: options.resetTimeout || 10000,
});


// Emit logs/metrics with correlationId
const log = (event, payload) => {
const correlationId = uuidv4();
console.log(
JSON.stringify({
ts: new Date().toISOString(),
event,
correlationId,
...payload,
})
);
};


breaker.on('open', () => log('circuit_open'));
breaker.on('halfOpen', () => log('circuit_half_open'));
breaker.on('close', () => log('circuit_closed'));
breaker.on('reject', () => log('circuit_reject'));
breaker.on('timeout', () => log('circuit_timeout'));
breaker.on('failure', (err) => log('circuit_failure', { error: err.message }));
breaker.on('success', () => log('circuit_success'));


return breaker;
}


module.exports = { createCircuitBreaker };