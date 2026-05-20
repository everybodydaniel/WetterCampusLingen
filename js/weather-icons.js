

/**
 * @namespace WeatherIcons
 * @description Sammlung von animierten SVG-Wetter-Icons.
 *              Jedes Icon wird als Inline-SVG zurückgegeben,
 *              damit wir Animationen und Farben direkt steuern können.
 */

const WeatherIcons = {

    /**
     * @memberof WeatherIcons
     * @description Liefert das animierte SVG-Icon für sonniges Wetter (Sonne mit Strahlen).
     * @returns {string} SVG-Markup
     */
    sunny() {
        return `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <!-- 8 evenly-spaced rays radiating from center (50,50), inner r=28, outer r=38 -->
            <g stroke="#FFD93D" stroke-width="3" stroke-linecap="round" opacity="0.85">
                <!-- Top -->
                <line x1="50" y1="12" x2="50" y2="22"/>
                <!-- Top-right -->
                <line x1="76.9" y1="23.1" x2="69.7" y2="30.3"/>
                <!-- Right -->
                <line x1="88" y1="50" x2="78" y2="50"/>
                <!-- Bottom-right -->
                <line x1="76.9" y1="76.9" x2="69.7" y2="69.7"/>
                <!-- Bottom -->
                <line x1="50" y1="88" x2="50" y2="78"/>
                <!-- Bottom-left -->
                <line x1="23.1" y1="76.9" x2="30.3" y2="69.7"/>
                <!-- Left -->
                <line x1="12" y1="50" x2="22" y2="50"/>
                <!-- Top-left -->
                <line x1="23.1" y1="23.1" x2="30.3" y2="30.3"/>
            </g>
            <!-- Sun body -->
            <circle cx="50" cy="50" r="20" fill="#FFD93D"/>
            <circle cx="50" cy="50" r="15" fill="#FFEC85" opacity="0.55"/>
        </svg>`;
    },

    /**
     * @memberof WeatherIcons
     * @description Liefert das animierte SVG-Icon für heiteres bis wolkiges Wetter (Sonne mit vorbeiziehender Wolke).
     * @returns {string} SVG-Markup
     */
    partlyCloudy() {
        return `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <!-- Sun (upper-left) -->
            <g>
                <!-- Rays – only the ones that are NOT hidden behind the cloud -->
                <g stroke="#FFD93D" stroke-width="2.5" stroke-linecap="round" opacity="0.8">
                    <!-- Top -->
                    <line x1="38" y1="6"  x2="38" y2="15"/>
                    <!-- Top-left -->
                    <line x1="17.5" y1="13.5" x2="23.3" y2="19.3"/>
                    <!-- Left -->
                    <line x1="6"  y1="34" x2="15" y2="34"/>
                    <!-- Top-right -->
                    <line x1="58.5" y1="13.5" x2="52.7" y2="19.3"/>
                    <!-- Bottom-left -->
                    <line x1="17.5" y1="54.5" x2="23.3" y2="48.7"/>
                </g>
                <!-- Sun disc -->
                <circle cx="38" cy="34" r="16" fill="#FFD93D"/>
                <circle cx="38" cy="34" r="12" fill="#FFEC85" opacity="0.5"/>
            </g>
            <!-- Cloud (lower-right, overlapping the sun) -->
            <g>
                <ellipse cx="58" cy="68" rx="30" ry="14" fill="white" opacity="0.95"/>
                <circle cx="44" cy="60" r="17" fill="white" opacity="0.95"/>
                <circle cx="62" cy="55" r="19" fill="white" opacity="0.95"/>
                <circle cx="52" cy="52" r="14" fill="#f0f4f8" opacity="0.6"/>
            </g>
        </svg>`;
    },

    /**
     * @memberof WeatherIcons
     * @description Liefert das animierte SVG-Icon für bewölktes Wetter (zwei überlappende Wolken).
     * @returns {string} SVG-Markup
     */
    cloudy() {
        return `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <!-- Back cloud -->
            <g opacity="0.5" transform="translate(-4, -6)">
                <ellipse cx="55" cy="52" rx="26" ry="13" fill="#c9d5e0"/>
                <circle cx="42" cy="45" r="15" fill="#c9d5e0"/>
                <circle cx="60" cy="42" r="16" fill="#c9d5e0"/>
            </g>
            <!-- Front cloud -->
            <g transform="translate(4, 6)">
                <ellipse cx="50" cy="58" rx="32" ry="16" fill="white" opacity="0.95"/>
                <circle cx="35" cy="50" r="19" fill="white" opacity="0.95"/>
                <circle cx="56" cy="45" r="21" fill="white" opacity="0.95"/>
                <circle cx="44" cy="40" r="16" fill="#edf1f5" opacity="0.6"/>
            </g>
        </svg>`;
    },

    /**
     * @memberof WeatherIcons
     * @description Liefert das animierte SVG-Icon für Regen (Wolke mit animierten Regentropfen).
     * @returns {string} SVG-Markup
     */
    rain() {
        return `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <!-- Cloud -->
            <g transform="translate(4, -2)">
                <ellipse cx="48" cy="42" rx="30" ry="15" fill="#b0bec5"/>
                <circle cx="34" cy="35" r="17" fill="#b0bec5"/>
                <circle cx="54" cy="31" r="19" fill="#b0bec5"/>
                <circle cx="44" cy="28" r="14" fill="#cfd8dc" opacity="0.7"/>
            </g>
            <!-- Rain drops -->
            <g stroke="#64B5F6" stroke-width="2.5" stroke-linecap="round" opacity="0.85">
                <line x1="30" y1="58" x2="26" y2="72">
                    <animate attributeName="y1" values="58;60;58" dur="0.8s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="72;76;72" dur="0.8s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.85;0.4;0.85" dur="0.8s" repeatCount="indefinite"/>
                </line>
                <line x1="45" y1="60" x2="41" y2="74">
                    <animate attributeName="y1" values="60;62;60" dur="0.7s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="74;78;74" dur="0.7s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.85;0.4;0.85" dur="0.7s" repeatCount="indefinite"/>
                </line>
                <line x1="60" y1="56" x2="56" y2="70">
                    <animate attributeName="y1" values="56;58;56" dur="0.9s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="70;74;70" dur="0.9s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.85;0.4;0.85" dur="0.9s" repeatCount="indefinite"/>
                </line>
                <line x1="50" y1="72" x2="46" y2="86">
                    <animate attributeName="y1" values="72;74;72" dur="0.75s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="86;90;86" dur="0.75s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.7;0.3;0.7" dur="0.75s" repeatCount="indefinite"/>
                </line>
                <line x1="35" y1="76" x2="31" y2="88">
                    <animate attributeName="y1" values="76;78;76" dur="0.85s" repeatCount="indefinite"/>
                    <animate attributeName="y2" values="88;92;88" dur="0.85s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.7;0.3;0.7" dur="0.85s" repeatCount="indefinite"/>
                </line>
            </g>
        </svg>`;
    },

    /**
     * @memberof WeatherIcons
     * @description Liefert das animierte SVG-Icon für Sturm und Gewitter (dunkle Wolke, Regen und aufblitzender Blitz).
     * @returns {string} SVG-Markup
     */
    storm() {
        return `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <!-- Dark cloud -->
            <g transform="translate(4, -2)">
                <ellipse cx="48" cy="38" rx="32" ry="16" fill="#78909c"/>
                <circle cx="32" cy="30" r="18" fill="#78909c"/>
                <circle cx="56" cy="26" r="20" fill="#78909c"/>
                <circle cx="44" cy="22" r="15" fill="#90a4ae" opacity="0.6"/>
            </g>
            <!-- Lightning bolt -->
            <polygon points="52,42 42,62 50,62 40,85 62,55 52,55 60,42" fill="#FFD93D" opacity="0.95">
                <animate attributeName="opacity" values="0.95;0.5;0.95;0.3;0.95" dur="2s" repeatCount="indefinite"/>
            </polygon>
            <!-- Rain -->
            <g stroke="#64B5F6" stroke-width="2" stroke-linecap="round" opacity="0.6">
                <line x1="28" y1="55" x2="24" y2="70">
                    <animate attributeName="opacity" values="0.6;0.2;0.6" dur="0.7s" repeatCount="indefinite"/>
                </line>
                <line x1="68" y1="52" x2="64" y2="67">
                    <animate attributeName="opacity" values="0.6;0.2;0.6" dur="0.8s" repeatCount="indefinite"/>
                </line>
                <line x1="72" y1="64" x2="68" y2="79">
                    <animate attributeName="opacity" values="0.5;0.2;0.5" dur="0.9s" repeatCount="indefinite"/>
                </line>
            </g>
        </svg>`;
    },

    /**
     * Gibt das passende Wetter-Icon als SVG-String zurück.
     * Falls der Condition-Key unbekannt ist, wird das Wolken-Icon genommen.
     * @param {string} condition - Wetterzustand ('sunny', 'rain', 'storm' usw.).
     * @returns {string} SVG-Markup als String.
     */
    get(condition) {
        const iconMap = {
            sunny:        this.sunny,
            partlyCloudy: this.partlyCloudy,
            cloudy:       this.cloudy,
            rain:         this.rain,
            storm:        this.storm,
        };
        const fn = iconMap[condition] || this.cloudy;
        return fn.call(this);
    }
};
