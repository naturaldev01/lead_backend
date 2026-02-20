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
    try {
      const response = await axios.get(
        `${this.baseUrl}/act_${adAccountId}/campaigns`,
        {
          params: {
            access_token: this.accessToken,
            fields: 'id,name,objective,status,created_time',
          },
        },
      );
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Failed to fetch campaigns for account ${adAccountId}`, error);
      throw error;
    }
  }

  async getCampaignInsights(
    adAccountId: string,
    startDate: string,
    endDate: string,
  ): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/act_${adAccountId}/insights`,
        {
          params: {
            access_token: this.accessToken,
            level: 'campaign',
            fields: 'campaign_id,campaign_name,spend,actions',
            time_range: JSON.stringify({
              since: startDate,
              until: endDate,
            }),
          },
        },
      );
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Failed to fetch insights for account ${adAccountId}`, error);
      throw error;
    }
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
}
