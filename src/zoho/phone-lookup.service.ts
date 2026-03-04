import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

export interface MatchedLead {
  leadId: string;
  leadDbId: string;
  campaignId: string;
  adId: string;
  adSetId: string;
  adName: string;
  adSetName: string;
  campaignName: string;
  formName: string;
  createdAt: string;
}

@Injectable()
export class PhoneLookupService {
  private readonly logger = new Logger(PhoneLookupService.name);

  constructor(private supabaseService: SupabaseService) {}

  normalizePhone(phone: string): string {
    if (!phone) return '';

    let normalized = phone.trim();
    
    // Remove all non-digit characters except leading +
    normalized = normalized.replace(/[^\d+]/g, '');
    
    // Remove leading +
    normalized = normalized.replace(/^\+/, '');
    
    // Handle Turkish numbers starting with 0
    if (normalized.startsWith('0') && normalized.length === 11) {
      normalized = '90' + normalized.slice(1);
    }
    
    // Handle numbers without country code (assume TR)
    if (normalized.length === 10 && !normalized.startsWith('90')) {
      normalized = '90' + normalized;
    }

    return normalized;
  }

  generatePhoneVariants(phone: string): string[] {
    const normalized = this.normalizePhone(phone);
    if (!normalized) return [];

    const variants: string[] = [
      normalized,
      phone.trim(),
    ];

    // Add variant with + prefix
    variants.push('+' + normalized);

    // If starts with country code, add without it
    if (normalized.startsWith('90') && normalized.length === 12) {
      variants.push('0' + normalized.slice(2));
      variants.push(normalized.slice(2));
    }

    // Add formatted versions
    if (normalized.length === 12 && normalized.startsWith('90')) {
      const areaCode = normalized.slice(2, 5);
      const part1 = normalized.slice(5, 8);
      const part2 = normalized.slice(8, 10);
      const part3 = normalized.slice(10, 12);
      
      variants.push(`+90 ${areaCode} ${part1} ${part2} ${part3}`);
      variants.push(`0${areaCode} ${part1} ${part2} ${part3}`);
      variants.push(`${areaCode}${part1}${part2}${part3}`);
    }

    return [...new Set(variants)];
  }

  async findLeadByPhone(phone: string): Promise<MatchedLead | null> {
    const supabase = this.supabaseService.getClient();
    const normalized = this.normalizePhone(phone);
    const variants = this.generatePhoneVariants(phone);

    this.logger.debug(`Searching for phone: ${phone}, normalized: ${normalized}`);
    this.logger.debug(`Phone variants: ${variants.join(', ')}`);

    // Search in lead_field_data for phone fields
    const { data: fieldMatches, error: fieldError } = await supabase
      .from('lead_field_data')
      .select('lead_id')
      .or(`mapped_field_name.eq.phone,field_name.ilike.%phone%,field_name.ilike.%tel%,field_name.ilike.%mobile%`)
      .or(variants.map(v => `field_value.ilike.%${v}%`).join(','));

    if (fieldError) {
      this.logger.error('Error searching lead_field_data', fieldError);
      return null;
    }

    if (!fieldMatches || fieldMatches.length === 0) {
      this.logger.debug('No matching leads found for phone');
      return null;
    }

    const leadIds = [...new Set(fieldMatches.map(f => f.lead_id))];
    this.logger.debug(`Found ${leadIds.length} potential lead matches`);

    // Get lead details
    const { data: leads, error: leadError } = await supabase
      .from('leads')
      .select(`
        id,
        lead_id,
        campaign_id,
        ad_name,
        ad_set_name,
        form_name,
        created_at,
        campaigns (id, name)
      `)
      .in('id', leadIds)
      .order('created_at', { ascending: false })
      .limit(1);

    if (leadError || !leads || leads.length === 0) {
      this.logger.debug('Could not fetch lead details');
      return null;
    }

    const lead = leads[0] as any;

    return {
      leadId: lead.lead_id,
      leadDbId: lead.id,
      campaignId: lead.campaign_id || '',
      adId: '',
      adSetId: '',
      adName: lead.ad_name || '',
      adSetName: lead.ad_set_name || '',
      campaignName: lead.campaigns?.name || '',
      formName: lead.form_name || '',
      createdAt: lead.created_at,
    };
  }

  async findLeadsByPhoneBatch(phones: string[]): Promise<Map<string, MatchedLead>> {
    const results = new Map<string, MatchedLead>();
    
    for (const phone of phones) {
      const match = await this.findLeadByPhone(phone);
      if (match) {
        results.set(this.normalizePhone(phone), match);
      }
    }

    return results;
  }

  normalizeEmail(email: string): string {
    if (!email) return '';
    return email.trim().toLowerCase();
  }

  async findLeadByEmail(email: string): Promise<MatchedLead | null> {
    const supabase = this.supabaseService.getClient();
    const normalized = this.normalizeEmail(email);

    if (!normalized) return null;

    this.logger.debug(`Searching for email: ${email}, normalized: ${normalized}`);

    // Search in lead_field_data for email fields
    const { data: fieldMatches, error: fieldError } = await supabase
      .from('lead_field_data')
      .select('lead_id')
      .or(`mapped_field_name.eq.email,field_name.ilike.%email%,field_name.ilike.%mail%`)
      .ilike('field_value', normalized);

    if (fieldError) {
      this.logger.error('Error searching lead_field_data for email', fieldError);
      return null;
    }

    if (!fieldMatches || fieldMatches.length === 0) {
      this.logger.debug('No matching leads found for email');
      return null;
    }

    const leadIds = [...new Set(fieldMatches.map(f => f.lead_id))];
    this.logger.debug(`Found ${leadIds.length} potential lead matches for email`);

    // Get lead details
    const { data: leads, error: leadError } = await supabase
      .from('leads')
      .select(`
        id,
        lead_id,
        campaign_id,
        ad_name,
        ad_set_name,
        form_name,
        created_at,
        campaigns (id, name)
      `)
      .in('id', leadIds)
      .order('created_at', { ascending: false })
      .limit(1);

    if (leadError || !leads || leads.length === 0) {
      this.logger.debug('Could not fetch lead details for email');
      return null;
    }

    const lead = leads[0] as any;

    return {
      leadId: lead.lead_id,
      leadDbId: lead.id,
      campaignId: lead.campaign_id || '',
      adId: '',
      adSetId: '',
      adName: lead.ad_name || '',
      adSetName: lead.ad_set_name || '',
      campaignName: lead.campaigns?.name || '',
      formName: lead.form_name || '',
      createdAt: lead.created_at,
    };
  }

  async findLeadByPhoneOrEmail(phone?: string, email?: string): Promise<MatchedLead | null> {
    // Try phone first
    if (phone) {
      const phoneMatch = await this.findLeadByPhone(phone);
      if (phoneMatch) {
        this.logger.debug(`Found lead by phone: ${phone}`);
        return phoneMatch;
      }
    }

    // If phone didn't match, try email
    if (email) {
      const emailMatch = await this.findLeadByEmail(email);
      if (emailMatch) {
        this.logger.debug(`Found lead by email: ${email}`);
        return emailMatch;
      }
    }

    this.logger.debug('No matching lead found by phone or email');
    return null;
  }
}
