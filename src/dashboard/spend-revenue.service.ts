import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

export interface SpendVsRevenueData {
  month: string;
  spend: number;
  leads: number;
  revenue: number;
}

export interface RevenueByDealDateData {
  month: string;
  revenue: number;
  dealCount: number;
}

@Injectable()
export class SpendRevenueService {
  private readonly logger = new Logger(SpendRevenueService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getSpendVsRevenue(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<SpendVsRevenueData[]> {
    const supabase = this.supabaseService.getClient();

    // Get monthly spend and leads from daily_insights
    let insightsQuery = supabase
      .from('daily_insights')
      .select('date, spend_usd, leads_count, ad_account_id');

    if (startDate) {
      insightsQuery = insightsQuery.gte('date', startDate);
    }
    if (endDate) {
      insightsQuery = insightsQuery.lte('date', endDate);
    }
    if (accountId) {
      insightsQuery = insightsQuery.eq('ad_account_id', accountId);
    }

    const { data: insights } = await insightsQuery;

    // Group by month
    const monthlySpend = new Map<string, { spend: number; leads: number }>();
    
    for (const insight of insights || []) {
      const date = new Date(insight.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      const current = monthlySpend.get(monthKey) || { spend: 0, leads: 0 };
      current.spend += parseFloat(insight.spend_usd) || 0;
      current.leads += insight.leads_count || 0;
      monthlySpend.set(monthKey, current);
    }

    // Get leads with their created_at (lead month) and attributed revenue
    let leadsQuery = supabase
      .from('leads')
      .select(`
        id,
        created_at,
        campaign_id,
        campaigns (ad_account_id)
      `);

    if (startDate) {
      leadsQuery = leadsQuery.gte('created_at', startDate);
    }
    if (endDate) {
      leadsQuery = leadsQuery.lte('created_at', endDate);
    }

    const { data: leads } = await leadsQuery;

    // Filter by account if specified
    let filteredLeads = leads || [];
    if (accountId) {
      filteredLeads = filteredLeads.filter(
        (l: any) => l.campaigns?.ad_account_id === accountId,
      );
    }

    // Get lead IDs
    const leadIds = filteredLeads.map((l) => l.id);

    // Get attributions with deal amounts
    let attributions: any[] = [];
    if (leadIds.length > 0) {
      const { data } = await supabase
        .from('lead_attribution')
        .select('lead_id, deal_amount')
        .in('lead_id', leadIds)
        .not('deal_amount', 'is', null);
      attributions = data || [];
    }

    // Create attribution map
    const attributionMap = new Map<string, number>();
    for (const attr of attributions) {
      attributionMap.set(attr.lead_id, parseFloat(attr.deal_amount) || 0);
    }

    // Calculate revenue by lead month (attribution logic)
    const monthlyRevenue = new Map<string, number>();
    for (const lead of filteredLeads) {
      const createdAt = new Date(lead.created_at);
      const monthKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      
      const revenue = attributionMap.get(lead.id) || 0;
      const current = monthlyRevenue.get(monthKey) || 0;
      monthlyRevenue.set(monthKey, current + revenue);
    }

    // Combine spend and revenue data
    const allMonths = new Set([...monthlySpend.keys(), ...monthlyRevenue.keys()]);
    const result: SpendVsRevenueData[] = [];

    for (const month of Array.from(allMonths).sort()) {
      const spendData = monthlySpend.get(month) || { spend: 0, leads: 0 };
      const revenue = monthlyRevenue.get(month) || 0;

      result.push({
        month,
        spend: spendData.spend,
        leads: spendData.leads,
        revenue,
      });
    }

    return result;
  }

  async getRevenueByDealDate(
    startDate?: string,
    endDate?: string,
    accountId?: string,
  ): Promise<RevenueByDealDateData[]> {
    const supabase = this.supabaseService.getClient();

    // Get attributions with deal dates for cash flow view
    let query = supabase
      .from('lead_attribution')
      .select('deal_amount, deal_date, campaign_id')
      .not('deal_amount', 'is', null)
      .not('deal_date', 'is', null);

    if (startDate) {
      query = query.gte('deal_date', startDate);
    }
    if (endDate) {
      query = query.lte('deal_date', endDate);
    }

    const { data: attributions } = await query;

    // Filter by account if specified
    let filteredAttributions = attributions || [];
    
    if (accountId && filteredAttributions.length > 0) {
      const campaignIds = [...new Set(filteredAttributions.map(a => a.campaign_id).filter(Boolean))];
      
      if (campaignIds.length > 0) {
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('campaign_id, ad_account_id')
          .in('campaign_id', campaignIds);
        
        const accountMap = new Map(campaigns?.map(c => [c.campaign_id, c.ad_account_id]) || []);
        
        filteredAttributions = filteredAttributions.filter(a => {
          return accountMap.get(a.campaign_id) === accountId;
        });
      }
    }

    // Group by deal month
    const monthlyData = new Map<string, { revenue: number; count: number }>();

    for (const attr of filteredAttributions) {
      const dealDate = new Date(attr.deal_date);
      const monthKey = `${dealDate.getFullYear()}-${String(dealDate.getMonth() + 1).padStart(2, '0')}`;
      
      const current = monthlyData.get(monthKey) || { revenue: 0, count: 0 };
      current.revenue += parseFloat(attr.deal_amount) || 0;
      current.count += 1;
      monthlyData.set(monthKey, current);
    }

    return Array.from(monthlyData.entries())
      .map(([month, data]) => ({
        month,
        revenue: data.revenue,
        dealCount: data.count,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }
}
