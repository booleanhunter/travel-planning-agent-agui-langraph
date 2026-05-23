import type { Weather } from "../types";

interface Props {
  weather: Weather;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function iconFor(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("monsoon") || c.includes("shower")) return "☔";
  if (c.includes("snow")) return "❄️";
  if (c.includes("hot") || c.includes("sunny")) return "☀️";
  if (c.includes("cool") || c.includes("cold")) return "🌥";
  return "🌤";
}

export function WeatherCard({ weather }: Props) {
  return (
    <div className="weather-card">
      <span style={{ fontSize: 28 }}>{iconFor(weather.condition)}</span>
      <div>
        <div className="weather-temp">
          {weather.high}° / {weather.low}°
        </div>
        <div className="weather-cond">
          {MONTH_NAMES[weather.month - 1]} in <span style={{ textTransform: "capitalize" }}>{weather.city}</span> — {weather.condition}
        </div>
      </div>
      {weather.precipitationChance > 0.3 && (
        <div className="weather-rain" style={{ marginLeft: "auto" }}>
          {Math.round(weather.precipitationChance * 100)}% chance of rain
        </div>
      )}
    </div>
  );
}
