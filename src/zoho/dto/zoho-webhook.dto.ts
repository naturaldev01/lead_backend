import { IsString, IsOptional, IsNumber } from 'class-validator';

export class ZohoWebhookDto {
  @IsString()
  event_name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  zoho_id?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  event_date?: string; // Gerçek event tarihi (YYYY-MM-DD formatında)
}

export class PhoneLookupQueryDto {
  @IsString()
  phone: string;
}

export interface LeadLookupResult {
  found: boolean;
  lead?: {
    id: string;
    leadId: string;
    date: string;
    campaign: string;
    campaignId: string;
    adSet: string;
    ad: string;
    form: string;
  };
  costs?: {
    attributedSpend: number;
    currency: string;
    costPerLead: number;
  };
  funnel?: {
    currentStage: string;
    stages: {
      lead?: string;
      contact?: string;
      offer?: string;
      deal?: string;
      payment?: string;
    };
    offerAmount?: number;
    dealAmount?: number;
    paymentAmount?: number;
  };
  roas?: number;
}

export interface ZohoEventRecord {
  id?: string;
  event_type: string;
  phone_raw?: string;
  phone_normalized?: string;
  email_raw?: string;
  email_normalized?: string;
  amount?: number;
  zoho_record_id?: string;
  matched_lead_id?: string;
}

export interface LeadAttributionRecord {
  id?: string;
  lead_id: string;
  phone_normalized: string;
  campaign_id?: string;
  ad_id?: string;
  ad_set_id?: string;
  attributed_spend_usd?: number;
  funnel_stage: string;
  offer_amount?: number;
  deal_amount?: number;
  payment_amount?: number;
  currency?: string;
  roas?: number;
  lead_date?: string;
  contact_date?: string;
  offer_date?: string;
  deal_date?: string;
  payment_date?: string;
}
