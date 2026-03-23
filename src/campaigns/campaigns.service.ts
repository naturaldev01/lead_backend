import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { MetaService } from '../meta/meta.service';
import { parseCountriesFromName } from '../common/country-parser';

interface HierarchyCacheEntry {
  data: unknown[];
  timestamp: number;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  private countriesCache: string[] | null = null;
  private countriesCacheTime: number = 0;
  private hierarchyCache: Map<string, HierarchyCacheEntry> = new Map();
  private readonly CACHE_TTL = 60 * 1000; // 1 minute for hierarchy
  private readonly COUNTRIES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for countries

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
      .select(
        `
        *,
        ad_accounts (account_name),
        leads (count)
      `,
      )
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
      leads: campaign.insights_leads_count || campaign.leads?.[0]?.count || 0,
    }));
  }

  async getHierarchy(
    accountId?: string,
    search?: string,
    country?: string,
    level?: string,
    startDate?: string,
    endDate?: string,
  ) {
    // Generate cache key
    const cacheKey = `${accountId || ''}_${search || ''}_${country || ''}_${level || ''}_${startDate || ''}_${endDate || ''}`;
    const cached = this.hierarchyCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    const supabase = this.supabaseService.getClient();

    // Helper function to fetch all rows with pagination
    const fetchAllWithPagination = async <T>(
      baseQuery: () => any,
    ): Promise<T[]> => {
      const allRows: T[] = [];
      let offset = 0;
      const batchSize = 1000;

      while (true) {
        const { data, error } = await baseQuery().range(
          offset,
          offset + batchSize - 1,
        );

        if (error || !data || data.length === 0) {
          break;
        }

        allRows.push(...data);

        if (data.length < batchSize) {
          break;
        }

        offset += batchSize;
      }

      return allRows;
    };

    // Build base queries
    const buildCampaignQuery = () => {
      let query = supabase
        .from('campaigns')
        .select(
          `
          *,
          ad_accounts (account_name)
        `,
        )
        .order('spend_usd', { ascending: false });

      if (accountId) {
        query = query.eq('ad_account_id', accountId);
      }
      if (search) {
        query = query.ilike('name', `%${search}%`);
      }
      return query;
    };

    const buildAdSetQuery = () => {
      let query = supabase
        .from('ad_sets')
        .select('*')
        .order('spend_usd', { ascending: false });

      if (accountId) {
        query = query.eq('ad_account_id', accountId);
      }
      return query;
    };

    const buildAdQuery = () => {
      let query = supabase
        .from('ads')
        .select('*')
        .order('spend_usd', { ascending: false });

      if (accountId) {
        query = query.eq('ad_account_id', accountId);
      }
      if (country) {
        query = query.ilike('name', `%${country}%`);
      }
      return query;
    };

    // Fetch all data with pagination
    const [campaigns, adSets, ads] = await Promise.all([
      fetchAllWithPagination<any>(buildCampaignQuery),
      fetchAllWithPagination<any>(buildAdSetQuery),
      fetchAllWithPagination<any>(buildAdQuery),
    ]);

    // If date range is specified, fetch aggregated data from daily_insights
    const dateRangeSpendByCampaign: Record<
      string,
      { spend: number; leads: number }
    > = {};
    const dateRangeSpendByAdSet: Record<
      string,
      { spend: number; leads: number }
    > = {};
    const dateRangeSpendByAd: Record<string, { spend: number; leads: number }> =
      {};

    if (startDate && endDate) {
      // Fetch with pagination to avoid Supabase default row limit truncating long date ranges.
      const allInsights: Array<{
        campaign_id: string | null;
        adset_id: string | null;
        ad_id: string | null;
        spend_usd: number | null;
        leads_count: number | null;
      }> = [];
      let insightsFrom = 0;
      const insightsBatchSize = 1000;
      let insightsHasMore = true;

      while (insightsHasMore) {
        let insightsQuery = supabase
          .from('daily_insights')
          .select('campaign_id, adset_id, ad_id, spend_usd, leads_count')
          .gte('date', startDate)
          .lte('date', endDate)
          .range(insightsFrom, insightsFrom + insightsBatchSize - 1);

        if (accountId) {
          insightsQuery = insightsQuery.eq('ad_account_id', accountId);
        }

        const { data: insightsBatch } = await insightsQuery;

        if (insightsBatch && insightsBatch.length > 0) {
          allInsights.push(...insightsBatch);
          insightsFrom += insightsBatchSize;
          insightsHasMore = insightsBatch.length === insightsBatchSize;
        } else {
          insightsHasMore = false;
        }
      }

      for (const row of allInsights) {
        const spend = Number(row.spend_usd) || 0;
        const leads = row.leads_count || 0;

        // Aggregate by campaign
        if (row.campaign_id) {
          if (!dateRangeSpendByCampaign[row.campaign_id]) {
            dateRangeSpendByCampaign[row.campaign_id] = { spend: 0, leads: 0 };
          }
          dateRangeSpendByCampaign[row.campaign_id].spend += spend;
          dateRangeSpendByCampaign[row.campaign_id].leads += leads;
        }

        // Aggregate by ad set
        if (row.adset_id) {
          if (!dateRangeSpendByAdSet[row.adset_id]) {
            dateRangeSpendByAdSet[row.adset_id] = { spend: 0, leads: 0 };
          }
          dateRangeSpendByAdSet[row.adset_id].spend += spend;
          dateRangeSpendByAdSet[row.adset_id].leads += leads;
        }

        // Aggregate by ad
        if (row.ad_id) {
          if (!dateRangeSpendByAd[row.ad_id]) {
            dateRangeSpendByAd[row.ad_id] = { spend: 0, leads: 0 };
          }
          dateRangeSpendByAd[row.ad_id].spend += spend;
          dateRangeSpendByAd[row.ad_id].leads += leads;
        }
      }
    }

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

    const leadsCountByCampaign = allLeads.reduce(
      (acc: Record<string, number>, lead) => {
        if (lead.campaign_id) {
          acc[lead.campaign_id] = (acc[lead.campaign_id] || 0) + 1;
        }
        return acc;
      },
      {},
    );

    const adsGroupedByAdSet = ads.reduce(
      (acc: Record<string, typeof ads>, ad) => {
        if (ad.adset_id) {
          if (!acc[ad.adset_id]) acc[ad.adset_id] = [];
          acc[ad.adset_id].push(ad);
        }
        return acc;
      },
      {},
    );

    const adSetsGroupedByCampaign = adSets.reduce(
      (acc: Record<string, typeof adSets>, adSet) => {
        if (adSet.campaign_id) {
          if (!acc[adSet.campaign_id]) acc[adSet.campaign_id] = [];
          acc[adSet.campaign_id].push({
            ...adSet,
            ads: adsGroupedByAdSet[adSet.adset_id] || [],
          });
        }
        return acc;
      },
      {},
    );

    const allCampaigns = campaigns.map((campaign) => {
      // Keep campaign-level aggregates as a fallback when child rows are missing.
      const campaignDateData = dateRangeSpendByCampaign[campaign.campaign_id];
      const campaignDateSpend =
        startDate && endDate ? campaignDateData?.spend || 0 : 0;
      const campaignDateLeads =
        startDate && endDate ? campaignDateData?.leads || 0 : 0;

      const adSetsWithCountries = (
        adSetsGroupedByCampaign[campaign.campaign_id] || []
      ).map((adSet) => {
        const adsWithCountries = (adSet.ads || []).map(
          (ad: {
            id: string;
            ad_id: string;
            name: string;
            status: string;
            spend_usd: number;
            insights_leads_count?: number;
          }) => {
            const adAllTimeSpend = ad.spend_usd || 0;
            const adAllTimeLeads = ad.insights_leads_count || 0;

            let adSpend: number;
            let adLeads: number;

            if (startDate && endDate) {
              // For date filtering: use daily_insights data only - no proportional distribution
              // If ad-level data doesn't exist for this date range, it means the ad had no activity
              const adDateData = dateRangeSpendByAd[ad.ad_id];
              if (adDateData) {
                adSpend = adDateData.spend;
                adLeads = adDateData.leads;
              } else {
                // No data for this ad in the date range = no spend/leads
                adSpend = 0;
                adLeads = 0;
              }
            } else {
              // No date filter: use all-time values
              adSpend = adAllTimeSpend;
              adLeads = adAllTimeLeads;
            }

            return {
              id: ad.id,
              adId: ad.ad_id,
              name: ad.name,
              leads: adLeads,
              status: ad.status,
              spendUsd: adSpend,
              countries: parseCountriesFromName(ad.name),
            };
          },
        );

        const adSetCountries = parseCountriesFromName(adSet.name);
        // Collect all unique countries from ads
        const allAdCountries = new Set<string>();
        adsWithCountries.forEach((ad: { countries: string[] }) => {
          ad.countries.forEach((c) => allAdCountries.add(c));
        });
        // AdSet shows its own countries + inherited from ads if adSet has none
        const effectiveAdSetCountries =
          adSetCountries.length > 0
            ? adSetCountries
            : Array.from(allAdCountries);

        // Ad Set spend = sum of all Ads' spend (hierarchical aggregation)
        const adSetSpend = adsWithCountries.reduce(
          (sum, ad) => sum + (ad.spendUsd || 0),
          0,
        );
        const adSetLeads = adsWithCountries.reduce(
          (sum, ad) => sum + (ad.leads || 0),
          0,
        );

        return {
          id: adSet.id,
          adSetId: adSet.adset_id,
          name: adSet.name,
          status: adSet.status,
          optimizationGoal: adSet.optimization_goal,
          spendUsd: adSetSpend,
          leads: adSetLeads,
          countries: effectiveAdSetCountries,
          ads: adsWithCountries,
        };
      });

      // Collect all unique countries from campaign name and all adsets
      const campaignParsedCountries = parseCountriesFromName(campaign.name);
      const allCampaignCountries = new Set<string>(campaignParsedCountries);
      adSetsWithCountries.forEach((adSet: { countries: string[] }) => {
        adSet.countries.forEach((c) => allCampaignCountries.add(c));
      });
      const campaignCountries = Array.from(allCampaignCountries);

      const hierarchicalCampaignSpend = adSetsWithCountries.reduce(
        (sum, adSet) => sum + (adSet.spendUsd || 0),
        0,
      );
      const hierarchicalCampaignLeads = adSetsWithCountries.reduce(
        (sum, adSet) => sum + (adSet.leads || 0),
        0,
      );

      let campaignSpend: number;
      let campaignLeads: number;

      if (startDate && endDate) {
        // Keep parent totals aligned with the visible child hierarchy for date-filtered views.
        campaignSpend = hierarchicalCampaignSpend;
        campaignLeads = hierarchicalCampaignLeads;

        // Fall back to campaign-level aggregates only when the campaign has no synced child rows.
        if (
          adSetsWithCountries.length === 0 &&
          (campaignDateSpend > 0 || campaignDateLeads > 0)
        ) {
          campaignSpend = campaignDateSpend;
          campaignLeads = campaignDateLeads;
        }
      } else {
        campaignSpend = hierarchicalCampaignSpend;
        campaignLeads = hierarchicalCampaignLeads;
      }

      return {
        id: campaign.id,
        campaignId: campaign.campaign_id,
        name: campaign.name,
        adAccountId: campaign.ad_account_id,
        adAccountName: campaign.ad_accounts?.account_name || '',
        type: campaign.type,
        status: campaign.status,
        countries: campaignCountries,
        spendUsd: campaignSpend,
        leads: campaignLeads,
        formLeads: leadsCountByCampaign[campaign.campaign_id] || 0,
        insightsLeads: campaign.insights_leads_count || 0,
        adSets: adSetsWithCountries,
      };
    });

    // Filter out campaigns with zero spend when date filter is applied
    const filteredByDateCampaigns =
      startDate && endDate
        ? allCampaigns.filter((c) => c.spendUsd > 0 || c.leads > 0)
        : allCampaigns;

    // If no filters, return and cache
    if (!country && !level) {
      this.hierarchyCache.set(cacheKey, {
        data: filteredByDateCampaigns,
        timestamp: Date.now(),
      });
      return filteredByDateCampaigns;
    }

    // Apply filters
    const result = filteredByDateCampaigns
      .map((campaign) => {
        let filteredAdSets = campaign.adSets;
        let countryUpper: string | null = null;

        // Apply country filter at all levels
        if (country) {
          countryUpper = country.toUpperCase();

          filteredAdSets = filteredAdSets
            .map(
              (adSet: {
                countries: string[];
                ads: {
                  countries: string[];
                  name: string;
                  id: string;
                  adId: string;
                  leads: number;
                  status: string;
                  spendUsd: number;
                }[];
                id: string;
                adSetId: string;
                name: string;
                status: string;
                optimizationGoal: string;
                spendUsd: number;
                leads: number;
              }) => {
                const filteredAds = adSet.ads.filter((ad) =>
                  ad.countries.includes(countryUpper!),
                );
                const recalculatedCountries =
                  adSet.countries.includes(countryUpper!)
                    ? adSet.countries
                    : Array.from(
                        new Set(
                          filteredAds.flatMap((ad) => ad.countries || []),
                        ),
                      );

                return {
                  ...adSet,
                  ads: filteredAds,
                  countries: recalculatedCountries,
                  spendUsd: filteredAds.reduce(
                    (sum, ad) => sum + (ad.spendUsd || 0),
                    0,
                  ),
                  leads: filteredAds.reduce(
                    (sum, ad) => sum + (ad.leads || 0),
                    0,
                  ),
                };
              },
            )
            .filter(
              (adSet: { countries: string[]; ads: unknown[] }) =>
                adSet.countries.includes(countryUpper!) || adSet.ads.length > 0,
            );

          if (filteredAdSets.length === 0) {
            return null;
          }
        }

        // Apply level filter
        if (level === 'ad') {
          filteredAdSets = filteredAdSets.filter(
            (adSet: { ads: unknown[] }) => adSet.ads.length > 0,
          );
          if (filteredAdSets.length === 0) {
            return null;
          }
        } else if (level === 'adset') {
          if (filteredAdSets.length === 0) {
            return null;
          }
        }

        const recalculatedCampaignCountries = Array.from(
          new Set<string>([
            ...(countryUpper
              ? campaign.countries.filter((value) => value === countryUpper)
              : campaign.countries),
            ...filteredAdSets.flatMap((adSet) => adSet.countries || []),
          ]),
        );
        const recalculatedCampaignSpend = filteredAdSets.reduce(
          (sum, adSet) => sum + (adSet.spendUsd || 0),
          0,
        );
        const recalculatedCampaignLeads = filteredAdSets.reduce(
          (sum, adSet) => sum + (adSet.leads || 0),
          0,
        );

        return {
          ...campaign,
          countries: recalculatedCampaignCountries,
          spendUsd: recalculatedCampaignSpend,
          leads: recalculatedCampaignLeads,
          adSets: filteredAdSets,
        };
      })
      .filter(
        (campaign): campaign is NonNullable<typeof campaign> =>
          campaign !== null,
      );

    // Cache the result
    this.hierarchyCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  }

  async getAvailableCountries() {
    // Return cached if still valid
    if (
      this.countriesCache &&
      Date.now() - this.countriesCacheTime < this.COUNTRIES_CACHE_TTL
    ) {
      return this.countriesCache;
    }

    const supabase = this.supabaseService.getClient();
    const countries = new Set<string>();
    const batchSize = 1000;

    // Helper function to fetch all names with pagination
    const fetchAllNames = async (table: string): Promise<string[]> => {
      const names: string[] = [];
      let offset = 0;

      while (true) {
        const { data, error } = await supabase
          .from(table)
          .select('name')
          .range(offset, offset + batchSize - 1);

        if (error || !data || data.length === 0) {
          break;
        }

        names.push(...data.map((row) => row.name));

        if (data.length < batchSize) {
          break;
        }

        offset += batchSize;
      }

      return names;
    };

    // Fetch all names from all tables with pagination
    const [campaignNames, adSetNames, adNames] = await Promise.all([
      fetchAllNames('campaigns'),
      fetchAllNames('ad_sets'),
      fetchAllNames('ads'),
    ]);

    const allNames = [...campaignNames, ...adSetNames, ...adNames];

    for (const name of allNames) {
      const parsed = parseCountriesFromName(name);
      parsed.forEach((c) => countries.add(c));
    }

    this.countriesCache = Array.from(countries).sort();
    this.countriesCacheTime = Date.now();

    return this.countriesCache;
  }

  async syncFromMeta() {
    const supabase = this.supabaseService.getClient();

    try {
      const adAccounts = await this.metaService.getAdAccounts();

      for (const account of adAccounts) {
        const { error: accountError } = await supabase
          .from('ad_accounts')
          .upsert(
            {
              account_id: account.account_id,
              account_name: account.name,
            },
            { onConflict: 'account_id' },
          );

        if (accountError) {
          this.logger.error(
            `Failed to upsert ad account ${account.account_id}`,
            accountError,
          );
          continue;
        }

        // Sync campaigns
        const campaigns = await this.metaService.getCampaigns(
          account.account_id,
        );
        for (const campaign of campaigns) {
          await supabase.from('campaigns').upsert(
            {
              campaign_id: campaign.id,
              name: campaign.name,
              type: campaign.objective,
              ad_account_id: account.account_id,
            },
            { onConflict: 'campaign_id' },
          );
        }

        // Sync ad sets
        const adSets = await this.metaService.getAdSets(account.account_id);
        for (const adSet of adSets) {
          await supabase.from('ad_sets').upsert(
            {
              adset_id: adSet.id,
              name: adSet.name,
              status: adSet.status,
              optimization_goal: adSet.optimization_goal,
              campaign_id: adSet.campaign_id,
              ad_account_id: account.account_id,
            },
            { onConflict: 'adset_id' },
          );
        }

        // Sync ads
        const ads = await this.metaService.getAds(account.account_id);
        for (const ad of ads) {
          await supabase.from('ads').upsert(
            {
              ad_id: ad.id,
              name: ad.name,
              status: ad.status,
              adset_id: ad.adset_id,
              campaign_id: ad.campaign_id,
              ad_account_id: account.account_id,
            },
            { onConflict: 'ad_id' },
          );
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
