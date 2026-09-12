import { api } from './api';

export type AnalyticsDays = 7 | 28 | 90;
export type AnalyticsMetric = 'views' | 'likes' | 'comments' | 'reposts';
export type AnalyticsCounts = Record<AnalyticsMetric, number>;
export type AnalyticsDay = AnalyticsCounts & { date: string };
export interface SwiftAnalytics {
  days: AnalyticsDays;
  start_date: string;
  end_date: string;
  timezone: 'UTC';
  totals: AnalyticsCounts & { videos: number };
  period: AnalyticsCounts;
  previous_period: AnalyticsCounts;
  series: AnalyticsDay[];
  top_swifts: {
    id: number; caption: string; thumbnail_url: string; created_at: string; views: number;
  }[];
  definitions: { views: string; engagements: string };
}

export async function fetchSwiftAnalytics(
  days: AnalyticsDays, swiftId?: number, signal?: AbortSignal,
): Promise<SwiftAnalytics> {
  const response = await api.get<SwiftAnalytics>('/api/swifts/analytics/', {
    params: { days, ...(swiftId === undefined ? {} : { swift_id: swiftId }) },
    signal,
  });
  return response.data;
}

export function periodChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? 'New' : '—';
  const percent = ((current - previous) / previous) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export function analyticsDate(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}
