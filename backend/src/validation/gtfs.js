const yauzl = require("yauzl");
const { parse } = require("csv-parse/sync");
const { crc32 } = require("node:zlib");

// Server-owned limits: adjust these for approved feed sizes, never from upload input.
const DEFAULT_LIMITS = Object.freeze({
  zipBytes: 50 * 1024 * 1024, // Maximum compressed upload size.
  totalBytes: 200 * 1024 * 1024, // Maximum expanded size across all entries.
  fileBytes: 100 * 1024 * 1024, // Maximum expanded size of one entry.
  entries: 128,
  rows: 1000000,
});
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const FLEX_FIELDS = ["location_id", "location_group_id", "start_pickup_drop_off_window", "end_pickup_drop_off_window"];
// Core CSV columns; conditional field values are checked after parsing.
const REQUIRED = {
  "agency.txt": ["agency_name", "agency_url", "agency_timezone"],
  "stops.txt": ["stop_id"],
  "routes.txt": ["route_id", "route_type"],
  "trips.txt": ["route_id", "service_id", "trip_id"],
  "stop_times.txt": ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"],
  "calendar.txt": ["service_id", ...DAYS, "start_date", "end_date"],
  "calendar_dates.txt": ["service_id", "date", "exception_type"],
};

// Keep a stable error code for callers and a diagnostic detail for server logs.
class GtfsValidationError extends Error {
  constructor(code, detail) {
    const messages = {
      AGENCY_MISMATCH: "This file does not match the chosen agency",
      FILE_UNREADABLE: "File could not be read",
      INVALID_GTFS: "File could not be read",
      UNSUPPORTED_GTFS: "This GTFS service type is not supported yet",
    };
    super(messages[code]);
    this.name = "GtfsValidationError";
    this.code = code;
    this.detail = detail;
  }
  toJSON() {
    // Send safe messages to clients without exposing internal diagnostic details.
    return { code: this.code, message: this.message };
  }
}
function invalid(detail) {
  throw new GtfsValidationError("INVALID_GTFS", detail);
}
function check(condition, detail) {
  if (!condition) invalid(detail);
}
function validateUrl(value) {
  // Check the agency URL format only; do not make an HTTP request to it.
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Expected a public http(s) agency URL");
  }
}
function isDate(value) {
  // Round-trip YYYYMMDD to reject impossible dates that JavaScript would normalize.
  if (!/^\d{8}$/.test(value)) return false;
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10).replaceAll("-", "") === value;
}
function time(value) {
  // GTFS allows hours after midnight, so 25:00:00 is valid rather than a new date.
  check(/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(value), `Invalid time: ${value}`);
  const [h, m, s] = value.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}
function unique(rows, fields, file) {
  // A key may contain one field or several fields, such as trip_id + stop_sequence.
  const seen = new Set();
  for (const row of rows) {
    const key = JSON.stringify(fields.map((field) => row[field]));
    check(!seen.has(key), `Duplicate ${fields.join(",")} in ${file}`);
    seen.add(key);
  }
}

// Read and check ZIP entries in memory; uploaded files are never extracted to disk.
async function readArchive(buffer, limits) {
  check(Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length <= limits.zipBytes, "Invalid upload size or type");
  const zip = await yauzl.fromBufferPromise(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const files = new Map();
  const names = new Set();
  let total = 0;
  try {
    check(zip.entryCount > 0 && zip.entryCount <= limits.entries, "Too many ZIP entries");
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      check(!/[\\/:\0]/.test(name) && name !== "." && name !== "..", "Files must be at the ZIP root");
      check(!names.has(name), `Duplicate ZIP entry: ${name}`);
      names.add(name);
      // Unix file-type bits identify links; some ZIP entries leave these bits unset.
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      check(mode === 0 || mode === 0o100000, "Only regular files are accepted");
      check(!(entry.generalPurposeBitFlag & 1), "Encrypted ZIP is not supported");
      check(entry.uncompressedSize <= limits.fileBytes && total + entry.uncompressedSize <= limits.totalBytes, "Uncompressed ZIP limit exceeded");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      let size = 0;
      let checksum = 0;
      for await (const chunk of stream) {
        // Check actual expanded bytes too, because ZIP size metadata is untrusted.
        size += chunk.length;
        total += chunk.length;
        if (size > limits.fileBytes || total > limits.totalBytes) {
          stream.destroy();
          invalid("Uncompressed ZIP limit exceeded");
        }
        checksum = crc32(chunk, checksum);
        // Retain core tables only, while still checking every other entry's integrity.
        if (Object.hasOwn(REQUIRED, name)) chunks.push(chunk);
      }
      // CRC detects changed content even when the file length is unchanged.
      check(size === entry.uncompressedSize && checksum === entry.crc32, `Corrupt ZIP entry: ${name}`);
      if (Object.hasOwn(REQUIRED, name)) files.set(name, Buffer.concat(chunks));
    }
  } finally {
    zip.close();
  }
  return { files, names };
}

// Convert core CSV files into row objects and check headers and required values.
function parseTables(files, names, limits) {
  if (!files.has("stops.txt") && names.has("locations.geojson")) {
    throw new GtfsValidationError("UNSUPPORTED_GTFS", "On-demand locations are outside this core stop-based validator");
  }
  for (const file of ["agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt"]) {
    check(files.has(file), `Missing ${file}`);
  }
  // A weekly calendar or a complete list of service dates can define the schedule.
  check(files.has("calendar.txt") || files.has("calendar_dates.txt"), "Missing service calendar");
  let totalRows = 0;
  const tables = Object.create(null);
  for (const [file, buffer] of files) {
    // Reject invalid UTF-8 instead of silently replacing damaged characters.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    let parsedRows = 0;
    const values = parse(text, {
      bom: true, skip_empty_lines: true, max_record_size: 1024 * 1024,
      on_record(record) {
        parsedRows += 1;
        // The parser counts the header too; the data-row budget does not.
        if (parsedRows > limits.rows - totalRows + 1) throw new GtfsValidationError("FILE_UNREADABLE", "Row limit exceeded");
        return record;
      },
    });
    check(values.length > 0, `${file} has no header`);
    if (!["calendar.txt", "calendar_dates.txt"].includes(file)) check(values.length > 1, `${file} has no data rows`);
    const [headers, ...records] = values;
    check(headers.every((name) => name && name === name.trim()) && new Set(headers).size === headers.length, `Invalid or duplicate columns in ${file}`);
    if (file === "stop_times.txt" && headers.some((name) => FLEX_FIELDS.includes(name)) &&
      ["stop_id", "arrival_time", "departure_time"].some((name) => !headers.includes(name))) {
      throw new GtfsValidationError("UNSUPPORTED_GTFS", "On-demand stop times are not supported");
    }
    check(REQUIRED[file].every((name) => headers.includes(name)), `Missing columns in ${file}`);
    totalRows += records.length;
    if (totalRows > limits.rows) throw new GtfsValidationError("FILE_UNREADABLE", "Row limit exceeded");
    tables[file] = records.map((values, index) => {
      check(values.every((value) => !/[\t\r\n\0]/.test(value)), `Invalid control character in ${file}`);
      const row = Object.fromEntries(headers.map((name, column) => [name, values[column]]));
      if (file === "stop_times.txt" && FLEX_FIELDS.some((name) => row[name])) {
        throw new GtfsValidationError("UNSUPPORTED_GTFS", "On-demand stop times are not supported");
      }
      for (const name of REQUIRED[file]) {
        // Blank intermediate times may be valid; trip/timepoint rules handle them later.
        if (file === "stop_times.txt" && ["arrival_time", "departure_time"].includes(name)) continue;
        check(row[name].trim() !== "", `Missing ${name} in ${file} row ${index + 2}`);
      }
      return row;
    });
  }
  return tables;
}

// Check relationships between parsed tables, without calling the database.
function validateTables(tables) {
  const agencies = tables["agency.txt"];
  for (const row of agencies) {
    validateUrl(row.agency_url);
    try { new Intl.DateTimeFormat("en", { timeZone: row.agency_timezone }); }
    catch { invalid("Invalid agency_timezone"); }
  }
  check(agencies.every((row) => row.agency_timezone === agencies[0].agency_timezone), "All agencies must use the same agency_timezone");
  const agencyIds = new Set();
  for (const row of agencies) {
    // A single agency may omit its ID; multiple agencies need distinct IDs.
    if (agencies.length > 1) check(row.agency_id?.trim(), "Multiple agencies require agency_id");
    if (row.agency_id) {
      check(!agencyIds.has(row.agency_id), "Duplicate agency_id");
      agencyIds.add(row.agency_id);
    }
  }
  const stops = tables["stops.txt"];
  const routes = tables["routes.txt"];
  const trips = tables["trips.txt"];
  const stopTimes = tables["stop_times.txt"];
  const calendar = tables["calendar.txt"] || [];
  const dates = tables["calendar_dates.txt"] || [];
  for (const [file, fields] of Object.entries({
    "stops.txt": ["stop_id"], "routes.txt": ["route_id"], "trips.txt": ["trip_id"],
    "stop_times.txt": ["trip_id", "stop_sequence"], "calendar.txt": ["service_id"],
    "calendar_dates.txt": ["service_id", "date"],
  })) unique(tables[file] || [], fields, file);

  // Maps and sets make reference checks fast without repeatedly scanning each table.
  const stopMap = new Map(stops.map((row) => [row.stop_id, row]));
  for (const row of stops) {
    const type = row.location_type || "0";
    check(["0", "1", "2", "3", "4"].includes(type), "Invalid location_type");
    if (["0", "1", "2"].includes(type)) {
      check(row.stop_name?.trim(), "Missing stop_name");
      for (const [field, max] of [["stop_lat", 90], ["stop_lon", 180]]) {
        check(typeof row[field] === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(row[field]) && Number.isFinite(Number(row[field])) && Math.abs(Number(row[field])) <= max, `Invalid ${field}`);
      }
    }
    if (row.parent_station) check(stopMap.has(row.parent_station) && row.parent_station !== row.stop_id, "Unknown or self parent_station");
    if (["2", "3", "4"].includes(type)) check(row.parent_station, "Missing parent_station");
  }
  const routeIds = new Set(routes.map((row) => row.route_id));
  for (const row of routes) {
    check(row.route_short_name?.trim() || row.route_long_name?.trim(), "Missing route name");
    check(["0", "1", "2", "3", "4", "5", "6", "7", "11", "12"].includes(row.route_type), "Invalid route_type");
    if (agencies.length > 1) check(row.agency_id?.trim(), "Multiple agencies require routes.agency_id");
    if (row.agency_id) check(agencyIds.has(row.agency_id), "Unknown route agency_id");
  }
  for (const row of calendar) {
    check(DAYS.every((day) => ["0", "1"].includes(row[day])), "Invalid calendar weekday");
    check(isDate(row.start_date) && isDate(row.end_date) && row.start_date <= row.end_date, "Invalid calendar date range");
  }
  for (const row of dates) {
    check(isDate(row.date) && ["1", "2"].includes(row.exception_type), "Invalid calendar exception");
  }
  // Date exceptions with type 1 can add service without a weekly calendar row.
  const serviceIds = new Set([...calendar.map((row) => row.service_id), ...dates.filter((row) => row.exception_type === "1").map((row) => row.service_id)]);
  const tripIds = new Set(trips.map((row) => row.trip_id));
  for (const row of trips) {
    check(routeIds.has(row.route_id), "Unknown trip route_id");
    check(serviceIds.has(row.service_id), "Unknown trip service_id");
  }
  // Group stop times by trip so sequence and chronological order can be checked together.
  const byTrip = new Map();
  for (const row of stopTimes) {
    check(tripIds.has(row.trip_id), "Unknown stop_times trip_id");
    check(stopMap.has(row.stop_id) && ["", "0"].includes(stopMap.get(row.stop_id).location_type || ""), "Unknown or non-platform stop_id");
    check(/^\d+$/.test(row.stop_sequence) && Number.isSafeInteger(Number(row.stop_sequence)), "Invalid stop_sequence");
    check(!row.timepoint || ["0", "1"].includes(row.timepoint), "Invalid timepoint");
    for (const field of ["arrival_time", "departure_time"]) if (row[field]) time(row[field]);
    if (row.timepoint !== "0") check(row.arrival_time && row.departure_time, "Exact stop requires arrival and departure times");
    if (row.arrival_time && row.departure_time) check(time(row.departure_time) >= time(row.arrival_time), "Departure precedes arrival");
    if (!byTrip.has(row.trip_id)) byTrip.set(row.trip_id, []);
    byTrip.get(row.trip_id).push(row);
  }
  for (const trip of trips) {
    const times = byTrip.get(trip.trip_id);
    check(times?.length >= 2, "Trip requires at least two stop times");
    // Sort a separate list of row references; keep the returned table in file order.
    times.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    check(times[0].arrival_time && times[0].departure_time && times.at(-1).arrival_time && times.at(-1).departure_time, "First and last stops require times");
    let previous = -1;
    let previousSequence = -1;
    for (const row of times) {
      const sequence = Number(row.stop_sequence);
      check(sequence > previousSequence, "Duplicate stop_sequence");
      previousSequence = sequence;
      for (const field of ["arrival_time", "departure_time"]) {
        if (row[field]) {
          const current = time(row[field]);
          check(current >= previous, "Stop times run backwards");
          previous = current;
        }
      }
    }
  }
}

/**
 * Validate an uploaded ZIP and return approved core rows, counts and agency-check status.
 * @param {Buffer} buffer Uploaded ZIP bytes.
 * @param {Object} options Optional server limits and a trusted agencyMatcher callback.
 * @returns {Promise<Object>} Validation summary and parsed core tables; rejects on failure.
 *
 * Await this function before calling an importer; it has no database access or writes.
 * Covers core stop-based GTFS Schedule, not full conformance or optional-table semantics.
 * Reference: https://gtfs.org/documentation/schedule/reference/
 * Fare files are optional. Only the validated core tables are returned for integration.
 * The HTTP upload handler must enforce a size limit before buffering the request.
 * Supply agencyMatcher only with a trusted mapping; a feed-local ID or ZIP name is not proof.
 * Without a mapping, agencyCheck.status is "skipped", never an assumed match.
 */
async function validateGtfsUpload(buffer, options = {}) {
  // Invalid server configuration is a programmer error, not a damaged upload.
  if (options.agencyMatcher !== undefined && typeof options.agencyMatcher !== "function") {
    throw new TypeError("agencyMatcher must be a trusted matching function");
  }
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) throw new TypeError(`Invalid limit: ${key}`);
  }
  let archive;
  try {
    // Phase 1: establish that the ZIP is readable, intact and within resource limits.
    archive = await readArchive(buffer, limits);
  } catch (error) {
    throw new GtfsValidationError("FILE_UNREADABLE", error.detail || error.message);
  }
  let tables;
  try {
    // Phase 2: parse core files, then check their contents and cross-table references.
    tables = parseTables(archive.files, archive.names, limits);
    validateTables(tables);
  } catch (error) {
    if (error instanceof GtfsValidationError) throw error;
    throw new GtfsValidationError("INVALID_GTFS", error.message);
  }
  let agencyCheck = { status: "skipped" };
  if (options.agencyMatcher) {
    // Phase 3: use read-only copies so a matching callback cannot alter approved rows.
    const agencies = Object.freeze(tables["agency.txt"].map((row) => Object.freeze({ ...row })));
    // Keep lookup/configuration failures distinct from an invalid uploaded archive.
    const matches = await options.agencyMatcher(agencies);
    if (typeof matches !== "boolean") throw new TypeError("agencyMatcher must return a boolean");
    if (!matches) throw new GtfsValidationError("AGENCY_MISMATCH", "The trusted mapping rejected the feed agencies");
    agencyCheck = { status: "matched" };
  }
  // A successful result approves only these core tables, not every optional GTFS feature.
  return {
    valid: true,
    agencies: tables["agency.txt"].map((row) => ({ id: row.agency_id || null, name: row.agency_name, url: row.agency_url })),
    agencyCheck,
    recordCounts: Object.fromEntries(Object.entries(tables).map(([file, rows]) => [file, rows.length])),
    tables,
  };
}

module.exports = { validateGtfsUpload, GtfsValidationError, DEFAULT_LIMITS };
