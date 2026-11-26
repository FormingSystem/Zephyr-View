'use strict';

const {createHash} = require('node:crypto');
const {performance} = require('node:perf_hooks');

/** Coalesce probes in flight. Keep successful results briefly and retry failed or incomplete lookups. */
class ProbeCache {
  constructor(limit, lifetime) {
    this.limit = limit;
    this.lifetime = lifetime;
    this.entries = new Map();
  }

  clear() {
    this.entries.clear();
  }

  read(key, load, reusable = () => true) {
    const existing = this.entries.get(key);
    if (existing && existing.expires > performance.now()) return existing.result;
    this.entries.delete(key);
    if (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value);
    const entry = {expires: Infinity};
    this.entries.set(key, entry);
    const remove = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };
    entry.result = Promise.resolve().then(load).then(value => {
      if (reusable(value)) entry.expires = performance.now() + this.lifetime;
      else remove();
      return value;
    }).catch(error => {
      remove();
      throw error;
    });
    return entry.result;
  }
}

// The lookup scripts consult Python, CMake, west and platform-specific environment settings.
// Hash the full invocation so environments with different search paths cannot share a result.
function probeKey(executable, parameters, environment) {
  const variables = Object.keys(environment).sort().map(key => [key, environment[key]]);
  return createHash('sha256').update(JSON.stringify([executable, parameters, variables])).digest('hex');
}

module.exports = {ProbeCache, probeKey};
