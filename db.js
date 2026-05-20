

/**
 * @module db
 * @description Datenbankmodul für die MariaDB-Anbindung.
 *              Speichert Wetterbeobachtungen, cached Widget-Payloads und
 *              protokolliert Import-Läufe. Falls keine DB verfügbar ist,
 *              läuft der Server trotzdem weiter (nur ohne DB-Features).
 */

const mariadb = require('mariadb');
const fs = require('fs');
const path = require('path');

/**
 * Liest die .env-Datei manuell ein und setzt fehlende Umgebungsvariablen.
 */
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (!process.env[key]) process.env[key] = value;
    }
}
loadEnv();

function formatDbTimestamp(date = new Date()) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

const pool = mariadb.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'campus_wetter_app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'Campus_Wetter',
    connectionLimit: 5,
    acquireTimeout: 10000,
    idleTimeout: 60000,
    multipleStatements: false,
});

let dbAvailable = false;

/**
 * Prüft ob die Datenbankverbindung funktioniert.
 * Setzt die interne Flag dbAvailable entsprechend.
 * @returns {Promise<boolean>} true wenn die DB erreichbar ist.
 */
async function checkConnection() {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query('SELECT 1');
        dbAvailable = true;
    } catch (err) {
        dbAvailable = false;
        console.warn('[DB] MariaDB nicht erreichbar:', err.message);
    } finally {
        if (conn) conn.release();
    }
    return dbAvailable;
}

function isAvailable() {
    return dbAvailable;
}

/**
 * Speichert eine aktuelle Wetterbeobachtung in die DB.
 * @param {Object} current - Aktuelle Wetterdaten (Temperatur, Wind usw.).
 */
async function saveCurrentObservation(current) {
    if (!dbAvailable) return;
    let conn;
    try {
        conn = await pool.getConnection();

        const [station] = await conn.query(
            `SELECT es.externe_station_id, ma.messaufloesung_id
             FROM externe_station es
             JOIN datenanbieter d ON d.datenanbieter_id = es.datenanbieter_id
             CROSS JOIN messaufloesung ma
             WHERE d.kuerzel = 'WEATHERLINK'
               AND es.stationscode = ?
               AND ma.kuerzel = 'TEN_MIN'
             LIMIT 1`,
            [current.station.id]
        );

        if (!station) return;

        const observedAt = new Date(current.observedAt);
        const utc = formatDbTimestamp(observedAt);
        const lokal = formatDbTimestamp(
            new Date(observedAt.getTime() + 2 * 3600 * 1000)
        );

        await conn.query(
            `INSERT INTO wetterbeobachtung (
                externe_station_id, messaufloesung_id, gemessen_am_utc, gemessen_am_lokal,
                temperatur_c, relative_luftfeuchte_prozent, luftdruck_meereshoehe_hpa,
                niederschlag_mm, windgeschwindigkeit_ms, windboe_ms, windrichtung_grad,
                solarstrahlung_wm2, wettercode, datenstatus
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'vorlaeufig')
             ON DUPLICATE KEY UPDATE
                temperatur_c = VALUES(temperatur_c),
                relative_luftfeuchte_prozent = VALUES(relative_luftfeuchte_prozent),
                luftdruck_meereshoehe_hpa = VALUES(luftdruck_meereshoehe_hpa),
                niederschlag_mm = VALUES(niederschlag_mm),
                windgeschwindigkeit_ms = VALUES(windgeschwindigkeit_ms),
                windboe_ms = VALUES(windboe_ms),
                windrichtung_grad = VALUES(windrichtung_grad),
                solarstrahlung_wm2 = VALUES(solarstrahlung_wm2),
                wettercode = VALUES(wettercode),
                aktualisiert_am = CURRENT_TIMESTAMP`,
            [
                station.externe_station_id,
                station.messaufloesung_id,
                utc,
                lokal,
                current.temperature,
                current.humidity,
                current.pressure,
                current.precipitation,
                current.wind.speed != null ? current.wind.speed / 3.6 : null,
                current.wind.gust != null ? current.wind.gust / 3.6 : null,
                current.wind.degrees,
                current.solarRadiation,
                current.conditionKey,
            ]
        );
    } catch (err) {
        console.error('[DB] Fehler beim Speichern der Beobachtung:', err.message);
    } finally {
        if (conn) conn.release();
    }
}

/**
 * Speichert ein komplettes Widget-Payload als JSON in der Cache-Tabelle.
 * @param {string} widgetKuerzel - Kürzel des Widgets, z.B. 'AKTUELLES_WETTER'.
 * @param {Object} payload - Das zu cachende JSON-Objekt.
 */
async function saveWidgetCache(widgetKuerzel, payload) {
    if (!dbAvailable) return;
    let conn;
    try {
        conn = await pool.getConnection();

        const [widget] = await conn.query(
            `SELECT ww.webseiten_widget_id
             FROM webseiten_widget ww
             JOIN standort s ON s.standort_id = ww.standort_id
             WHERE ww.kuerzel = ? AND s.kuerzel = 'CAMPUS_LINGEN'
             LIMIT 1`,
            [widgetKuerzel]
        );

        if (!widget) return;

        const now = formatDbTimestamp();
        const expiresAt = formatDbTimestamp(
            new Date(Date.now() + 15 * 60 * 1000)
        );

        await conn.query(
            `INSERT INTO webseiten_widget_cache (
                webseiten_widget_id, zwischengespeichert_am, laeuft_ab_am,
                cache_status, quellenzusammenfassung, payload_json
             ) VALUES (?, ?, ?, 'aktuell', ?, ?)`,
            [
                widget.webseiten_widget_id,
                now,
                expiresAt,
                'WeatherLink + DWD MOSMIX + DWD CDC',
                JSON.stringify(payload),
            ]
        );

        await conn.query(
            `DELETE FROM webseiten_widget_cache
             WHERE webseiten_widget_id = ?
               AND webseiten_widget_cache_id NOT IN (
                   SELECT id FROM (
                       SELECT webseiten_widget_cache_id AS id
                       FROM webseiten_widget_cache
                       WHERE webseiten_widget_id = ?
                       ORDER BY zwischengespeichert_am DESC
                       LIMIT 100
                   ) AS keep_rows
               )`,
            [widget.webseiten_widget_id, widget.webseiten_widget_id]
        );
    } catch (err) {
        console.error('[DB] Fehler beim Speichern des Widget-Cache:', err.message);
    } finally {
        if (conn) conn.release();
    }
}

/**
 * Lädt den neuesten Cache-Eintrag für ein Widget aus der DB.
 * @param {string} widgetKuerzel - Kürzel des Widgets.
 * @returns {Promise<Object|null>} Gecachtes Payload oder null.
 */
async function loadWidgetCache(widgetKuerzel) {
    if (!dbAvailable) return null;
    let conn;
    try {
        conn = await pool.getConnection();

        const [row] = await conn.query(
            `SELECT wwc.payload_json, wwc.zwischengespeichert_am, wwc.cache_status
             FROM webseiten_widget_cache wwc
             JOIN webseiten_widget ww ON ww.webseiten_widget_id = wwc.webseiten_widget_id
             JOIN standort s ON s.standort_id = ww.standort_id
             WHERE ww.kuerzel = ? AND s.kuerzel = 'CAMPUS_LINGEN'
             ORDER BY wwc.zwischengespeichert_am DESC
             LIMIT 1`,
            [widgetKuerzel]
        );

        if (!row || !row.payload_json) return null;

        const payload = JSON.parse(row.payload_json);
        payload._fromCache = true;
        payload._cachedAt = row.zwischengespeichert_am;
        return payload;
    } catch (err) {
        console.error('[DB] Fehler beim Laden des Widget-Cache:', err.message);
        return null;
    } finally {
        if (conn) conn.release();
    }
}


/**
 * Lädt die letzte gespeicherte Wetterbeobachtung aus der DB.
 * @returns {Promise<Object|null>} Letzte Beobachtung oder null.
 */
async function loadLastObservation() {
    if (!dbAvailable) return null;
    let conn;
    try {
        conn = await pool.getConnection();

        const [row] = await conn.query(
            `SELECT
                wb.temperatur_c,
                wb.relative_luftfeuchte_prozent,
                wb.luftdruck_meereshoehe_hpa,
                wb.niederschlag_mm,
                wb.windgeschwindigkeit_ms,
                wb.windboe_ms,
                wb.windrichtung_grad,
                wb.solarstrahlung_wm2,
                wb.wettercode,
                wb.gemessen_am_utc,
                wb.gemessen_am_lokal,
                es.stationscode,
                es.stationsname
             FROM wetterbeobachtung wb
             JOIN externe_station es ON es.externe_station_id = wb.externe_station_id
             JOIN datenanbieter d ON d.datenanbieter_id = es.datenanbieter_id
             WHERE d.kuerzel = 'WEATHERLINK'
             ORDER BY wb.gemessen_am_utc DESC
             LIMIT 1`
        );

        if (!row) return null;

        const windSpeedKmh = row.windgeschwindigkeit_ms != null
            ? Math.round(row.windgeschwindigkeit_ms * 3.6 * 10) / 10 : null;
        const windGustKmh = row.windboe_ms != null
            ? Math.round(row.windboe_ms * 3.6 * 10) / 10 : null;

        const directions = ['N','NNO','NO','ONO','O','OSO','SO','SSO','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        const deg = row.windrichtung_grad;
        const dirText = deg != null ? directions[Math.round(deg / 22.5) % 16] : '';

        const observedAt = row.gemessen_am_utc instanceof Date
            ? row.gemessen_am_utc.toISOString()
            : new Date(row.gemessen_am_utc).toISOString();

        const lokalTime = row.gemessen_am_lokal instanceof Date
            ? row.gemessen_am_lokal
            : new Date(row.gemessen_am_lokal);

        const label = lokalTime.toLocaleString('de-DE', {
            hour: '2-digit', minute: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric',
            timeZone: 'Europe/Berlin',
        });

        const CONDITION_LABELS = {
            sunny: 'Sonnig',
            partlyCloudy: 'Wolkig',
            cloudy: 'Bewölkt',
            rain: 'Regen',
            storm: 'Gewitter',
        };
        const condKey = row.wettercode || 'partlyCloudy';
        const condLabel = CONDITION_LABELS[condKey] || condKey;

        const temp = row.temperatur_c != null ? Number(row.temperatur_c) : null;
        const hum = row.relative_luftfeuchte_prozent != null ? Number(row.relative_luftfeuchte_prozent) : null;
        let feelsLike = temp;
        if (temp !== null) {
            if (temp <= 10 && windSpeedKmh && windSpeedKmh > 4.8) {
                feelsLike = 13.12 + (0.6215 * temp) - (11.37 * Math.pow(windSpeedKmh, 0.16))
                          + (0.3965 * temp * Math.pow(windSpeedKmh, 0.16));
            } else if (temp >= 26 && hum) {
                feelsLike = temp + (0.05 * hum);
            }
            feelsLike = Math.round(feelsLike * 10) / 10;
        }

        return {
            temperature: temp,
            feelsLike: feelsLike,
            condition: condLabel,
            conditionKey: condKey,
            wind: {
                speed: windSpeedKmh,
                direction: dirText,
                degrees: deg != null ? Number(deg) : null,
                gust: windGustKmh,
            },
            humidity: hum,
            precipitation: row.niederschlag_mm != null ? Number(row.niederschlag_mm) : null,
            rainfallDaily: null,
            pressure: row.luftdruck_meereshoehe_hpa != null ? Number(row.luftdruck_meereshoehe_hpa) : null,
            cloudCover: null,
            solarRadiation: row.solarstrahlung_wm2 != null ? Number(row.solarstrahlung_wm2) : null,
            uvIndex: null,
            observedAt: observedAt,
            observedAtLabel: label + ' (aus DB)',
            station: {
                id: row.stationscode || 'weatherlink',
                name: row.stationsname || 'WeatherLink Lingen',
            },
            _fromDb: true,
        };
    } catch (err) {
        console.error('[DB] Fehler beim Laden der letzten Beobachtung:', err.message);
        return null;
    } finally {
        if (conn) conn.release();
    }
}

/**
 * Protokolliert einen Import-Lauf in der Tabelle importlauf.
 * @param {string} importKuerzel - z.B. 'WL_AKTUELLE_BEOBACHTUNG'.
 * @param {string} status - 'erfolgreich' oder 'fehlgeschlagen'.
 * @param {number} recordsRead - Anzahl gelesener Datensätze.
 * @param {number} recordsWritten - Anzahl geschriebener Datensätze.
 * @param {string|null} errorMsg - Fehlermeldung falls vorhanden.
 */
async function logImportRun(importKuerzel, status, recordsRead, recordsWritten, errorMsg) {
    if (!dbAvailable) return;
    let conn;
    try {
        conn = await pool.getConnection();

        const [auftrag] = await conn.query(
            `SELECT importauftrag_id FROM importauftrag WHERE kuerzel = ? LIMIT 1`,
            [importKuerzel]
        );

        if (!auftrag) return;

        const now = formatDbTimestamp();

        await conn.query(
            `INSERT INTO importlauf (
                importauftrag_id, status, gestartet_am, beendet_am,
                gelesene_datensaetze, geschriebene_datensaetze, fehlermeldung
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                auftrag.importauftrag_id,
                status,
                now,
                now,
                recordsRead,
                recordsWritten,
                errorMsg,
            ]
        );
    } catch (err) {
        console.error('[DB] Fehler beim Importlauf-Logging:', err.message);
    } finally {
        if (conn) conn.release();
    }
}

module.exports = {
    checkConnection,
    isAvailable,
    saveCurrentObservation,
    saveWidgetCache,
    loadWidgetCache,
    loadLastObservation,
    logImportRun,
};
