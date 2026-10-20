# RainWise — Smart Rainwater Harvesting & Management

A free, software-only simulation project for college campuses and residential buildings. It models rooftop runoff, usable inflow, tank storage, water demand, overflow, unmet demand, performance metrics and basic recommendations.

## Technology

- HTML and CSS: dashboard and responsive layout
- JavaScript: browser input, charts, scenario simulation, CSV export, and WebAssembly integration
- C: reusable water calculation engine
- Emscripten: compiles the C engine to WebAssembly
- Open-Meteo forecast API (optional; standard non-commercial use subject to its terms)

## Open-Meteo weather integration

The dashboard includes an optional **Fetch rainfall forecast** panel. It requests daily precipitation totals from the Open-Meteo forecast API and copies the forecast into the rainfall input before rerunning the simulation.

- Standard Open-Meteo API use does not require an API key.
- Default coordinates are Dehradun (latitude 30.3165, longitude 78.0322); change them to match your building site.
- Select 7, 14 or 16 forecast days. The returned forecast becomes the model's rainfall series.
- An internet connection is required for the forecast. If the request fails, the app keeps the previous rainfall series.
- The forecast is not guaranteed rainfall and is not a replacement for historical rainfall analysis or site engineering.
- Follow Open-Meteo's current terms, attribution requirements and usage limits: https://open-meteo.com/en/terms and https://open-meteo.com/en/docs.
