/**
 * @namespace WeatherWidget
 * @description Frontend-Logik für das Campus-Wetter-Widget.
 *              Handhabt Datenabruf, DOM-Manipulation, Charts und UI-State für
 *              aktuelle Werte, Vorhersage, Historie und Luftqualität.
 */

(function () {
    'use strict';

    /** API-Endpunkt für die Wetterdaten */
    const API_URL = '/api/weather';

    /** Alle DOM-Referenzen, die wir brauchen – einmal am Anfang geholt */
    const DOM = {
        widget: document.getElementById('weather-widget'),
        currentIcon: document.getElementById('current-icon'),
        currentTemp: document.getElementById('current-temp'),
        currentCondition: document.getElementById('current-condition'),
        detailFeelsLike: document.querySelector('#detail-feels-like .detail-value'),
        detailWind: document.querySelector('#detail-wind .detail-value'),
        detailHumidity: document.querySelector('#detail-humidity .detail-value'),
        detailPrecip: document.querySelector('#detail-precipitation .detail-value'),
        forecastContainer: document.getElementById('widget-forecast'),

        timestampText: document.getElementById('timestamp-text'),
        historyMonths: document.getElementById('history-months'),
        historySummary: document.getElementById('history-summary'),
        historyDays: document.getElementById('history-days'),
        dayDetails: document.getElementById('day-details'),
        navWeather: document.getElementById('nav-wetter'),
        navHistory: document.getElementById('nav-history'),
        pageHeader: document.getElementById('page-header'),
        weatherWidget: document.getElementById('weather-widget'),
        historyPanel: document.getElementById('weather-history'),
        modalOverlay: document.getElementById('forecast-modal-overlay'),
        modal: document.getElementById('forecast-modal'),
        modalContent: document.getElementById('modal-content'),
        modalClose: document.getElementById('modal-close'),
        mainRainOverlay: document.getElementById('main-rain-overlay'),
        mainSunOverlay: document.getElementById('main-sun-overlay'),
        mainCloudOverlay: document.getElementById('main-cloud-overlay'),
    };

    /** Globaler Zustand der App (History-Daten, Kartenobjekte usw.) */
    const state = {
        history: null,
        selectedMonthIndex: 0,
        selectedDayIndex: 0,
        forecastData: null,
        airQuality: null,

        modalDays: [],
        modalSelectedIndex: 0,
        modalActiveTab: 'overview',
        modalChart: null,
    };

    const LINGEN_COORDS = { lat: 52.527, lon: 7.318 };

    const MODAL_TABS = [
        { key: 'overview', label: 'Übersicht',       unit: '°C', icon: '🌡️' },
        { key: 'precip',   label: 'Niederschlag',    unit: 'mm', icon: '🌧️' },
        { key: 'wind',     label: 'Wind',            unit: 'km/h', icon: '💨' },
        { key: 'humidity', label: 'Luftfeuchtigkeit',unit: '%',  icon: '💧' },
        { key: 'cloud',    label: 'Bewölkt',         unit: '%',  icon: '☁️' },
        { key: 'aqi',      label: 'Luftqualität',    unit: '',   icon: '🍃' },
    ];

    const AQI_FALLBACK_CATEGORIES = [
        { max: 20,  key: 'very-good',       label: 'Sehr gut',         color: '#50f0e6' },
        { max: 40,  key: 'good',            label: 'Gut',              color: '#50ccaa' },
        { max: 60,  key: 'moderate',        label: 'Mäßig',            color: '#f0e641' },
        { max: 80,  key: 'poor',            label: 'Schlecht',         color: '#ff5050' },
        { max: 100, key: 'very-poor',       label: 'Sehr schlecht',    color: '#960032' },
        { max: null, key: 'extremely-poor', label: 'Extrem schlecht',  color: '#7d2181' },
    ];

    function aqiCategoryFor(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return { key: 'unknown', label: 'Keine Daten', color: '#9aa1a8' };
        }
        const categories = state.airQuality?.categories?.length
            ? state.airQuality.categories
            : AQI_FALLBACK_CATEGORIES;
        return categories.find(category => category.max === null || value <= category.max)
            || categories[categories.length - 1];
    }

    function aqiBadge(aqi, size = 'sm') {
        if (aqi === null || aqi === undefined) {
            return `<span class="aqi-badge aqi-badge--${size} aqi-badge--unknown" title="Keine AQI-Daten">AQI –</span>`;
        }
        const value = typeof aqi === 'object' ? aqi.aqi : aqi;
        const category = typeof aqi === 'object'
            ? { label: aqi.categoryLabel, color: aqi.color, key: aqi.category }
            : aqiCategoryFor(value);
        const display = value === null ? '–' : formatNumber(value);
        return `<span class="aqi-badge aqi-badge--${size}" style="--aqi-color:${category.color}" `
            + `title="${category.label}: AQI ${display}">`
            + `<span class="aqi-badge-dot" aria-hidden="true"></span>`
            + `<span class="aqi-badge-text">AQI ${display}</span>`
            + `</span>`;
    }

    /**
     * Holt die kompletten Wetterdaten vom Server.
     * @returns {Promise<Object>} Das JSON-Payload mit current, forecast, history, airQuality.
     * @throws {Error} Wenn der Server nicht antwortet oder einen Fehler liefert.
     */
    async function loadDwdWeatherData() {
        const response = await fetch(API_URL, { cache: 'no-store' });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Wetterdaten konnten nicht geladen werden.');
        }
        return response.json();
    }

    /**
     * Rendert die aktuellen Wetterdaten in die Hauptanzeige.
     * Setzt Icon, Temperatur, Wetterlage und die Detail-Karten.
     * Aktiviert auch die passenden Wetter-Overlays (Regen, Sonne usw.).
     * @param {Object} current - Aktuelle Wetterdaten vom Server.
     */
    function renderCurrent(current) {
        DOM.currentIcon.innerHTML = WeatherIcons.get(current.conditionKey);
        DOM.currentTemp.textContent = `${formatNumber(current.temperature)}°C`;
        DOM.currentCondition.textContent = current.condition;
        DOM.detailFeelsLike.textContent = `${formatNumber(current.feelsLike)}°C`;
        DOM.detailWind.textContent = `${formatNumber(current.wind.speed)} km/h ${current.wind.direction}`.trim();
        DOM.detailHumidity.textContent = `${formatNumber(current.humidity)}%`;
        DOM.detailPrecip.textContent = `${formatNumber(current.precipitation, 1)} mm`;

        const widgetCurrent = document.getElementById('widget-current');
        if (widgetCurrent && !widgetCurrent.dataset.modalBound) {
            widgetCurrent.dataset.modalBound = '1';
            widgetCurrent.style.cursor = 'pointer';
            widgetCurrent.addEventListener('click', () => {
                if (state._currentData) openCurrentModal(state._currentData);
            });
        }
        state._currentData = current;

        if (DOM.mainRainOverlay) {
            const isRaining = current.conditionKey === 'rain' || current.conditionKey === 'storm';
            DOM.mainRainOverlay.classList.toggle('active', isRaining);
        }
        if (DOM.mainSunOverlay) {
            const isSunny = current.conditionKey === 'sunny' || current.conditionKey === 'partlyCloudy';
            DOM.mainSunOverlay.classList.toggle('active', isSunny);
        }
        if (DOM.mainCloudOverlay) {
            const isCloudy = current.conditionKey === 'cloudy' || current.conditionKey === 'partlyCloudy';
            DOM.mainCloudOverlay.classList.toggle('active', isCloudy);
        }
    }

    /**
     * Wandelt die aktuellen Stationsdaten in ein "Tages-Objekt" um, damit das
     * Modal eine einheitliche Day-Struktur für Heute + Vorhersage hat.
     */
    function buildTodayDay(current) {
        const today = state.todayData || null;
        const now = new Date();
        return {
            conditionKey: current.conditionKey,
            condition: current.condition,
            dayLong: 'Heute',
            day: 'Heute',
            dayLabel: 'Heute',
            dateLabel: now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
            date: now.toISOString().split('T')[0],
            dayNumber: now.getDate(),
            high: today ? today.high : current.temperature,
            low: today ? today.low : current.temperature,
            precipitation: today ? today.precipitation : (current.precipitation ?? 0),
            humidity: current.humidity,
            cloudCover: today ? today.cloudCover : null,
            wind: current.wind ? current.wind.speed : null,
            windGust: current.wind ? (current.wind.gust || current.wind.speed) : null,
            windDirection: current.wind ? (current.wind.direction || '') : '',
            windDegrees: current.wind ? (current.wind.degrees ?? null) : null,
            airQuality: today ? today.airQuality : (current.airQuality || null),
            hourly: today ? (today.hourly || []) : [],
            isToday: true,
            _current: current,
        };
    }

    /**
     * Stellt das Day-Array zusammen, das im Modal scrollbar als Strip erscheint:
     * Gestern (aus Historie) + Heute (live) + 5–7 Tage Vorhersage.
     */
    function buildModalDays(current) {
        const days = [];

        const yesterday = buildYesterdayDay() || findYesterdayFromHistory();
        if (yesterday) days.push(yesterday);

        days.push(buildTodayDay(current));

        (state.forecastData || []).forEach(day => {
            days.push({
                ...day,
                dayLabel: day.day,
                dayNumber: dayNumberFromDate(day.date),
                isToday: false,
            });
        });

        return days;
    }

    /**
     * Baut das Gestern-Day-Objekt aus den vom Server gelieferten Open-Meteo-
     * Stundenwerten (state.yesterdayData). Liefert null, wenn nichts da ist.
     */
    function buildYesterdayDay() {
        const y = state.yesterdayData;
        if (!y) return null;
        return {
            ...y,
            dayLabel: 'Gestern',
            day: 'Gestern',
            dayLong: 'Gestern',
            dayNumber: dayNumberFromDate(y.date),
            isYesterday: true,
        };
    }

    function findYesterdayFromHistory() {
        const months = state.history?.months;
        if (!months?.length) return null;
        for (const month of months) {
            for (const day of month.days) {
                const dateKey = day.date;
                if (!dateKey) continue;
                const isYesterday = isoIsYesterday(dateKey);
                if (isYesterday) {
                    return {
                        date: dateKey,
                        dateLabel: formatIsoDate(dateKey),
                        day: 'Gestern',
                        dayLong: 'Gestern',
                        dayLabel: 'Gestern',
                        dayNumber: dayNumberFromDate(dateKey),
                        conditionKey: day.conditionKey,
                        condition: day.conditionLabel || day.condition || '',
                        high: day.highTemp,
                        low: day.lowTemp,
                        precipitation: day.precipitation,
                        humidity: day.humidity,
                        cloudCover: day.cloudCover ?? null,
                        wind: day.windMean,
                        windGust: day.windGust,
                        windDirection: '',
                        windDegrees: null,
                        airQuality: day.airQuality || null,
                        hourly: [],
                        isHistory: true,
                    };
                }
            }
        }
        return null;
    }

    function isoIsYesterday(iso) {
        const d = new Date(`${iso}T12:00:00`);
        const y = new Date();
        y.setDate(y.getDate() - 1);
        return d.getFullYear() === y.getFullYear()
            && d.getMonth() === y.getMonth()
            && d.getDate() === y.getDate();
    }

    function dayNumberFromDate(iso) {
        if (!iso) return '';
        return new Date(`${iso}T12:00:00`).getDate();
    }

    function openCurrentModal(current) {
        state.modalDays = buildModalDays(current);
        // "Heute" ist nach Gestern: Index 1, falls Gestern existiert, sonst 0.
        state.modalSelectedIndex = state.modalDays.findIndex(d => d.isToday);
        if (state.modalSelectedIndex < 0) state.modalSelectedIndex = 0;
        state.modalActiveTab = 'overview';
        renderModalShell();
    }

    function openForecastModal(day) {
        state.modalDays = buildModalDays(state._currentData);
        const idx = state.modalDays.findIndex(d => d.date === day.date);
        state.modalSelectedIndex = idx >= 0 ? idx : 1;
        state.modalActiveTab = 'overview';
        renderModalShell();
    }

    function renderModalShell() {
        const day = state.modalDays[state.modalSelectedIndex];
        if (!day) return;

        renderModalEffects(day);
        DOM.modalContent.innerHTML = buildModalLayout();
        DOM.modalContent.scrollTop = 0;
        DOM.modalOverlay.hidden = false;
        void DOM.modalOverlay.offsetHeight;
        DOM.modalOverlay.classList.add('visible');
        document.body.style.overflow = 'hidden';

        wireModalInteractions();
        drawActiveChart();
    }

    function refreshModalContent() {
        const day = state.modalDays[state.modalSelectedIndex];
        if (!day) return;
        renderModalEffects(day);
        DOM.modalContent.innerHTML = buildModalLayout();
        wireModalInteractions();
        drawActiveChart();
    }

    function buildModalLayout() {
        const day = state.modalDays[state.modalSelectedIndex];
        return `
            <section class="wm-modal">
                ${buildChartCard(day)}
                ${buildDetailsCard(day)}
            </section>
        `;
    }

    function buildChartCard(day) {
        return `
            <div class="wm-card wm-chart-card">
                <div class="wm-chart-tabs">
                    <span class="wm-chart-tabs-label">Stündlich</span>
                    <div class="wm-tab-list" role="tablist">
                        ${MODAL_TABS.map(tab => `
                            <button type="button"
                                    class="wm-tab${tab.key === state.modalActiveTab ? ' is-active' : ''}"
                                    data-tab="${tab.key}"
                                    role="tab"
                                    aria-selected="${tab.key === state.modalActiveTab}">
                                ${tab.label}
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="wm-day-strip-wrapper">
                    <div class="wm-day-strip" id="wm-day-strip">
                        ${state.modalDays.map((d, i) => `
                            <button type="button"
                                    class="wm-day-card${i === state.modalSelectedIndex ? ' is-active' : ''}"
                                    data-day-index="${i}">
                                <div class="wm-day-card-top">
                                    <span class="wm-day-num">${d.dayNumber}</span>
                                    <span class="wm-day-name">${d.dayLabel}</span>
                                </div>
                                <div class="wm-day-card-mid">
                                    <span class="wm-day-icon">${WeatherIcons.get(d.conditionKey)}</span>
                                    <div class="wm-day-temps">
                                        <span class="wm-day-high">${formatNumber(d.high)}°</span>
                                        <span class="wm-day-low">${formatNumber(d.low)}°</span>
                                    </div>
                                </div>
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="wm-chart-area">
                    <div class="wm-chart-header">
                        <h3 class="wm-chart-title">${chartHeadingFor(state.modalActiveTab, day)}</h3>
                    </div>
                    <div class="wm-chart-wrap">
                        <canvas id="wm-modal-chart"></canvas>
                    </div>
                    ${buildSunFooter(day)}
                </div>
            </div>
        `;
    }

    function chartHeadingFor(tab, day) {
        const meta = MODAL_TABS.find(t => t.key === tab);
        const base = meta ? meta.label : 'Übersicht';
        const name = day.isToday ? 'Heute' : (day.dayLong || day.dayLabel || day.day || '');
        return `${base} · ${name}`;
    }

    function buildSunFooter(day) {
        const dateRef = day.isToday ? new Date() : new Date(`${day.date || ''}T12:00:00`);
        if (isNaN(dateRef.getTime())) return '';
        const sun = computeSunTimes(dateRef, LINGEN_COORDS.lat, LINGEN_COORDS.lon);
        if (!sun) return '';
        return `
            <div class="wm-chart-footer">
                <div class="wm-foot-sun">
                    <span>🌅 ${sun.sunrise}</span>
                    <span>🌇 ${sun.sunset}</span>
                </div>
            </div>
        `;
    }

    function buildDetailsCard(day) {
        const now = new Date();
        const nowLabel = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const cards = [
            cardTemperature(day),
            cardFeelsLike(day),
            cardCloud(day),
            cardPrecip(day),
            cardWind(day),
            cardHumidity(day),
            cardAqi(day),
            cardPressure(day),
            cardSun(day),
            cardMoonPhase(day),
        ].filter(Boolean);

        return `
            <div class="wm-card wm-details-card">
                <div class="wm-details-header">
                    <h3 class="wm-details-title">Wetterdetails <small>${nowLabel}</small></h3>
                </div>
                <div class="wm-details-grid">
                    ${cards.join('')}
                </div>
            </div>
        `;
    }

    function wireModalInteractions() {
        DOM.modalContent.querySelectorAll('.wm-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const next = btn.dataset.tab;
                if (next === state.modalActiveTab) return;
                state.modalActiveTab = next;
                refreshModalContent();
            });
        });
        DOM.modalContent.querySelectorAll('.wm-day-card').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.dayIndex);
                if (idx === state.modalSelectedIndex) return;
                state.modalSelectedIndex = idx;
                refreshModalContent();
            });
        });
    }

    function destroyModalChart() {
        if (state.modalChart) {
            try { state.modalChart.destroy(); } catch (_) { /* noop */ }
            state.modalChart = null;
        }
    }

    function drawActiveChart() {
        destroyModalChart();
        const canvas = document.getElementById('wm-modal-chart');
        if (!canvas || typeof window.Chart === 'undefined') return;

        const day = state.modalDays[state.modalSelectedIndex];
        const tab = state.modalActiveTab;
        const hourly = day.hourly || [];

        if (!hourly.length) {
            renderEmptyChart(canvas, day);
            return;
        }

        const config = chartConfigFor(tab, hourly, day);
        state.modalChart = new window.Chart(canvas, config);
    }

    function renderEmptyChart(canvas, day) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight || 280;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '500 14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(day.isHistory ? 'Stündliche Daten für Gestern liegen nicht vor.' : 'Keine stündlichen Daten verfügbar.', w / 2, h / 2);
    }

    function commonChartOptions(hourly, yTitle) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(8, 16, 32, 0.92)',
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderWidth: 1,
                    padding: 10,
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    titleFont: { family: 'Inter', weight: '700' },
                    bodyFont: { family: 'Inter' },
                    callbacks: {
                        title: (items) => {
                            const i = items[0].dataIndex;
                            return hourly[i] ? hourly[i].hour : '';
                        },
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        color: 'rgba(255,255,255,0.6)',
                        font: { family: 'Inter', size: 11 },
                        callback: function(_, index) {
                            const h = hourly[index];
                            if (!h) return '';
                            const hour = new Date(h.time).getHours();
                            return hour % 3 === 0 ? h.hour : '';
                        },
                        maxRotation: 0,
                    },
                    grid: { display: false, drawBorder: false },
                },
                y: {
                    ticks: {
                        color: 'rgba(255,255,255,0.55)',
                        font: { family: 'Inter', size: 11 },
                        callback: (v) => `${Number(v).toLocaleString('de-DE')}${yTitle}`,
                    },
                    grid: { color: 'rgba(255,255,255,0.07)', drawBorder: false },
                },
            },
            animation: { duration: 600, easing: 'easeOutQuart' },
        };
    }

    function chartConfigFor(tab, hourly, day) {
        const labels = hourly.map(h => h.hour);

        switch (tab) {
            case 'overview':   return overviewChart(labels, hourly);
            case 'precip':     return precipChart(labels, hourly);
            case 'wind':       return windChart(labels, hourly);
            case 'humidity':   return humidityChart(labels, hourly);
            case 'cloud':      return cloudChart(labels, hourly);
            case 'aqi':        return aqiChart(labels, hourly, day);
            default:           return overviewChart(labels, hourly);
        }
    }

    function gradient(ctx, area, fromColor, toColor) {
        if (!area) return fromColor;
        const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
        g.addColorStop(0, fromColor);
        g.addColorStop(1, toColor);
        return g;
    }

    function overviewChart(labels, hourly) {
        const temps  = hourly.map(h => h.temperature ?? null);
        const precip = hourly.map(h => h.precipitation ?? 0);
        const opts = commonChartOptions(hourly, '°');
        opts.scales.y1 = {
            position: 'right',
            beginAtZero: true,
            suggestedMax: Math.max(2, Math.ceil(Math.max(...precip) * 1.2)),
            ticks: {
                color: 'rgba(120, 180, 250, 0.8)',
                font: { family: 'Inter', size: 11 },
                callback: (v) => `${v} mm`,
            },
            grid: { display: false, drawBorder: false },
        };
        return {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Niederschlag',
                        data: precip,
                        backgroundColor: 'rgba(96, 165, 250, 0.55)',
                        borderRadius: 4,
                        yAxisID: 'y1',
                        order: 2,
                    },
                    {
                        type: 'line',
                        label: 'Temperatur',
                        data: temps,
                        borderColor: '#FFB347',
                        borderWidth: 3,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: '#FFB347',
                        pointHoverBorderColor: '#fff',
                        fill: true,
                        backgroundColor: (ctx) => gradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(255,179,71,0.35)', 'rgba(120,180,90,0.04)'),
                        yAxisID: 'y',
                        order: 1,
                    },
                ],
            },
            options: opts,
        };
    }

    function precipChart(labels, hourly) {
        const precip = hourly.map(h => h.precipitation ?? 0);
        const opts = commonChartOptions(hourly, 'mm');
        opts.scales.y.beginAtZero = true;
        opts.scales.y.suggestedMax = Math.max(1, Math.ceil(Math.max(...precip) * 1.3));
        return {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Niederschlag',
                    data: precip,
                    backgroundColor: (ctx) => gradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(96,165,250,0.95)', 'rgba(96,165,250,0.25)'),
                    borderRadius: 6,
                }],
            },
            options: opts,
        };
    }

    function windChart(labels, hourly) {
        const wind = hourly.map(h => h.windKmh ?? 0);
        const opts = commonChartOptions(hourly, ' km/h');
        return {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Wind',
                    data: wind,
                    borderColor: '#26C6DA',
                    borderWidth: 2.5,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: true,
                    backgroundColor: (ctx) => gradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(38,198,218,0.35)', 'rgba(38,198,218,0.02)'),
                }],
            },
            options: opts,
        };
    }

    function humidityChart(labels, hourly) {
        const humid = hourly.map(h => h.humidity ?? 0);
        const opts = commonChartOptions(hourly, '%');
        opts.scales.y.min = 0;
        opts.scales.y.max = 100;
        return {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Luftfeuchtigkeit',
                    data: humid,
                    borderColor: '#42A5F5',
                    borderWidth: 2.5,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: true,
                    backgroundColor: (ctx) => gradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(66,165,245,0.4)', 'rgba(66,165,245,0.02)'),
                }],
            },
            options: opts,
        };
    }

    function cloudChart(labels, hourly) {
        const clouds = hourly.map(h => h.cloudCover ?? 0);
        const opts = commonChartOptions(hourly, '%');
        opts.scales.y.min = 0;
        opts.scales.y.max = 100;
        return {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Bewölkung',
                    data: clouds,
                    borderColor: '#CFD8DC',
                    borderWidth: 2.5,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: true,
                    backgroundColor: (ctx) => gradient(ctx.chart.ctx, ctx.chart.chartArea, 'rgba(176,190,197,0.45)', 'rgba(176,190,197,0.02)'),
                }],
            },
            options: opts,
        };
    }

    function aqiChart(labels, hourly, day) {
        const aq = day.airQuality;
        const pollutants = aq ? [
            { label: 'PM₂,₅', value: aq.pm25, color: '#50ccaa' },
            { label: 'PM₁₀',  value: aq.pm10, color: '#42A5F5' },
            { label: 'NO₂',   value: aq.no2,  color: '#FFB347' },
            { label: 'O₃',    value: aq.o3,   color: '#f06292' },
            { label: 'SO₂',   value: aq.so2,  color: '#bb86fc' },
        ].filter(p => p.value !== null && p.value !== undefined) : [];

        return {
            type: 'bar',
            data: {
                labels: pollutants.map(p => p.label),
                datasets: [{
                    label: 'µg/m³',
                    data: pollutants.map(p => p.value),
                    backgroundColor: pollutants.map(p => p.color),
                    borderRadius: 6,
                    barPercentage: 0.55,
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(8,16,32,0.92)',
                        callbacks: { label: (c) => `${formatNumber(c.parsed.x, 1)} µg/m³` },
                    },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { color: 'rgba(255,255,255,0.55)', font: { family: 'Inter', size: 11 } },
                        grid: { color: 'rgba(255,255,255,0.07)', drawBorder: false },
                    },
                    y: {
                        ticks: { color: 'rgba(255,255,255,0.7)', font: { family: 'Inter', size: 12, weight: '600' } },
                        grid: { display: false, drawBorder: false },
                    },
                },
                animation: { duration: 600 },
            },
        };
    }

    function rangeCard(title, label, current, low, high, color, hint) {
        const lo = Number(low), hi = Number(high), cur = Number(current);
        const span = Math.max(2, hi - lo);
        const ratio = Math.min(Math.max((cur - lo) / span, 0), 1);
        const pct = (ratio * 100).toFixed(1);
        return `
            <article class="wm-detail wm-detail--range">
                <header class="wm-detail-head">
                    <span class="wm-detail-title">${title}</span>
                </header>
                <div class="wm-range">
                    <div class="wm-range-track" style="--bar-color:${color}">
                        <div class="wm-range-fill" style="left:${pct}%"></div>
                    </div>
                    <div class="wm-range-value">${formatNumber(cur, 0)}°</div>
                </div>
                ${hint ? `<p class="wm-detail-hint">${hint}</p>` : ''}
            </article>
        `;
    }

    function cardTemperature(day) {
        const cur = day._current ? day._current.temperature : (day.high + day.low) / 2;
        const ref = day.high - day.low > 2 ? day : { high: cur + 4, low: cur - 4 };
        const trend = day.isToday ? 'Stabil' : 'Tagesverlauf';
        const hint = day.isToday
            ? `Aktuell ${formatNumber(cur, 0)}°. Tagestief ${formatNumber(day.low, 0)}°, Tageshoch ${formatNumber(day.high, 0)}°.`
            : `Tagestief ${formatNumber(day.low, 0)}° · Tageshoch ${formatNumber(day.high, 0)}°.`;
        return rangeCard('Temperatur', trend, cur, ref.low, ref.high, '#5dd6c0', hint);
    }

    function cardFeelsLike(day) {
        if (!day._current) return '';
        const feel = day._current.feelsLike;
        if (feel === null || feel === undefined) return '';
        const ref = { low: feel - 4, high: feel + 4 };
        return `
            <article class="wm-detail wm-detail--feel">
                <header class="wm-detail-head">
                    <span class="wm-detail-title">Gefühlt</span>
                </header>
                <div class="wm-range">
                    <div class="wm-range-track" style="--bar-color:#FFB347">
                        <div class="wm-range-fill" style="left:50%"></div>
                    </div>
                </div>
                <div class="wm-feel-grid">
                    <div>
                        <span class="wm-detail-kicker">Dominanter Faktor: keine</span>
                        <div class="wm-detail-big">${formatNumber(feel, 0)}° <small>Gefühlt</small></div>
                    </div>
                    <div>
                        <span class="wm-detail-kicker">&nbsp;</span>
                        <div class="wm-detail-big">${formatNumber(day._current.temperature, 0)}° <small>Temperatur</small></div>
                    </div>
                </div>
                <p class="wm-detail-hint">Angenehm 😊</p>
            </article>
        `;
    }

    function cardCloud(day) {
        const v = day.cloudCover;
        if (v === null || v === undefined) return '';
        const desc = v >= 75 ? 'Meist bewölkt' : v >= 40 ? 'Wolkig' : v >= 15 ? 'Heiter' : 'Klar';
        return `
            <article class="wm-detail wm-detail--cloud">
                <header class="wm-detail-head">
                    <span class="wm-detail-title">Bewölkt</span>
                </header>
                <div class="wm-donut" style="--p:${v};--col:#9aa8b5">
                    <span class="wm-donut-icon">☁️</span>
                </div>
                <p class="wm-detail-strong">${desc} (${formatNumber(v, 0)}%)</p>
                <p class="wm-detail-hint">Bewölkung über den Tag verteilt.</p>
            </article>
        `;
    }

    function cardPrecip(day) {
        const v = day.precipitation ?? 0;
        const cap = Math.max(5, v + 1);
        const p = Math.min(100, (v / cap) * 100);
        const desc = v < 0.1 ? 'Kein Niederschlag' : v < 1 ? 'Leichter Regen' : v < 4 ? 'Mäßiger Regen' : 'Starker Regen';
        return `
            <article class="wm-detail wm-detail--precip">
                <header class="wm-detail-head">
                    <span class="wm-detail-title">Niederschlag</span>
                </header>
                <div class="wm-donut" style="--p:${p};--col:#64B5F6">
                    <div class="wm-donut-stack">
                        <span class="wm-donut-big">${formatNumber(v, 1)}</span>
                        <span class="wm-donut-unit">mm</span>
                    </div>
                </div>
                <p class="wm-detail-strong">${desc}</p>
                <p class="wm-detail-hint">${day.isToday ? 'In den nächsten 24 h' : 'Tagessumme'}</p>
            </article>
        `;
    }

    function cardWind(day) {
        const speed = day.wind ?? 0;
        const gust = day.windGust ?? speed;
        const deg = day.windDegrees ?? null;
        const dir = day.windDirection || '';
        const arrow = deg !== null ? `style="transform:rotate(${deg}deg)"` : '';
        const force = speed < 5 ? 'Schwach' : speed < 15 ? 'Mäßig' : speed < 30 ? 'Sanfte Brise' : 'Stark';
        return `
            <article class="wm-detail wm-detail--wind">
                <header class="wm-detail-head">
                    <span class="wm-detail-title">Wind</span>
                </header>
                <div class="wm-wind">
                    <div class="wm-compass">
                        <span class="wm-compass-n">N</span>
                        <span class="wm-compass-e">O</span>
                        <span class="wm-compass-s">S</span>
                        <span class="wm-compass-w">W</span>
                        <span class="wm-compass-needle" ${arrow}></span>
                    </div>
                    <div class="wm-wind-info">
                        <div class="wm-wind-row"><strong>${formatNumber(speed, 0)}</strong><small>km/h Windgeschwindigkeit</small></div>
                        <div class="wm-wind-row"><strong>${formatNumber(gust, 0)}</strong><small>km/h Windböen</small></div>
                        ${dir ? `<div class="wm-wind-row wm-wind-dir">Aus ${dir}</div>` : ''}
                    </div>
                </div>
                <p class="wm-detail-hint">Kraft: ${force}</p>
            </article>
        `;
    }

    function cardHumidity(day) {
        const v = day.humidity;
        if (v === null || v === undefined) return '';
        const dew = day._current && day._current.dewPoint !== null && day._current.dewPoint !== undefined
            ? day._current.dewPoint
            : null;
        // 10 vertikale Balken, Anzahl gefüllter Balken = humidity/10
        const bars = Array.from({ length: 10 }).map((_, i) => {
            const filled = (i + 1) * 10 <= v;
            return `<span class="wm-bar${filled ? ' is-on' : ''}"></span>`;
        }).join('');
        return `
            <article class="wm-detail wm-detail--humid">
                <header class="wm-detail-head">
                    <span class="wm-detail-title">Luftfeuchtigkeit</span>
                </header>
                <div class="wm-humid">
                    <div class="wm-humid-bars">${bars}</div>
                    <div class="wm-humid-info">
                        <div class="wm-humid-big">${formatNumber(v, 0)}%</div>
                        <small>Relative Luftfeuchtigkeit</small>
                        ${dew !== null ? `<div class="wm-humid-dew"><strong>${formatNumber(dew, 0)}°</strong><small>Taupunkt</small></div>` : ''}
                    </div>
                </div>
                <p class="wm-detail-hint">Normal</p>
            </article>
        `;
    }



    function cardAqi(day) {
        const aq = day.airQuality;
        if (!aq) return '';
        const max = 120;
        const ratio = Math.min(1, (aq.aqi ?? 0) / max);
        return `
            <article class="wm-detail wm-detail--aqi">
                <header class="wm-detail-head"><span class="wm-detail-title">AQI</span></header>
                <div class="wm-gauge" style="--p:${ratio * 100};--col:${aq.color || '#FFB347'};--col2:#ff5050">
                    <div class="wm-gauge-stack">
                        <span class="wm-gauge-big">${formatNumber(aq.aqi, 0)}</span>
                    </div>
                </div>
                <p class="wm-detail-strong">${aq.categoryLabel || ''}</p>
                <p class="wm-detail-hint">Schlechtere Luftqualität mit primärem Schadstoff: ${primaryPollutant(aq)}.</p>
            </article>
        `;
    }

    function primaryPollutant(aq) {
        const list = [
            { l: 'O₃', v: aq.o3 }, { l: 'PM₂,₅', v: aq.pm25 },
            { l: 'PM₁₀', v: aq.pm10 }, { l: 'NO₂', v: aq.no2 },
        ].filter(p => p.v !== null && p.v !== undefined);
        list.sort((a, b) => b.v - a.v);
        return list[0] ? `${list[0].l} ${formatNumber(list[0].v, 0)} ppb` : '–';
    }

    function cardPressure(day) {
        if (!day._current) return '';
        const p = day._current.pressure;
        if (p === null || p === undefined) return '';
        const min = 980, max = 1040;
        const ratio = Math.min(1, Math.max(0, (p - min) / (max - min)));
        const trend = day._current.pressureTrend;
        const trendLabel = trend > 0.01 ? 'Langsam steigend' : trend < -0.01 ? 'Langsam fallend' : 'Stabil';
        return `
            <article class="wm-detail wm-detail--press">
                <header class="wm-detail-head"><span class="wm-detail-title">Druck</span></header>
                <div class="wm-press">
                    <div class="wm-press-track">
                        <span class="wm-press-marker" style="left:${ratio * 100}%"></span>
                    </div>
                    <div class="wm-press-info">
                        <span class="wm-press-big">${formatNumber(p, 0)}</span>
                        <small>mbar · ${formatTime(new Date())} (Jetzt)</small>
                    </div>
                </div>
                <p class="wm-detail-hint">${trendLabel}</p>
            </article>
        `;
    }

    function cardSun(day) {
        const dateRef = day.isToday ? new Date() : new Date(`${day.date}T12:00:00`);
        const sun = computeSunTimes(dateRef, LINGEN_COORDS.lat, LINGEN_COORDS.lon);
        if (!sun) return '';
        const dur = sunDuration(sun.sunriseDate, sun.sunsetDate);
        const ratio = sunProgress(sun.sunriseDate, sun.sunsetDate, new Date());
        return `
            <article class="wm-detail wm-detail--sun">
                <header class="wm-detail-head"><span class="wm-detail-title">Sonne</span></header>
                <div class="wm-arc">
                    <svg viewBox="0 0 200 110" preserveAspectRatio="xMidYMid meet">
                        <defs>
                            <linearGradient id="wm-sun-grad" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0" stop-color="#ff8a4c"/>
                                <stop offset="0.5" stop-color="#ffd166"/>
                                <stop offset="1" stop-color="#ff8a4c"/>
                            </linearGradient>
                        </defs>
                        <path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3"/>
                        <path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="url(#wm-sun-grad)" stroke-width="3" stroke-dasharray="283" stroke-dashoffset="${283 * (1 - ratio)}"/>
                        <circle cx="${10 + 180 * ratio}" cy="${100 - Math.sin(Math.PI * ratio) * 90}" r="5" fill="#ffd166"/>
                    </svg>
                    <div class="wm-arc-center">
                        <strong>${dur}</strong>
                    </div>
                </div>
                <div class="wm-arc-times">
                    <div><strong>${sun.sunrise}</strong><small>Sonnenaufgang</small></div>
                    <div><strong>${sun.sunset}</strong><small>Sonnenuntergang</small></div>
                </div>
            </article>
        `;
    }

    function cardMoonPhase(day) {
        const date = day.isToday ? new Date() : new Date(`${day.date}T12:00:00`);
        const phase = computeMoonPhase(date);
        const pct = Math.round(phase.illumination * 100);
        return `
            <article class="wm-detail wm-detail--moon">
                <header class="wm-detail-head"><span class="wm-detail-title">Mondphase</span></header>
                <div class="wm-moon">
                    <div class="wm-moon-vis">
                        ${moonSvg(phase.phase)}
                    </div>
                    <div class="wm-moon-info">
                        <span class="wm-moon-pct">${pct}%</span>
                        <small>Phase des Mondes</small>
                        <p class="wm-detail-hint">${phase.name}</p>
                    </div>
                </div>
            </article>
        `;
    }

    function deg2rad(d) { return d * Math.PI / 180; }
    function rad2deg(r) { return r * 180 / Math.PI; }

    /**
     * Näherung für Sonnenaufgang/-untergang nach NOAA. Liefert lokale Zeiten
     * für das übergebene Datum + Koordinaten. Genauigkeit für Lingen +/- 1–2 Min.
     */
    function computeSunTimes(date, lat, lon) {
        const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
        const gamma = 2 * Math.PI / 365 * (dayOfYear - 1);
        const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
            - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
        const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
            - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
            - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

        const zenith = 90.833; // Standard incl. Refraktion
        const cosH = (Math.cos(deg2rad(zenith)) - Math.sin(deg2rad(lat)) * Math.sin(decl))
            / (Math.cos(deg2rad(lat)) * Math.cos(decl));
        if (cosH < -1 || cosH > 1) return null;
        const H = rad2deg(Math.acos(cosH));

        const solarNoonUTC = 720 - 4 * lon - eqTime;
        const sunriseUTC = solarNoonUTC - 4 * H;
        const sunsetUTC  = solarNoonUTC + 4 * H;

        const sunriseDate = minutesUtcToDate(date, sunriseUTC);
        const sunsetDate  = minutesUtcToDate(date, sunsetUTC);
        return {
            sunriseDate,
            sunsetDate,
            sunrise: formatTime(sunriseDate),
            sunset:  formatTime(sunsetDate),
        };
    }

    function minutesUtcToDate(refDate, minutesUtc) {
        const d = new Date(Date.UTC(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), 0, 0, 0));
        d.setUTCMinutes(d.getUTCMinutes() + minutesUtc);
        return d;
    }

    function sunDuration(sunrise, sunset) {
        const diff = (sunset - sunrise) / 60000;
        const h = Math.floor(diff / 60);
        const m = Math.round(diff - h * 60);
        return `${h} Std. ${m} Min.`;
    }

    function sunProgress(sunrise, sunset, now) {
        if (now <= sunrise) return 0;
        if (now >= sunset) return 1;
        return (now - sunrise) / (sunset - sunrise);
    }

    /**
     * Mondphase-Näherung. illumination 0..1, phase 0..1 (0/1 = Neumond, 0.5 = Vollmond).
     */
    function computeMoonPhase(date) {
        const c = date.getTime() / 86400000 + 2440587.5; // Julianisches Datum
        const newMoonRef = 2451550.1; // bekannter Neumond
        const synodic = 29.530588853;
        let phase = ((c - newMoonRef) % synodic) / synodic;
        if (phase < 0) phase += 1;
        const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
        let name = 'Zunehmender Halbmond';
        if (phase < 0.03 || phase > 0.97) name = 'Neumond';
        else if (phase < 0.22) name = 'Zunehmende Sichel';
        else if (phase < 0.28) name = 'Erstes Viertel';
        else if (phase < 0.47) name = 'Zunehmender Mond';
        else if (phase < 0.53) name = 'Vollmond';
        else if (phase < 0.72) name = 'Abnehmender Mond';
        else if (phase < 0.78) name = 'Letztes Viertel';
        else name = 'Abnehmende Sichel';
        return { phase, illumination, name };
    }

    function moonSvg(phase) {
        // phase 0..1: 0/1 = neu, 0.5 = voll, <0.5 = waxing (Schatten links), >0.5 waning (Schatten rechts)
        const waxing = phase < 0.5;
        const k = waxing ? phase * 2 : (1 - phase) * 2; // 0 (neu) → 1 (voll)
        const cxOffset = waxing ? -(1 - k) * 50 : (1 - k) * 50;
        return `
            <svg viewBox="-50 -50 100 100" class="wm-moon-svg">
                <defs>
                    <clipPath id="wm-moon-clip"><circle cx="0" cy="0" r="46"/></clipPath>
                </defs>
                <circle cx="0" cy="0" r="46" fill="#1a2438" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
                <circle cx="${cxOffset}" cy="0" r="46" fill="#f5d27c" clip-path="url(#wm-moon-clip)"/>
            </svg>
        `;
    }

    /**
     * Rendert die 7-Tage-Vorhersage als Karten-Liste.
     * Jede Karte ist klickbar und öffnet ein Detail-Modal.
     * @param {Array<Object>} forecast - Array mit Tagesvorhersagen.
     */
    function renderForecast(forecast) {
        state.forecastData = forecast;
        DOM.forecastContainer.innerHTML = '';

        forecast.forEach((day, index) => {
            const card = document.createElement('article');
            card.className = 'forecast-card';
            card.setAttribute('aria-label', `Vorhersage ${day.day}`);
            const hasAqi = day.airQuality && day.airQuality.aqi !== null && day.airQuality.aqi !== undefined;
            card.innerHTML = `
                <span class="forecast-day">${day.day}</span>
                <div class="forecast-icon">${WeatherIcons.get(day.conditionKey)}</div>
                <div class="forecast-temps">
                    <span class="forecast-temp-high">${formatNumber(day.high)}°</span>
                    <span class="forecast-temp-low">${formatNumber(day.low)}°</span>
                </div>
                <span class="forecast-condition">${day.condition}</span>
                <span class="forecast-rain">${formatNumber(day.precipitation, 1)} mm</span>
                ${hasAqi ? aqiBadge(day.airQuality, 'sm') : ''}
            `;
            card.addEventListener('click', () => openForecastModal(day));
            DOM.forecastContainer.appendChild(card);
        });
    }

    function closeForecastModal() {
        DOM.modalOverlay.classList.remove('visible');
        DOM.modalOverlay.classList.add('closing');
        document.body.style.overflow = '';

        DOM.modalOverlay.addEventListener('transitionend', () => {
            DOM.modalOverlay.classList.remove('closing');
            DOM.modalOverlay.hidden = true;
        }, { once: true });
    }

    function initModal() {
        DOM.modalClose.addEventListener('click', closeForecastModal);
        DOM.modalOverlay.addEventListener('click', (e) => {
            if (e.target === DOM.modalOverlay) closeForecastModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !DOM.modalOverlay.hidden) closeForecastModal();
        });
    }

    function renderModalEffects(day) {
        DOM.modal.querySelectorAll('.rain-overlay, .sun-overlay, .cloud-overlay').forEach(el => el.remove());

        const isRaining = day.conditionKey === 'rain' || day.conditionKey === 'storm';
        const isSunny = day.conditionKey === 'sunny' || day.conditionKey === 'partlyCloudy';
        const isCloudy = day.conditionKey === 'cloudy' || day.conditionKey === 'partlyCloudy';

        const overlays = [];
        if (isRaining) overlays.push('<div class="rain-overlay active"></div>');
        if (isSunny) overlays.push('<div class="sun-overlay active"></div>');
        if (isCloudy) overlays.push('<div class="cloud-overlay active"></div>');

        if (overlays.length) {
            DOM.modal.insertAdjacentHTML('afterbegin', overlays.join(''));
        }
    }


    function renderTimestamp(current, fetchedAt) {
        const fetched = new Date(fetchedAt);
        DOM.timestampText.textContent = `Datenstand vom: ${current.observedAtLabel} | abgerufen ${formatTime(fetched)} Uhr`;
    }

    /**
     * Rendert die komplette Wetter-Historie (Monatstabs, Tagesliste, Details).
     * @param {Object} history - History-Objekt mit months[] vom Server.
     */
    function renderHistory(history) {
        state.history = history;
        state.selectedMonthIndex = 0;
        state.selectedDayIndex = 0;
        renderMonthTabs();
        renderSelectedMonth();
    }

    function renderMonthTabs() {
        DOM.historyMonths.innerHTML = '';

        state.history.months.forEach((month, index) => {
            const button = document.createElement('button');
            button.className = `month-tab${index === state.selectedMonthIndex ? ' active' : ''}`;
            button.type = 'button';
            button.role = 'tab';
            button.setAttribute('aria-selected', String(index === state.selectedMonthIndex));
            button.textContent = month.label;
            button.addEventListener('click', () => {
                state.selectedMonthIndex = index;
                state.selectedDayIndex = 0;
                renderMonthTabs();
                renderSelectedMonth();
            });
            DOM.historyMonths.appendChild(button);
        });
    }

    function renderSelectedMonth() {
        const month = state.history.months[state.selectedMonthIndex];
        renderMonthSummary(month);
        renderDayList(month);
        renderDayDetails(month.days[state.selectedDayIndex]);
    }

    function renderMonthSummary(month) {
        const summary = month.summary;
        const aqi = summary.airQuality;
        const aqiCard = aqi
            ? `<article class="history-metric history-metric--aqi" style="--aqi-color:${aqi.color}">
                    <span class="metric-label">Ø Luftqualität</span>
                    <span class="metric-value">${formatNumber(aqi.meanAqi)} <small>${aqi.categoryLabel}</small></span>
               </article>`
            : '';
        DOM.historySummary.innerHTML = `
            ${metricCard('Tage', summary.days, '')}
            ${metricCard('Ø Temperatur', summary.meanTemp, '°C', 1)}
            ${metricCard('Max / Min', `${formatNumber(summary.highTemp, 1)}° / ${formatNumber(summary.lowTemp, 1)}°`, '')}
            ${metricCard('Niederschlag', summary.precipitation, 'mm', 1)}
            ${metricCard('Ø Feuchte', summary.humidity, '%')}
            ${metricCard('Ø Wind', summary.windMean, 'km/h', 1)}
            ${aqiCard}
        `;
    }

    function renderDayList(month) {
        DOM.historyDays.innerHTML = '';

        month.days.forEach((day, index) => {
            const button = document.createElement('button');
            button.className = `day-button${index === state.selectedDayIndex ? ' active' : ''}`;
            button.type = 'button';
            button.setAttribute('aria-pressed', String(index === state.selectedDayIndex));
            button.innerHTML = `
                <span class="day-date">${day.label}</span>
                <span class="day-icon">${WeatherIcons.get(day.conditionKey)}</span>
                <span class="day-temp">${formatNumber(day.highTemp, 1)}° / ${formatNumber(day.lowTemp, 1)}°</span>
                <span class="day-rain">${formatNumber(day.precipitation, 1)} mm</span>
                ${day.airQuality ? aqiBadge(day.airQuality, 'sm') : ''}
            `;
            button.addEventListener('click', () => {
                state.selectedDayIndex = index;
                renderDayList(month);
                renderDayDetails(day);
            });
            DOM.historyDays.appendChild(button);
        });
    }

    function renderDayDetails(day) {
        if (!day) {
            DOM.dayDetails.innerHTML = '<p class="empty-state">Keine Tagesdaten verfügbar.</p>';
            return;
        }

        DOM.dayDetails.innerHTML = `
            <header class="day-details-header">
                <div>
                    <p class="section-kicker">${formatIsoDate(day.date)}</p>
                    <h3 class="day-details-title">${day.label}</h3>
                </div>
                <div class="day-details-icon">${WeatherIcons.get(day.conditionKey)}</div>
            </header>
            ${day.airQuality ? `<div class="day-details-aqi">${aqiBadge(day.airQuality, 'md')}</div>` : ''}
            <dl class="day-metrics">
                ${detailRow('Mitteltemperatur', day.meanTemp, '°C', 1)}
                ${detailRow('Höchsttemperatur', day.highTemp, '°C', 1)}
                ${detailRow('Tiefsttemperatur', day.lowTemp, '°C', 1)}
                ${detailRow('Niederschlag', day.precipitation, 'mm', 1)}
                ${detailRow('Luftfeuchtigkeit', day.humidity, '%')}
                ${detailRow('Luftdruck', day.pressure, 'hPa', 1)}
                ${detailRow('Ø Windgeschwindigkeit', day.windMean, 'km/h', 1)}
                ${detailRow('Max. Windböe', day.windGust, 'km/h', 1)}
                ${day.airQuality ? aqiDetailRows(day.airQuality) : ''}
            </dl>
        `;
    }

    function aqiDetailRows(aqi) {
        const headline = `
            <div class="day-metric-row day-metric-row--aqi" style="--aqi-color:${aqi.color}">
                <dt>Luftqualität (AQI)</dt>
                <dd>${formatNumber(aqi.aqi)} – <span class="aqi-inline-label">${aqi.categoryLabel}</span></dd>
            </div>
        `;
        return [
            headline,
            aqi.pm25 !== null ? detailRow('PM₂,₅ (Feinstaub)', aqi.pm25, 'µg/m³', 1) : '',
            aqi.pm10 !== null ? detailRow('PM₁₀ (Feinstaub)', aqi.pm10, 'µg/m³', 1) : '',
            aqi.no2 !== null ? detailRow('NO₂ (Stickstoffdioxid)', aqi.no2, 'µg/m³', 1) : '',
            aqi.o3 !== null ? detailRow('O₃ (Ozon)', aqi.o3, 'µg/m³', 1) : '',
        ].filter(Boolean).join('');
    }



    function metricCard(label, value, unit, digits = 0) {
        const displayValue = typeof value === 'string' ? value : formatNumber(value, digits);
        return `
            <article class="history-metric">
                <span class="metric-label">${label}</span>
                <span class="metric-value">${displayValue}${unit ? ` ${unit}` : ''}</span>
            </article>
        `;
    }

    function detailRow(label, value, unit, digits = 0) {
        return `
            <div class="day-metric-row">
                <dt>${label}</dt>
                <dd>${formatNumber(value, digits)}${unit ? ` ${unit}` : ''}</dd>
            </div>
        `;
    }



    function renderLoading() {
        DOM.currentCondition.textContent = 'Wetterdaten werden geladen…';
        DOM.forecastContainer.innerHTML = Array.from({ length: 3 },
            () => '<article class="forecast-card loading-card">Laden…</article>'
        ).join('');
        DOM.historySummary.innerHTML = '<p class="empty-state">Historie wird geladen…</p>';
    }

    function renderError(error) {
        WeatherThemes.apply('cloudy');
        DOM.widget.classList.add('has-error');
        DOM.currentIcon.innerHTML = WeatherIcons.get('cloudy');
        DOM.currentTemp.textContent = '--°C';
        DOM.currentCondition.textContent = 'Wetterdaten nicht erreichbar';
        DOM.detailFeelsLike.textContent = '--°C';
        DOM.detailWind.textContent = '-- km/h';
        DOM.detailHumidity.textContent = '--%';
        DOM.detailPrecip.textContent = '-- mm';
        DOM.forecastContainer.innerHTML = `<p class="empty-state">${error.message}</p>`;
        DOM.timestampText.textContent = 'Bitte die Seite über den lokalen Server starten: node server.js';
        DOM.historySummary.innerHTML = `<p class="empty-state">${error.message}</p>`;
    }

    function formatNumber(value, digits = 0) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
        return Number(value).toLocaleString('de-DE', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        });
    }

    function formatTime(date) {
        return date.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function formatIsoDate(value) {
        if (!value) return '--';
        return new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    }

    function setActiveNav(active) {
        DOM.navWeather.classList.toggle('active', active === 'weather');
        DOM.navHistory.classList.toggle('active', active === 'history');
    }

    function renderView(view) {
        const isHistory = view === 'history';
        DOM.pageHeader.hidden = isHistory;
        DOM.weatherWidget.hidden = isHistory;
        DOM.historyPanel.hidden = !isHistory;
        setActiveNav(isHistory ? 'history' : 'weather');
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function viewFromHash() {
        return window.location.hash === '#historie' ? 'history' : 'weather';
    }

    function initNavigation() {
        DOM.navWeather.addEventListener('click', (event) => {
            event.preventDefault();
            window.location.hash = 'wetter';
            renderView('weather');
        });

        DOM.navHistory.addEventListener('click', (event) => {
            event.preventDefault();
            window.location.hash = 'historie';
            renderView('history');
        });

        window.addEventListener('hashchange', () => renderView(viewFromHash()));
        renderView(viewFromHash());
        const nav = document.getElementById('top-nav');
        let lastScrollY = window.scrollY;
        const SCROLL_THRESHOLD = 8;
        window.addEventListener('scroll', () => {
            const scrollY = window.scrollY;
            const delta = scrollY - lastScrollY;

            if (scrollY <= 10) {
                nav.classList.remove('hidden');
            } else if (delta > SCROLL_THRESHOLD) {
                nav.classList.add('hidden');
            } else if (delta < -SCROLL_THRESHOLD) {
                nav.classList.remove('hidden');
            }

            lastScrollY = scrollY;
        }, { passive: true });
    }

    /**
     * @memberof WeatherWidget
     * @description Einstiegspunkt:
     * Initialisiert das Widget, bindet Events,
     * lädt die Wetterdaten und rendert alles.
     * @returns {Promise<void>}
     */
    async function init() {
        initNavigation();
        initModal();
        renderLoading();

        try {
            const data = await loadDwdWeatherData();

            if (data.airQuality) state.airQuality = data.airQuality;
            state.todayData = data.today || null;
            state.yesterdayData = data.yesterday || null;
            WeatherThemes.apply(data.current.conditionKey);
            renderCurrent(data.current);
            renderForecast(data.forecast);
            renderTimestamp(data.current, data.fetchedAt);
            renderHistory(data.history);
        } catch (error) {
            renderError(error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
