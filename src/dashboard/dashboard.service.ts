import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

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
    const { startDate, endDate, accountId, objective, country, service, language } = filters;

    let totalSpend = 0;
    let totalLeads = 0;

    // Get spend and leads from daily_insights or campaigns
    if (startDate && endDate) {
      let query = supabase
        .from('daily_insights')
        .select('spend_usd, leads_count, campaign_id');

      query = query.gte('date', startDate).lte('date', endDate);

      if (accountId) {
        query = query.eq('ad_account_id', accountId);
      }

      const { data: insights } = await query;

      if (insights) {
        // Filter by campaign name patterns if service/country/language specified
        let filteredInsights = insights;
        
        if (service || country || language) {
          const campaignIds = [...new Set(insights.map(i => i.campaign_id))];
          const { data: campaigns } = await supabase
            .from('campaigns')
            .select('campaign_id, name')
            .in('campaign_id', campaignIds);
          
          const campaignMap = new Map(campaigns?.map(c => [c.campaign_id, c.name]) || []);
          
          filteredInsights = insights.filter(i => {
            const campaignName = campaignMap.get(i.campaign_id) || '';
            if (service && !this.matchesService(campaignName, service)) return false;
            if (country && !this.matchesCountry(campaignName, country)) return false;
            if (language && !this.matchesLanguage(campaignName, language)) return false;
            return true;
          });
        }

        totalSpend = filteredInsights.reduce((sum, i) => sum + (parseFloat(i.spend_usd) || 0), 0);
        totalLeads = filteredInsights.reduce((sum, i) => sum + (i.leads_count || 0), 0);
      }
    } else {
      const { data, error } = await supabase.rpc('get_campaigns_totals', {
        account_id: accountId || null,
        campaign_objective: objective || null,
      });

      if (!error && data) {
        totalSpend = parseFloat(data.total_spend) || 0;
        totalLeads = parseInt(data.total_leads) || 0;
      }
    }

    // Get attribution metrics (deals, revenue, offers)
    let attributionQuery = supabase
      .from('lead_attribution')
      .select('funnel_stage, deal_amount, offer_amount, payment_amount, campaign_id');

    if (startDate) {
      attributionQuery = attributionQuery.gte('lead_date', startDate);
    }
    if (endDate) {
      attributionQuery = attributionQuery.lte('lead_date', endDate);
    }

    const { data: attributions } = await attributionQuery;

    let deals = 0;
    let totalRevenue = 0;
    let totalOfferAmount = 0;
    let offerCount = 0;
    let totalDealAmount = 0;
    let dealAmountCount = 0;

    if (attributions) {
      // Filter by campaign if service/country/language specified
      let filteredAttributions = attributions;
      
      if (service || country || language || accountId) {
        const campaignIds = [...new Set(attributions.map(a => a.campaign_id).filter(Boolean))];
        
        if (campaignIds.length > 0) {
          let campaignsQuery = supabase
            .from('campaigns')
            .select('campaign_id, name, ad_account_id')
            .in('campaign_id', campaignIds);

          const { data: campaigns } = await campaignsQuery;
          const campaignMap = new Map(campaigns?.map(c => [c.campaign_id, { name: c.name, accountId: c.ad_account_id }]) || []);
          
          filteredAttributions = attributions.filter(a => {
            const campaign = campaignMap.get(a.campaign_id);
            if (!campaign) return true;
            if (accountId && campaign.accountId !== accountId) return false;
            if (service && !this.matchesService(campaign.name, service)) return false;
            if (country && !this.matchesCountry(campaign.name, country)) return false;
            if (language && !this.matchesLanguage(campaign.name, language)) return false;
            return true;
          });
        }
      }

      for (const attr of filteredAttributions) {
        // Count deals (funnel_stage = 'deal' or 'payment')
        if (attr.funnel_stage === 'deal' || attr.funnel_stage === 'payment') {
          deals++;
        }

        // Sum revenue from deal_amount
        if (attr.deal_amount) {
          totalRevenue += parseFloat(attr.deal_amount) || 0;
          totalDealAmount += parseFloat(attr.deal_amount) || 0;
          dealAmountCount++;
        }

        // Sum offer amounts
        if (attr.offer_amount) {
          totalOfferAmount += parseFloat(attr.offer_amount) || 0;
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
}
