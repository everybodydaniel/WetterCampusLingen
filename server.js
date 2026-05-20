/**
 * @module server
 * @description Hauptserver für das Campus-Wetter-Dashboard.
 *              Holt aktuelle Wetterdaten von der WeatherLink-Station,
 *              Vorhersagen vom DWD (MOSMIX) und Luftqualität von Open-Meteo.
 *              Stellt alles über eine REST-API und statische Dateien bereit.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('./db');

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const CACHE_TTL_MS = 10 * 60 * 1000;
const HTTP_TIMEOUT_MS = 5000;
const TIME_ZONE = 'Europe/Berlin';
const HISTORY_FILE = path.join(ROOT, 'weather-history.json');

const WEATHERLINK_INTERVAL_MS = 1 * 60 * 60 * 1000;
let lastWeatherlinkFetchAt = 0;
let lastWeatherlinkCurrent = null;

const DWD = {
    history: 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/recent/tageswerte_KL_15813_akt.zip',
};

const WEATHERLINK = {
    currentConditions: 'http://131.173.66.27/v1/current_conditions',
};

const LINGEN_COORDS = { lat: 52.5212, lon: 7.3072 };

/**
 * Baut die Open-Meteo-Air-Quality-URL dynamisch.
 * Historie ueber start_date (1 Jahr zurueck) statt past_days (Open-Meteo erlaubt
 * mit past_days nur max 92 Tage). Forecast ueber end_date (today + 6 Tage = das
 * Open-Meteo-Maximum). start_date und end_date schliessen past_days/forecast_days aus.
 */
function buildAirQualityUrl() {
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), 1));
    const end = new Date(today);
    end.setDate(today.getDate() + 6);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    return `https://air-quality-api.open-meteo.com/v1/air-quality`
        + `?latitude=${LINGEN_COORDS.lat}&longitude=${LINGEN_COORDS.lon}`
        + `&hourly=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,sulphur_dioxide`
        + `&timezone=Europe%2FBerlin`
        + `&start_date=${startDate}`
        + `&end_date=${endDate}`;
}

const cache = new Map();

/**
 * Lädt eine URL als Buffer herunter (HTTP oder HTTPS).
 * Folgt automatisch Redirects (3xx) und bricht nach Timeout ab.
 * @param {string} url - Die URL, von der geladen werden soll.
 * @param {number} [timeoutMs=HTTP_TIMEOUT_MS] - Timeout in Millisekunden.
 * @returns {Promise<Buffer>} Der heruntergeladene Inhalt als Buffer.
 */
function fetchBuffer(url, timeoutMs = HTTP_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;

        const req = client.get(url, { headers: { 'User-Agent': 'Webtech-Wetter-Lingen/1.0' }, timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchBuffer(new URL(res.headers.location, url).toString(), timeoutMs).then(resolve, reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`Weather data request failed (${res.statusCode}) for ${url}`));
                res.resume();
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Timeout nach ${timeoutMs}ms für ${url}`));
        });
    });
}

/**
 * Holt JSON-Daten von einer URL.
 * @param {string} url - Die URL zur JSON-Ressource.
 * @returns {Promise<Object>} Das geparste JSON-Objekt.
 */
async function fetchJson(url) {
    const buffer = await fetchBuffer(url);
    return JSON.parse(buffer.toString('utf8'));
}

/**
 * Einfacher In-Memory-Cache mit TTL.
 * Gibt gecachte Daten zurück, wenn sie noch frisch sind,
 * ansonsten wird der Loader erneut aufgerufen.
 * @param {string} key - Eindeutiger Cache-Schluessel.
 * @param {Function} loader - Async-Funktion, die die Daten laedt.
 * @returns {Promise<*>} Die (ggf. gecachten) Daten.
 */
async function cached(key, loader) {
    const existing = cache.get(key);
    if (existing && Date.now() - existing.createdAt < CACHE_TTL_MS) {
        return existing.value;
    }

    const value = await loader();
    cache.set(key, { createdAt: Date.now(), value });
    return value;
}

/**
 * Entpackt alle Eintraege aus einem ZIP-Buffer.
 * Unterstützt unkomprimierte (store) und deflate-komprimierte Dateien.
 * @param {Buffer} buffer - Der ZIP-Dateiinhalt.
 * @returns {Array<{name: string, data: Buffer}>} Liste der entpackten Dateien.
 */
function unzipEntries(buffer) {
    const entries = [];
    const eocdOffset = findEndOfCentralDirectory(buffer);

    if (eocdOffset === -1) {
        throw new Error('ZIP central directory could not be found.');
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let centralOffset = buffer.readUInt32LE(eocdOffset + 16);

    for (let index = 0; index < entryCount; index += 1) {
        const centralSignature = buffer.readUInt32LE(centralOffset);
        if (centralSignature !== 0x02014b50) {
            break;
        }

        const method = buffer.readUInt16LE(centralOffset + 10);
        const compressedSize = buffer.readUInt32LE(centralOffset + 20);
        const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
        const extraLength = buffer.readUInt16LE(centralOffset + 30);
        const commentLength = buffer.readUInt16LE(centralOffset + 32);
        const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
        const name = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8');

        const localSignature = buffer.readUInt32LE(localHeaderOffset);
        if (localSignature !== 0x04034b50) {
            throw new Error(`Invalid ZIP local header for ${name}`);
        }

        const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
        let data;

        if (method === 0) {
            data = compressed;
        } else if (method === 8) {
            data = zlib.inflateRawSync(compressed);
        } else {
            throw new Error(`Unsupported ZIP compression method ${method}`);
        }

        entries.push({ name, data });
        centralOffset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
}

function findEndOfCentralDirectory(buffer) {
    const minOffset = Math.max(0, buffer.length - 65557);
    for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
        if (buffer.readUInt32LE(offset) === 0x06054b50) {
            return offset;
        }
    }
    return -1;
}



/**
 * Wandelt einen Rohwert in eine Zahl um.
 * Behandelt diverse Sonderfälle wie Komma-Dezimaltrenner,
 * Platzhalter ('-999', '---' usw.) und gibt dann null zurück.
 * @param {*} value - Der Rohwert (String, Zahl oder null/undefined).
 * @returns {number|null} Die bereinigte Zahl oder null.
 */
function numberValue(value) {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).trim().replace(',', '.');
    if (!cleaned || cleaned === '-' || cleaned === '---' || cleaned === '-999' || cleaned === '-999.0') {
        return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function validNumbers(values) {
    return values.filter(v => v !== null && v !== undefined && Number.isFinite(v));
}

function firstFinite(...values) {
    return validNumbers(values)[0] ?? null;
}

function fahrenheitToCelsius(value) {
    return value === null ? null : (value - 32) * (5 / 9);
}

function mphToKmh(value) {
    return value === null ? null : value * 1.609344;
}

function inHgToHpa(value) {
    return value === null ? null : value * 33.8638866667;
}

function rainCountToMm(count, rainSize) {
    if (count === null) return null;

    const millimetersPerCount = {
        1: 0.254,
        2: 0.2,
        3: 0.1,
        4: 0.0254,
    }[rainSize] ?? 0.2;

    return count * millimetersPerCount;
}

function average(values) {
    const valid = validNumbers(values);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sum(values) {
    return validNumbers(values)
        .reduce((total, value) => total + value, 0);
}

function max(values) {
    const valid = validNumbers(values);
    return valid.length ? Math.max(...valid) : null;
}

function min(values) {
    const valid = validNumbers(values);
    return valid.length ? Math.min(...valid) : null;
}

function localDateKey(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);

    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(date, options) {
    return new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, ...options }).format(date);
}

function directionLabel(degrees) {
    if (degrees === null) return '';
    const directions = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(degrees / 45) % 8];
}

/**
 * Berechnet die gefühlte Temperatur (Wind-Chill oder Hitzeindex).
 * Unter 10 Grad wird der Wind-Chill-Faktor genommen,
 * ueber 26 Grad der vereinfachte Hitzeindex.
 * @param {number|null} temp - Temperatur in Grad Celsius.
 * @param {number|null} windKmh - Windgeschwindigkeit in km/h.
 * @param {number|null} humidity - Relative Luftfeuchtigkeit in Prozent.
 * @returns {number|null} Gefuehlte Temperatur in Grad Celsius.
 */
function apparentTemperature(temp, windKmh, humidity) {
    if (temp === null) return null;
    if (temp <= 10 && windKmh && windKmh > 4.8) {
        return 13.12 + (0.6215 * temp) - (11.37 * windKmh ** 0.16) + (0.3965 * temp * windKmh ** 0.16);
    }
    if (temp >= 26 && humidity) {
        return temp + (0.05 * humidity);
    }
    return temp;
}

/**
 * Bestimmt die Wetterlage anhand von Wettercode, Bewölkung und Niederschlag.
 * @param {number|null} code - DWD-Wettercode (ww).
 * @param {number|null} cloudCover - Bewölkungsgrad in Prozent.
 * @param {number|null} precipitation - Niederschlag in mm.
 * @returns {{key: string, label: string}} Wetterzustand mit Schluessel und deutschem Label.
 */
function conditionFromWeather(code, cloudCover, precipitation) {
    if (code >= 95) return { key: 'storm', label: 'Gewitter' };
    if (code >= 80 || (code >= 50 && code <= 69) || precipitation > 0.1) {
        return { key: 'rain', label: 'Regen' };
    }
    if (cloudCover !== null && cloudCover >= 87) return { key: 'cloudy', label: 'Bewölkt' };
    if (cloudCover !== null && cloudCover >= 35) return { key: 'partlyCloudy', label: 'Wolkig' };
    return { key: 'sunny', label: 'Sonnig' };
}

function findWeatherlinkCondition(conditions, structureType) {
    return conditions.find(item => Number(item.data_structure_type) === structureType) || null;
}

function weatherlinkRainMm(record, names) {
    const rainSize = numberValue(record?.rain_size);

    for (const name of names) {
        const millimeters = numberValue(record?.[`${name}_mm`]);
        if (millimeters !== null) return millimeters;

        const inches = numberValue(record?.[`${name}_in`]);
        if (inches !== null) return inches * 25.4;

        const counts = numberValue(record?.[name]);
        if (counts !== null) return rainCountToMm(counts, rainSize);
    }

    return null;
}

function weatherlinkCondition(record, precipitationLastHour) {
    const rainRate = weatherlinkRainMm(record, ['rain_rate_last']);
    if ((precipitationLastHour !== null && precipitationLastHour > 0.1) || (rainRate !== null && rainRate > 0.1)) {
        return { key: 'rain', label: 'Regen' };
    }

    const solarRadiation = numberValue(record?.solar_rad);
    if (solarRadiation !== null && solarRadiation >= 350) {
        return { key: 'sunny', label: 'Sonnig' };
    }
    if (solarRadiation !== null && solarRadiation >= 80) {
        return { key: 'partlyCloudy', label: 'Wolkig' };
    }

    return { key: 'partlyCloudy', label: 'Trocken' };
}

/**
 * Parst die JSON-Antwort der WeatherLink-API und extrahiert die aktuellen Messwerte.
 * Rechnet alles von imperischen Einheiten (Fahrenheit, mph, inHg) in metrische um.
 * @param {Object} payload - Rohe JSON-Antwort von der WeatherLink-Station.
 * @returns {Object} Aufbereitetes Objekt mit Temperatur, Wind, Feuchte usw.
 */
function parseWeatherlinkCurrent(payload) {
    const data = payload?.data;
    const conditions = Array.isArray(data?.conditions) ? data.conditions : [];
    const iss = findWeatherlinkCondition(conditions, 1);
    const barometer = findWeatherlinkCondition(conditions, 3);

    if (!iss) {
        throw new Error('WeatherLink current conditions did not include an ISS record.');
    }

    const observedAt = new Date((numberValue(iss.ts) || numberValue(data.ts) || Date.now() / 1000) * 1000);
    const temperature = fahrenheitToCelsius(numberValue(iss.temp));
    const humidity = numberValue(iss.hum);
    const windSpeed = mphToKmh(firstFinite(
        numberValue(iss.wind_speed_avg_last_10_min),
        numberValue(iss.wind_speed_avg_last_2_min),
        numberValue(iss.wind_speed_last)
    ));
    const windGust = mphToKmh(firstFinite(
        numberValue(iss.wind_speed_hi_last_10_min),
        numberValue(iss.wind_speed_hi_last_2_min)
    ));
    const windDirection = firstFinite(
        numberValue(iss.wind_dir_scalar_avg_last_10_min),
        numberValue(iss.wind_dir_scalar_avg_last_2_min),
        numberValue(iss.wind_dir_last)
    );
    const precipitation = weatherlinkRainMm(iss, ['rainfall_last_60_min', 'rain_60_min']);
    const rainfallDaily = weatherlinkRainMm(iss, ['rainfall_daily']);
    const pressure = inHgToHpa(firstFinite(numberValue(barometer?.bar_sea_level), numberValue(barometer?.bar_absolute)));
    const pressureTrend = numberValue(barometer?.bar_trend);
    const dewPoint = fahrenheitToCelsius(numberValue(iss.dew_point));
    const feelsLike = fahrenheitToCelsius(firstFinite(
        numberValue(iss.thw_index),
        numberValue(iss.heat_index),
        numberValue(iss.wind_chill),
        numberValue(iss.temp)
    ));
    const condition = weatherlinkCondition(iss, precipitation);

    return {
        temperature: round(temperature),
        feelsLike: round(feelsLike ?? apparentTemperature(temperature, windSpeed, humidity)),
        condition: condition.label,
        conditionKey: condition.key,
        wind: {
            speed: round(windSpeed),
            direction: directionLabel(windDirection),
            degrees: windDirection,
            gust: round(windGust),
        },
        humidity: round(humidity),
        precipitation: round(precipitation, 1),
        rainfallDaily: round(rainfallDaily, 1),
        pressure: round(pressure, 1),
        pressureTrend: pressureTrend === null ? null : round(pressureTrend, 3),
        dewPoint: round(dewPoint, 1),
        cloudCover: null,
        solarRadiation: numberValue(iss.solar_rad),
        uvIndex: numberValue(iss.uv_index),
        observedAt: observedAt.toISOString(),
        observedAtLabel: `${formatDate(observedAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${formatDate(observedAt, { hour: '2-digit', minute: '2-digit' })} Uhr`,
        station: {
            id: data.did || String(iss.lsid || 'weatherlink'),
            name: 'WeatherLink Lingen',
        },
    };
}



/**
 * Parst die tagesgenaue Klimadaten-Datei vom DWD (CDC-Archiv).
 * Das ist eine Semikolon-getrennte Textdatei mit Kopfzeile.
 * @param {string} text - Roher Dateiinhalt (Latin-1 dekodiert).
 * @returns {Object} Aufbereitetes History-Objekt mit Monaten und Tagen.
 */
function parseDailyHistory(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines.shift().split(';').map(header => header.trim());
    const rows = lines.map(line => {
        const cells = line.split(';').map(cell => cell.trim());
        const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
        const date = row.MESS_DATUM;
        return {
            stationId: row.STATIONS_ID,
            date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
            meanTemp: numberValue(row.TMK),
            highTemp: numberValue(row.TXK),
            lowTemp: numberValue(row.TNK),
            groundLowTemp: numberValue(row.TGK),
            humidity: numberValue(row.UPM),
            precipitation: numberValue(row.RSK),
            precipitationForm: numberValue(row.RSKF),
            sunshineHours: numberValue(row.SDK),
            snowDepth: numberValue(row.SHK_TAG),
            cloudCover: numberValue(row.NM),
            pressure: numberValue(row.PM),
            vaporPressure: numberValue(row.VPM),
            windMean: numberValue(row.FM),
            windGust: numberValue(row.FX),
        };
    }).filter(row => row.date && row.meanTemp !== null);

    const mappedRows = rows.map(row => ({
        ...row,
        conditionKey: conditionFromWeather(null, row.cloudCover === null ? null : (row.cloudCover / 8) * 100, row.precipitation).key,
    }));

    return buildHistoryFromDays(mappedRows, {
        id: '15813',
        name: 'Lingen-Baccum',
    });
}

async function readWeatherlinkHistoryRecords() {
    try {
        const content = await fs.promises.readFile(HISTORY_FILE, 'utf8');
        const parsed = JSON.parse(content);
        return Array.isArray(parsed.records) ? parsed.records : [];
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function writeWeatherlinkHistoryRecords(records) {
    await fs.promises.writeFile(HISTORY_FILE, `${JSON.stringify({ records }, null, 2)}\n`, 'utf8');
}

function currentToHistoryRecord(current) {
    return {
        observedAt: current.observedAt,
        date: localDateKey(new Date(current.observedAt)),
        stationId: current.station.id,
        stationName: current.station.name,
        meanTemp: current.temperature,
        highTemp: current.temperature,
        lowTemp: current.temperature,
        humidity: current.humidity,
        precipitation: current.precipitation,
        rainfallDaily: current.rainfallDaily,
        pressure: current.pressure,
        windMean: current.wind.speed,
        windGust: current.wind.gust,
        conditionKey: current.conditionKey,
        solarRadiation: current.solarRadiation,
    };
}

/**
 * Aktualisiert die lokale JSON-Datei mit WeatherLink-History-Einträgen.
 * Fügt den neuen Datensatz hinzu und entfernt alles älter als ein Jahr.
 * @param {Object} current - Aktuelle Wetterdaten von der WeatherLink-Station.
 * @returns {Promise<Array<Object>>} Aktualisierte sortierte Datensaetze.
 */
async function updateWeatherlinkHistoryRecords(current) {
    const existing = await readWeatherlinkHistoryRecords();
    const nextRecord = currentToHistoryRecord(current);
    const byTimestamp = new Map(existing.map(record => [record.observedAt, record]));
    byTimestamp.set(nextRecord.observedAt, nextRecord);

    const cutoff = new Date(current.observedAt);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);

    const records = [...byTimestamp.values()]
        .filter(record => record.observedAt && new Date(record.observedAt) > cutoff)
        .sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));

    await writeWeatherlinkHistoryRecords(records);
    return records;
}

function aggregateWeatherlinkDays(records) {
    const groups = new Map();
    records.forEach(record => {
        if (!groups.has(record.date)) groups.set(record.date, []);
        groups.get(record.date).push(record);
    });

    return [...groups.entries()].map(([date, rows]) => {
        const rainfallDaily = max(rows.map(row => row.rainfallDaily));
        const precipitation = rainfallDaily ?? max(rows.map(row => row.precipitation)) ?? 0;
        const conditionKey = rows.some(row => row.conditionKey === 'rain') || precipitation > 0.1
            ? 'rain'
            : (rows.some(row => row.conditionKey === 'sunny') ? 'sunny' : 'partlyCloudy');

        return {
            stationId: rows[0]?.stationId || 'weatherlink',
            date,
            meanTemp: round(average(rows.map(row => row.meanTemp)), 1),
            highTemp: round(max(rows.map(row => row.highTemp)), 1),
            lowTemp: round(min(rows.map(row => row.lowTemp)), 1),
            groundLowTemp: null,
            humidity: round(average(rows.map(row => row.humidity))),
            precipitation: round(precipitation, 1),
            precipitationForm: null,
            sunshineHours: null,
            snowDepth: null,
            cloudCover: null,
            pressure: round(average(rows.map(row => row.pressure)), 1),
            vaporPressure: null,
            windMean: round(average(rows.map(row => row.windMean)), 1),
            windGust: round(max(rows.map(row => row.windGust)), 1),
            conditionKey,
            label: formatDayLabel(date),
        };
    });
}

function flattenHistoryDays(history) {
    return history.months
        .flatMap(month => month.days)
        .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Baut aus einer Liste von Tagen ein strukturiertes History-Objekt.
 * Fehlende Tage werden durch Interpolation der Nachbarn aufgefüllt.
 * Die Tage werden nach Monaten gruppiert und jeweils zusammengefasst.
 * @param {Array<Object>} days - Array mit Tagesdatensaetzen.
 * @param {Object} station - Stations-Info (id, name).
 * @returns {Object} History-Objekt mit station, months[] usw.
 */
function buildHistoryFromDays(days, station) {
    const sortedDays = days
        .filter(day => day.date && day.meanTemp !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (sortedDays.length === 0) return { station, months: [] };

    const startDate = new Date(`${sortedDays[0].date}T00:00:00Z`);
    const endDate = new Date(`${sortedDays[sortedDays.length - 1].date}T00:00:00Z`);
    const daysMap = new Map(sortedDays.map(d => [d.date, d]));

    const completeDays = [];
    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        if (daysMap.has(dateStr)) {
            completeDays.push(daysMap.get(dateStr));
        } else {
            const prev = completeDays[completeDays.length - 1];
            const nextIdx = sortedDays.findIndex(day => day.date > dateStr);
            const next = nextIdx !== -1 ? sortedDays[nextIdx] : prev;

            if (prev && next) {
                completeDays.push({
                    date: dateStr,
                    meanTemp: round((prev.meanTemp + next.meanTemp) / 2, 1),
                    highTemp: round((prev.highTemp + next.highTemp) / 2, 1),
                    lowTemp: round((prev.lowTemp + next.lowTemp) / 2, 1),
                    precipitation: round((prev.precipitation + next.precipitation) / 2, 1),
                    humidity: round((prev.humidity + next.humidity) / 2),
                    windMean: round((prev.windMean + next.windMean) / 2, 1),
                    windGust: round((prev.windGust + next.windGust) / 2, 1),
                    pressure: round((prev.pressure + next.pressure) / 2, 1),
                    cloudCover: round((prev.cloudCover + next.cloudCover) / 2, 1),
                    conditionKey: prev.conditionKey,
                    label: formatDayLabel(dateStr)
                });
            } else {
                completeDays.push({
                    date: dateStr,
                    meanTemp: null,
                    highTemp: null,
                    lowTemp: null,
                    precipitation: null,
                    humidity: null,
                    windMean: null,
                    windGust: null,
                    pressure: null,
                    cloudCover: null,
                    conditionKey: 'partlyCloudy',
                    label: formatDayLabel(dateStr)
                });
            }
        }
    }

    const latestDate = completeDays[completeDays.length - 1].date;
    const cutoff = new Date(`${latestDate}T00:00:00Z`);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    cutoff.setUTCDate(1);
    cutoff.setUTCDate(0);

    const recentDays = completeDays.filter(day => new Date(`${day.date}T00:00:00Z`) > cutoff);
    const groups = new Map();
    recentDays.forEach(day => {
        const monthKey = day.date.slice(0, 7);
        if (!groups.has(monthKey)) groups.set(monthKey, []);
        groups.get(monthKey).push(day);
    });

    return {
        station,
        latestDate,
        earliestDate: recentDays[0]?.date,
        months: [...groups.entries()].reverse().map(([key, monthDays]) => ({
            key,
            label: formatMonthLabel(key),
            summary: summarizeDays(monthDays),
            days: monthDays.map(day => ({
                ...day,
                label: day.label || formatDayLabel(day.date),
            })).reverse(),
        })),
    };
}

/**
 * Merged die aktuellen WeatherLink-Tage in die DWD-History.
 * Dadurch wird die Lücke zwischen dem letzten DWD-Tag und heute geschlossen.
 * @param {Object} baseHistory - DWD-basierte Historie.
 * @param {Object} current - Aktuelle WeatherLink-Beobachtung.
 * @returns {Promise<Object>} Zusammengeführte History.
 */
async function mergeCurrentDaysIntoHistory(baseHistory, current) {
    const weatherlinkRecords = await updateWeatherlinkHistoryRecords(current);
    const weatherlinkDays = aggregateWeatherlinkDays(weatherlinkRecords)
        .filter(day => !baseHistory.latestDate || day.date > baseHistory.latestDate);

    if (!weatherlinkDays.length) {
        return baseHistory;
    }

    const daysByDate = new Map(flattenHistoryDays(baseHistory).map(day => [day.date, day]));
    weatherlinkDays.forEach(day => daysByDate.set(day.date, day));

    return buildHistoryFromDays([...daysByDate.values()], baseHistory.station);
}

function formatMonthLabel(key) {
    return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(`${key}-01T00:00:00Z`));
}

function formatDayLabel(key) {
    return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${key}T00:00:00Z`));
}

function summarizeDays(days) {
    return {
        days: days.length,
        meanTemp: round(average(days.map(day => day.meanTemp)), 1),
        highTemp: round(max(days.map(day => day.highTemp)), 1),
        lowTemp: round(min(days.map(day => day.lowTemp)), 1),
        precipitation: round(sum(days.map(day => day.precipitation)), 1),
        humidity: round(average(days.map(day => day.humidity))),
        windMean: round(average(days.map(day => day.windMean)), 1),
        windGust: round(max(days.map(day => day.windGust)), 1),
        pressure: round(average(days.map(day => day.pressure)), 1),
        cloudCover: round(average(days.map(day => day.cloudCover)), 1),
        sunshineHours: null,
    };
}

const AQI_CATEGORIES = [
    { max: 20,  key: 'very-good',  label: 'Sehr gut',         color: '#50f0e6' },
    { max: 40,  key: 'good',       label: 'Gut',              color: '#50ccaa' },
    { max: 60,  key: 'moderate',   label: 'Mäßig',            color: '#f0e641' },
    { max: 80,  key: 'poor',       label: 'Schlecht',         color: '#ff5050' },
    { max: 100, key: 'very-poor',  label: 'Sehr schlecht',    color: '#960032' },
    { max: Infinity, key: 'extremely-poor', label: 'Extrem schlecht', color: '#7d2181' },
];

function aqiCategory(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return { key: 'unknown', label: 'Keine Daten', color: '#9aa1a8' };
    }
    return AQI_CATEGORIES.find(category => value <= category.max);
}

/**
 * Baut aus den stündlichen Open-Meteo-Daten ein Array mit Luftqualitäts-Datenpunkten.
 * Jeder Eintrag enthält AQI, Feinstaub, Stickstoffdioxid usw.
 * @param {Object} payload - JSON-Antwort der Open-Meteo Air Quality API.
 * @returns {Array<Object>} Stündliche AQI-Datenpunkte.
 */
function buildAqiHourly(payload) {
    const hourly = payload?.hourly;
    if (!hourly || !Array.isArray(hourly.time)) return [];

    return hourly.time.map((iso, index) => ({
        time: iso,
        dateKey: localDateKey(new Date(iso)),
        aqi: numberValue(hourly.european_aqi?.[index]),
        pm10: numberValue(hourly.pm10?.[index]),
        pm25: numberValue(hourly.pm2_5?.[index]),
        no2: numberValue(hourly.nitrogen_dioxide?.[index]),
        o3: numberValue(hourly.ozone?.[index]),
        so2: numberValue(hourly.sulphur_dioxide?.[index]),
    }));
}

function aggregateAqiByDay(hourlyRecords) {
    const groups = new Map();
    hourlyRecords.forEach(record => {
        if (!record.dateKey) return;
        if (!groups.has(record.dateKey)) groups.set(record.dateKey, []);
        groups.get(record.dateKey).push(record);
    });

    return [...groups.entries()].map(([date, rows]) => {
        const aqiValues = rows.map(row => row.aqi).filter(value => value !== null);
        const peakIndex = aqiValues.length
            ? rows.findIndex(row => row.aqi === Math.max(...aqiValues))
            : -1;
        const peakRow = peakIndex >= 0 ? rows[peakIndex] : null;
        const aqi = round(max(aqiValues));
        const category = aqiCategory(aqi);

        return {
            date,
            aqi,
            aqiMean: round(average(aqiValues), 1),
            category: category.key,
            categoryLabel: category.label,
            color: category.color,
            pm10: round(average(rows.map(row => row.pm10)), 1),
            pm25: round(average(rows.map(row => row.pm25)), 1),
            no2: round(average(rows.map(row => row.no2)), 1),
            o3: round(average(rows.map(row => row.o3)), 1),
            so2: round(average(rows.map(row => row.so2)), 1),
            peakHour: peakRow ? formatDate(new Date(peakRow.time), { hour: '2-digit', minute: '2-digit' }) : null,
        };
    }).sort((a, b) => a.date.localeCompare(b.date));
}

function currentAqiFromHourly(hourlyRecords) {
    if (!hourlyRecords.length) return null;

    const now = Date.now();
    let bestRecord = null;
    let bestDelta = Infinity;

    for (const record of hourlyRecords) {
        if (record.aqi === null) continue;
        const delta = Math.abs(new Date(record.time).getTime() - now);
        if (delta < bestDelta) {
            bestDelta = delta;
            bestRecord = record;
        }
    }

    if (!bestRecord) return null;

    const category = aqiCategory(bestRecord.aqi);
    return {
        observedAt: bestRecord.time,
        aqi: round(bestRecord.aqi),
        category: category.key,
        categoryLabel: category.label,
        color: category.color,
        pm10: round(bestRecord.pm10, 1),
        pm25: round(bestRecord.pm25, 1),
        no2: round(bestRecord.no2, 1),
        o3: round(bestRecord.o3, 1),
        so2: round(bestRecord.so2, 1),
    };
}

/**
 * Lädt Luftqualitätsdaten (AQI) von der Open-Meteo API.
 * Cached die Ergebnisse intern. Gibt im Fehlerfall ein
 * Fallback-Objekt zurück, damit der Rest der Seite trotzdem geht.
 * @returns {Promise<Object>} AQI-Daten mit current, forecast, history.
 */
async function loadAirQuality() {
    return cached('air-quality', async () => {
        try {
            const payload = await fetchJson(buildAirQualityUrl());
            const hourlyRecords = buildAqiHourly(payload);
            const dailyAggregates = aggregateAqiByDay(hourlyRecords);
            const todayKey = localDateKey(new Date());

            return {
                source: 'open-meteo',
                location: { lat: LINGEN_COORDS.lat, lon: LINGEN_COORDS.lon },
                current: currentAqiFromHourly(hourlyRecords),
                forecast: dailyAggregates.filter(day => day.date > todayKey),
                history: dailyAggregates.filter(day => day.date <= todayKey),
                categories: AQI_CATEGORIES.map(({ key, label, color, max }) => ({
                    key, label, color, max: max === Infinity ? null : max,
                })),
            };
        } catch (error) {
            console.warn('[AQI] Air-Quality-API konnte nicht geladen werden:', error.message);
            return {
                source: 'open-meteo',
                location: { lat: LINGEN_COORDS.lat, lon: LINGEN_COORDS.lon },
                current: null,
                forecast: [],
                history: [],
                categories: AQI_CATEGORIES.map(({ key, label, color, max }) => ({
                    key, label, color, max: max === Infinity ? null : max,
                })),
                error: error.message,
            };
        }
    });
}

function attachAqiToForecast(forecast, aqiForecast) {
    if (!aqiForecast?.length) return forecast;
    const byDate = new Map(aqiForecast.map(entry => [entry.date, entry]));
    return forecast.map(day => {
        const aqi = byDate.get(day.date);
        return aqi ? { ...day, airQuality: aqi } : day;
    });
}

function attachAqiToHistory(history, aqiHistory) {
    if (!aqiHistory?.length) return history;
    const byDate = new Map(aqiHistory.map(entry => [entry.date, entry]));

    return {
        ...history,
        months: history.months.map(month => ({
            ...month,
            days: month.days.map(day => {
                const aqi = byDate.get(day.date);
                return aqi ? { ...day, airQuality: aqi } : day;
            }),
            summary: {
                ...month.summary,
                airQuality: monthAqiSummary(month.days.map(day => byDate.get(day.date)).filter(Boolean)),
            },
        })),
    };
}

function monthAqiSummary(aqiDays) {
    if (!aqiDays.length) return null;
    const aqiValues = aqiDays.map(day => day.aqi).filter(value => value !== null);
    if (!aqiValues.length) return null;
    const meanAqi = round(average(aqiValues));
    const peakAqi = round(max(aqiValues));
    const meanCategory = aqiCategory(meanAqi);
    return {
        meanAqi,
        peakAqi,
        category: meanCategory.key,
        categoryLabel: meanCategory.label,
        color: meanCategory.color,
        days: aqiDays.length,
    };
}



async function loadHistory() {
    return cached('history', async () => {
        const historyBuffer = await fetchBuffer(DWD.history);
        const historyEntry = unzipEntries(historyBuffer).find(entry => /^produkt_klima_tag_.*\.txt$/.test(entry.name));

        if (!historyEntry) {
            throw new Error('Required DWD history file was not found in archive.');
        }

        return parseDailyHistory(historyEntry.data.toString('latin1'));
    });
}

/**
 * Holt die stündliche Vorhersage von Open-Meteo (gestern + heute + 6 Folgetage)
 * und liefert sie aufgeteilt als { yesterday, today, future[] }.
 */
async function loadOpenMeteoForecast() {
    return cached('open-meteo-forecast', async () => {
        const url = `https://api.open-meteo.com/v1/forecast`
            + `?latitude=${LINGEN_COORDS.lat}&longitude=${LINGEN_COORDS.lon}`
            + `&hourly=temperature_2m,apparent_temperature,precipitation,`
            + `windspeed_10m,winddirection_10m,windgusts_10m,`
            + `relativehumidity_2m,dewpoint_2m,cloudcover,weathercode,`
            + `surface_pressure,uv_index,shortwave_radiation`
            + `&past_days=1&forecast_days=7`
            + `&timezone=Europe%2FBerlin`;

        try {
            const data = await fetchJson(url);
            return parseOpenMeteoForecast(data);
        } catch (err) {
            console.warn('[OM] Forecast nicht abrufbar:', err.message);
            return { yesterday: null, today: null, future: [] };
        }
    });
}

/**
 * Parst die Open-Meteo-Antwort und gruppiert die Stundenwerte nach lokalem Datum.
 */
function parseOpenMeteoForecast(payload) {
    const h = payload?.hourly;
    if (!h || !Array.isArray(h.time)) {
        return { yesterday: null, today: null, future: [] };
    }

    const grouped = new Map();
    h.time.forEach((iso, i) => {
        const dateKey = iso.slice(0, 10);
        if (!grouped.has(dateKey)) grouped.set(dateKey, []);
        grouped.get(dateKey).push({
            time: iso,
            hour: iso.slice(11, 16),
            temperature: numberValue(h.temperature_2m?.[i]),
            feelsLike: numberValue(h.apparent_temperature?.[i]),
            precipitation: numberValue(h.precipitation?.[i]),
            windKmh: numberValue(h.windspeed_10m?.[i]),
            windGustKmh: numberValue(h.windgusts_10m?.[i]),
            windDegrees: numberValue(h.winddirection_10m?.[i]),
            humidity: numberValue(h.relativehumidity_2m?.[i]),
            dewPoint: numberValue(h.dewpoint_2m?.[i]),
            cloudCover: numberValue(h.cloudcover?.[i]),
            weatherCode: numberValue(h.weathercode?.[i]),
            pressure: numberValue(h.surface_pressure?.[i]),
            uvIndex: numberValue(h.uv_index?.[i]),
            solarRadiation: numberValue(h.shortwave_radiation?.[i]),
        });
    });

    const buildDay = ([dateKey, values]) => {
        const firstDate = new Date(`${dateKey}T12:00:00`);
        const precipSum = sum(values.map(v => v.precipitation));
        const cloudMean = average(values.map(v => v.cloudCover));
        const dom = dominantOpenMeteoCondition(values, cloudMean, precipSum);
        return {
            day: formatDate(firstDate, { weekday: 'short' }).replace('.', ''),
            dayLong: formatDate(firstDate, { weekday: 'long' }),
            date: dateKey,
            dateLabel: formatDate(firstDate, { day: '2-digit', month: '2-digit', year: 'numeric' }),
            high: round(max(values.map(v => v.temperature))),
            low: round(min(values.map(v => v.temperature))),
            precipitation: round(precipSum, 1),
            wind: round(average(values.map(v => v.windKmh))),
            windGust: round(max(values.map(v => v.windGustKmh))),
            humidity: round(average(values.map(v => v.humidity))),
            cloudCover: round(cloudMean),
            conditionKey: dom.key,
            condition: dom.label,
            hourly: values.map(v => ({
                time: v.time,
                hour: v.hour,
                temperature: round(v.temperature, 1),
                feelsLike: round(v.feelsLike, 1),
                precipitation: round(v.precipitation, 1),
                windKmh: round(v.windKmh, 1),
                windGustKmh: round(v.windGustKmh, 1),
                windDegrees: round(v.windDegrees),
                humidity: round(v.humidity),
                dewPoint: round(v.dewPoint, 1),
                cloudCover: round(v.cloudCover),
                pressure: round(v.pressure, 1),
                uvIndex: round(v.uvIndex, 1),
                solarRadiation: round(v.solarRadiation),
                weatherCode: v.weatherCode,
                source: 'open-meteo',
            })),
        };
    };

    const todayKey = localDateKey(new Date());
    const yKey = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localDateKey(d); })();

    const yesterdayEntry = [...grouped.entries()].find(([k]) => k === yKey);
    const todayEntry = [...grouped.entries()].find(([k]) => k === todayKey);
    const future = [...grouped.entries()]
        .filter(([k]) => k > todayKey)
        .slice(0, 6)
        .map(buildDay);

    return {
        yesterday: yesterdayEntry ? buildDay(yesterdayEntry) : null,
        today: todayEntry ? buildDay(todayEntry) : null,
        future,
    };
}

function dominantOpenMeteoCondition(values, cloudMean, precipSum) {
    const codes = values.map(v => v.weatherCode).filter(Number.isFinite);
    if (codes.some(c => c >= 95)) return { key: 'storm', label: 'Gewitter' };
    if (precipSum > 0.8 || codes.some(c => c >= 80 || (c >= 50 && c <= 69))) {
        return { key: 'rain', label: 'Regen' };
    }
    return conditionFromWeather(null, cloudMean, 0);
}

/**
 * Mergt die Live-Werte der WeatherLink-Station in den Heute-Tag von Open-Meteo.
 * Strategie:
 *   – Tages-Aggregate (high/low/wind/humidity) bleiben Open-Meteo (vollstaendig).
 *   – Die Stunde, in die `current.observedAt` faellt, wird mit den WL-Sensor-
 *     werten ueberschrieben (Temperatur, Wind, Feuchte, Druck, UV, Niederschlag).
 *   – Fehlende WL-Felder bleiben unveraendert auf den Open-Meteo-Werten.
 *   – Faellt Open-Meteo aus, baut die Funktion einen Minimal-Heute-Tag aus den
 *     WL-Daten allein, damit das Modal nicht leer ist.
 */
function mergeWeatherlinkIntoToday(openMeteoToday, current) {
    if (!current) return openMeteoToday;

    if (!openMeteoToday) {
        const now = new Date(current.observedAt || Date.now());
        return {
            day: formatDate(now, { weekday: 'short' }).replace('.', ''),
            dayLong: formatDate(now, { weekday: 'long' }),
            date: localDateKey(now),
            dateLabel: formatDate(now, { day: '2-digit', month: '2-digit', year: 'numeric' }),
            high: current.temperature,
            low: current.temperature,
            precipitation: current.precipitation ?? 0,
            wind: current.wind?.speed ?? null,
            windGust: current.wind?.gust ?? null,
            humidity: current.humidity,
            cloudCover: null,
            conditionKey: current.conditionKey,
            condition: current.condition,
            hourly: [],
        };
    }

    const merged = { ...openMeteoToday, hourly: openMeteoToday.hourly.map(h => ({ ...h })) };
    const observedAt = new Date(current.observedAt || Date.now());
    const currentHourIso = `${localDateKey(observedAt)}T${String(observedAt.getHours()).padStart(2, '0')}:00`;

    const idx = merged.hourly.findIndex(h => h.time.startsWith(currentHourIso));
    if (idx >= 0) {
        const target = merged.hourly[idx];
        merged.hourly[idx] = {
            ...target,
            temperature: firstFinite(current.temperature, target.temperature),
            feelsLike: firstFinite(current.feelsLike, target.feelsLike),
            humidity: firstFinite(current.humidity, target.humidity),
            dewPoint: firstFinite(current.dewPoint, target.dewPoint),
            windKmh: firstFinite(current.wind?.speed, target.windKmh),
            windGustKmh: firstFinite(current.wind?.gust, target.windGustKmh),
            windDegrees: firstFinite(current.wind?.degrees, target.windDegrees),
            precipitation: firstFinite(current.precipitation, target.precipitation),
            pressure: firstFinite(current.pressure, target.pressure),
            uvIndex: firstFinite(current.uvIndex, target.uvIndex),
            solarRadiation: firstFinite(current.solarRadiation, target.solarRadiation),
            source: 'weatherlink+open-meteo',
        };
    }

    const temps = merged.hourly.map(h => h.temperature).filter(v => v !== null && v !== undefined);
    const precs = merged.hourly.map(h => h.precipitation);
    const winds = merged.hourly.map(h => h.windKmh);
    const gusts = merged.hourly.map(h => h.windGustKmh);
    const hums  = merged.hourly.map(h => h.humidity);
    const clds  = merged.hourly.map(h => h.cloudCover);

    merged.high = round(max(temps));
    merged.low = round(min(temps));
    merged.precipitation = round(sum(precs), 1);
    merged.wind = round(average(winds));
    merged.windGust = round(max(gusts));
    merged.humidity = round(average(hums));
    merged.cloudCover = round(average(clds));

    return merged;
}

/**
 * Baut das komplette Wetter-Payload zusammen, das der API-Endpunkt ausliefert.
 * Holt Daten von WeatherLink, DWD-Vorhersage, DWD-History und Luftqualitaet,
 * merged alles und speichert es in die DB (falls verfügbar).
 * @returns {Promise<Object>} Fertiges Payload-Objekt für das Frontend.
 */
async function buildWeatherPayload() {
    const now = Date.now();
    const timeSinceLastFetch = now - lastWeatherlinkFetchAt;
    const shouldFetchWeatherlink = timeSinceLastFetch >= WEATHERLINK_INTERVAL_MS;

    let current = null;

    if (shouldFetchWeatherlink) {

        try {
            const nextCallIn = Math.round(WEATHERLINK_INTERVAL_MS / 3600000);
            console.log(`[WL] WeatherLink-API wird abgerufen (naechster Abruf in ~${nextCallIn}h)...`);
            const weatherlinkPayload = await fetchJson(WEATHERLINK.currentConditions);
            current = parseWeatherlinkCurrent(weatherlinkPayload);
            lastWeatherlinkFetchAt = now;
            lastWeatherlinkCurrent = current;
            console.log('[WL] WeatherLink-Daten erfolgreich abgerufen:', current.temperature + '°C');

            if (db.isAvailable()) {
                db.saveCurrentObservation(current).catch(err =>
                    console.error('[DB] saveCurrentObservation fehlgeschlagen:', err.message)
                );
                db.logImportRun('WL_AKTUELLE_BEOBACHTUNG', 'erfolgreich', 1, 1, null).catch(() => {});
            }
        } catch (wlError) {
            console.warn('[WL] WeatherLink nicht erreichbar:', wlError.message);

            lastWeatherlinkFetchAt = now;
            if (db.isAvailable()) {
                db.logImportRun('WL_AKTUELLE_BEOBACHTUNG', 'fehlgeschlagen', 0, 0, wlError.message).catch(() => {});
            }
        }
    } else {
        const minutesAgo = Math.round(timeSinceLastFetch / 60000);
        const nextIn = Math.round((WEATHERLINK_INTERVAL_MS - timeSinceLastFetch) / 60000);
        console.log(`[WL] Rate-Limit aktiv: Letzter Abruf vor ${minutesAgo}min, naechster in ~${nextIn}min.`);
        current = lastWeatherlinkCurrent;
    }

    const [openMeteoForecast, dwdHistory, airQuality] = await Promise.all([
        loadOpenMeteoForecast(),
        loadHistory(),
        loadAirQuality(),
    ]);

    if (!current && db.isAvailable()) {
        console.log('[WL] Lade letzte Beobachtung aus Datenbank...');
        try {
            current = await db.loadLastObservation();
            if (current) {
                console.log(`[WL] DB-Beobachtung geladen: ${current.temperature}°C von ${current.observedAtLabel}`);
            }
        } catch (dbErr) {
            console.warn('[WL] DB-Beobachtung konnte nicht geladen werden:', dbErr.message);
        }
    }

    if (!current) {
        console.warn('[WL] Weder API noch DB liefern Daten – verwende Platzhalter.');
        current = buildFallbackCurrent();
    }

    const history = await mergeCurrentDaysIntoHistory(dwdHistory, current);

    const todayMerged = mergeWeatherlinkIntoToday(openMeteoForecast.today, current);

    const forecastFuture = attachAqiToForecast(openMeteoForecast.future, airQuality?.forecast);
    const todayDay = todayMerged
        ? attachAqiToForecast([todayMerged], airQuality?.history)[0]
        : null;
    const yesterdayDay = openMeteoForecast.yesterday
        ? attachAqiToForecast([openMeteoForecast.yesterday], airQuality?.history)[0]
        : null;
    const historyWithAqi = attachAqiToHistory(history, airQuality?.history);

    const payload = {
        location: {
            name: 'Kaiserstraße 10C, 49809 Lingen (Ems)',
            coords: LINGEN_COORDS,
        },
        current: { ...current, airQuality: airQuality?.current || null },
        today: todayDay,
        yesterday: yesterdayDay,
        forecast: forecastFuture,
        history: historyWithAqi,
        airQuality: {
            current: airQuality?.current || null,
            forecast: airQuality?.forecast || [],
            history: airQuality?.history || [],
            categories: airQuality?.categories || [],
            location: airQuality?.location || LINGEN_COORDS,
            source: airQuality?.source || 'open-meteo',
            error: airQuality?.error || null,
        },
        sources: {
            observations: WEATHERLINK.currentConditions,
            forecast: 'https://api.open-meteo.com/v1/forecast',
            history: DWD.history,
            historySupplement: HISTORY_FILE,
            airQuality: buildAirQualityUrl(),
        },
        fetchedAt: new Date().toISOString(),
    };

    if (db.isAvailable()) {
        db.saveWidgetCache('AKTUELLES_WETTER', payload).catch(err =>
            console.error('[DB] saveWidgetCache fehlgeschlagen:', err.message)
        );
    }

    return payload;
}

function buildFallbackCurrent() {
    return {
        temperature: null,
        feelsLike: null,
        condition: 'Keine Live-Daten',
        conditionKey: 'cloudy',
        wind: { speed: null, direction: '', degrees: null, gust: null },
        humidity: null,
        precipitation: null,
        rainfallDaily: null,
        pressure: null,
        cloudCover: null,
        solarRadiation: null,
        uvIndex: null,
        observedAt: new Date().toISOString(),
        observedAtLabel: 'Station nicht erreichbar',
        station: { id: 'weatherlink', name: 'WeatherLink Lingen' },
    };
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

/**
 * Liefert statische Dateien (HTML, CSS, JS, Bilder) aus dem Projektverzeichnis.
 * Prüft, dass der Pfad nicht aus dem Root-Verzeichnis ausbricht (Sicherheit).
 * @param {http.IncomingMessage} req - Das HTTP-Request-Objekt.
 * @param {http.ServerResponse} res - Das HTTP-Response-Objekt.
 */
function serveStatic(req, res) {
    const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
    const relativePath = requestPath === '/' ? '/index.html' : requestPath;
    const filePath = path.normalize(path.join(ROOT, relativePath));

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        res.writeHead(200, {
            'Content-Type': mimeType(filePath),
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
};

function mimeType(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/weather') {

        if (db.isAvailable()) {
            try {
                const cached = await db.loadWidgetCache('AKTUELLES_WETTER');
                if (cached) {
                    console.log('[API] Cache-First: Liefere DB-Cache sofort aus.');
                    cached._fromCache = true;
                    sendJson(res, 200, cached);

                    buildWeatherPayload().then(() => {
                        console.log('[API] Hintergrund-Aktualisierung: Frische Daten in DB gespeichert.');
                    }).catch(err => {
                        console.warn('[API] Hintergrund-Aktualisierung fehlgeschlagen:', err.message);
                    });
                    return;
                }
            } catch (dbError) {
                console.warn('[API] DB-Cache-Lesung fehlgeschlagen:', dbError.message);
            }
        }

        try {
            sendJson(res, 200, await buildWeatherPayload());
        } catch (error) {
            console.error('[API] Live-Daten fehlgeschlagen:', error.message);
            sendJson(res, 502, {
                error: 'Wetterdaten konnten nicht geladen werden.',
                detail: error.message,
            });
        }
        return;
    }

    if (url.pathname === '/api/weather/cached') {
        if (!db.isAvailable()) {
            sendJson(res, 503, { error: 'Datenbank nicht verfuegbar.' });
            return;
        }
        try {
            const cached = await db.loadWidgetCache('AKTUELLES_WETTER');
            if (cached) {
                sendJson(res, 200, cached);
            } else {
                sendJson(res, 404, { error: 'Kein Cache-Eintrag vorhanden.' });
            }
        } catch (dbError) {
            sendJson(res, 500, { error: 'DB-Fehler.', detail: dbError.message });
        }
        return;
    }

    serveStatic(req, res);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} ist bereits belegt.`);
        console.log(`Falls der Wetterserver schon läuft, öffne http://localhost:${PORT}`);
        console.log(`Alternativ kannst du einen anderen Port nutzen: PORT=5174 node server.js`);
        process.exit(0);
    }

    throw error;
});

db.checkConnection().then(available => {
    if (available) {
        console.log('[DB] MariaDB-Verbindung hergestellt.');
    } else {
        console.warn('[DB] MariaDB nicht erreichbar – Server startet ohne DB (nur Live-API).');
        console.warn('[DB] Konfiguration: .env oder Umgebungsvariablen DB_HOST, DB_USER, DB_PASSWORD, DB_NAME setzen.');
    }

    server.listen(PORT, () => {
        console.log(`Wetter-Dashboard läuft unter http://localhost:${PORT}`);
        if (available) {
            console.log(`[DB] Cache-Endpunkt: http://localhost:${PORT}/api/weather/cached`);
        }
    });
});
