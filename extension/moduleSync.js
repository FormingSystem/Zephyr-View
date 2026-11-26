'use strict';

async function syncBatch(rows, syncOne) {
  const results = [];
  for (const row of rows) {
    try {
      await syncOne(row);
      results.push({name: row.name, status: 'complete'});
    } catch (error) {
      results.push({name: row.name, status: 'failed', message: error.message});
      for (const remaining of rows.slice(results.length)) {
        results.push({name: remaining.name, status: 'pending'});
      }
      break;
    }
  }
  return results;
}

module.exports = {syncBatch};
