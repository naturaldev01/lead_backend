import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { FieldMappingsService } from '../field-mappings/field-mappings.service';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private fieldMappingsService: FieldMappingsService,
  ) {}

  async getLeads(
    startDate: string,
    endDate: string,
    accountId?: string,
    campaignId?: string,
    formName?: string,
    search?: string,
    page = 1,
    limit = 50,
    includeFieldData = false,
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

    const leads = data || [];

    let fieldDataMap: Record<string, Array<{ name: string; mappedName: string | null; values: string[] }>> = {};

    if (includeFieldData && leads.length > 0) {
      const leadIds = leads.map((l) => l.id);
      
      // Batch lead IDs to avoid URL length limits (Supabase has ~16KB header limit)
      // Each UUID is 36 chars, with encoding ~50 chars per ID. Safe batch size is ~100 IDs
      const idBatchSize = 50;
      let allFieldData: any[] = [];
      
      for (let i = 0; i < leadIds.length; i += idBatchSize) {
        const batchIds = leadIds.slice(i, i + idBatchSize);
        
        // Fetch field data for this batch of lead IDs
        let fdOffset = 0;
        const rowBatchSize = 1000;
        
        while (true) {
          const { data: fieldData, error: fdError } = await supabase
            .from('lead_field_data')
            .select('*')
            .in('lead_id', batchIds)
            .range(fdOffset, fdOffset + rowBatchSize - 1);
          
          if (fdError) {
            this.logger.error('Failed to fetch field data', fdError);
            break;
          }
          
          if (!fieldData || fieldData.length === 0) break;
          
          allFieldData = allFieldData.concat(fieldData);
          
          if (fieldData.length < rowBatchSize) break;
          fdOffset += rowBatchSize;
        }
      }
      
      this.logger.debug(`Fetched ${allFieldData.length} field data entries for ${leadIds.length} leads`);

      for (const fd of allFieldData) {
        if (!fieldDataMap[fd.lead_id]) {
          fieldDataMap[fd.lead_id] = [];
        }
        // Apply mapping at runtime if not already mapped in DB
        let mappedName = fd.mapped_field_name;
        if (!mappedName) {
          mappedName = await this.fieldMappingsService.getMappedFieldName(fd.field_name);
        }
        fieldDataMap[fd.lead_id].push({
          name: fd.field_name,
          mappedName: mappedName || null,
          values: [fd.field_value],
        });
      }
      
      // Log leads without field data for debugging
      const leadsWithoutData = leadIds.filter(id => !fieldDataMap[id] || fieldDataMap[id].length === 0);
      if (leadsWithoutData.length > 0) {
        this.logger.debug(`Leads without field data: ${leadsWithoutData.length}`);
      }
    }

    return {
      data: leads.map((lead) => ({
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
        ...(includeFieldData && { fieldData: fieldDataMap[lead.id] || [] }),
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

    // Apply mapping at runtime for fields without mapped_field_name
    const mappedFieldData = await Promise.all(
      (fieldData || []).map(async (f) => {
        let mappedName = f.mapped_field_name;
        if (!mappedName) {
          mappedName = await this.fieldMappingsService.getMappedFieldName(f.field_name);
        }
        return {
          name: f.field_name,
          mappedName: mappedName || null,
          values: [f.field_value],
        };
      })
    );

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
      fieldData: mappedFieldData,
    };
  }

  async syncLead(id: string) {
    this.logger.log(`Syncing lead ${id}`);
    return { success: true };
  }
}
