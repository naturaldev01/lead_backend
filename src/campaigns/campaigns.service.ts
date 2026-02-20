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
    startDate: string,
    endDate: string,
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
      .gte('created_at', startDate)
      .lte('created_at', endDate)
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

        const campaigns = await this.metaService.getCampaigns(account.account_id);

        for (const campaign of campaigns) {
          await supabase.from('campaigns').upsert({
            campaign_id: campaign.id,
            name: campaign.name,
            type: campaign.objective,
            ad_account_id: account.account_id,
          }, { onConflict: 'campaign_id' });
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
