import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getLeads(
    startDate: string,
    endDate: string,
    accountId?: string,
    campaignId?: string,
    formName?: string,
    search?: string,
    page = 1,
    limit = 50,
  ) {
    const supabase = this.supabaseService.getClient();
    const offset = (page - 1) * limit;

    let query = supabase
      .from('leads')
      .select(`
        *,
        ad_accounts (account_name),
        campaigns (name)
      `, { count: 'exact' })
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (accountId) {
      query = query.eq('ad_account_id', accountId);
    }

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    if (formName) {
      query = query.ilike('form_name', `%${formName}%`);
    }

    if (search) {
      query = query.or(`lead_id.ilike.%${search}%,form_name.ilike.%${search}%`);
    }

    const { data, count, error } = await query;

    if (error) {
      this.logger.error('Failed to fetch leads', error);
      throw error;
    }

    return {
      data: (data || []).map((lead) => ({
        id: lead.id,
        leadId: lead.lead_id,
        createdAt: lead.created_at,
        adAccountName: lead.ad_accounts?.account_name || '',
        campaignId: lead.campaign_id,
        campaignName: lead.campaigns?.name || '',
        adSetName: lead.ad_set_name || '',
        adName: lead.ad_name || '',
        formName: lead.form_name || '',
        source: lead.source || '',
      })),
      total: count || 0,
      page,
      limit,
    };
  }

  async getLeadDetails(id: string) {
    const supabase = this.supabaseService.getClient();

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(`
        *,
        ad_accounts (account_name),
        campaigns (name)
      `)
      .eq('id', id)
      .single();

    if (leadError || !lead) {
      throw new NotFoundException('Lead not found');
    }

    const { data: fieldData } = await supabase
      .from('lead_field_data')
      .select('*')
      .eq('lead_id', id);

    return {
      id: lead.id,
      leadId: lead.lead_id,
      createdAt: lead.created_at,
      adAccountName: lead.ad_accounts?.account_name || '',
      campaignId: lead.campaign_id,
      campaignName: lead.campaigns?.name || '',
      adSetName: lead.ad_set_name || '',
      adName: lead.ad_name || '',
      formName: lead.form_name || '',
      source: lead.source || '',
      fieldData: (fieldData || []).map((f) => ({
        name: f.field_name,
        values: [f.field_value],
      })),
    };
  }

  async syncLead(id: string) {
    this.logger.log(`Syncing lead ${id}`);
    return { success: true };
  }
}
