'use strict';

const {ProbeCache} = require('./probeCache');

const singleBoards = new ProbeCache(16, 5000);
const registeredSdks = new ProbeCache(4, 5000);
const compilerDirectories = new ProbeCache(128, 5000);

function clearToolchainDiscovery() {
  for (const cache of [singleBoards, registeredSdks, compilerDirectories]) cache.clear();
}

module.exports = {singleBoards, registeredSdks, compilerDirectories, clearToolchainDiscovery};
