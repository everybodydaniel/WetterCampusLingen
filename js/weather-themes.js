

/**
 * @namespace WeatherThemes
 * @description Definiert Farbthemen für verschiedene Wetterlagen.
 *              Je nach aktuellem Wetter werden die CSS Custom Properties
 *              auf dem Root-Element angepasst, sodass sich die ganze Seite
 *              farblich an das Wetter anpasst.
 */

const WeatherThemes = {

    /**
     * @memberof WeatherThemes
     * @description Farben für sonniges Wetter (Blautöne).
     * @type {Object}
     */
    sunny: {
        '--theme-primary':      '#2980b9',
        '--theme-primary-rgb':  '41, 128, 185',
        '--theme-accent':       '#3498db',
        '--theme-accent-rgb':   '52, 152, 219',
        '--theme-text':         '#ffffff',
        '--theme-text-muted':   'rgba(255, 255, 255, 0.8)',
        '--theme-overlay':      'rgba(20, 80, 160, 0.25)',
        '--theme-card-bg':      'rgba(255, 255, 255, 0.18)',
        '--theme-card-border':  'rgba(255, 255, 255, 0.3)',
        '--theme-divider':      'rgba(255, 255, 255, 0.25)',
        '--glass-bg':           'rgba(41, 128, 185, 0.35)',
        '--glass-border':       'rgba(255, 255, 255, 0.35)',
    },

    /**
     * @memberof WeatherThemes
     * @description Farben für heiteres bis wolkiges Wetter (Hellblau bis Grau).
     * @type {Object}
     */
    partlyCloudy: {
        '--theme-primary':      '#3a86c9',
        '--theme-primary-rgb':  '58, 134, 201',
        '--theme-accent':       '#5ba3dd',
        '--theme-accent-rgb':   '91, 163, 221',
        '--theme-text':         '#ffffff',
        '--theme-text-muted':   'rgba(255, 255, 255, 0.75)',
        '--theme-overlay':      'rgba(30, 80, 140, 0.35)',
        '--theme-card-bg':      'rgba(255, 255, 255, 0.15)',
        '--theme-card-border':  'rgba(255, 255, 255, 0.25)',
        '--theme-divider':      'rgba(255, 255, 255, 0.2)',
        '--glass-bg':           'rgba(255, 255, 255, 0.18)',
        '--glass-border':       'rgba(255, 255, 255, 0.3)',
    },

    /**
     * @memberof WeatherThemes
     * @description Farben für stark bewölktes Wetter (Blaugrau).
     * @type {Object}
     */
    cloudy: {
        '--theme-primary':      '#607d8b',
        '--theme-primary-rgb':  '96, 125, 139',
        '--theme-accent':       '#78909c',
        '--theme-accent-rgb':   '120, 144, 156',
        '--theme-text':         '#ffffff',
        '--theme-text-muted':   'rgba(255, 255, 255, 0.7)',
        '--theme-overlay':      'rgba(60, 70, 85, 0.45)',
        '--theme-card-bg':      'rgba(255, 255, 255, 0.12)',
        '--theme-card-border':  'rgba(255, 255, 255, 0.2)',
        '--theme-divider':      'rgba(255, 255, 255, 0.18)',
        '--glass-bg':           'rgba(200, 210, 220, 0.2)',
        '--glass-border':       'rgba(255, 255, 255, 0.22)',
    },

    /**
     * @memberof WeatherThemes
     * @description Farben für regnerisches Wetter (Dunkelgrau).
     * @type {Object}
     */
    rain: {
        '--theme-primary':      '#455a64',
        '--theme-primary-rgb':  '69, 90, 100',
        '--theme-accent':       '#546e7a',
        '--theme-accent-rgb':   '84, 110, 122',
        '--theme-text':         '#eceff1',
        '--theme-text-muted':   'rgba(236, 239, 241, 0.65)',
        '--theme-overlay':      'rgba(40, 50, 65, 0.55)',
        '--theme-card-bg':      'rgba(255, 255, 255, 0.1)',
        '--theme-card-border':  'rgba(255, 255, 255, 0.15)',
        '--theme-divider':      'rgba(255, 255, 255, 0.15)',
        '--glass-bg':           'rgba(180, 195, 210, 0.18)',
        '--glass-border':       'rgba(255, 255, 255, 0.18)',
    },

    /**
     * @memberof WeatherThemes
     * @description Farben für stürmisches Wetter und Gewitter (sehr dunkles Graublau).
     * @type {Object}
     */
    storm: {
        '--theme-primary':      '#37474f',
        '--theme-primary-rgb':  '55, 71, 79',
        '--theme-accent':       '#455a64',
        '--theme-accent-rgb':   '69, 90, 100',
        '--theme-text':         '#cfd8dc',
        '--theme-text-muted':   'rgba(207, 216, 220, 0.6)',
        '--theme-overlay':      'rgba(25, 30, 40, 0.65)',
        '--theme-card-bg':      'rgba(255, 255, 255, 0.08)',
        '--theme-card-border':  'rgba(255, 255, 255, 0.12)',
        '--theme-divider':      'rgba(255, 255, 255, 0.12)',
        '--glass-bg':           'rgba(150, 160, 175, 0.15)',
        '--glass-border':       'rgba(255, 255, 255, 0.14)',
    },

    /**
     * Wendet ein Farbthema auf die Seite an.
     * Setzt die CSS Custom Properties direkt auf dem HTML-Element.
     * @param {string} conditionKey - Wetterzustand ('sunny', 'rain' usw.).
     */
    apply(conditionKey) {
        const theme = this[conditionKey] || this.partlyCloudy;
        const root = document.documentElement;
        Object.entries(theme).forEach(([prop, value]) => {
            root.style.setProperty(prop, value);
        });
    }
};
