import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { isHrFormName } from './reporting-helpers';

export interface DashboardStatsV2 {
  spend: number;
  leads: number;
  cpl: number;
  deals: number;
  revenue: number;
  roas: number;
  leadToDealRate: number;
  costPerDeal: number;
  avgOfferAmount: number;
  avgDealAmount: number;
  lastSpendSync: string | null;
  lastLeadsSync: string | null;
}

export interface DashboardFilters {
  startDate?: string;
  endDate?: string;
  accountId?: string;
  objective?: string;
  country?: string;
  service?: string;
  campaign?: string;
  language?: string;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getStats(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    objective?: string,
  ) {
    const supabase = this.supabaseService.getClient();

    let totalSpend = 0;
    let totalLeads = 0;

    // If date range is provided, use daily_insights table with SQL aggregation
    if (startDate && endDate) {
      const { data, error } = await supabase.rpc('get_daily_insights_totals', {
        start_date: startDate,
        end_date: endDate,
        account_id: accountId || null,
      });

      if (!error && data) {
        totalSpend = parseFloat(data.total_spend) || 0;
        totalLeads = parseInt(data.total_leads) || 0;
      }
    } else {
      // All time - use campaigns table with SQL aggregation
      const { data, error } = await supabase.rpc('get_campaigns_totals', {
        account_id: accountId || null,
        campaign_objective: objective || null,
      });

      if (!error && data) {
        totalSpend = parseFloat(data.total_spend) || 0;
        totalLeads = parseInt(data.total_leads) || 0;
      }
    }

    // Get sync logs
    const { data: syncLogs } = await supabase
      .from('sync_logs')
      .select('type, created_at')
      .order('created_at', { ascending: false })
      .limit(2);

    const spendSync = (syncLogs || []).find((s) => s.type === 'spend');
    const leadsSync = (syncLogs || []).find(
      (s) => s.type === 'leads' || s.type === 'spend',
    );

    return {
      totalSpend,
      totalLeads,
      lastSpendSync: spendSync?.created_at || null,
      lastLeadsSync: leadsSync?.created_at || null,
    };
  }

  async getStatsV2(filters: DashboardFilters): Promise<DashboardStatsV2> {
    const supabase = this.supabaseService.getClient();
    const { startDate, endDate, accountId, country, service, language } = filters;

    // If country/service/language filters are present, use fallback with campaign filtering
    const hasAdvancedFilters = !!(country || service || language);

    let spend = 0;
    let leads = 0;
    let deals = 0;
    let revenue = 0;
    let cpl = 0;
    let roas = 0;
    let leadToDealRate = 0;
    let costPerDeal = 0;
    let avgOfferAmount = 0;
    let avgDealAmount = 0;

    if (hasAdvancedFilters) {
      // Fallback: use campaign-level RPC and filter in JS
      const stats = await this.getStatsV2WithAdvancedFilters(filters);
      spend = stats.spend;
      leads = stats.leads;
      deals = stats.deals;
      revenue = stats.revenue;
      cpl = stats.cpl;
      roas = stats.roas;
      leadToDealRate = stats.leadToDealRate;
      costPerDeal = stats.costPerDeal;
      avgOfferAmount = stats.avgOfferAmount;
      avgDealAmount = stats.avgDealAmount;
    } else {
      // Fast path: single SQL RPC call
      const { data, error } = await supabase.rpc('get_dashboard_stats_v2_rpc', {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_account_id: accountId || null,
      });

      if (error) {
        this.logger.error('Failed to fetch dashboard stats v2 via RPC', error);
      } else if (data && data.length > 0) {
        const row = data[0];
        spend = parseFloat(row.spend) || 0;
        leads = parseInt(row.leads) || 0;
        deals = parseInt(row.deals) || 0;
        revenue = parseFloat(row.revenue) || 0;
        cpl = parseFloat(row.cpl) || 0;
        roas = parseFloat(row.roas) || 0;
        leadToDealRate = parseFloat(row.lead_to_deal_rate) || 0;
        costPerDeal = parseFloat(row.cost_per_deal) || 0;
        avgOfferAmount = parseFloat(row.avg_offer_amount) || 0;
        avgDealAmount = parseFloat(row.avg_deal_amount) || 0;
      }
    }

    // Get sync logs (already fast - single indexed query)
    const { data: syncLogs } = await supabase
      .from('sync_logs')
      .select('type, created_at')
      .order('created_at', { ascending: false })
      .limit(2);

    const spendSync = (syncLogs || []).find((s) => s.type === 'spend');
    const leadsSync = (syncLogs || []).find(
      (s) => s.type === 'leads' || s.type === 'spend',
    );

    return {
      spend,
      leads,
      cpl,
      deals,
      revenue,
      roas,
      leadToDealRate,
      costPerDeal,
      avgOfferAmount,
      avgDealAmount,
      lastSpendSync: spendSync?.created_at || null,
      lastLeadsSync: leadsSync?.created_at || null,
    };
  }

  private async getStatsV2WithAdvancedFilters(filters: DashboardFilters): Promise<{
    spend: number;
    leads: number;
    deals: number;
    revenue: number;
    cpl: number;
    roas: number;
    leadToDealRate: number;
    costPerDeal: number;
    avgOfferAmount: number;
    avgDealAmount: number;
  }> {
    const supabase = this.supabaseService.getClient();
    const { startDate, endDate, accountId, country, service, language } = filters;

    // Get campaign performance data (already aggregated by SQL)
    const { data: campaignData, error: campaignError } = await supabase.rpc(
      'get_campaign_performance_rpc',
      {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_account_id: accountId || null,
        p_limit: 10000,
      },
    );

    if (campaignError) {
      this.logger.error('Failed to fetch campaign performance for advanced filters', campaignError);
      return { spend: 0, leads: 0, deals: 0, revenue: 0, cpl: 0, roas: 0, leadToDealRate: 0, costPerDeal: 0, avgOfferAmount: 0, avgDealAmount: 0 };
    }

    // Filter campaigns by country/service/language patterns
    const filteredCampaigns = (campaignData || []).filter((c: any) => {
      const campaignName = c.campaign_name || '';
      if (service && !this.matchesService(campaignName, service)) return false;
      if (country && !this.matchesCountry(campaignName, country)) return false;
      if (language && !this.matchesLanguage(campaignName, language)) return false;
      return true;
    });

    // Aggregate filtered results
    let totalSpend = 0;
    let totalLeads = 0;
    let totalDeals = 0;
    let totalRevenue = 0;

    for (const c of filteredCampaigns) {
      totalSpend += parseFloat(c.spend) || 0;
      totalLeads += parseInt(c.leads) || 0;
      totalDeals += parseInt(c.deals) || 0;
      totalRevenue += parseFloat(c.revenue) || 0;
    }

    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const leadToDealRate = totalLeads > 0 ? (totalDeals / totalLeads) * 100 : 0;
    const costPerDeal = totalDeals > 0 ? totalSpend / totalDeals : 0;

    return {
      spend: totalSpend,
      leads: totalLeads,
      deals: totalDeals,
      revenue: totalRevenue,
      cpl,
      roas,
      leadToDealRate,
      costPerDeal,
      avgOfferAmount: 0,
      avgDealAmount: totalDeals > 0 ? totalRevenue / totalDeals : 0,
    };
  }

  private matchesService(campaignName: string, service: string): boolean {
    const name = campaignName.toLowerCase();
    const svc = service.toLowerCase();
    return name.includes(svc);
  }

  private matchesCountry(campaignName: string, country: string): boolean {
    const countryPatterns: Record<string, string[]> = {
      'EU': ['eu', 'europe'],
      'TR': ['tr', 'turkey', 'türkiye'],
      'FR': ['fr', 'france'],
      'DE': ['de', 'germany'],
      'UK': ['uk', 'united kingdom', 'gb'],
      'US': ['us', 'usa', 'united states'],
    };
    
    const name = campaignName.toLowerCase();
    const patterns = countryPatterns[country.toUpperCase()] || [country.toLowerCase()];
    return patterns.some(p => name.includes(p));
  }

  private matchesLanguage(campaignName: string, language: string): boolean {
    const name = campaignName.toLowerCase();
    const lang = language.toLowerCase();
    return name.includes(lang);
  }
}
