import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { PhoneLookupService, MatchedLead } from './phone-lookup.service';
import {
  ZohoWebhookDto,
  LeadLookupResult,
  ZohoEventRecord,
  LeadAttributionRecord,
} from './dto/zoho-webhook.dto';

@Injectable()
export class ZohoService {
  private readonly logger = new Logger(ZohoService.name);

  constructor(
    private supabaseService: SupabaseService,
    private phoneLookupService: PhoneLookupService,
  ) {}

  async processWebhookEvent(payload: ZohoWebhookDto): Promise<{
    success: boolean;
    matched: boolean;
    matchedBy?: 'phone' | 'email';
    leadId?: string;
    message: string;
    searchedBy?: { phone?: string; email?: string };
  }> {
    const supabase = this.supabaseService.getClient();

    // Check if at least phone or email is provided
    if (!payload.phone && !payload.email) {
      this.logger.warn(
        `Zoho webhook received without phone or email: ${payload.event_name}`,
      );
      return {
        success: false,
        matched: false,
        message: 'No phone or email provided - cannot search for matching lead',
      };
    }

    const normalizedPhone = payload.phone
      ? this.phoneLookupService.normalizePhone(payload.phone)
      : undefined;
    const normalizedEmail = payload.email
      ? this.phoneLookupService.normalizeEmail(payload.email)
      : undefined;

    this.logger.log(
      `Processing Zoho event: ${payload.event_name} for phone: ${payload.phone || 'N/A'}, email: ${payload.email || 'N/A'}`,
    );

    // Find matching lead by phone first, then email
    const matchedLead = await this.phoneLookupService.findLeadByPhoneOrEmail(
      payload.phone,
      payload.email,
    );
    const matchedBy = matchedLead
      ? payload.phone &&
        (await this.phoneLookupService.findLeadByPhone(payload.phone))
        ? 'phone'
        : 'email'
      : undefined;

    // Save the event
    const eventRecord: ZohoEventRecord = {
      event_type: payload.event_name,
      phone_raw: payload.phone,
      phone_normalized: normalizedPhone,
      email_raw: payload.email,
      email_normalized: normalizedEmail,
      amount: payload.amount,
      zoho_record_id: payload.zoho_id,
      matched_lead_id: matchedLead?.leadDbId,
    };

    const { error: eventError } = await supabase
      .from('zoho_events')
      .insert(eventRecord);

    if (eventError) {
      this.logger.error('Failed to save Zoho event', eventError);
      return {
        success: false,
        matched: false,
        message: `Failed to save event: ${eventError.message}`,
      };
    }

    // If we found a matching lead, update attribution
    if (matchedLead) {
      await this.updateLeadAttribution(
        matchedLead,
        normalizedPhone || normalizedEmail || '',
        payload.event_name,
        payload.amount,
      );

      return {
        success: true,
        matched: true,
        matchedBy,
        leadId: matchedLead.leadDbId,
        message: `Event processed and matched to lead ${matchedLead.leadId} by ${matchedBy}`,
      };
    }

    // No matching lead found - return detailed info for Zoho
    return {
      success: true,
      matched: false,
      message:
        'No matching lead found in Meta ads data pool. This contact may not have originated from a Meta ad campaign.',
      searchedBy: {
        ...(payload.phone && { phone: payload.phone }),
        ...(payload.email && { email: payload.email }),
      },
    };
  }

  private async updateLeadAttribution(
    lead: MatchedLead,
    normalizedPhone: string,
    eventType: string,
    amount?: number,
  ): Promise<void> {
    const supabase = this.supabaseService.getClient();
    const today = new Date().toISOString().split('T')[0];

    // Check if attribution record exists
    const { data: existing } = await supabase
      .from('lead_attribution')
      .select('*')
      .eq('lead_id', lead.leadDbId)
      .single();

    const funnelStage = this.mapEventToFunnelStage(eventType);
    const dateField = this.mapEventToDateField(eventType);

    if (existing) {
      // Update existing record
      const updateData: Partial<LeadAttributionRecord> = {
        funnel_stage: this.getHigherFunnelStage(
          existing.funnel_stage,
          funnelStage,
        ),
      };

      if (dateField) {
        (updateData as any)[dateField] = today;
      }

      if (eventType.includes('offer') && amount) {
        updateData.offer_amount = amount;
        updateData.currency = 'EUR';
      }

      if (eventType.includes('deal') && amount) {
        updateData.deal_amount = amount;
        updateData.currency = 'EUR';
      }

      if (eventType.includes('payment') && amount) {
        updateData.payment_amount = amount;
        updateData.currency = 'EUR';

        // Calculate ROAS if we have spend
        if (
          existing.attributed_spend_usd &&
          existing.attributed_spend_usd > 0
        ) {
          updateData.roas = amount / existing.attributed_spend_usd;
        }
      }

      const { error } = await supabase
        .from('lead_attribution')
        .update(updateData)
        .eq('lead_id', lead.leadDbId);

      if (error) {
        this.logger.error('Failed to update lead attribution', error);
      }
    } else {
      // Calculate attributed spend
      const attributedSpend = await this.calculateAttributedSpend(
        lead.campaignId,
        lead.createdAt,
      );

      // Create new attribution record
      const newAttribution: LeadAttributionRecord = {
        lead_id: lead.leadDbId,
        phone_normalized: normalizedPhone,
        campaign_id: lead.campaignId,
        ad_id: lead.adId,
        ad_set_id: lead.adSetId,
        attributed_spend_usd: attributedSpend,
        funnel_stage: funnelStage,
        lead_date: lead.createdAt.split('T')[0],
        currency: 'EUR',
      };

      if (dateField) {
        (newAttribution as any)[dateField] = today;
      }

      if (eventType.includes('offer') && amount) {
        newAttribution.offer_amount = amount;
      }

      if (eventType.includes('deal') && amount) {
        newAttribution.deal_amount = amount;
      }

      if (eventType.includes('payment') && amount) {
        newAttribution.payment_amount = amount;
        if (attributedSpend > 0) {
          newAttribution.roas = amount / attributedSpend;
        }
      }

      const { error } = await supabase
        .from('lead_attribution')
        .insert(newAttribution);

      if (error) {
        this.logger.error('Failed to create lead attribution', error);
      }
    }
  }

  async calculateAttributedSpend(
    campaignId: string,
    leadDate: string,
  ): Promise<number> {
    if (!campaignId) return 0;

    const supabase = this.supabaseService.getClient();
    const date = leadDate.split('T')[0];

    // Get daily insights for the campaign on the lead date
    const { data: insights } = await supabase
      .from('daily_insights')
      .select('spend_usd, leads_count')
      .eq('campaign_id', campaignId)
      .eq('date', date);

    if (!insights || insights.length === 0) {
      // Fallback: get campaign total spend
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('spend_usd, insights_leads_count')
        .eq('campaign_id', campaignId)
        .single();

      if (campaign && campaign.insights_leads_count > 0) {
        return campaign.spend_usd / campaign.insights_leads_count;
      }
      return 0;
    }

    // Sum up spend and leads for the day
    const totalSpend = insights.reduce(
      (sum, i) => sum + (parseFloat(i.spend_usd) || 0),
      0,
    );
    const totalLeads = insights.reduce(
      (sum, i) => sum + (i.leads_count || 0),
      0,
    );

    if (totalLeads > 0) {
      return totalSpend / totalLeads;
    }

    return totalSpend;
  }

  private mapEventToFunnelStage(eventType: string): string {
    const eventLower = eventType.toLowerCase();
    if (eventLower.includes('payment')) return 'payment';
    if (eventLower.includes('deal')) return 'deal';
    if (eventLower.includes('offer')) return 'offer';
    if (eventLower.includes('contact')) return 'contact';
    return 'lead';
  }

  private mapEventToDateField(eventType: string): string | null {
    const eventLower = eventType.toLowerCase();
    if (eventLower.includes('payment')) return 'payment_date';
    if (eventLower.includes('deal')) return 'deal_date';
    if (eventLower.includes('offer')) return 'offer_date';
    if (eventLower.includes('contact')) return 'contact_date';
    if (eventLower.includes('lead')) return 'lead_date';
    return null;
  }

  private getHigherFunnelStage(current: string, incoming: string): string {
    const stages = ['lead', 'contact', 'offer', 'deal', 'payment'];
    const currentIndex = stages.indexOf(current);
    const incomingIndex = stages.indexOf(incoming);
    return incomingIndex > currentIndex ? incoming : current;
  }

  async lookupByPhone(phone: string): Promise<LeadLookupResult> {
    const matchedLead = await this.phoneLookupService.findLeadByPhone(phone);

    if (!matchedLead) {
      return { found: false };
    }

    const supabase = this.supabaseService.getClient();

    // Get attribution data
    const { data: attribution } = await supabase
      .from('lead_attribution')
      .select('*')
      .eq('lead_id', matchedLead.leadDbId)
      .single();

    // Calculate spend if no attribution exists yet
    let attributedSpend = attribution?.attributed_spend_usd || 0;
    if (!attribution) {
      attributedSpend = await this.calculateAttributedSpend(
        matchedLead.campaignId,
        matchedLead.createdAt,
      );
    }

    const result: LeadLookupResult = {
      found: true,
      lead: {
        id: matchedLead.leadDbId,
        leadId: matchedLead.leadId,
        date: matchedLead.createdAt.split('T')[0],
        campaign: matchedLead.campaignName,
        campaignId: matchedLead.campaignId,
        adSet: matchedLead.adSetName,
        ad: matchedLead.adName,
        form: matchedLead.formName,
      },
      costs: {
        attributedSpend: attributedSpend,
        currency: 'USD',
        costPerLead: attributedSpend,
      },
    };

    if (attribution) {
      result.funnel = {
        currentStage: attribution.funnel_stage,
        stages: {
          lead: attribution.lead_date,
          contact: attribution.contact_date,
          offer: attribution.offer_date,
          deal: attribution.deal_date,
          payment: attribution.payment_date,
        },
        offerAmount: attribution.offer_amount,
        dealAmount: attribution.deal_amount,
        paymentAmount: attribution.payment_amount,
      };

      if (attribution.roas) {
        result.roas = attribution.roas;
      }
    }

    return result;
  }

  async getAttribution(leadId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('lead_attribution')
      .select(
        `
        *,
        leads (
          lead_id,
          form_name,
          ad_name,
          ad_set_name,
          created_at,
          campaigns (name)
        )
      `,
      )
      .eq('lead_id', leadId)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  async getFunnelStats(
    startDate?: string,
    endDate?: string,
  ): Promise<{
    total: number;
    byStage: Record<string, number>;
    conversionRates: Record<string, number>;
    avgSpend: number;
    avgRoas: number;
    totalRevenue: number;
    totalSpend: number;
  }> {
    const supabase = this.supabaseService.getClient();

    let query = supabase.from('lead_attribution').select('*');

    if (startDate) {
      query = query.gte('lead_date', startDate);
    }
    if (endDate) {
      query = query.lte('lead_date', endDate);
    }

    const { data: attributions } = await query;

    if (!attributions || attributions.length === 0) {
      return {
        total: 0,
        byStage: {},
        conversionRates: {},
        avgSpend: 0,
        avgRoas: 0,
        totalRevenue: 0,
        totalSpend: 0,
      };
    }

    const byStage: Record<string, number> = {
      lead: 0,
      contact: 0,
      offer: 0,
      deal: 0,
      payment: 0,
    };

    let totalSpend = 0;
    let totalRevenue = 0;
    let roasSum = 0;
    let roasCount = 0;

    for (const attr of attributions) {
      byStage[attr.funnel_stage] = (byStage[attr.funnel_stage] || 0) + 1;
      totalSpend += parseFloat(attr.attributed_spend_usd) || 0;

      if (attr.payment_amount) {
        totalRevenue += parseFloat(attr.payment_amount) || 0;
      }

      if (attr.roas) {
        roasSum += parseFloat(attr.roas);
        roasCount++;
      }
    }

    const total = attributions.length;
    const conversionRates: Record<string, number> = {};

    if (total > 0) {
      conversionRates['lead_to_contact'] =
        (byStage.contact + byStage.offer + byStage.deal + byStage.payment) /
        total;
      conversionRates['contact_to_deal'] =
        byStage.contact > 0
          ? (byStage.deal + byStage.payment) /
            (byStage.contact + byStage.offer + byStage.deal + byStage.payment)
          : 0;
      conversionRates['deal_to_payment'] =
        byStage.deal > 0
          ? byStage.payment / (byStage.deal + byStage.payment)
          : 0;
    }

    return {
      total,
      byStage,
      conversionRates,
      avgSpend: total > 0 ? totalSpend / total : 0,
      avgRoas: roasCount > 0 ? roasSum / roasCount : 0,
      totalRevenue,
      totalSpend,
    };
  }

  async getAttributionList(
    startDate?: string,
    endDate?: string,
    page: number = 1,
    limit: number = 25,
    offerFilter: 'all' | 'with_offer' | 'without_offer' = 'all',
    sortBy:
      | 'created_at'
      | 'offer_amount'
      | 'deal_amount'
      | 'payment_amount'
      | 'roas' = 'created_at',
    sortDirection: 'asc' | 'desc' = 'desc',
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const supabase = this.supabaseService.getClient();
    const offset = (page - 1) * limit;

    let query = supabase
      .from('lead_attribution')
      .select(
        `
        *,
        leads (
          lead_id,
          form_name,
          ad_name,
          ad_set_name,
          campaign_id,
          created_at
        )
      `,
        { count: 'exact' },
      )
      .order(sortBy, {
        ascending: sortDirection === 'asc',
        nullsFirst:
          sortBy === 'offer_amount' ||
          sortBy === 'deal_amount' ||
          sortBy === 'payment_amount' ||
          sortBy === 'roas'
            ? false
            : undefined,
      })
      .range(offset, offset + limit - 1);

    if (startDate) {
      query = query.gte('lead_date', startDate);
    }
    if (endDate) {
      query = query.lte('lead_date', endDate);
    }

    if (offerFilter === 'with_offer') {
      query = query.not('offer_amount', 'is', null);
    }

    if (offerFilter === 'without_offer') {
      query = query.is('offer_amount', null);
    }

    const { data, error, count } = await query;

    if (error) {
      this.logger.error('Failed to fetch attribution list', error);
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    // Get campaign names for each attribution
    const campaignIds = [
      ...new Set((data || []).map((d) => d.campaign_id).filter(Boolean)),
    ];
    let campaignMap: Record<string, string> = {};

    if (campaignIds.length > 0) {
      const { data: campaigns } = await supabase
        .from('campaigns')
        .select('campaign_id, name')
        .in('campaign_id', campaignIds);

      if (campaigns) {
        campaignMap = campaigns.reduce(
          (acc, c) => {
            acc[c.campaign_id] = c.name;
            return acc;
          },
          {} as Record<string, string>,
        );
      }
    }

    const formattedData = (data || []).map((attr) => ({
      id: attr.id,
      phone: attr.phone_normalized,
      leadId: attr.leads?.lead_id,
      leadDate: attr.lead_date,
      campaignName: campaignMap[attr.campaign_id] || 'Unknown',
      campaignId: attr.campaign_id,
      adName: attr.leads?.ad_name,
      adSetName: attr.leads?.ad_set_name,
      formName: attr.leads?.form_name,
      funnelStage: attr.funnel_stage,
      attributedSpend: parseFloat(attr.attributed_spend_usd) || 0,
      offerAmount: attr.offer_amount ? parseFloat(attr.offer_amount) : null,
      dealAmount: attr.deal_amount ? parseFloat(attr.deal_amount) : null,
      paymentAmount: attr.payment_amount
        ? parseFloat(attr.payment_amount)
        : null,
      roas: attr.roas ? parseFloat(attr.roas) : null,
      contactDate: attr.contact_date,
      offerDate: attr.offer_date,
      dealDate: attr.deal_date,
      paymentDate: attr.payment_date,
      createdAt: attr.created_at,
    }));

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return {
      data: formattedData,
      total,
      page,
      limit,
      totalPages,
    };
  }
}
