export type AreaScores = {
  discoverability: number;
  readability: number;
  actionability: number;
  trust: number;
};

export type PublicResult = {
  id: string;
  siteKey: string;
  url: string;
  score: number;
  grade: string;
  areas: AreaScores;
  checkedAt: string;
  removalToken: string;
};

export type PublicSiteRow = {
  rank: number;
  siteKey: string;
  slug: string;
  score: number;
  grade: string;
  areas: AreaScores;
  change: number | null;
  checkedAt: string;
};

export type PublicListResponse = {
  total: number;
  page: number;
  perPage: number;
  pages: number;
  stats: {
    sites: number;
    average: number;
    top: number;
    strongCount: number;
  };
  rows: PublicSiteRow[];
};

export type PublicReportResponse = {
  slug: string;
  siteKey: string;
  url: string;
  score: number;
  grade: string;
  areas: AreaScores;
  checkedAt: string;
  rank: number;
  total: number;
  report: unknown;
};

export type HistoryPoint = {
  score: number;
  checkedAt: string;
};

export const AREA_MAX = {
  discoverability: 25,
  readability: 30,
  actionability: 25,
  trust: 20,
} as const;
