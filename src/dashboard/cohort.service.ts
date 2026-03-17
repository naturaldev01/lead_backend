import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

export interface CohortData {
  cohortMonth: string;
  leadCount: number;
  monthsData: {
    month: number;
    revenue: number;
    cumulativeRevenue: number;
  }[];
}

export interface CohortSummary {
  cohorts: CohortData[];
  maxMonths: number;
}

@Injectable()
export class CohortService {
  private readonly logger = new Logger(CohortService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getCohortRevenue(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    cohortStartDate?: string,
    cohortEndDate?: string,
    maxMonthsToTrack?: number,
  ): Promise<CohortSummary> {
    const supabase = this.supabaseService.getClient();
    const trackLimit = maxMonthsToTrack || 12;
    const cohortStart = cohortStartDate || startDate;
    const cohortEnd = cohortEndDate || endDate;

    try {
      const { data, error } = await supabase.rpc('get_cohort_revenue_optimized', {
        p_cohort_start: cohortStart || null,
        p_cohort_end: cohortEnd || null,
        p_account_id: accountId || null,
        p_max_months: trackLimit,
      });

      if (error) {
        this.logger.error('RPC get_cohort_revenue_optimized failed', error);
        return { cohorts: [], maxMonths: 0 };
      }

      if (!data || data.length === 0) {
        return { cohorts: [], maxMonths: 0 };
      }

      const cohortMap = new Map<string, CohortData>();
      let maxMonths = 0;

      for (const row of data) {
        const cohortMonth = row.cohort_month;
        const monthOffset = parseInt(row.month_offset);
        const leadCount = parseInt(row.lead_count);
        const cumulativeRevenue = parseFloat(row.cumulative_revenue) || 0;

        maxMonths = Math.max(maxMonths, monthOffset);

        if (!cohortMap.has(cohortMonth)) {
          cohortMap.set(cohortMonth, {
            cohortMonth,
            leadCount,
            monthsData: [],
          });
        }

        const cohort = cohortMap.get(cohortMonth)!;
        const prevCumulative = cohort.monthsData.length > 0
          ? cohort.monthsData[cohort.monthsData.length - 1].cumulativeRevenue
          : 0;

        cohort.monthsData.push({
          month: monthOffset,
          revenue: cumulativeRevenue - prevCumulative,
          cumulativeRevenue,
        });
      }

      const cohorts = Array.from(cohortMap.values()).sort(
        (a, b) => a.cohortMonth.localeCompare(b.cohortMonth)
      );

      return { cohorts, maxMonths };
    } catch (err) {
      this.logger.error('Failed to fetch cohort revenue', err);
      return { cohorts: [], maxMonths: 0 };
    }
  }

  async getLeadTrend(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    granularity: 'day' | 'week' | 'month' = 'month',
  ): Promise<{ date: string; leads: number }[]> {
    const supabase = this.supabaseService.getClient();

    try {
      const { data, error } = await supabase.rpc('get_lead_trend_optimized', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_account_id: accountId || null,
        p_granularity: granularity,
      });

      if (error) {
        this.logger.error('RPC get_lead_trend_optimized failed', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        date: row.date,
        leads: parseInt(row.leads) || 0,
      }));
    } catch (err) {
      this.logger.error('Failed to fetch lead trend', err);
      return [];
    }
  }
}
