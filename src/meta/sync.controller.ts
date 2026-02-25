import { Controller, Post, Get, Query, Logger } from '@nestjs/common';
import { MetaService } from './meta.service';
import { SupabaseService } from '../common/supabase.service';

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

  constructor(
    private metaService: MetaService,
    private supabaseService: SupabaseService,
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

            // Field data insert
            const fieldDataToInsert: any[] = [];
            for (let j = 0; j < insertedLeads.length; j++) {
              const originalLead = newLeads[j];
              if (originalLead.field_data) {
                for (const field of originalLead.field_data) {
                  fieldDataToInsert.push({
                    lead_id: insertedLeads[j].id,
                    field_name: field.name,
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
                      fieldDataToInsert.push({
                        lead_id: insertedLeads[j].id,
                        field_name: field.name,
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
      const adAccounts = await this.metaService.getAdAccounts();

      for (const account of adAccounts) {
        await supabase.from('ad_accounts').upsert(
          {
            account_id: account.account_id,
            account_name: account.name,
          },
          { onConflict: 'account_id' },
        );

        // Batch upsert campaigns
        const campaigns = await this.metaService.getCampaigns(account.account_id);
        this.logger.log(`Found ${campaigns.length} campaigns for account ${account.name}`);
        
        if (campaigns.length > 0) {
          const campaignsData = campaigns.map(campaign => ({
            campaign_id: campaign.id,
            name: campaign.name,
            type: campaign.objective,
            status: campaign.status,
            ad_account_id: account.account_id,
          }));
          await supabase.from('campaigns').upsert(campaignsData, { onConflict: 'campaign_id' });
        }

        // Batch upsert ad sets
        const adSets = await this.metaService.getAdSets(account.account_id);
        this.logger.log(`Found ${adSets.length} ad sets for account ${account.name}`);

        if (adSets.length > 0) {
          const adSetsData = adSets.map(adSet => ({
            adset_id: adSet.id,
            name: adSet.name,
            campaign_id: adSet.campaign_id,
            ad_account_id: account.account_id,
            status: adSet.status,
            optimization_goal: adSet.optimization_goal,
          }));
          // Batch in chunks of 500 to avoid payload limits
          for (let i = 0; i < adSetsData.length; i += 500) {
            const chunk = adSetsData.slice(i, i + 500);
            await supabase.from('ad_sets').upsert(chunk, { onConflict: 'adset_id' });
          }
        }

        // Batch upsert ads
        const ads = await this.metaService.getAds(account.account_id);
        this.logger.log(`Found ${ads.length} ads for account ${account.name}`);

        if (ads.length > 0) {
          const adsData = ads.map(ad => ({
            ad_id: ad.id,
            name: ad.name,
            adset_id: ad.adset_id,
            campaign_id: ad.campaign_id,
            ad_account_id: account.account_id,
            status: ad.status,
          }));
          for (let i = 0; i < adsData.length; i += 500) {
            const chunk = adsData.slice(i, i + 500);
            await supabase.from('ads').upsert(chunk, { onConflict: 'ad_id' });
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
          account.account_id,
          startDateStr,
          endDateStr,
        );
        this.logger.log(`Found ${campaignInsights.length} campaign insights`);

        // Update campaign spends and leads count from insights
        const campaignUpdates = campaignInsights.map(insight => {
          // Extract lead count from actions - only count actual form leads
          let leadsCount = 0;
          if (insight.actions) {
            for (const action of insight.actions) {
              if (action.action_type === 'lead') {
                leadsCount += parseInt(action.value || '0', 10);
              }
            }
          }
          return supabase.from('campaigns').update({ 
            spend_usd: parseFloat(insight.spend || '0'),
            insights_leads_count: leadsCount,
          }).eq('campaign_id', insight.campaign_id);
        });
        await Promise.all(campaignUpdates);

        // Get and update ad set insights
        const adSetInsights = await this.metaService.getAdSetInsights(
          account.account_id,
          startDateStr,
          endDateStr,
        );
        this.logger.log(`Found ${adSetInsights.length} ad set insights`);

        const adSetUpdates = adSetInsights.map(insight => {
          let leadsCount = 0;
          if (insight.actions) {
            for (const action of insight.actions) {
              if (action.action_type === 'lead') {
                leadsCount += parseInt(action.value || '0', 10);
              }
            }
          }
          return supabase.from('ad_sets').update({ 
            spend_usd: parseFloat(insight.spend || '0'),
            insights_leads_count: leadsCount,
          }).eq('adset_id', insight.adset_id);
        });
        await Promise.all(adSetUpdates);

        // Get and update ad insights
        const adInsights = await this.metaService.getAdInsights(
          account.account_id,
          startDateStr,
          endDateStr,
        );
        this.logger.log(`Found ${adInsights.length} ad insights`);

        const adUpdates = adInsights.map(insight => {
          let leadsCount = 0;
          if (insight.actions) {
            for (const action of insight.actions) {
              if (action.action_type === 'lead') {
                leadsCount += parseInt(action.value || '0', 10);
              }
            }
          }
          return supabase.from('ads').update({ 
            spend_usd: parseFloat(insight.spend || '0'),
            insights_leads_count: leadsCount,
          }).eq('ad_id', insight.ad_id);
        });
        await Promise.all(adUpdates);

        // Fetch and save daily insights for date filtering
        this.logger.log(`Fetching daily insights for account ${account.name}`);
        const dailyInsights = await this.metaService.getDailyInsights(
          account.account_id,
          startDateStr,
          endDateStr,
          'campaign',
        );
        this.logger.log(`Found ${dailyInsights.length} daily campaign insights`);

        if (dailyInsights.length > 0) {
          const dailyData = dailyInsights.map(insight => {
            let leadsCount = 0;
            if (insight.actions) {
              for (const action of insight.actions) {
                // Only count actual form leads - 'lead' is the primary action type for lead gen forms
                if (action.action_type === 'lead') {
                  leadsCount += parseInt(action.value || '0', 10);
                }
              }
            }
            return {
              date: insight.date_start,
              campaign_id: insight.campaign_id,
              campaign_name: insight.campaign_name,
              spend_usd: parseFloat(insight.spend || '0'),
              leads_count: leadsCount,
              impressions: parseInt(insight.impressions || '0', 10),
              clicks: parseInt(insight.clicks || '0', 10),
              ad_account_id: account.account_id,
            };
          });

          // Batch upsert daily insights in chunks
          for (let i = 0; i < dailyData.length; i += 500) {
            const chunk = dailyData.slice(i, i + 500);
            await supabase.from('daily_insights').upsert(chunk, { 
              onConflict: 'date,campaign_id',
              ignoreDuplicates: false,
            });
          }
          this.logger.log(`Saved ${dailyData.length} daily insights for account ${account.name}`);
        }
      }

      await supabase.from('sync_logs').insert({
        type: 'spend',
        status: 'success',
      });

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
