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
      .select(
        `
        *,
        ad_accounts (account_name),
        campaigns (name)
      `,
        { count: 'exact' },
      )
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

    const fieldDataMap: Record<
      string,
      Array<{ name: string; mappedName: string | null; values: string[] }>
    > = {};

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

      this.logger.debug(
        `Fetched ${allFieldData.length} field data entries for ${leadIds.length} leads`,
      );

      for (const fd of allFieldData) {
        if (!fieldDataMap[fd.lead_id]) {
          fieldDataMap[fd.lead_id] = [];
        }
        // Apply mapping at runtime if not already mapped in DB
        let mappedName = fd.mapped_field_name;
        if (!mappedName) {
          mappedName = await this.fieldMappingsService.getMappedFieldName(
            fd.field_name,
          );
        }
        fieldDataMap[fd.lead_id].push({
          name: fd.field_name,
          mappedName: mappedName || null,
          values: [fd.field_value],
        });
      }

      // Log leads without field data for debugging
      const leadsWithoutData = leadIds.filter(
        (id) => !fieldDataMap[id] || fieldDataMap[id].length === 0,
      );
      if (leadsWithoutData.length > 0) {
        this.logger.debug(
          `Leads without field data: ${leadsWithoutData.length}`,
        );
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

  async getLeadProfiles(search?: string, page = 1, limit = 50) {
    return this.getLeadProfilesWithFilters({ search, page, limit });
  }

  private buildLeadProfilesQuery(params: {
    search?: string;
    country?: string;
    source?: string;
    status?: string;
  }) {
    const supabase = this.supabaseService.getClient();

    let query = supabase.from('lead_profiles').select('*', { count: 'exact' });

    if (params.search) {
      query = query.or(
        [
          `meta_lead_id.ilike.%${params.search}%`,
          `form_name.ilike.%${params.search}%`,
          `full_name.ilike.%${params.search}%`,
          `first_name.ilike.%${params.search}%`,
          `last_name.ilike.%${params.search}%`,
          `email.ilike.%${params.search}%`,
          `phone.ilike.%${params.search}%`,
          `city.ilike.%${params.search}%`,
          `country.ilike.%${params.search}%`,
          `source.ilike.%${params.search}%`,
          `status.ilike.%${params.search}%`,
        ].join(','),
      );
    }

    if (params.country) {
      query = query.eq('country', params.country);
    }

    if (params.source) {
      query = query.eq('source', params.source);
    }

    if (params.status) {
      query = query.eq('status', params.status);
    }

    return query;
  }

  private mapLeadProfile(profile: any) {
    return {
      leadUuid: profile.lead_uuid,
      metaLeadId: profile.meta_lead_id,
      adAccountId: profile.ad_account_id,
      campaignId: profile.campaign_id,
      source: profile.source || '',
      formName: profile.form_name || '',
      fullName:
        profile.full_name ||
        [profile.first_name, profile.last_name].filter(Boolean).join(' '),
      firstName: profile.first_name || '',
      lastName: profile.last_name || '',
      email: profile.email || '',
      phone: profile.phone || '',
      city: profile.city || '',
      country: profile.country || '',
      status: profile.status || '',
      dealAmount: profile.deal_amount,
      offerAmount: profile.offer_amount,
      paymentAmount: profile.payment_amount,
      comments: profile.comments || '',
      dateOfBirth: profile.date_of_birth,
      createdTime: profile.created_time,
      insertedAt: profile.inserted_at,
      updatedAt: profile.updated_at,
    };
  }

  async getLeadProfilesWithFilters(params: {
    search?: string;
    country?: string;
    source?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const supabase = this.supabaseService.getClient();
    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;

    const query = this.buildLeadProfilesQuery(params)
      .order('created_time', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      this.logger.error('Failed to fetch lead profiles', error);
      throw error;
    }

    return {
      data: (data || []).map((profile) => this.mapLeadProfile(profile)),
      total: count || 0,
      page,
      limit,
    };
  }

  async getLeadProfilesFilterOptions() {
    const supabase = this.supabaseService.getClient();
    
    // Use parallel DISTINCT queries instead of scanning entire table
    // Wrap RPC calls in Promises to handle errors properly
    const safeRpc = async (fnName: string) => {
      try {
        return await supabase.rpc(fnName);
      } catch {
        return { data: null };
      }
    };

    const [countriesResult, sourcesResult, statusesResult] = await Promise.all([
      safeRpc('get_distinct_countries'),
      safeRpc('get_distinct_sources'),
      safeRpc('get_distinct_statuses'),
    ]);

    // If RPC functions exist, use their results
    if (countriesResult.data && sourcesResult.data && statusesResult.data) {
      return {
        countries: (countriesResult.data as string[]).filter(Boolean).sort(),
        sources: (sourcesResult.data as string[]).filter(Boolean).sort(),
        statuses: (statusesResult.data as string[]).filter(Boolean).sort(),
      };
    }

    // Fallback: fetch distinct values using standard queries with limit
    // This is faster than scanning all rows for unique values
    const [countriesData, sourcesData, statusesData] = await Promise.all([
      supabase.from('lead_profiles').select('country').limit(5000),
      supabase.from('lead_profiles').select('source').limit(5000),
      supabase.from('lead_profiles').select('status').limit(5000),
    ]);

    const countries = new Set<string>();
    const sources = new Set<string>();
    const statuses = new Set<string>();

    for (const row of countriesData.data || []) {
      if (row.country?.trim()) countries.add(row.country.trim());
    }
    for (const row of sourcesData.data || []) {
      if (row.source?.trim()) sources.add(row.source.trim());
    }
    for (const row of statusesData.data || []) {
      if (row.status?.trim()) statuses.add(row.status.trim());
    }

    return {
      countries: Array.from(countries).sort(),
      sources: Array.from(sources).sort(),
      statuses: Array.from(statuses).sort(),
    };
  }

  async exportLeadProfilesCsv(params: {
    search?: string;
    country?: string;
    source?: string;
    status?: string;
  }) {
    const batchSize = 1000;
    let offset = 0;
    const rows: string[] = [];
    const headers = [
      'lead_uuid',
      'meta_lead_id',
      'created_time',
      'inserted_at',
      'updated_at',
      'ad_account_id',
      'campaign_id',
      'source',
      'form_name',
      'full_name',
      'first_name',
      'last_name',
      'email',
      'phone',
      'city',
      'country',
      'status',
      'deal_amount',
      'offer_amount',
      'payment_amount',
      'date_of_birth',
      'comments',
    ];

    rows.push(headers.join(','));

    while (true) {
      const { data, error } = await this.buildLeadProfilesQuery(params)
        .order('created_time', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (error) {
        this.logger.error('Failed to export lead profiles CSV', error);
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const profile of data) {
        const csvRow = [
          profile.lead_uuid,
          profile.meta_lead_id,
          profile.created_time,
          profile.inserted_at,
          profile.updated_at,
          profile.ad_account_id,
          profile.campaign_id,
          profile.source,
          profile.form_name,
          profile.full_name,
          profile.first_name,
          profile.last_name,
          profile.email,
          profile.phone,
          profile.city,
          profile.country,
          profile.status,
          profile.deal_amount,
          profile.offer_amount,
          profile.payment_amount,
          profile.date_of_birth,
          profile.comments,
        ].map((value) => this.escapeCsvValue(value));

        rows.push(csvRow.join(','));
      }

      if (data.length < batchSize) {
        break;
      }

      offset += batchSize;
    }

    return rows.join('\n');
  }

  private escapeCsvValue(value: unknown) {
    if (value === null || value === undefined) {
      return '';
    }

    const stringValue = String(value);
    if (/[",\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
  }

  async getLeadDetails(id: string) {
    const supabase = this.supabaseService.getClient();

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(
        `
        *,
        ad_accounts (account_name),
        campaigns (name)
      `,
      )
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
          mappedName = await this.fieldMappingsService.getMappedFieldName(
            f.field_name,
          );
        }
        return {
          name: f.field_name,
          mappedName: mappedName || null,
          values: [f.field_value],
        };
      }),
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
