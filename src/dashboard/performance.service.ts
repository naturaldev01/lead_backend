import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { chunkArray, isHrFormName } from './reporting-helpers';

export interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  spend: number;
  leads: number;
  deals: number;
  leadToDealRate: number;
  revenue: number;
  roas: number;
}

export interface ServicePerformance {
  service: string;
  leads: number;
  deals: number;
  leadToDealRate: number;
  revenue: number;
  roas: number;
  spend: number;
}

export interface CreativePerformance {
  adName: string;
  leads: number;
  deals: number;
  revenue: number;
}

export interface FunnelStageData {
  stage: string;
  count: number;
  cost: number;
}

export interface FunnelSnapshot {
  stages: FunnelStageData[];
  conversionRates: {
    leadToContact: number;
    contactToOffer: number;
    offerToDeal: number;
    dealToRealization: number;
  };
  totalSpend: number;
  totalLeads: number;
}

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);
  private readonly batchSize = 1000;
  private readonly inBatchSize = 200;

  private readonly servicePatterns: Record<string, string[]> = {
    'Dental': ['dental', 'teeth', 'implant', 'veneer', 'hollywood smile'],
    'Hair': ['hair', 'fue', 'dhi', 'transplant', 'saç'],
    'Rhinoplasty': ['rhinoplasty', 'nose', 'rhino', 'burun'],
    'BBL': ['bbl', 'brazilian butt', 'buttock'],
    'Facelift': ['facelift', 'face lift', 'yüz germe'],
    'Liposuction': ['liposuction', 'lipo', 'yağ aldırma'],
    'Breast': ['breast', 'meme', 'mammoplasty'],
    'Tummy Tuck': ['tummy tuck', 'abdominoplasty', 'karın germe'],
  };

  constructor(private supabaseService: SupabaseService) {}

  async getCampaignPerformance(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    limit: number = 10,
  ): Promise<CampaignPerformance[]> {
    const supabase = this.supabaseService.getClient();

    // Get campaigns with spend
    let campaignsQuery = supabase
      .from('campaigns')
      .select('campaign_id, name, spend_usd, insights_leads_count, ad_account_id');

    if (accountId) {
      campaignsQuery = campaignsQuery.eq('ad_account_id', accountId);
    }

    const { data: campaigns } = await campaignsQuery;

    if (!campaigns || campaigns.length === 0) {
      return [];
    }

    // Get spend by campaign from daily_insights if date range specified
    let campaignSpend = new Map<string, { spend: number; leads: number }>();
    
    if (startDate && endDate) {
      // Fetch all insights with pagination
      let offset = 0;
      
      while (true) {
        let insightsQuery = supabase
          .from('daily_insights')
          .select('campaign_id, spend_usd, leads_count')
          .gte('date', startDate)
          .lte('date', endDate)
          .range(offset, offset + this.batchSize - 1);

        if (accountId) {
          insightsQuery = insightsQuery.eq('ad_account_id', accountId);
        }

        const { data: insights, error } = await insightsQuery;

        if (error || !insights || insights.length === 0) {
          break;
        }

        for (const insight of insights) {
          const current = campaignSpend.get(insight.campaign_id) || { spend: 0, leads: 0 };
          current.spend += parseFloat(insight.spend_usd) || 0;
          current.leads += insight.leads_count || 0;
          campaignSpend.set(insight.campaign_id, current);
        }

        if (insights.length < this.batchSize) {
          break;
        }

        offset += this.batchSize;
      }
    } else {
      for (const campaign of campaigns) {
        campaignSpend.set(campaign.campaign_id, {
          spend: campaign.spend_usd || 0,
          leads: campaign.insights_leads_count || 0,
        });
      }
    }

    // Get attributions by campaign
    const campaignIds = campaigns.map(c => c.campaign_id);
    const eligibleLeads = await this.fetchEligibleLeads(startDate, endDate, accountId);
    const leadCounts = new Map<string, number>();

    for (const lead of eligibleLeads) {
      const current = leadCounts.get(lead.campaign_id) || 0;
      leadCounts.set(lead.campaign_id, current + 1);
    }
    const leadIds = eligibleLeads.map((lead) => lead.id);
    
    const attributions: Array<{ campaign_id: string; funnel_stage: string; deal_amount: string | number | null }> = [];
    for (const chunk of chunkArray(leadIds, this.inBatchSize)) {
      const { data } = await supabase
        .from('lead_attribution')
        .select('campaign_id, funnel_stage, deal_amount')
        .in('lead_id', chunk);
      attributions.push(...(data || []));
    }

    // Aggregate attribution data by campaign
    const campaignAttribution = new Map<string, { deals: number; revenue: number }>();
    
    for (const attr of attributions || []) {
      const current = campaignAttribution.get(attr.campaign_id) || { deals: 0, revenue: 0 };
      
      if (attr.funnel_stage === 'deal' || attr.funnel_stage === 'payment') {
        current.deals += 1;
      }
      
      if (attr.deal_amount) {
        current.revenue += parseFloat(String(attr.deal_amount)) || 0;
      }
      
      campaignAttribution.set(attr.campaign_id, current);
    }

    // Build result
    const result: CampaignPerformance[] = [];
    
    for (const campaign of campaigns) {
      const spendData = campaignSpend.get(campaign.campaign_id) || { spend: 0, leads: 0 };
      const attrData = campaignAttribution.get(campaign.campaign_id) || { deals: 0, revenue: 0 };

      const spend = spendData.spend;
      const leads = leadCounts.get(campaign.campaign_id) || 0;
      const deals = attrData.deals;
      const revenue = attrData.revenue;

      result.push({
        campaignId: campaign.campaign_id,
        campaignName: campaign.name,
        spend,
        leads,
        deals,
        leadToDealRate: leads > 0 ? (deals / leads) * 100 : 0,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
      });
    }

    // Sort by revenue descending and limit
    return result
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  async getServicePerformance(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<ServicePerformance[]> {
    const supabase = this.supabaseService.getClient();

    // Get campaigns with spend data in a single query (fixes N+1)
    let campaignsQuery = supabase
      .from('campaigns')
      .select('campaign_id, name, ad_account_id, spend_usd, insights_leads_count');

    if (accountId) {
      campaignsQuery = campaignsQuery.eq('ad_account_id', accountId);
    }

    const { data: campaigns } = await campaignsQuery;

    if (!campaigns || campaigns.length === 0) {
      return [];
    }

    // Map campaigns to services
    const campaignServiceMap = new Map<string, string>();
    for (const campaign of campaigns) {
      const service = this.detectService(campaign.name);
      if (service) {
        campaignServiceMap.set(campaign.campaign_id, service);
      }
    }

    // Get spend by campaign
    const campaignIds = campaigns.map(c => c.campaign_id);
    const eligibleLeads = await this.fetchEligibleLeads(startDate, endDate, accountId);
    const leadsByService = new Map<string, number>();

    for (const lead of eligibleLeads) {
      const service = campaignServiceMap.get(lead.campaign_id);
      if (!service) continue;
      leadsByService.set(service, (leadsByService.get(service) || 0) + 1);
    }
    
    const spendData = new Map<string, { spend: number; leads: number }>();
    
    if (startDate && endDate) {
      // Fetch insights with pagination
      let offset = 0;
      
      while (true) {
        let insightsQuery = supabase
          .from('daily_insights')
          .select('campaign_id, spend_usd, leads_count')
          .in('campaign_id', campaignIds)
          .gte('date', startDate)
          .lte('date', endDate)
          .range(offset, offset + this.batchSize - 1);

        const { data: insights, error } = await insightsQuery;

        if (error || !insights || insights.length === 0) {
          break;
        }

        for (const insight of insights) {
          const current = spendData.get(insight.campaign_id) || { spend: 0, leads: 0 };
          current.spend += parseFloat(insight.spend_usd) || 0;
          current.leads += insight.leads_count || 0;
          spendData.set(insight.campaign_id, current);
        }

        if (insights.length < this.batchSize) {
          break;
        }

        offset += this.batchSize;
      }
    } else {
      // Use data already fetched with campaigns (no additional queries needed)
      for (const campaign of campaigns) {
        spendData.set(campaign.campaign_id, {
          spend: campaign.spend_usd || 0,
          leads: campaign.insights_leads_count || 0,
        });
      }
    }

    // Get attributions
    const leadIds = eligibleLeads.map((lead) => lead.id);
    const attributions: Array<{ campaign_id: string; funnel_stage: string; deal_amount: string | number | null }> = [];
    for (const chunk of chunkArray(leadIds, this.inBatchSize)) {
      const { data } = await supabase
        .from('lead_attribution')
        .select('campaign_id, funnel_stage, deal_amount')
        .in('lead_id', chunk);
      attributions.push(...(data || []));
    }

    // Aggregate by service
    const serviceData = new Map<string, { spend: number; leads: number; deals: number; revenue: number }>();

    // Add spend/leads data
    for (const [campaignId, data] of spendData) {
      const service = campaignServiceMap.get(campaignId);
      if (!service) continue;

      const current = serviceData.get(service) || { spend: 0, leads: 0, deals: 0, revenue: 0 };
      current.spend += data.spend;
      serviceData.set(service, current);
    }

    for (const [service, leads] of leadsByService) {
      const current = serviceData.get(service) || { spend: 0, leads: 0, deals: 0, revenue: 0 };
      current.leads += leads;
      serviceData.set(service, current);
    }

    // Add attribution data
    for (const attr of attributions || []) {
      const service = campaignServiceMap.get(attr.campaign_id);
      if (!service) continue;

      const current = serviceData.get(service) || { spend: 0, leads: 0, deals: 0, revenue: 0 };
      
      if (attr.funnel_stage === 'deal' || attr.funnel_stage === 'payment') {
        current.deals += 1;
      }
      
      if (attr.deal_amount) {
        current.revenue += parseFloat(String(attr.deal_amount)) || 0;
      }
      
      serviceData.set(service, current);
    }

    // Build result
    const result: ServicePerformance[] = [];
    
    for (const [service, data] of serviceData) {
      result.push({
        service,
        leads: data.leads,
        deals: data.deals,
        leadToDealRate: data.leads > 0 ? (data.deals / data.leads) * 100 : 0,
        revenue: data.revenue,
        roas: data.spend > 0 ? data.revenue / data.spend : 0,
        spend: data.spend,
      });
    }

    return result.sort((a, b) => b.revenue - a.revenue);
  }

  async getCreativePerformance(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    limit: number = 10,
  ): Promise<CreativePerformance[]> {
    const supabase = this.supabaseService.getClient();

    // Get leads with ad names - with pagination
    const allLeads: any[] = [];
    let offset = 0;

    while (true) {
      let leadsQuery = supabase
        .from('leads')
        .select(`
          id,
          ad_name,
          form_name,
          campaign_id,
          campaigns (ad_account_id)
        `)
        .range(offset, offset + this.batchSize - 1);

      if (startDate) {
        leadsQuery = leadsQuery.gte('created_at', startDate);
      }
      if (endDate) {
        leadsQuery = leadsQuery.lte('created_at', endDate);
      }

      const { data: leads, error } = await leadsQuery;

      if (error || !leads || leads.length === 0) {
        break;
      }

      allLeads.push(...leads);

      if (leads.length < this.batchSize) {
        break;
      }

      offset += this.batchSize;
    }

    // Filter by account if specified
    let filteredLeads = allLeads;
    if (accountId) {
      filteredLeads = filteredLeads.filter(
        (l: any) => l.campaigns?.ad_account_id === accountId,
      );
    }
    filteredLeads = filteredLeads.filter((l: any) => !isHrFormName(l.form_name));

    // Get lead IDs
    const leadIds = filteredLeads.map((l) => l.id);

    // Get attributions
    let attributions: any[] = [];
    if (leadIds.length > 0) {
      const { data } = await supabase
        .from('lead_attribution')
        .select('lead_id, funnel_stage, deal_amount')
        .in('lead_id', leadIds);
      attributions = data || [];
    }

    // Create attribution map
    const attributionMap = new Map<string, { isDeal: boolean; dealAmount: number }>();
    for (const attr of attributions) {
      attributionMap.set(attr.lead_id, {
        isDeal: attr.funnel_stage === 'deal' || attr.funnel_stage === 'payment',
        dealAmount: parseFloat(attr.deal_amount) || 0,
      });
    }

    // Aggregate by ad name
    const creativeData = new Map<string, { leads: number; deals: number; revenue: number }>();

    for (const lead of filteredLeads) {
      const adName = lead.ad_name || 'Unknown';
      const current = creativeData.get(adName) || { leads: 0, deals: 0, revenue: 0 };
      
      current.leads += 1;
      
      const attribution = attributionMap.get(lead.id);
      if (attribution) {
        if (attribution.isDeal) {
          current.deals += 1;
        }
        current.revenue += attribution.dealAmount;
      }
      
      creativeData.set(adName, current);
    }

    // Build and sort result
    const result: CreativePerformance[] = [];
    
    for (const [adName, data] of creativeData) {
      result.push({
        adName,
        leads: data.leads,
        deals: data.deals,
        revenue: data.revenue,
      });
    }

    return result
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  async getFunnelSnapshot(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<FunnelSnapshot> {
    const supabase = this.supabaseService.getClient();

    // Get total spend and leads
    let totalSpend = 0;

    if (startDate && endDate) {
      // Fetch insights with pagination
      let offset = 0;
      
      while (true) {
        let insightsQuery = supabase
          .from('daily_insights')
          .select('spend_usd, leads_count')
          .gte('date', startDate)
          .lte('date', endDate)
          .range(offset, offset + this.batchSize - 1);

        if (accountId) {
          insightsQuery = insightsQuery.eq('ad_account_id', accountId);
        }

        const { data: insights, error } = await insightsQuery;

        if (error || !insights || insights.length === 0) {
          break;
        }

        for (const insight of insights) {
          totalSpend += parseFloat(insight.spend_usd) || 0;
        }

        if (insights.length < this.batchSize) {
          break;
        }

        offset += this.batchSize;
      }
    } else {
      const { data } = await supabase.rpc('get_campaigns_totals', {
        account_id: accountId || null,
        campaign_objective: null,
      });

      if (data) {
        totalSpend = parseFloat(data.total_spend) || 0;
      }
    }

    const eligibleLeads = await this.fetchEligibleLeads(startDate, endDate, accountId);
    const totalLeads = eligibleLeads.length;
    const leadIds = eligibleLeads.map((lead) => lead.id);

    // Get funnel stage counts from lead_attribution
    const filteredAttributions: Array<{
      funnel_stage: string;
      contact_date: string | null;
      offer_date: string | null;
      deal_date: string | null;
      payment_date: string | null;
      campaign_id: string | null;
    }> = [];
    for (const chunk of chunkArray(leadIds, this.inBatchSize)) {
      const { data } = await supabase
        .from('lead_attribution')
        .select('funnel_stage, contact_date, offer_date, deal_date, payment_date, campaign_id')
        .in('lead_id', chunk);
      filteredAttributions.push(...(data || []));
    }

    // Count attributions that have reached each stage (cumulative counting)
    // A lead that reached "offer" has also reached "contact" stage
    const attributionCount = filteredAttributions.length;
    
    let contacts = 0;
    let offers = 0;
    let deals = 0;
    let realizations = 0;

    for (const attr of filteredAttributions) {
      // Count based on funnel_stage or date fields
      const stage = attr.funnel_stage;
      
      if (stage === 'contact' || stage === 'offer' || stage === 'deal' || stage === 'payment') {
        contacts++;
      }
      if (stage === 'offer' || stage === 'deal' || stage === 'payment') {
        offers++;
      }
      if (stage === 'deal' || stage === 'payment') {
        deals++;
      }
      if (stage === 'payment') {
        realizations++;
      }
    }

    // Build funnel stages with cost per stage
    const stages: FunnelStageData[] = [
      { stage: 'Lead', count: totalLeads, cost: totalLeads > 0 ? totalSpend / totalLeads : 0 },
      { stage: 'Contact', count: contacts, cost: contacts > 0 ? totalSpend / contacts : 0 },
      { stage: 'Offer', count: offers, cost: offers > 0 ? totalSpend / offers : 0 },
      { stage: 'Deal', count: deals, cost: deals > 0 ? totalSpend / deals : 0 },
      { stage: 'Realization', count: realizations, cost: realizations > 0 ? totalSpend / realizations : 0 },
    ];

    // Calculate conversion rates based on matched attributions
    // Lead → Contact uses attribution count (matched leads from Zoho)
    const conversionRates = {
      leadToContact: attributionCount > 0 ? (contacts / attributionCount) * 100 : 0,
      contactToOffer: contacts > 0 ? (offers / contacts) * 100 : 0,
      offerToDeal: offers > 0 ? (deals / offers) * 100 : 0,
      dealToRealization: deals > 0 ? (realizations / deals) * 100 : 0,
    };

    return {
      stages,
      conversionRates,
      totalSpend,
      totalLeads,
    };
  }

  private detectService(campaignName: string): string | null {
    const name = campaignName.toLowerCase();
    
    for (const [service, patterns] of Object.entries(this.servicePatterns)) {
      if (patterns.some(p => name.includes(p))) {
        return service;
      }
    }
    
    return 'Other';
  }

  private async fetchEligibleLeads(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<Array<{ id: string; campaign_id: string; ad_name: string | null; form_name: string | null }>> {
    const supabase = this.supabaseService.getClient();
    const leads: Array<{ id: string; campaign_id: string; ad_name: string | null; form_name: string | null }> = [];
    let offset = 0;

    while (true) {
      let query = supabase
        .from('leads')
        .select(
          `
          id,
          campaign_id,
          ad_name,
          form_name,
          campaigns (
            ad_account_id
          )
        `,
        )
        .order('created_at', { ascending: true })
        .range(offset, offset + this.batchSize - 1);

      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate);
      }

      const { data, error } = await query;
      if (error) {
        this.logger.error('Failed to fetch eligible leads for performance reporting', error);
        return [];
      }

      if (!data || data.length === 0) break;

      leads.push(
        ...data.filter((lead: any) => {
          if (isHrFormName(lead.form_name)) return false;
          if (accountId && lead.campaigns?.ad_account_id !== accountId) return false;
          return true;
        }),
      );

      if (data.length < this.batchSize) break;
      offset += this.batchSize;
    }

    return leads;
  }
}
