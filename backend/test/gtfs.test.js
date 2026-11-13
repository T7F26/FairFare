"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const yazl = require("yazl");
const { validateGtfsUpload, GtfsValidationError } = require("../src/validation/gtfs");

// Each call creates a fresh, fictional feed so one test cannot change another.
// Keep the IDs linked across tables when building a new valid example.
function fixture() {
  // The named timezone also exercises the validator's IANA timezone check.
  return {
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA1,Example Transit,https://example.test/transit,America/Toronto\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nS1,Central Station,43.59,-79.64\nS2,Example Park,43.68,-79.62\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_type\nR1,A1,7,3\n",
    "trips.txt": "route_id,service_id,trip_id\nR1,WK,T1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,S1,1\nT1,08:20:00,08:20:00,S2,2\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20261231\n",
  };
}

// Build uploads entirely in memory; the tests do not need fixture files on disk.
// Options such as compress: false let individual tests control the ZIP layout.
function zip(files, options = {}) {
  const archive = new yazl.ZipFile();
  for (const [name, content] of Object.entries(files)) {
    archive.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content), name, options);
  }
  return new Promise((resolve, reject) => {
    // ZIP output arrives in chunks; validation starts after the full buffer exists.
    const chunks = [];
    archive.on("error", reject);
    archive.outputStream.on("error", reject);
    archive.outputStream.on("data", (chunk) => chunks.push(chunk));
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.end();
  });
}

// Most rejection cases change one file and share these error-contract checks.
// Diagnostic detail helps developers; the stable code identifies the failure type.
async function expectError(files, code = "INVALID_GTFS", options) {
  await assert.rejects(validateGtfsUpload(await zip(files), options), (error) => {
    assert.ok(error instanceof GtfsValidationError);
    assert.equal(error.code, code);
    if (code === "INVALID_GTFS") assert.equal(error.message, "File could not be read");
    if (code === "FILE_UNREADABLE") assert.equal(error.message, "File could not be read");
    assert.equal(typeof error.detail, "string");
    return true;
  });
}

// Accepted examples establish the minimum supported scheduled-feed structure.
test("a valid minimal scheduled feed needs no optional fare files and returns counts", async () => {
  const result = await validateGtfsUpload(await zip(fixture()));
  assert.equal(result.valid, true);
  // No trusted mapping was supplied, so agency identity must remain unverified.
  assert.deepEqual(result.agencyCheck, { status: "skipped" });
  assert.deepEqual(result.agencies, [{ id: "A1", name: "Example Transit", url: "https://example.test/transit" }]);
  assert.equal(result.recordCounts["agency.txt"], 1);
  assert.equal(result.recordCounts["stops.txt"], 2);
  assert.equal(result.recordCounts["routes.txt"], 1);
  assert.equal(result.recordCounts["trips.txt"], 1);
  assert.equal(result.recordCounts["stop_times.txt"], 2);
  assert.equal(result.tables["stops.txt"][0].stop_id, "S1");
  assert.equal(result.tables["stop_times.txt"][1].arrival_time, "08:20:00");
});

test("calendar_dates may define all service when calendar.txt is absent", async () => {
  const files = fixture();
  delete files["calendar.txt"];
  files["calendar_dates.txt"] = "service_id,date,exception_type\nWK,20261113,1\n";
  const result = await validateGtfsUpload(await zip(files));
  assert.equal(result.valid, true);
  assert.equal(result.recordCounts["calendar_dates.txt"], 1);
});

test("CSV accepts UTF-8 BOM, CRLF, quoted commas and escaped quotation marks", async () => {
  const files = fixture();
  // These escapes describe actual BOM/line-ending bytes and CSV-escaped quotes.
  files["stops.txt"] = '\ufeffstop_id,stop_name,stop_lat,stop_lon\r\nS1,"Central, \"\"Station\"\"",43.59,-79.64\r\nS2,Example Park,43.68,-79.62\r\n';
  const result = await validateGtfsUpload(await zip(files));
  assert.equal(result.tables["stops.txt"][0].stop_name, 'Central, "Station"');
});

// Rejection cases remove or corrupt one requirement at a time.
// Starting from the same valid feed makes the reason for each failure easier to see.
test("missing core files or both service-calendar files are invalid GTFS", async () => {
  for (const file of ["agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt"]) {
    const files = fixture();
    delete files[file];
    await expectError(files);
  }
});

test("missing required columns and duplicate CSV headers are rejected", async () => {
  for (const content of [
    "stop_name,stop_lat,stop_lon\nCentral Station,43.59,-79.64\n",
    "stop_id,stop_id,stop_lat,stop_lon\nS1,S1,43.59,-79.64\n",
  ]) await expectError({ ...fixture(), "stops.txt": content });
});

test("blank required values and header-only core tables are rejected", async () => {
  await expectError({ ...fixture(), "trips.txt": "route_id,service_id,trip_id\nR1,WK,   \n" });
  await expectError({ ...fixture(), "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\n" });
  await expectError({ ...fixture(), "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA1,,https://example.test,America/Toronto\n" });
});

test("bad quoting, inconsistent column counts, invalid UTF-8 and control characters fail", async () => {
  for (const content of [
    "stop_id,stop_name,stop_lat,stop_lon\nS1,\"unterminated,43,-79\n",
    "stop_id,stop_name,stop_lat,stop_lon\nS1,Central Station,43\n",
    "stop_id,stop_name,stop_lat,stop_lon\nS1,Central\tStation,43,-79\n",
    Buffer.from([0xff, 0xfe, 0x00]),
  ]) await expectError({ ...fixture(), "stops.txt": content });
});

test("non-ZIP and truncated ZIP data report unreadable files", async () => {
  await assert.rejects(validateGtfsUpload(Buffer.from("not a ZIP")), {
    code: "FILE_UNREADABLE", message: "File could not be read",
  });
  const buffer = await zip(fixture());
  await assert.rejects(validateGtfsUpload(buffer.subarray(0, buffer.length - 10)), {
    code: "FILE_UNREADABLE", message: "File could not be read",
  });
});

test("a ZIP entry with altered bytes and an unchanged size fails CRC validation", async () => {
  // Uncompressed content is easy to locate without changing ZIP entry lengths.
  // Its stored checksum should detect even a one-bit change in an otherwise readable file.
  const buffer = await zip(fixture(), { compress: false });
  const offset = buffer.indexOf("Central Station");
  assert.ok(offset > 0);
  // XOR flips one bit while preserving both the buffer length and ZIP metadata.
  buffer[offset] ^= 1;
  await assert.rejects(validateGtfsUpload(buffer), { code: "FILE_UNREADABLE", message: "File could not be read" });
});

test("duplicate IDs and numerically duplicate stop sequences are invalid", async () => {
  const duplicateTrip = fixture();
  duplicateTrip["trips.txt"] += "R1,WK,T1\n";
  await expectError(duplicateTrip);
  const duplicateStop = fixture();
  duplicateStop["stops.txt"] += "S1,Other Stop,43.60,-79.63\n";
  await expectError(duplicateStop);
  // Stop sequences are numbers: textual "01" must collide with sequence "1".
  const duplicateSequence = fixture();
  duplicateSequence["stop_times.txt"] = duplicateSequence["stop_times.txt"].replace("S2,2", "S2,01");
  await expectError(duplicateSequence);
});

test("unknown route, service, trip, stop and route-agency references are rejected", async () => {
  // Each replacement breaks a different relationship between the core tables.
  for (const [file, from, to] of [
    ["trips.txt", "R1,WK,T1", "UNKNOWN,WK,T1"],
    ["trips.txt", "R1,WK,T1", "R1,UNKNOWN,T1"],
    ["stop_times.txt", "T1,08:00", "UNKNOWN,08:00"],
    ["stop_times.txt", "S1,1", "UNKNOWN,1"],
    ["routes.txt", "R1,A1,7,3", "R1,UNKNOWN,7,3"],
  ]) {
    const files = fixture();
    files[file] = files[file].replace(from, to);
    await expectError(files);
  }
});

test("invalid coordinates, calendar values, route types and malformed or backwards times fail", async () => {
  for (const [file, from, to] of [
    ["stops.txt", "43.59", "91"],
    ["stops.txt", "43.59", "0x10"],
    ["calendar.txt", "20260101", "20260230"],
    ["calendar.txt", "WK,1,1", "WK,2,1"],
    ["routes.txt", "R1,A1,7,3", "R1,A1,7,99"],
    ["stop_times.txt", "08:20:00", "08:99:00"],
    ["stop_times.txt", "08:20:00", "07:20:00"],
  ]) {
    const files = fixture();
    files[file] = files[file].replaceAll(from, to);
    await expectError(files);
  }
});

test("times after midnight and blank intermediate approximate times are supported", async () => {
  const files = fixture();
  // GTFS service days can exceed 24 hours; timepoint=0 permits an untimed middle stop.
  files["stop_times.txt"] = "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\nT1,25:00:00,25:00:00,S1,1,1\nT1,,,S2,2,0\nT1,25:20:00,25:20:00,S1,3,1\n";
  const result = await validateGtfsUpload(await zip(files));
  assert.equal(result.valid, true);
  assert.equal(result.recordCounts["stop_times.txt"], 3);
  assert.equal(result.tables["stop_times.txt"][0].arrival_time, "25:00:00");
});

test("multiple agencies are supported with IDs and valid route-agency references", async () => {
  const files = fixture();
  // Multiple agencies need distinct IDs so each route can identify its operator.
  files["agency.txt"] += "A2,Second Example Transit,https://second.example.test,America/Toronto\n";
  files["routes.txt"] += "R2,A2,8,3\n";
  const result = await validateGtfsUpload(await zip(files));
  assert.equal(result.valid, true);
  assert.equal(result.agencies.length, 2);
  assert.equal(result.agencies[1].id, "A2");
  assert.deepEqual(result.agencyCheck, { status: "skipped" });
  const missingId = { ...files, "agency.txt": files["agency.txt"].replace("A2,Second", ",Second") };
  await expectError(missingId);
  const missingRouteAgency = { ...files, "routes.txt": files["routes.txt"].replace("R2,A2", "R2,") };
  await expectError(missingRouteAgency);
});

// Identity comparison belongs to an explicitly supplied, trusted mapping policy.
// Both ordinary and promise-returning policies should receive the same safe input.
test("a supplied sync or async agency matcher receives read-only agency rows", async () => {
  const buffer = await zip(fixture());
  const matchedRows = [];
  function matcher(rows) {
    assert.ok(Array.isArray(rows));
    assert.ok(Object.isFrozen(rows));
    assert.ok(Object.isFrozen(rows[0]));
    assert.equal(rows[0].agency_id, "A1");
    assert.equal(rows[0].agency_name, "Example Transit");
    assert.equal(rows[0].agency_url, "https://example.test/transit");
    // Strict mode turns attempted edits to frozen inputs into observable errors.
    assert.throws(() => { rows[0].agency_name = "Changed"; }, TypeError);
    assert.throws(() => { rows.push({}); }, TypeError);
    matchedRows.push(rows);
    return rows[0].agency_url === "https://example.test/transit";
  }
  const synchronous = await validateGtfsUpload(buffer, { agencyMatcher: matcher });
  const asynchronous = await validateGtfsUpload(buffer, { agencyMatcher: async (rows) => matcher(rows) });
  assert.deepEqual(synchronous.agencyCheck, { status: "matched" });
  assert.deepEqual(asynchronous.agencyCheck, { status: "matched" });
  assert.equal(matchedRows.length, 2);
  assert.equal(synchronous.tables["agency.txt"][0].agency_name, "Example Transit");
});

test("multiple agencies must use the same timezone", async () => {
  const files = fixture();
  // Both names are valid timezones; the failure is their disagreement within one feed.
  files["agency.txt"] += "A2,Second Example Transit,https://second.example.test,America/Vancouver\n";
  files["routes.txt"] += "R2,A2,8,3\n";
  await expectError(files);
});

// Unsupported scheduling features have a separate outcome from malformed core data.
test("unsupported Flex data gets a specific feature error rather than a false validity claim", async () => {
  const files = fixture();
  files["stop_times.txt"] = "trip_id,arrival_time,departure_time,stop_id,stop_sequence,location_id\nT1,08:00:00,08:00:00,,1,ZONE1\nT1,08:20:00,08:20:00,,2,ZONE1\n";
  files["locations.geojson"] = '{"type":"FeatureCollection","features":[]}';
  await expectError(files, "UNSUPPORTED_GTFS");
});

test("stop-based pickup/drop-off windows are explicitly unsupported", async () => {
  const files = fixture();
  files["stop_times.txt"] = "trip_id,arrival_time,departure_time,stop_id,stop_sequence,start_pickup_drop_off_window,end_pickup_drop_off_window\nT1,08:00:00,08:00:00,S1,1,08:00:00,08:10:00\nT1,08:20:00,08:20:00,S2,2,08:20:00,08:30:00\n";
  await expectError(files, "UNSUPPORTED_GTFS");
  files["stop_times.txt"] = "trip_id,stop_id,stop_sequence,start_pickup_drop_off_window,end_pickup_drop_off_window\nT1,S1,1,08:00:00,08:10:00\nT1,S2,2,08:20:00,08:30:00\n";
  await expectError(files, "UNSUPPORTED_GTFS");
});

test("a reliable mapping mismatch returns the story message without diagnostic leakage", async () => {
  await assert.rejects(validateGtfsUpload(await zip(fixture()), { agencyMatcher: () => false }), (error) => {
    assert.ok(error instanceof GtfsValidationError);
    assert.equal(error.code, "AGENCY_MISMATCH");
    assert.equal(error.message, "This file does not match the chosen agency");
    // Serialized errors expose the public contract while keeping diagnostic detail private.
    assert.deepEqual(error.toJSON(), { code: "AGENCY_MISMATCH", message: "This file does not match the chosen agency" });
    assert.deepEqual(JSON.parse(JSON.stringify(error)), error.toJSON());
    assert.equal(Object.hasOwn(error.toJSON(), "detail"), false);
    return true;
  });
});

test("an agency matcher must return a boolean, not a truthy or empty value", async () => {
  const buffer = await zip(fixture());
  for (const value of [undefined, null, "yes", 1, {}]) {
    await assert.rejects(validateGtfsUpload(buffer, { agencyMatcher: () => value }), TypeError);
  }
});

test("sync and async agency lookup failures propagate unchanged", async () => {
  // A failed lookup must stay distinguishable from an uploaded-file validation error.
  const buffer = await zip(fixture());
  const lookupFailure = new Error("Example lookup unavailable");
  for (const agencyMatcher of [() => { throw lookupFailure; }, async () => { throw lookupFailure; }]) {
    await assert.rejects(validateGtfsUpload(buffer, { agencyMatcher }), (error) => error === lookupFailure);
  }
});

test("ZIP bytes, expanded file/total bytes, entry counts and parsed rows are bounded", async () => {
  // Tiny per-test limits exercise each guard without allocating a genuinely large upload.
  const buffer = await zip(fixture());
  for (const limits of [{ zipBytes: 10 }, { fileBytes: 20 }, { totalBytes: 100 }, { entries: 2 }, { rows: 3 }]) {
    await assert.rejects(validateGtfsUpload(buffer, { limits }), { code: "FILE_UNREADABLE" });
  }
});

test("nested and traversal archive paths are rejected without extracting files", async () => {
  await expectError({ ...fixture(), "nested/extra.txt": "example" }, "FILE_UNREADABLE");
  const unsafe = await zip(fixture());
  // Rewrite both filename occurrences using equal-length text to retain the ZIP layout.
  // This bypasses the ZIP writer's own safe-name checks and exercises the reader instead.
  let offset = unsafe.indexOf("agency.txt");
  while (offset !== -1) {
    unsafe.write("../ncy.txt", offset, "utf8");
    offset = unsafe.indexOf("agency.txt", offset + 10);
  }
  await assert.rejects(validateGtfsUpload(unsafe), { code: "FILE_UNREADABLE" });
});

test("a caller that awaits validation never imports a rejected feed or changes old in-memory records", async () => {
  // This checks the service/caller boundary, not a real database transaction.
  // The spy represents a later import step; its counter reveals whether it was reached.
  // The snapshot lets us check that rejection leaves the previous in-memory records intact.
  const oldRecords = [{ id: "existing", name: "Previous approved record" }];
  const snapshot = structuredClone(oldRecords);
  let importCalls = 0;
  async function importSpy(validated) {
    importCalls += 1;
    oldRecords.splice(0, oldRecords.length, ...validated.tables["stops.txt"]);
  }
  async function validateThenImport(buffer, options) {
    // Awaiting rejection here prevents the import step below from running.
    const validated = await validateGtfsUpload(buffer, options);
    await importSpy(validated);
  }
  const invalidBuffer = Buffer.from("bad upload");
  const invalidSnapshot = Buffer.from(invalidBuffer);
  await assert.rejects(validateThenImport(invalidBuffer));
  const wrongAgencyBuffer = await zip(fixture());
  const wrongAgencySnapshot = Buffer.from(wrongAgencyBuffer);
  await assert.rejects(validateThenImport(wrongAgencyBuffer, { agencyMatcher: () => false }));
  assert.equal(importCalls, 0);
  assert.deepEqual(oldRecords, snapshot);
  assert.deepEqual(invalidBuffer, invalidSnapshot);
  assert.deepEqual(wrongAgencyBuffer, wrongAgencySnapshot);
  const validBuffer = await zip(fixture());
  const validSnapshot = Buffer.from(validBuffer);
  await validateGtfsUpload(validBuffer);
  assert.deepEqual(validBuffer, validSnapshot);
});
