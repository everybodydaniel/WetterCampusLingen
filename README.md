# Campus Wetter-Dashboard 🌤️

Ein modernes, schlankes und responsives Wetter-Dashboard, das Live-Wetterdaten, Vorhersagen, Historien und Luftqualitätsdaten aus verschiedenen Quellen aggregiert und visuell ansprechend darstellt. 

Das Projekt besteht aus einem Node.js-Backend und einem Vanilla JS/HTML/CSS Frontend, das durch ein umfangreiches Refactoring für maximale Performance und Wartbarkeit optimiert wurde.

---

## 🚀 Features

- **Live-Wetterdaten:** Integriert Echtzeitdaten der lokalen WeatherLink-Station.
- **Wettervorhersage:** Detaillierte Stundenvorhersage sowie 7-Tage-Trend über Open-Meteo.
- **Luftqualität (AQI):** Visualisierung von aktuellen Schadstoffwerten (Feinstaub, Stickstoffdioxid etc.) via Open-Meteo.
- **Fallback-System:** Bei fehlender Datenbankverbindung läuft die Anwendung nahtlos im API-Modus weiter.
- **Responsives UI:** Entwickelt ohne schwere Frontend-Frameworks, mit modernem CSS für Desktops und mobile Endgeräte (inkl. Modal-Dialogen für detaillierte Vorhersagen).
- **Automatisierte Dokumentation:** JSDoc ist vollständig integriert. Ein GitHub-Action-Workflow generiert bei Änderungen automatisch eine statische Dokumentationsseite und veröffentlicht diese via GitHub Pages.

---

## 🛠️ Technologien

- **Backend:** Node.js (Vanilla HTTP-Server ohne Express, minimaler Overhead)
- **Datenbank:** MariaDB (Pool-basierte Verbindung, Caching für Widget-Payloads)
- **Frontend:** Vanilla JavaScript, HTML5, CSS3 (inkl. CSS-Variablen für Theming)
- **Datenquellen:** WeatherLink, Open-Meteo (und optional DWD WarnWetter/CDC)

---

## ⚙️ Setup & Installation

Folge diesen Schritten, um das Projekt lokal auszuführen:

### 1. Abhängigkeiten installieren
Stelle sicher, dass Node.js (Version >= 18 empfohlen) installiert ist. Öffne ein Terminal im Projektordner und installiere die benötigten Pakete:

```bash
npm install
```
*(Die MariaDB-Bibliothek wird automatisch als Abhängigkeit aus der `package.json` installiert).*

### 2. Umgebungsvariablen (.env) einrichten
Das System benötigt Datenbank-Zugangsdaten. Kopiere die beiliegende `.env.example` in eine neue `.env` Datei (oder erstelle diese) und passe die Werte an:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=campus_wetter_app
DB_PASSWORD=Campus_Wetter2026!
DB_NAME=Campus_Wetter
PORT=5173
```

### 3. Datenbank vorbereiten
Stelle sicher, dass dein lokaler MariaDB-Server läuft und die im `.env` angegebene Datenbank existiert. 
*(Hinweis: Werden die notwendigen Tabellen wie z.B. `wetterbeobachtung` nicht gefunden oder schlägt die Verbindung fehl, warnt das Backend im Terminal, funktioniert aber als Fallback rein auf API-Basis weiter).*

### 4. Server starten
Starte den Node.js-Server:

```bash
node server.js
```
*(Alternativ kann ein abweichender Port angegeben werden, falls `5173` blockiert ist: `$env:PORT=5174; node server.js` auf Windows).*

Die Webseite ist danach im Browser unter [http://localhost:5173](http://localhost:5173) (bzw. dem konfigurierten Port) erreichbar.

---

## 📚 Entwickler-Dokumentation (JSDoc)

Der gesamte Code ist ausführlich mit JSDoc kommentiert. 
Eine statische HTML-Dokumentation wird via GitHub Actions generiert und auf **GitHub Pages** bereitgestellt. Die Dokumentation liefert Entwicklern einen direkten Einblick in Methoden, Parameter und Module (wie `db.js`, `server.js`, `weather-widget.js`).