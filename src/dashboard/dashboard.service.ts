import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { chunkArray, isHrFormName } from './reporting-helpers';

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
  private readonly queryBatchSize = 1000;
  private readonly inBatchSize = 200;

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
    const { startDate, endDate, accountId, objective, country, service, language } = filters;

    let totalSpend = 0;

    // Get spend and leads from daily_insights or campaigns
    if (startDate && endDate) {
      // Fetch all daily_insights with pagination (Supabase default limit is 1000)
      const allInsights: Array<{ spend_usd: any; leads_count: any; campaign_id: string }> = [];
      let offset = 0;
      const batchSize = 1000;

      while (true) {
        let query = supabase
          .from('daily_insights')
          .select('spend_usd, leads_count, campaign_id')
          .gte('date', startDate)
          .lte('date', endDate)
          .range(offset, offset + batchSize - 1);

        if (accountId) {
          query = query.eq('ad_account_id', accountId);
        }

        const { data: insights, error } = await query;

        if (error) {
          this.logger.error('Failed to fetch daily_insights', error);
          break;
        }

        if (!insights || insights.length === 0) {
          break;
        }

        allInsights.push(...insights);

        if (insights.length < batchSize) {
          break;
        }

        offset += batchSize;
      }

      if (allInsights.length > 0) {
        // Filter by campaign name patterns if service/country/language specified
        let filteredInsights = allInsights;
        
        if (service || country || language) {
          const campaignIds = [...new Set(allInsights.map(i => i.campaign_id))];
          
          // Fetch campaigns in batches too
          const campaignMap = new Map<string, string>();
          for (const chunk of chunkArray(campaignIds, this.inBatchSize)) {
            const { data: campaigns } = await supabase
              .from('campaigns')
              .select('campaign_id, name')
              .in('campaign_id', chunk);
            
            campaigns?.forEach(c => campaignMap.set(c.campaign_id, c.name));
          }
          
          filteredInsights = allInsights.filter(i => {
            const campaignName = campaignMap.get(i.campaign_id) || '';
            if (service && !this.matchesService(campaignName, service)) return false;
            if (country && !this.matchesCountry(campaignName, country)) return false;
            if (language && !this.matchesLanguage(campaignName, language)) return false;
            return true;
          });
        }

        totalSpend = filteredInsights.reduce((sum, i) => sum + (parseFloat(i.spend_usd) || 0), 0);
      }
    } else {
      const { data, error } = await supabase.rpc('get_campaigns_totals', {
        account_id: accountId || null,
        campaign_objective: objective || null,
      });

      if (!error && data) {
        totalSpend = parseFloat(data.total_spend) || 0;
      }
    }

    const eligibleLeads = await this.fetchEligibleLeads(filters);
    const totalLeads = eligibleLeads.length;
    const leadIds = eligibleLeads.map((lead) => lead.id);

    // Get attribution metrics (deals, revenue, offers)
    const attributions: Array<{
      funnel_stage: string | null;
      deal_amount: string | number | null;
      offer_amount: string | number | null;
      payment_amount: string | number | null;
    }> = [];

    for (const chunk of chunkArray(leadIds, this.inBatchSize)) {
      const { data, error } = await supabase
        .from('lead_attribution')
        .select('funnel_stage, deal_amount, offer_amount, payment_amount')
        .in('lead_id', chunk);

      if (error) {
        this.logger.error('Failed to fetch filtered attributions for dashboard stats', error);
        continue;
      }

      attributions.push(...(data || []));
    }

    let deals = 0;
    let totalRevenue = 0;
    let totalOfferAmount = 0;
    let offerCount = 0;
    let totalDealAmount = 0;
    let dealAmountCount = 0;

    if (attributions.length > 0) {
      for (const attr of attributions) {
        // Count deals (funnel_stage = 'deal' or 'payment')
        if (attr.funnel_stage === 'deal' || attr.funnel_stage === 'payment') {
          deals++;
        }

        // Sum revenue from deal_amount
        if (attr.deal_amount) {
          totalRevenue += parseFloat(String(attr.deal_amount)) || 0;
          totalDealAmount += parseFloat(String(attr.deal_amount)) || 0;
          dealAmountCount++;
        }

        // Sum offer amounts
        if (attr.offer_amount) {
          totalOfferAmount += parseFloat(String(attr.offer_amount)) || 0;
          offerCount++;
        }
      }
    }

    // Calculate derived metrics
    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const leadToDealRate = totalLeads > 0 ? (deals / totalLeads) * 100 : 0;
    const costPerDeal = deals > 0 ? totalSpend / deals : 0;
    const avgOfferAmount = offerCount > 0 ? totalOfferAmount / offerCount : 0;
    const avgDealAmount = dealAmountCount > 0 ? totalDealAmount / dealAmountCount : 0;

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
      spend: totalSpend,
      leads: totalLeads,
      cpl,
      deals,
      revenue: totalRevenue,
      roas,
      leadToDealRate,
      costPerDeal,
      avgOfferAmount,
      avgDealAmount,
      lastSpendSync: spendSync?.created_at || null,
      lastLeadsSync: leadsSync?.created_at || null,
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

  private async fetchEligibleLeads(filters: DashboardFilters) {
    const supabase = this.supabaseService.getClient();
    const { startDate, endDate, accountId, country, service, language } = filters;
    const leads: Array<{
      id: string;
      campaign_id: string | null;
      form_name: string | null;
      campaigns?: { name: string; ad_account_id: string | null } | null;
    }> = [];
    let offset = 0;

    while (true) {
      let query = supabase
        .from('leads')
        .select(
          `
          id,
          campaign_id,
          form_name,
          campaigns (
            name,
            ad_account_id
          )
        `,
        )
        .order('created_at', { ascending: true })
        .range(offset, offset + this.queryBatchSize - 1);

      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate);
      }

      const { data, error } = await query;
      if (error) {
        this.logger.error('Failed to fetch eligible leads for dashboard reporting', error);
        return [];
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const lead of data as any[]) {
        const campaign = Array.isArray(lead.campaigns) ? lead.campaigns[0] : lead.campaigns;
        const campaignName = campaign?.name || '';
        if (isHrFormName(lead.form_name)) continue;
        if (accountId && campaign?.ad_account_id !== accountId) continue;
        if (service && !this.matchesService(campaignName, service)) continue;
        if (country && !this.matchesCountry(campaignName, country)) continue;
        if (language && !this.matchesLanguage(campaignName, language)) continue;

        leads.push({
          id: lead.id,
          campaign_id: lead.campaign_id,
          form_name: lead.form_name,
          campaigns: campaign
            ? { name: campaign.name, ad_account_id: campaign.ad_account_id }
            : null,
        });
      }

      if (data.length < this.queryBatchSize) {
        break;
      }

      offset += this.queryBatchSize;
    }

    return leads;
  }
}
