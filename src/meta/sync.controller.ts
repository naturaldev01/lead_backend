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
    let totalLeadsInserted = 0;

    try {
      const pages = await this.metaService.getPages();
      this.logger.log(`Found ${pages.length} pages to sync leads from`);

      for (const page of pages) {
        try {
          this.logger.log(`Syncing leads from page: ${page.name} (${page.id})`);
          const forms = await this.metaService.getLeadGenFormsWithPageToken(page.id, page.access_token);
          this.logger.log(`Found ${forms.length} forms for page ${page.name}`);

          for (const form of forms) {
            if (!form.leads_count || form.leads_count === 0) continue;

            const leads = await this.metaService.getLeadsWithPageToken(form.id, page.access_token, 100);
            this.logger.log(`Fetched ${leads.length} leads from form ${form.name}`);

            for (const lead of leads) {
              const { data: existingLead } = await supabase
                .from('leads')
                .select('id')
                .eq('lead_id', lead.id)
                .maybeSingle();

              if (!existingLead) {
                const { data: insertedLead, error: insertError } = await supabase
                  .from('leads')
                  .insert({
                    lead_id: lead.id,
                    form_name: form.name,
                    ad_name: lead.ad_name || null,
                    ad_set_name: lead.adset_name || null,
                    campaign_id: lead.campaign_id || null,
                    source: 'sync',
                    created_at: lead.created_time,
                  })
                  .select()
                  .single();

                if (insertError) {
                  this.logger.error(`Failed to insert lead ${lead.id}`, insertError);
                  continue;
                }

                if (insertedLead && lead.field_data) {
                  for (const field of lead.field_data) {
                    await supabase.from('lead_field_data').insert({
                      lead_id: insertedLead.id,
                      field_name: field.name,
                      field_value: field.values?.[0] || '',
                    });
                  }
                }
                totalLeadsInserted++;
              }
            }
          }
        } catch (error) {
          this.logger.error(`Failed to sync leads for page ${page.name}`, error);
        }
      }

      await supabase.from('sync_logs').insert({
        type: 'leads',
        status: 'success',
      });

      this.logger.log(`Leads sync completed. Inserted ${totalLeadsInserted} new leads.`);
      return { success: true, message: `Leads sync completed. Inserted ${totalLeadsInserted} new leads.` };
    } catch (error) {
      this.logger.error('Leads sync failed', error);
      throw error;
    }
  }
}
