import { Controller, Post, Get, Query, Logger } from '@nestjs/common';
import { MetaService } from './meta.service';
import { SupabaseService } from '../common/supabase.service';
import { FieldMappingsService } from '../field-mappings/field-mappings.service';

interface SyncProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  currentPage?: string;
  currentForm?: string;
  totalFetched: number;
  totalInserted: number;
  formsProcessed: number;
  totalForms: number;
  error?: string;
}

@Controller('api/meta')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);
  private syncProgress: SyncProgress = {
    status: 'idle',
    totalFetched: 0,
    totalInserted: 0,
    formsProcessed: 0,
    totalForms: 0,
  };

  private extractLeadsCount(actions: Array<{ action_type?: string; value?: string }> = []): number {
    // Meta can report lead metrics under multiple action_type keys.
    // Use the maximum lead-like metric to avoid counting the same event twice.
    let maxLeadCount = 0;

    for (const action of actions) {
      const actionType = (action.action_type || '').toLowerCase();
      const value = parseInt(action.value || '0', 10) || 0;

      if (value <= 0) continue;

      const isLeadLike =
        actionType === 'lead' ||
        actionType === 'omni_lead' ||
        actionType === 'onsite_conversion.lead' ||
        actionType === 'onsite_conversion.lead_grouped' ||
        actionType === 'offsite_conversion.lead' ||
        actionType === 'offsite_conversion.fb_pixel_lead' ||
        actionType.includes('lead');

      if (isLeadLike && value > maxLeadCount) {
        maxLeadCount = value;
      }
    }

    return maxLeadCount;
  }

  private normalizeAccountId(accountId?: string): string {
    return (accountId || '').replace(/^act_/, '');
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetriableError(message: string): boolean {
    const text = message.toLowerCase();
    return (
      text.includes('502') ||
      text.includes('503') ||
      text.includes('504') ||
      text.includes('bad gateway') ||
      text.includes('gateway') ||
      text.includes('timeout') ||
      text.includes('fetch failed') ||
      text.includes('network') ||
      text.includes('econnreset') ||
      text.includes('etimedout')
    );
  }

  private async executeSupabaseWriteWithRetry(
    label: string,
    operation: () => PromiseLike<{ error?: { message?: string } | null }>,
    maxRetries = 5,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await operation();
      const error = result?.error;

      if (!error) {
        return;
      }

      const message = error.message || 'Unknown Supabase error';
      const shouldRetry = this.isRetriableError(message) && attempt < maxRetries;

      if (!shouldRetry) {
        throw new Error(`${label}: ${message}`);
      }

      const waitMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      this.logger.warn(`${label} (attempt ${attempt}/${maxRetries}) failed: ${message}. Retrying in ${waitMs}ms`);
      await this.sleep(waitMs);
    }
  }

  private chunkArray<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private async updateInsightsInBatches(
    supabase: any,
    table: 'campaigns' | 'ad_sets' | 'ads',
    idKey: 'campaign_id' | 'adset_id' | 'ad_id',
    insights: any[],
    label: string,
  ): Promise<void> {
    const batches = this.chunkArray(insights, 50);

    for (const batch of batches) {
      await Promise.all(
        batch.map(async (insight) => {
          const entityId = insight[idKey];
          const leadsCount = this.extractLeadsCount(insight.actions || []);

          await this.executeSupabaseWriteWithRetry(
            `Failed to update ${label} ${entityId}`,
            () =>
              supabase
                .from(table)
                .update({
                  spend_usd: parseFloat(insight.spend || '0'),
                  insights_leads_count: leadsCount,
                })
                .eq(idKey, entityId),
          );
        }),
      );
    }
  }

  constructor(
    private metaService: MetaService,
    private supabaseService: SupabaseService,
    private fieldMappingsService: FieldMappingsService,
  ) {}

  @Get('sync/progress')
  getSyncProgress() {
    return this.syncProgress;
  }

  @Get('debug/campaign-actions')
  async debugCampaignActions(
    @Query('accountId') accountId: string,
    @Query('campaignName') campaignName?: string,
    @Query('date') date?: string,
  ) {
    if (!accountId) {
      return { error: 'accountId is required' };
    }

    const accountIdClean = accountId.replace('act_', '');
    const singleDate = date || new Date().toISOString().split('T')[0];
    
    this.logger.log(`Debug: Fetching insights for account ${accountIdClean}, date=${singleDate}`);

    const insights = await this.metaService.getCampaignInsights(accountIdClean, singleDate, singleDate);
    
    const results = insights
      .filter(i => !campaignName || i.campaign_name?.toLowerCase().includes(campaignName.toLowerCase()))
      .slice(0, 10)
      .map(insight => {
        const actionsSummary: Record<string, number> = {};
        if (insight.actions) {
          for (const action of insight.actions) {
            actionsSummary[action.action_type] = parseInt(action.value || '0', 10);
          }
        }
        return {
          campaign_id: insight.campaign_id,
          campaign_name: insight.campaign_name,
          spend: insight.spend,
          actions: actionsSummary,
          raw_actions: insight.actions,
        };
      });

    return { 
      dateRange: singleDate,
      count: results.length,
      campaigns: results 
    };
  }

  @Post('fix-leads')
  async fixLeadCounts() {
    const supabase = this.supabaseService.getClient();
    
    // Fix daily_insights - divide by 2
    const { data: dailyData, error: dailyError } = await supabase
      .from('daily_insights')
      .update({ leads_count: supabase.rpc('div2', {}) })
      .gt('leads_count', 0);
    
    // Direct SQL approach - update all records
    const { error: error1 } = await supabase.rpc('fix_lead_counts_daily');
    const { error: error2 } = await supabase.rpc('fix_lead_counts_campaigns');
    
    if (error1 || error2) {
      // Fallback: manually fetch and update
      const { data: insights } = await supabase
        .from('daily_insights')
        .select('id, leads_count')
        .gt('leads_count', 0);
      
      if (insights) {
        for (const row of insights) {
          await supabase
            .from('daily_insights')
            .update({ leads_count: Math.floor(row.leads_count / 2) })
            .eq('id', row.id);
        }
      }
      
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('id, insights_leads_count')
        .gt('insights_leads_count', 0);
      
      if (campaigns) {
        for (const row of campaigns) {
          await supabase
            .from('campaigns')
            .update({ insights_leads_count: Math.floor(row.insights_leads_count / 2) })
            .eq('id', row.id);
        }
      }
      
      return { success: true, message: 'Lead counts fixed via fallback method' };
    }
    
    return { success: true, message: 'Lead counts fixed' };
  }

  @Get('sync/forms')
  async getAvailableForms() {
    const forms: any[] = [];
    try {
      const pages = await this.metaService.getPages();
      for (const page of pages) {
        const pageForms = await this.metaService.getLeadGenFormsWithPageToken(page.id, page.access_token);
        for (const form of pageForms) {
          forms.push({
            formId: form.id,
            formName: form.name,
            leadsCount: form.leads_count || 0,
            pageName: page.name,
            pageId: page.id,
            pageAccessToken: page.access_token,
          });
        }
      }
      return { success: true, forms: forms.filter(f => f.leadsCount > 0) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  @Post('sync/form')
  async syncSingleForm(
    @Query('formId') formId: string,
    @Query('formName') formName: string,
    @Query('pageAccessToken') pageAccessToken: string,
  ) {
    if (!formId || !pageAccessToken) {
      return { success: false, error: 'formId and pageAccessToken are required' };
    }

    const supabase = this.supabaseService.getClient();
    let totalInserted = 0;
    let totalFetched = 0;

    try {
      this.logger.log(`Starting streaming sync for form: ${formName || formId}`);

      // Streaming: Sayfa sayfa çek ve hemen DB'ye yaz
      let nextUrl: string | null = `https://graph.facebook.com/v19.0/${formId}/leads?access_token=${pageAccessToken}&fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&limit=100`;
      let pageNum = 0;

      while (nextUrl) {
        pageNum++;
        const axios = require('axios');
        const response = await axios.get(nextUrl);
        const leads = response.data.data || [];
        totalFetched += leads.length;

        if (leads.length === 0) {
          nextUrl = response.data.paging?.next || null;
          continue;
        }

        // Her sayfa için hemen DB'ye yaz
        const leadIds = leads.map((l: any) => l.id);
        const { data: existingLeads } = await supabase
          .from('leads')
          .select('lead_id')
          .in('lead_id', leadIds);

        const existingIds = new Set((existingLeads || []).map((l: any) => l.lead_id));
        const newLeads = leads.filter((l: any) => !existingIds.has(l.id));

        if (newLeads.length > 0) {
          const leadsToInsert = newLeads.map((lead: any) => ({
            lead_id: lead.id,
            form_name: formName || 'Unknown',
            ad_name: lead.ad_name || null,
            ad_set_name: lead.adset_name || null,
            campaign_id: lead.campaign_id || null,
            source: 'sync',
            created_at: lead.created_time,
          }));

          const { data: insertedLeads, error: insertError } = await supabase
            .from('leads')
            .insert(leadsToInsert)
            .select();

          if (!insertError && insertedLeads) {
            totalInserted += insertedLeads.length;

            // Field data insert with mapping
            const fieldDataToInsert: any[] = [];
            for (let j = 0; j < insertedLeads.length; j++) {
              const originalLead = newLeads[j];
              if (originalLead.field_data) {
                for (const field of originalLead.field_data) {
                  const mappedFieldName = await this.fieldMappingsService.getMappedFieldName(field.name);
                  fieldDataToInsert.push({
                    lead_id: insertedLeads[j].id,
                    field_name: field.name,
                    mapped_field_name: mappedFieldName,
                    field_value: field.values?.[0] || '',
                  });
                }
              }
            }

            if (fieldDataToInsert.length > 0) {
              await supabase.from('lead_field_data').insert(fieldDataToInsert);
            }
          }
        }

        this.logger.log(`Page ${pageNum}: Fetched ${leads.length}, Inserted ${newLeads.length} new leads`);
        nextUrl = response.data.paging?.next || null;
      }

      this.logger.log(`Form sync completed: ${totalFetched} fetched, ${totalInserted} inserted`);
      return {
        success: true,
        formId,
        formName,
        totalFetched,
        totalInserted,
      };
    } catch (error) {
      this.logger.error(`Form sync failed: ${formId}`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  @Post('sync/leads/streaming')
  async syncLeadsStreaming() {
    if (this.syncProgress.status === 'running') {
      return { success: false, message: 'Sync already running', progress: this.syncProgress };
    }

    this.syncProgress = {
      status: 'running',
      totalFetched: 0,
      totalInserted: 0,
      formsProcessed: 0,
      totalForms: 0,
    };

    const supabase = this.supabaseService.getClient();

    try {
      const pages = await this.metaService.getPages();
      this.logger.log(`Found ${pages.length} pages`);

      // Önce tüm formları topla
      const allForms: any[] = [];
      for (const page of pages) {
        const forms = await this.metaService.getLeadGenFormsWithPageToken(page.id, page.access_token);
        for (const form of forms) {
          if (form.leads_count && form.leads_count > 0) {
            allForms.push({ ...form, page });
          }
        }
      }

      this.syncProgress.totalForms = allForms.length;
      this.logger.log(`Found ${allForms.length} forms with leads`);

      // Her form için streaming sync
      for (const formData of allForms) {
        const form = formData;
        const page = formData.page;

        this.syncProgress.currentPage = page.name;
        this.syncProgress.currentForm = form.name;

        this.logger.log(`Processing form: ${form.name} (${form.leads_count} leads)`);

        try {
          // Streaming pagination
          let nextUrl: string | null = `https://graph.facebook.com/v19.0/${form.id}/leads?access_token=${page.access_token}&fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&limit=100`;
          
          while (nextUrl) {
            const axios = require('axios');
            const response = await axios.get(nextUrl);
            const leads = response.data.data || [];
            
            if (leads.length === 0) {
              nextUrl = response.data.paging?.next || null;
              continue;
            }

            this.syncProgress.totalFetched += leads.length;

            // Batch check existing
            const leadIds = leads.map((l: any) => l.id);
            const { data: existingLeads } = await supabase
              .from('leads')
              .select('lead_id')
              .in('lead_id', leadIds);

            const existingIds = new Set((existingLeads || []).map((l: any) => l.lead_id));
            const newLeads = leads.filter((l: any) => !existingIds.has(l.id));

            if (newLeads.length > 0) {
              const leadsToInsert = newLeads.map((lead: any) => ({
                lead_id: lead.id,
                form_name: form.name,
                ad_name: lead.ad_name || null,
                ad_set_name: lead.adset_name || null,
                campaign_id: lead.campaign_id || null,
                source: 'sync',
                created_at: lead.created_time,
              }));

              const { data: insertedLeads, error: insertError } = await supabase
                .from('leads')
                .insert(leadsToInsert)
                .select();

              if (!insertError && insertedLeads) {
                this.syncProgress.totalInserted += insertedLeads.length;

                const fieldDataToInsert: any[] = [];
                for (let j = 0; j < insertedLeads.length; j++) {
                  const originalLead = newLeads[j];
                  if (originalLead.field_data) {
                    for (const field of originalLead.field_data) {
                      const mappedFieldName = await this.fieldMappingsService.getMappedFieldName(field.name);
                      fieldDataToInsert.push({
                        lead_id: insertedLeads[j].id,
                        field_name: field.name,
                        mapped_field_name: mappedFieldName,
                        field_value: field.values?.[0] || '',
                      });
                    }
                  }
                }

                if (fieldDataToInsert.length > 0) {
                  await supabase.from('lead_field_data').insert(fieldDataToInsert);
                }
              }
            }

            nextUrl = response.data.paging?.next || null;
          }
        } catch (error) {
          this.logger.error(`Error processing form ${form.name}`, error);
        }

        this.syncProgress.formsProcessed++;
        this.logger.log(`Progress: ${this.syncProgress.formsProcessed}/${this.syncProgress.totalForms} forms, ${this.syncProgress.totalInserted} leads inserted`);
      }

      await supabase.from('sync_logs').insert({
        type: 'leads',
        status: 'success',
      });

      this.syncProgress.status = 'completed';
      return {
        success: true,
        message: `Sync completed`,
        ...this.syncProgress,
      };
    } catch (error) {
      this.syncProgress.status = 'error';
      this.syncProgress.error = (error as Error).message;
      this.logger.error('Streaming sync failed', error);
      return { success: false, error: (error as Error).message };
    }
  }

  @Post('sync')
  async syncAll() {
    const supabase = this.supabaseService.getClient();

    try {
      const rawAdAccounts = await this.metaService.getAdAccounts();
      const allowedAccounts = this.metaService.getAllowedAdAccounts();
      const allowedSet = new Set(
        (allowedAccounts || [])
          .map((id) => this.normalizeAccountId(id))
          .filter(Boolean),
      );

      const adAccounts =
        allowedSet.size > 0
          ? rawAdAccounts.filter((account) =>
              allowedSet.has(this.normalizeAccountId(account.account_id || account.id)),
            )
          : rawAdAccounts;

      for (const account of adAccounts) {
        const accountId = this.normalizeAccountId(account.account_id || account.id);

        const { error: accountUpsertError } = await supabase.from('ad_accounts').upsert(
          {
            account_id: accountId,
            account_name: account.name,
          },
          { onConflict: 'account_id' },
        );
        if (accountUpsertError) {
          throw new Error(`Failed to upsert ad account ${accountId}: ${accountUpsertError.message}`);
        }

        // Batch upsert campaigns
        const campaigns = await this.metaService.getCampaigns(accountId);
        this.logger.log(`Found ${campaigns.length} campaigns for account ${account.name}`);
        
        if (campaigns.length > 0) {
          const campaignsData = campaigns.map(campaign => ({
            campaign_id: campaign.id,
            name: campaign.name,
            type: campaign.objective,
            status: campaign.status,
            ad_account_id: accountId,
          }));
          for (let i = 0; i < campaignsData.length; i += 500) {
            const chunk = campaignsData.slice(i, i + 500);
            const { error } = await supabase.from('campaigns').upsert(chunk, { onConflict: 'campaign_id' });
            if (error) {
              throw new Error(`Failed to upsert campaigns for account ${accountId}: ${error.message}`);
            }
          }
        }

        // Batch upsert ad sets
        const adSets = await this.metaService.getAdSets(accountId);
        this.logger.log(`Found ${adSets.length} ad sets for account ${account.name}`);

        if (adSets.length > 0) {
          const adSetsData = adSets.map(adSet => ({
            adset_id: adSet.id,
            name: adSet.name,
            campaign_id: adSet.campaign_id,
            ad_account_id: accountId,
            status: adSet.status,
            optimization_goal: adSet.optimization_goal,
          }));
          // Batch in chunks of 500 to avoid payload limits
          for (let i = 0; i < adSetsData.length; i += 500) {
            const chunk = adSetsData.slice(i, i + 500);
            const { error } = await supabase.from('ad_sets').upsert(chunk, { onConflict: 'adset_id' });
            if (error) {
              throw new Error(`Failed to upsert ad sets for account ${accountId}: ${error.message}`);
            }
          }
        }

        // Batch upsert ads
        const ads = await this.metaService.getAds(accountId);
        this.logger.log(`Found ${ads.length} ads for account ${account.name}`);

        if (ads.length > 0) {
          const adsData = ads.map(ad => ({
            ad_id: ad.id,
            name: ad.name,
            adset_id: ad.adset_id,
            campaign_id: ad.campaign_id,
            ad_account_id: accountId,
            status: ad.status,
          }));
          for (let i = 0; i < adsData.length; i += 500) {
            const chunk = adsData.slice(i, i + 500);
            const { error } = await supabase.from('ads').upsert(chunk, { onConflict: 'ad_id' });
            if (error) {
              throw new Error(`Failed to upsert ads for account ${accountId}: ${error.message}`);
            }
          }
        }

        const today = new Date();
        const lookbackDays = this.metaService.getSyncLookbackDays();
        const startDate = new Date(today.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = today.toISOString().split('T')[0];
        this.logger.log(`Fetching insights for last ${lookbackDays} days: ${startDateStr} to ${endDateStr}`);
        
        // Get and update campaign insights (spend + leads count)
        const campaignInsights = await this.metaService.getCampaignInsights(
          accountId,
          startDateStr,
          endDateStr,
        );
        this.logger.log(`Found ${campaignInsights.length} campaign insights`);

        await this.updateInsightsInBatches(
          supabase,
          'campaigns',
          'campaign_id',
          campaignInsights,
          'campaign',
        );

        // Get and update ad set insights
        const adSetInsights = await this.metaService.getAdSetInsights(
          accountId,
          startDateStr,
          endDateStr,
        );
        this.logger.log(`Found ${adSetInsights.length} ad set insights`);

        await this.updateInsightsInBatches(
          supabase,
          'ad_sets',
          'adset_id',
          adSetInsights,
          'ad set',
        );

        // Get and update ad insights
        const adInsights = await this.metaService.getAdInsights(
          accountId,
          startDateStr,
          endDateStr,
        );
        this.logger.log(`Found ${adInsights.length} ad insights`);

        await this.updateInsightsInBatches(
          supabase,
          'ads',
          'ad_id',
          adInsights,
          'ad',
        );

        // Fetch and save daily insights for date filtering
        this.logger.log(`Fetching daily insights for account ${account.name}`);
        const dailyInsights = await this.metaService.getDailyInsights(
          accountId,
          startDateStr,
          endDateStr,
          'campaign',
        );
        this.logger.log(`Found ${dailyInsights.length} daily campaign insights`);

        if (dailyInsights.length > 0) {
          const dailyData = dailyInsights.map(insight => {
            const leadsCount = this.extractLeadsCount(insight.actions || []);
            return {
              date: insight.date_start,
              campaign_id: insight.campaign_id,
              campaign_name: insight.campaign_name,
              spend_usd: parseFloat(insight.spend || '0'),
              leads_count: leadsCount,
              impressions: parseInt(insight.impressions || '0', 10),
              clicks: parseInt(insight.clicks || '0', 10),
              ad_account_id: accountId,
            };
          });

          await this.executeSupabaseWriteWithRetry(
            `Failed to clear daily insights for account ${accountId}`,
            () =>
              supabase
                .from('daily_insights')
                .delete()
                .eq('ad_account_id', accountId)
                .gte('date', startDateStr)
                .lte('date', endDateStr),
          );

          // Batch insert daily insights in chunks
          for (let i = 0; i < dailyData.length; i += 500) {
            const chunk = dailyData.slice(i, i + 500);
            await this.executeSupabaseWriteWithRetry(
              `Failed to insert daily insights for account ${accountId}`,
              () => supabase.from('daily_insights').insert(chunk),
            );
          }
          this.logger.log(`Saved ${dailyData.length} daily insights for account ${account.name}`);
        }
      }

      const { error: syncLogError } = await supabase.from('sync_logs').insert({
        type: 'spend',
        status: 'success',
      });
      if (syncLogError) {
        this.logger.warn(`Failed to write success sync log: ${syncLogError.message}`);
      }

      return { success: true, message: 'Sync completed successfully' };
    } catch (error) {
      this.logger.error('Sync failed', error);

      await supabase.from('sync_logs').insert({
        type: 'sync',
        status: 'error',
        error_message: (error as Error).message,
      });

      throw error;
    }
  }

  @Post('sync/leads')
  async syncLeads() {
    return this.syncLeadsStreaming();
  }
}
