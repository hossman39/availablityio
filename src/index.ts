import dotenv from "dotenv";
import { addonBuilder, serveHTTP } from "stremio-addon-sdk";
import type { StreamArgs } from "stremio-addon-sdk";

dotenv.config();

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type TmdbFindResponse = {
  movie_results?: Array<{ id: number }>;
};

type TmdbReleaseDatesResponse = {
  results?: Array<{
    iso_3166_1: string;
    release_dates?: Array<{ release_date: string; type: number }>;
  }>;
};

const manifest = {
  id: "com.availabilityio.tmdb-digital-release",
  name: "Availabilityio Digital Release Streams",
  version: "1.0.0",
  description: "Shows a stream card once the TMDB digital release date has passed.",
  catalogs: [],
  resources: ["stream"],
  types: ["movie"],
  idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status}`);
  }
  return (await response.json()) as T;
};

const getTmdbIdFromImdb = async (imdbId: string): Promise<number | null> => {
  const url = `${TMDB_BASE_URL}/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  const data = await fetchJson<TmdbFindResponse>(url);
  return data.movie_results?.[0]?.id ?? null;
};

const getDigitalReleaseDate = async (tmdbId: number): Promise<string | null> => {
  const url = `${TMDB_BASE_URL}/movie/${tmdbId}/release_dates?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson<TmdbReleaseDatesResponse>(url);
  const results = data.results ?? [];
  const usResult = results.find((result) => result.iso_3166_1 === "US");
  const getDigitalDates = (items: typeof results) =>
    items
      .flatMap((result) => result.release_dates ?? [])
      .filter((release) => release.type === 4 && release.release_date)
      .map((release) => release.release_date);

  const preferred = getDigitalDates(usResult ? [usResult] : []);
  const fallback = getDigitalDates(results);
  const candidates = preferred.length > 0 ? preferred : fallback;
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return candidates[0];
};

builder.defineStreamHandler(async (args: StreamArgs) => {
  if (!TMDB_API_KEY) {
    return {
      streams: [
        {
          name: "Configuration error",
          title: "TMDB_API_KEY is not set",
          externalUrl: "https://www.themoviedb.org"
        }
      ]
    };
  }

  if (args.type !== "movie") {
    return { streams: [] };
  }

  const imdbId = args.id.split(":")[0];
  if (!imdbId || !imdbId.startsWith("tt")) {
    return { streams: [] };
  }

  try {
    const tmdbId = await getTmdbIdFromImdb(imdbId);
    if (!tmdbId) {
      return {
        streams: [
          {
            name: "No TMDB match",
            title: `No TMDB match for ${imdbId}`,
            externalUrl: "https://www.themoviedb.org"
          }
        ]
      };
    }

    const tmdbUrl = `https://www.themoviedb.org/movie/${tmdbId}`;
    const plannedDate = await getDigitalReleaseDate(tmdbId);
    if (!plannedDate) {
      return {
        streams: [
          {
            name: "No digital date",
            title: "No digital release date found",
            externalUrl: tmdbUrl
          }
        ]
      };
    }

    const dateOnly = plannedDate.split("T")[0] || plannedDate;
    const releaseTime = new Date(plannedDate).getTime();
    if (Number.isNaN(releaseTime)) {
      return {
        streams: [
          {
            name: "Not yet available",
            title: `Planned digital release: ${dateOnly}`,
            externalUrl: tmdbUrl
          }
        ]
      };
    }

    if (releaseTime <= Date.now()) {
      return {
        streams: [
          {
            name: "Digital release",
            title: `Released ${dateOnly}`,
            externalUrl: tmdbUrl
          }
        ]
      };
    }

    return {
      streams: [
        {
          name: "⏳ Not Available Yet",
          title: `Digital release: ${dateOnly} — Check back after that date!`,
          externalUrl: tmdbUrl
        }
      ]
    };
  } catch (error) {
    return {
      streams: [
        {
          name: "TMDB error",
          title: "Failed to fetch release data",
          externalUrl: "https://www.themoviedb.org"
        }
      ]
    };
  }
});

const addonInterface = builder.getInterface();
const port = Number(process.env.PORT) || 7874;

serveHTTP(addonInterface, { port });
console.log(`Addon running on http://localhost:${port}/manifest.json`);
