import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

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

  constructor(private supabaseService: SupabaseService) {}

  async getCampaignPerformance(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    limit: number = 10,
  ): Promise<CampaignPerformance[]> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.rpc('get_campaign_performance_rpc', {
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_account_id: accountId || null,
      p_limit: limit,
    });

    if (error) {
      this.logger.error('Failed to fetch campaign performance via RPC', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      spend: parseFloat(row.spend) || 0,
      leads: parseInt(row.leads) || 0,
      deals: parseInt(row.deals) || 0,
      leadToDealRate: parseFloat(row.lead_to_deal_rate) || 0,
      revenue: parseFloat(row.revenue) || 0,
      roas: parseFloat(row.roas) || 0,
    }));
  }

  async getServicePerformance(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<ServicePerformance[]> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.rpc('get_service_performance_rpc', {
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_account_id: accountId || null,
    });

    if (error) {
      this.logger.error('Failed to fetch service performance via RPC', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      service: row.service,
      spend: parseFloat(row.spend) || 0,
      leads: parseInt(row.leads) || 0,
      deals: parseInt(row.deals) || 0,
      leadToDealRate: parseFloat(row.lead_to_deal_rate) || 0,
      revenue: parseFloat(row.revenue) || 0,
      roas: parseFloat(row.roas) || 0,
    }));
  }

  async getCreativePerformance(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    limit: number = 10,
  ): Promise<CreativePerformance[]> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.rpc('get_creative_performance_rpc', {
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_account_id: accountId || null,
      p_limit: limit,
    });

    if (error) {
      this.logger.error('Failed to fetch creative performance via RPC', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      adName: row.ad_name,
      leads: parseInt(row.leads) || 0,
      deals: parseInt(row.deals) || 0,
      revenue: parseFloat(row.revenue) || 0,
    }));
  }

  async getFunnelSnapshot(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<FunnelSnapshot> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.rpc('get_funnel_snapshot_rpc', {
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_account_id: accountId || null,
    });

    if (error) {
      this.logger.error('Failed to fetch funnel snapshot via RPC', error);
      return {
        stages: [],
        conversionRates: {
          leadToContact: 0,
          contactToOffer: 0,
          offerToDeal: 0,
          dealToRealization: 0,
        },
        totalSpend: 0,
        totalLeads: 0,
      };
    }

    if (!data || data.length === 0) {
      return {
        stages: [],
        conversionRates: {
          leadToContact: 0,
          contactToOffer: 0,
          offerToDeal: 0,
          dealToRealization: 0,
        },
        totalSpend: 0,
        totalLeads: 0,
      };
    }

    const stages: FunnelStageData[] = (data || []).map((row: any) => ({
      stage: row.stage,
      count: parseInt(row.count) || 0,
      cost: parseFloat(row.cost) || 0,
    }));

    const totalSpend = parseFloat(data[0]?.total_spend) || 0;
    const totalLeads = parseInt(data[0]?.total_leads) || 0;

    const stageMap = new Map<string, number>();
    for (const s of stages) {
      stageMap.set(s.stage, s.count);
    }

    const contacts = stageMap.get('Contact') || 0;
    const offers = stageMap.get('Offer') || 0;
    const deals = stageMap.get('Deal') || 0;
    const realizations = stageMap.get('Realization') || 0;

    const conversionRates = {
      leadToContact: totalLeads > 0 ? (contacts / totalLeads) * 100 : 0,
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
}
