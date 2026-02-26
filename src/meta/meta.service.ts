import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);
  private readonly baseUrl: string;
  private accessToken: string;
  private allowedAdAccounts: string[];
  private syncLookbackDays: number;

  constructor(private configService: ConfigService) {
    const apiVersion = this.configService.get<string>('META_API_VERSION') || 'v18.0';
    this.baseUrl = `https://graph.facebook.com/${apiVersion}`;
    this.accessToken = this.configService.get<string>('META_ACCESS_TOKEN') || '';
    this.allowedAdAccounts = (this.configService.get<string>('META_ALLOWED_AD_ACCOUNTS') || '').split(',').filter(Boolean);
    this.syncLookbackDays = parseInt(this.configService.get<string>('META_SYNC_LOOKBACK_DAYS') || '90', 10);
  }

  getAllowedAdAccounts(): string[] {
    return this.allowedAdAccounts;
  }

  getSyncLookbackDays(): number {
    return this.syncLookbackDays;
  }

  async getAdAccounts(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/me/adaccounts`, {
        params: {
          access_token: this.accessToken,
          fields: 'id,name,account_id,account_status',
        },
      });
      return response.data.data || [];
    } catch (error) {
      this.logger.error('Failed to fetch ad accounts', error);
      throw error;
    }
  }

  async getCampaigns(adAccountId: string): Promise<any[]> {
    const allCampaigns: any[] = [];
    let nextUrl: string | null = `${this.baseUrl}/act_${adAccountId}/campaigns?access_token=${this.accessToken}&fields=id,name,objective,status,created_time&limit=500`;
    
    try {
      while (nextUrl) {
        const response = await axios.get(nextUrl);
        const data = response.data.data || [];
        allCampaigns.push(...data);
        nextUrl = response.data.paging?.next || null;
        
        if (allCampaigns.length >= 100000) {
          this.logger.warn(`Reached 100000 campaigns limit for account ${adAccountId}`);
          break;
        }
      }
      return allCampaigns;
    } catch (error) {
      this.logger.error(`Failed to fetch campaigns for account ${adAccountId}`, error);
      throw error;
    }
  }

  async getAdSets(adAccountId: string): Promise<any[]> {
    const allAdSets: any[] = [];
    let nextUrl: string | null = `${this.baseUrl}/act_${adAccountId}/adsets?access_token=${this.accessToken}&fields=id,name,campaign_id,status,targeting,optimization_goal&limit=500`;
    
    try {
      while (nextUrl) {
        const response = await axios.get(nextUrl);
        const data = response.data.data || [];
        allAdSets.push(...data);
        nextUrl = response.data.paging?.next || null;
        
        if (allAdSets.length >= 100000) {
          this.logger.warn(`Reached 100000 ad sets limit for account ${adAccountId}`);
          break;
        }
      }
      return allAdSets;
    } catch (error) {
      this.logger.error(`Failed to fetch ad sets for account ${adAccountId}`, error);
      throw error;
    }
  }

  async getAds(adAccountId: string): Promise<any[]> {
    const allAds: any[] = [];
    let nextUrl: string | null = `${this.baseUrl}/act_${adAccountId}/ads?access_token=${this.accessToken}&fields=id,name,adset_id,campaign_id,status,creative&limit=500`;
    
    try {
      while (nextUrl) {
        const response = await axios.get(nextUrl);
        const data = response.data.data || [];
        allAds.push(...data);
        nextUrl = response.data.paging?.next || null;
        
        if (allAds.length >= 100000) {
          this.logger.warn(`Reached 100000 ads limit for account ${adAccountId}`);
          break;
        }
      }
      return allAds;
    } catch (error) {
      this.logger.error(`Failed to fetch ads for account ${adAccountId}`, error);
      throw error;
    }
  }

  async getCampaignInsights(
    adAccountId: string,
    startDate: string,
    endDate: string,
  ): Promise<any[]> {
    return this.fetchInsightsWithRetry(
      adAccountId,
      'campaign',
      'campaign_id,campaign_name,spend,actions',
      startDate,
      endDate,
    );
  }

  private async fetchInsightsWithRetry(
    adAccountId: string,
    level: string,
    fields: string,
    startDate: string,
    endDate: string,
  ): Promise<any[]> {
    const allInsights: any[] = [];
    let nextUrl: string | null = `${this.baseUrl}/act_${adAccountId}/insights?access_token=${this.accessToken}&level=${level}&fields=${fields}&time_range=${JSON.stringify({ since: startDate, until: endDate })}&limit=500`;
    
    let retries = 0;
    const maxRetries = 3;

    while (nextUrl) {
      try {
        const response = await axios.get(nextUrl);
        const data = response.data.data || [];
        allInsights.push(...data);
        nextUrl = response.data.paging?.next || null;
        retries = 0; // Reset retries on success
        
        // Small delay between pages
        if (nextUrl) {
          await this.sleep(300);
        }
        
        if (allInsights.length >= 100000) {
          this.logger.warn(`Reached 100000 ${level} insights limit for account ${adAccountId}`);
          break;
        }
      } catch (error: any) {
        const errorCode = error.response?.data?.error?.code;
        const isRateLimit = errorCode === 4 || errorCode === 17;
        
        if (isRateLimit && retries < maxRetries) {
          retries++;
          const waitTime = Math.pow(2, retries) * 30000;
          this.logger.warn(`Rate limit for ${level} insights, waiting ${waitTime / 1000}s (retry ${retries}/${maxRetries})`);
          await this.sleep(waitTime);
        } else {
          this.logger.error(`Failed to fetch ${level} insights for account ${adAccountId}`, error);
          throw error;
        }
      }
    }
    
    return allInsights;
  }

  async getAdSetInsights(
    adAccountId: string,
    startDate: string,
    endDate: string,
  ): Promise<any[]> {
    return this.fetchInsightsWithRetry(
      adAccountId,
      'adset',
      'adset_id,adset_name,campaign_id,spend,actions',
      startDate,
      endDate,
    );
  }

  async getAdInsights(
    adAccountId: string,
    startDate: string,
    endDate: string,
  ): Promise<any[]> {
    return this.fetchInsightsWithRetry(
      adAccountId,
      'ad',
      'ad_id,ad_name,adset_id,campaign_id,spend,actions',
      startDate,
      endDate,
    );
  }

  async getDailyInsights(
    adAccountId: string,
    startDate: string,
    endDate: string,
    level: 'campaign' | 'adset' | 'ad' = 'campaign',
  ): Promise<any[]> {
    const allInsights: any[] = [];
    const fieldsMap = {
      campaign: 'campaign_id,campaign_name,spend,actions,impressions,clicks,date_start',
      adset: 'campaign_id,adset_id,adset_name,spend,actions,impressions,clicks,date_start',
      ad: 'campaign_id,adset_id,ad_id,ad_name,spend,actions,impressions,clicks,date_start',
    };

    // Split date range into 90-day batches to avoid Meta API limits
    const batches = this.splitDateRange(startDate, endDate, 90);
    this.logger.log(`Splitting ${startDate} to ${endDate} into ${batches.length} batches for daily insights`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      // Add delay between batches to avoid rate limiting (2 seconds)
      if (i > 0) {
        await this.sleep(2000);
      }
      
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
        try {
          let nextUrl: string | null = `${this.baseUrl}/act_${adAccountId}/insights?access_token=${this.accessToken}&level=${level}&fields=${fieldsMap[level]}&time_range=${JSON.stringify({ since: batch.start, until: batch.end })}&time_increment=1&limit=500`;
          
          while (nextUrl) {
            const response = await axios.get(nextUrl);
            const data = response.data.data || [];
            allInsights.push(...data);
            nextUrl = response.data.paging?.next || null;
            
            // Small delay between pages
            if (nextUrl) {
              await this.sleep(500);
            }
            
            if (allInsights.length >= 100000) {
              this.logger.warn(`Reached 100000 daily insights limit for account ${adAccountId} at level ${level}`);
              break;
            }
          }
          this.logger.log(`Batch ${i + 1}/${batches.length} (${batch.start} to ${batch.end}): fetched ${allInsights.length} total daily ${level} insights`);
          break; // Success, exit retry loop
        } catch (error: any) {
          retries++;
          const errorCode = error.response?.data?.error?.code;
          const isRateLimit = errorCode === 4 || errorCode === 17;
          
          if (isRateLimit && retries < maxRetries) {
            const waitTime = Math.pow(2, retries) * 30000; // Exponential backoff: 60s, 120s, 240s
            this.logger.warn(`Rate limit hit for batch ${batch.start} to ${batch.end}. Waiting ${waitTime / 1000}s before retry ${retries}/${maxRetries}`);
            await this.sleep(waitTime);
          } else if (retries >= maxRetries) {
            this.logger.error(`Failed batch ${batch.start} to ${batch.end} after ${maxRetries} retries: ${error.message}`);
            // Continue with next batch instead of failing completely
            break;
          } else {
            this.logger.error(`Non-rate-limit error for batch ${batch.start} to ${batch.end}: ${error.message}`);
            break;
          }
        }
      }
    }
    
    this.logger.log(`Fetched ${allInsights.length} daily ${level} insights for account ${adAccountId}`);
    return allInsights;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private splitDateRange(startDate: string, endDate: string, batchDays: number): { start: string; end: string }[] {
    const batches: { start: string; end: string }[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    let currentStart = new Date(start);
    while (currentStart < end) {
      const currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + batchDays - 1);
      
      if (currentEnd > end) {
        currentEnd.setTime(end.getTime());
      }
      
      batches.push({
        start: currentStart.toISOString().split('T')[0],
        end: currentEnd.toISOString().split('T')[0],
      });
      
      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() + 1);
    }
    
    return batches;
  }

  async getLeadGenForms(pageId: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${pageId}/leadgen_forms`, {
        params: {
          access_token: this.accessToken,
          fields: 'id,name,status,leads_count',
        },
      });
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Failed to fetch lead gen forms for page ${pageId}`, error);
      throw error;
    }
  }

  async getLeads(formId: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${formId}/leads`, {
        params: {
          access_token: this.accessToken,
          fields: 'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform',
        },
      });
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Failed to fetch leads for form ${formId}`, error);
      throw error;
    }
  }

  async subscribeToWebhook(adAccountId: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/act_${adAccountId}/subscribed_apps`,
        null,
        {
          params: {
            access_token: this.accessToken,
            subscribed_fields: 'leadgen,ads,adsets,campaigns',
          },
        },
      );
      return response.data.success;
    } catch (error) {
      this.logger.error(`Failed to subscribe to webhook for account ${adAccountId}`, error);
      throw error;
    }
  }

  async getSubscriptionStatus(adAccountId: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/act_${adAccountId}/subscribed_apps`,
        {
          params: {
            access_token: this.accessToken,
          },
        },
      );
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Failed to get subscription status for account ${adAccountId}`, error);
      throw error;
    }
  }

  async getPages(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/me/accounts`, {
        params: {
          access_token: this.accessToken,
          fields: 'id,name,access_token',
        },
      });
      return response.data.data || [];
    } catch (error) {
      this.logger.error('Failed to fetch pages', error);
      throw error;
    }
  }

  async getLeadGenFormsWithPageToken(pageId: string, pageAccessToken: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${pageId}/leadgen_forms`, {
        params: {
          access_token: pageAccessToken,
          fields: 'id,name,status,leads_count',
        },
      });
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Failed to fetch lead gen forms for page ${pageId}`, error);
      return [];
    }
  }

  async getLeadsWithPageToken(formId: string, pageAccessToken: string, limit = 100): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${formId}/leads`, {
        params: {
          access_token: pageAccessToken,
          fields: 'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id',
          limit,
        },
      });
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Failed to fetch leads for form ${formId}`, error);
      return [];
    }
  }

  async getAllLeadsWithPageToken(formId: string, pageAccessToken: string): Promise<any[]> {
    const allLeads: any[] = [];
    let nextUrl: string | null = `${this.baseUrl}/${formId}/leads?access_token=${pageAccessToken}&fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&limit=500`;
    let pageCount = 0;

    try {
      while (nextUrl) {
        pageCount++;
        const response = await axios.get(nextUrl);
        const data = response.data.data || [];
        allLeads.push(...data);
        
        nextUrl = response.data.paging?.next || null;
        
        // Log progress every 10 pages
        if (pageCount % 10 === 0) {
          this.logger.log(`Form ${formId}: Fetched ${allLeads.length} leads (page ${pageCount})`);
        }
        
        // Safety limit at 100,000 to prevent infinite loops
        if (allLeads.length >= 100000) {
          this.logger.warn(`Reached 100000 leads limit for form ${formId}, stopping pagination`);
          break;
        }
      }
      
      this.logger.log(`Fetched total ${allLeads.length} leads from form ${formId}`);
      return allLeads;
    } catch (error) {
      this.logger.error(`Failed to fetch all leads for form ${formId}`, error);
      return allLeads;
    }
  }

  async getLeadsWithFiltering(
    formId: string, 
    pageAccessToken: string, 
    fromDate?: Date
  ): Promise<any[]> {
    const allLeads: any[] = [];
    let nextUrl: string | null = `${this.baseUrl}/${formId}/leads?access_token=${pageAccessToken}&fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&limit=500`;
    
    // If fromDate specified, add filtering parameter
    if (fromDate) {
      const fromTimestamp = Math.floor(fromDate.getTime() / 1000);
      nextUrl += `&filtering=[{"field":"time_created","operator":"GREATER_THAN","value":${fromTimestamp}}]`;
    }

    try {
      while (nextUrl) {
        const response = await axios.get(nextUrl);
        const data = response.data.data || [];
        allLeads.push(...data);
        
        nextUrl = response.data.paging?.next || null;
        
        if (allLeads.length >= 100000) {
          this.logger.warn(`Reached 100000 leads limit for form ${formId}`);
          break;
        }
      }
      
      return allLeads;
    } catch (error) {
      this.logger.error(`Failed to fetch filtered leads for form ${formId}`, error);
      return allLeads;
    }
  }
}
