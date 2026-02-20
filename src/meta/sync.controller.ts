import { Controller, Post, Logger } from '@nestjs/common';
import { MetaService } from './meta.service';
import { SupabaseService } from '../common/supabase.service';

@Controller('api/meta')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    private metaService: MetaService,
    private supabaseService: SupabaseService,
  ) {}

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

        const campaigns = await this.metaService.getCampaigns(account.account_id);

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

        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        const insights = await this.metaService.getCampaignInsights(
          account.account_id,
          thirtyDaysAgo.toISOString().split('T')[0],
          today.toISOString().split('T')[0],
        );

        for (const insight of insights) {
          await supabase
            .from('campaigns')
            .update({
              spend_usd: parseFloat(insight.spend || '0'),
            })
            .eq('campaign_id', insight.campaign_id);
        }
      }

      await supabase.from('sync_logs').insert({
        type: 'spend',
        status: 'success',
      });

      await supabase.from('sync_logs').insert({
        type: 'leads',
        status: 'success',
      });

      return { success: true, message: 'Sync completed successfully' };
    } catch (error) {
      this.logger.error('Sync failed', error);

      await supabase.from('sync_logs').insert({
        type: 'sync',
        status: 'error',
        error_message: error.message,
      });

      throw error;
    }
  }

  @Post('sync/leads')
  async syncLeads() {
    const supabase = this.supabaseService.getClient();

    try {
      const { data: accounts } = await supabase.from('ad_accounts').select('*');

      for (const account of accounts || []) {
        try {
          const forms = await this.metaService.getLeadGenForms(account.page_id);

          for (const form of forms) {
            const leads = await this.metaService.getLeads(form.id);

            for (const lead of leads) {
              const { data: existingLead } = await supabase
                .from('leads')
                .select('id')
                .eq('lead_id', lead.id)
                .single();

              if (!existingLead) {
                const { data: insertedLead } = await supabase
                  .from('leads')
                  .insert({
                    lead_id: lead.id,
                    form_id: lead.form_id,
                    form_name: form.name,
                    ad_id: lead.ad_id,
                    ad_name: lead.ad_name,
                    ad_set_id: lead.adset_id,
                    ad_set_name: lead.adset_name,
                    ad_account_id: account.id,
                    source: 'sync',
                    created_at: lead.created_time,
                  })
                  .select()
                  .single();

                if (insertedLead && lead.field_data) {
                  for (const field of lead.field_data) {
                    await supabase.from('lead_field_data').insert({
                      lead_id: insertedLead.id,
                      field_name: field.name,
                      field_value: field.values?.[0] || '',
                    });
                  }
                }
              }
            }
          }
        } catch (error) {
          this.logger.error(`Failed to sync leads for account ${account.account_id}`, error);
        }
      }

      await supabase.from('sync_logs').insert({
        type: 'leads',
        status: 'success',
      });

      return { success: true, message: 'Leads sync completed' };
    } catch (error) {
      this.logger.error('Leads sync failed', error);
      throw error;
    }
  }
}
