import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { MetaService } from '../meta/meta.service';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private metaService: MetaService,
  ) {}

  async getCampaigns(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    search?: string,
  ) {
    const supabase = this.supabaseService.getClient();

    let query = supabase
      .from('campaigns')
      .select(`
        *,
        ad_accounts (account_name),
        leads (count)
      `)
      .order('spend_usd', { ascending: false });

    if (accountId) {
      query = query.eq('ad_account_id', accountId);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error('Failed to fetch campaigns', error);
      throw error;
    }

    return (data || []).map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      adAccountId: campaign.ad_account_id,
      adAccountName: campaign.ad_accounts?.account_name || '',
      type: campaign.type,
      spendUsd: campaign.spend_usd || 0,
      leads: campaign.leads?.[0]?.count || 0,
    }));
  }

  async getHierarchy(accountId?: string, search?: string) {
    const supabase = this.supabaseService.getClient();

    let campaignQuery = supabase
      .from('campaigns')
      .select(`
        *,
        ad_accounts (account_name)
      `)
      .order('spend_usd', { ascending: false });

    let adSetQuery = supabase
      .from('ad_sets')
      .select('*')
      .order('spend_usd', { ascending: false });

    let adQuery = supabase
      .from('ads')
      .select('*')
      .order('spend_usd', { ascending: false });

    if (accountId) {
      campaignQuery = campaignQuery.eq('ad_account_id', accountId);
      adSetQuery = adSetQuery.eq('ad_account_id', accountId);
      adQuery = adQuery.eq('ad_account_id', accountId);
    }

    if (search) {
      campaignQuery = campaignQuery.ilike('name', `%${search}%`);
    }

    const [campaignsResult, adSetsResult, adsResult] = await Promise.all([
      campaignQuery,
      adSetQuery,
      adQuery,
    ]);

    const campaigns = campaignsResult.data || [];
    const adSets = adSetsResult.data || [];
    const ads = adsResult.data || [];

    // Fetch all leads with pagination to overcome Supabase 1000 row limit
    const allLeads: { campaign_id: string }[] = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data: leadsBatch } = await supabase
        .from('leads')
        .select('campaign_id')
        .range(from, from + batchSize - 1);
      
      if (leadsBatch && leadsBatch.length > 0) {
        allLeads.push(...leadsBatch);
        from += batchSize;
        hasMore = leadsBatch.length === batchSize;
      } else {
        hasMore = false;
      }
    }

    const leadsCountByCampaign = allLeads.reduce((acc: Record<string, number>, lead) => {
      if (lead.campaign_id) {
        acc[lead.campaign_id] = (acc[lead.campaign_id] || 0) + 1;
      }
      return acc;
    }, {});

    const adsGroupedByAdSet = ads.reduce((acc: Record<string, typeof ads>, ad) => {
      if (ad.adset_id) {
        if (!acc[ad.adset_id]) acc[ad.adset_id] = [];
        acc[ad.adset_id].push(ad);
      }
      return acc;
    }, {});

    const adSetsGroupedByCampaign = adSets.reduce((acc: Record<string, typeof adSets>, adSet) => {
      if (adSet.campaign_id) {
        if (!acc[adSet.campaign_id]) acc[adSet.campaign_id] = [];
        acc[adSet.campaign_id].push({
          ...adSet,
          ads: adsGroupedByAdSet[adSet.adset_id] || [],
        });
      }
      return acc;
    }, {});

    return campaigns.map((campaign) => ({
      id: campaign.id,
      campaignId: campaign.campaign_id,
      name: campaign.name,
      adAccountId: campaign.ad_account_id,
      adAccountName: campaign.ad_accounts?.account_name || '',
      type: campaign.type,
      status: campaign.status,
      spendUsd: campaign.spend_usd || 0,
      leads: campaign.insights_leads_count || leadsCountByCampaign[campaign.campaign_id] || 0,
      formLeads: leadsCountByCampaign[campaign.campaign_id] || 0,
      insightsLeads: campaign.insights_leads_count || 0,
      adSets: (adSetsGroupedByCampaign[campaign.campaign_id] || []).map((adSet) => ({
        id: adSet.id,
        adSetId: adSet.adset_id,
        name: adSet.name,
        status: adSet.status,
        optimizationGoal: adSet.optimization_goal,
        spendUsd: adSet.spend_usd || 0,
        leads: adSet.insights_leads_count || 0,
        ads: (adSet.ads || []).map((ad: { id: string; ad_id: string; name: string; status: string; spend_usd: number; insights_leads_count?: number }) => ({
          id: ad.id,
          adId: ad.ad_id,
          name: ad.name,
          leads: ad.insights_leads_count || 0,
          status: ad.status,
          spendUsd: ad.spend_usd || 0,
        })),
      })),
    }));
  }

  async syncFromMeta() {
    const supabase = this.supabaseService.getClient();

    try {
      const adAccounts = await this.metaService.getAdAccounts();

      for (const account of adAccounts) {
        const { error: accountError } = await supabase
          .from('ad_accounts')
          .upsert({
            account_id: account.account_id,
            account_name: account.name,
          }, { onConflict: 'account_id' });

        if (accountError) {
          this.logger.error(`Failed to upsert ad account ${account.account_id}`, accountError);
          continue;
        }

        // Sync campaigns
        const campaigns = await this.metaService.getCampaigns(account.account_id);
        for (const campaign of campaigns) {
          await supabase.from('campaigns').upsert({
            campaign_id: campaign.id,
            name: campaign.name,
            type: campaign.objective,
            ad_account_id: account.account_id,
          }, { onConflict: 'campaign_id' });
        }

        // Sync ad sets
        const adSets = await this.metaService.getAdSets(account.account_id);
        for (const adSet of adSets) {
          await supabase.from('ad_sets').upsert({
            adset_id: adSet.id,
            name: adSet.name,
            status: adSet.status,
            optimization_goal: adSet.optimization_goal,
            campaign_id: adSet.campaign_id,
            ad_account_id: account.account_id,
          }, { onConflict: 'adset_id' });
        }

        // Sync ads
        const ads = await this.metaService.getAds(account.account_id);
        for (const ad of ads) {
          await supabase.from('ads').upsert({
            ad_id: ad.id,
            name: ad.name,
            status: ad.status,
            adset_id: ad.adset_id,
            campaign_id: ad.campaign_id,
            ad_account_id: account.account_id,
          }, { onConflict: 'ad_id' });
        }
      }

      await supabase.from('sync_logs').insert({
        type: 'campaigns',
        status: 'success',
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to sync campaigns from Meta', error);

      await supabase.from('sync_logs').insert({
        type: 'campaigns',
        status: 'error',
        error_message: error.message,
      });

      throw error;
    }
  }
}
