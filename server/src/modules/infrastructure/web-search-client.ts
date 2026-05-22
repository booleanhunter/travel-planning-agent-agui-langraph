/**
 * Web-search adapter. Currently backed by Tavily; the public surface
 * exposes the two operations the agent tools actually use:
 *
 *   - lookupWeather    — forecast for the trip's days, drives "looks like rain on Day 2"
 *   - searchProducts   — product search for the trip-essentials picker
 *
 * Point-of-interest discovery uses Google Places + the Redis hybrid index
 * instead — this client is scoped to the planning agent's weather lookup
 * and the trip-preparation agent's product search.
 */

import { tavily, type TavilyClient } from '@tavily/core';
import { config } from '../../config.ts';
import { AppError, ErrorType } from '../../lib/errors.ts';

export interface WeatherForecast {
    dayIndex: number; // 1-indexed position within the trip
    date: string; // ISO date
    conditions: string; // narrative — "scattered showers"
    precipitationChance?: number; // 0-1
    temperatureHigh?: number;
    temperatureLow?: number;
}

export interface ProductResult {
    name: string;
    vendor: string;
    priceText?: string;
    imageUrl?: string;
    url: string;
    snippet?: string;
}

let client: TavilyClient | null = null;
function getClient(): TavilyClient {
    if (!config.tavily.apiKey) {
        throw new AppError(
            'TavilyConfigError',
            'Tavily: TAVILY_API_KEY not set',
            ErrorType.EXTERNAL_SERVICE,
        );
    }
    if (!client) client = tavily({ apiKey: config.tavily.apiKey });
    return client;
}

/**
 * One Tavily search per trip, includeAnswer=true. Tavily's natural-language
 * answer is fanned out across the trip's days so the prep agent can reason
 * over "looks like rain mid-week" — the planning agent surfaces this as a
 * single weather summary line per day in the sidebar. Per-day structured
 * data would need a forecast API; for the demo the narrative is enough.
 */
export async function lookupWeather(
    destination: string,
    days: { date: string }[],
): Promise<WeatherForecast[]> {
    if (!days.length) return [];
    const tvly = getClient();
    const first = days[0].date;
    const last = days[days.length - 1].date;
    const query = `weather forecast ${destination} ${first} to ${last}`;

    let summary: string;
    try {
        const res = await tvly.search(query, { includeAnswer: 'basic', maxResults: 5 });
        summary = res.answer?.trim() || res.results[0]?.content?.slice(0, 240) || 'no forecast';
    } catch (e) {
        throw new AppError(
            'TavilySearchError',
            `Tavily weather search: ${String(e)}`,
            ErrorType.EXTERNAL_SERVICE,
        );
    }

    return days.map((d, i) => ({ dayIndex: i + 1, date: d.date, conditions: summary }));
}

function vendorFromUrl(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return 'unknown';
    }
}

export async function searchProducts(query: string, maxResults = 3): Promise<ProductResult[]> {
    const tvly = getClient();
    try {
        const res = await tvly.search(query, { maxResults, includeImages: true });
        return res.results.map((r, i) => ({
            name: r.title,
            vendor: vendorFromUrl(r.url),
            url: r.url,
            snippet: r.content?.slice(0, 200),
            imageUrl: res.images?.[i]?.url,
        }));
    } catch (e) {
        throw new AppError(
            'TavilySearchError',
            `Tavily product search: ${String(e)}`,
            ErrorType.EXTERNAL_SERVICE,
        );
    }
}
