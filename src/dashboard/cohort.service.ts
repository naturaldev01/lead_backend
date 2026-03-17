import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

export interface CohortData {
  cohortMonth: string;
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
  ): Promise<CohortSummary> {
    const supabase = this.supabaseService.getClient();

    // Get all leads with their attribution data
    let leadsQuery = supabase
      .from('leads')
      .select(`
        id,
        created_at,
        campaign_id,
        campaigns!inner (
          ad_account_id
        )
      `);

    if (startDate) {
      leadsQuery = leadsQuery.gte('created_at', startDate);
    }
    if (endDate) {
      leadsQuery = leadsQuery.lte('created_at', endDate);
    }

    const { data: leads, error: leadsError } = await leadsQuery;

    if (leadsError) {
      this.logger.error('Failed to fetch leads for cohort', leadsError);
      return { cohorts: [], maxMonths: 0 };
    }

    // Filter by account if specified
    let filteredLeads = leads || [];
    if (accountId) {
      filteredLeads = filteredLeads.filter(
        (l: any) => l.campaigns?.ad_account_id === accountId,
      );
    }

    // Get lead IDs
    const leadIds = filteredLeads.map((l) => l.id);

    if (leadIds.length === 0) {
      return { cohorts: [], maxMonths: 0 };
    }

    // Get attributions for these leads (use payment_amount or deal_amount for revenue)
    const { data: attributions } = await supabase
      .from('lead_attribution')
      .select('lead_id, deal_amount, payment_amount, deal_date, payment_date')
      .in('lead_id', leadIds);

    // Create a map of lead_id to attribution (prefer payment_amount, fallback to deal_amount)
    const attributionMap = new Map<string, { dealAmount: number; dealDate: string }>();
    for (const attr of attributions || []) {
      const amount = attr.payment_amount || attr.deal_amount;
      const date = attr.payment_date || attr.deal_date;
      
      if (amount && date) {
        attributionMap.set(attr.lead_id, {
          dealAmount: parseFloat(amount),
          dealDate: date,
        });
      }
    }

    // Group leads by cohort month
    const cohortMap = new Map<string, { leadId: string; createdAt: Date }[]>();
    for (const lead of filteredLeads) {
      const createdAt = new Date(lead.created_at);
      const cohortKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      
      if (!cohortMap.has(cohortKey)) {
        cohortMap.set(cohortKey, []);
      }
      cohortMap.get(cohortKey)!.push({
        leadId: lead.id,
        createdAt,
      });
    }

    // Calculate revenue for each cohort at each month interval
    const now = new Date();
    const cohorts: CohortData[] = [];
    let maxMonths = 0;

    const sortedCohortKeys = Array.from(cohortMap.keys()).sort();

    for (const cohortMonth of sortedCohortKeys) {
      const cohortLeads = cohortMap.get(cohortMonth)!;
      const cohortDate = new Date(cohortMonth + '-01');
      
      // Calculate how many months have passed since this cohort
      const monthsElapsed = this.getMonthsDiff(cohortDate, now);
      maxMonths = Math.max(maxMonths, monthsElapsed);

      const monthsData: { month: number; revenue: number; cumulativeRevenue: number }[] = [];
      let cumulativeRevenue = 0;

      // Calculate revenue for each month (0 to monthsElapsed)
      for (let month = 0; month <= Math.min(monthsElapsed, 12); month++) {
        const targetDate = new Date(cohortDate);
        targetDate.setMonth(targetDate.getMonth() + month + 1);
        targetDate.setDate(0); // Last day of the month

        let monthRevenue = 0;

        for (const lead of cohortLeads) {
          const attribution = attributionMap.get(lead.leadId);
          if (attribution) {
            const dealDate = new Date(attribution.dealDate);
            // Check if deal was closed within this month period
            if (dealDate <= targetDate) {
              // Only count once when the deal happened
              const dealMonth = this.getMonthsDiff(cohortDate, dealDate);
              if (dealMonth === month) {
                monthRevenue += attribution.dealAmount;
              }
            }
          }
        }

        cumulativeRevenue += monthRevenue;
        monthsData.push({
          month,
          revenue: monthRevenue,
          cumulativeRevenue,
        });
      }

      cohorts.push({
        cohortMonth,
        monthsData,
      });
    }

    return {
      cohorts,
      maxMonths: Math.min(maxMonths, 12),
    };
  }

  async getLeadTrend(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    granularity: 'day' | 'week' | 'month' = 'month',
  ): Promise<{ date: string; leads: number }[]> {
    const supabase = this.supabaseService.getClient();

    let query = supabase
      .from('daily_insights')
      .select('date, leads_count, ad_account_id');

    if (startDate) {
      query = query.gte('date', startDate);
    }
    if (endDate) {
      query = query.lte('date', endDate);
    }
    if (accountId) {
      query = query.eq('ad_account_id', accountId);
    }

    const { data: insights } = await query;

    if (!insights || insights.length === 0) {
      return [];
    }

    // Group by granularity
    const groupedData = new Map<string, number>();

    for (const insight of insights) {
      let key: string;
      const date = new Date(insight.date);

      switch (granularity) {
        case 'day':
          key = insight.date;
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
        default:
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
      }

      const current = groupedData.get(key) || 0;
      groupedData.set(key, current + (insight.leads_count || 0));
    }

    return Array.from(groupedData.entries())
      .map(([date, leads]) => ({ date, leads }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private getMonthsDiff(start: Date, end: Date): number {
    return (
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth())
    );
  }
}
