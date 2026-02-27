import { Controller, Get, Post, Query, Body, Logger, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../common/supabase.service';
import { MetaService } from './meta.service';
import { FieldMappingsService } from '../field-mappings/field-mappings.service';
import type { Request } from 'express';
import * as crypto from 'crypto';

interface LeadgenEventData {
  leadgen_id: string;
  form_id: string;
  page_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  ad_account_id?: string;
  created_time: number;
}

interface LeadData {
  id: string;
  field_data?: Array<{ name: string; values?: string[] }>;
}

@Controller('api/webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private metaService: MetaService,
    private fieldMappingsService: FieldMappingsService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const verifyToken = this.configService.get<string>('META_WEBHOOK_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }

    this.logger.warn('Webhook verification failed');
    return 'Verification failed';
  }

  @Post()
  async handleWebhook(
    @Body() body: any,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const signature = req.headers['x-hub-signature-256'] as string;
    
    if (signature && !this.verifySignature(req.rawBody, signature)) {
      this.logger.warn('Invalid webhook signature');
      return { success: false, error: 'Invalid signature' };
    }

    this.logger.log('Received webhook:', JSON.stringify(body));

    try {
      if (body.object === 'page' || body.object === 'ad_account') {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field === 'leadgen') {
              await this.processLeadgenEvent(change.value as LeadgenEventData);
            }
          }
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error('Error processing webhook', error);
      return { success: false, error: (error as Error).message };
    }
  }

  private verifySignature(rawBody: Buffer | undefined, signature: string): boolean {
    if (!rawBody) return false;
    
    const appSecret = this.configService.get<string>('META_APP_SECRET');
    if (!appSecret) return true;

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );
  }

  private async processLeadgenEvent(leadData: LeadgenEventData) {
    this.logger.log('Processing leadgen event:', JSON.stringify(leadData));

    const supabase = this.supabaseService.getClient();

    try {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('lead_id', leadData.leadgen_id)
        .single();

      if (existingLead) {
        this.logger.log(`Lead ${leadData.leadgen_id} already exists, skipping`);
        return;
      }

      let fullLeadData: LeadData | null = null;
      try {
        const leads = await this.metaService.getLeads(leadData.form_id);
        fullLeadData = leads.find((l: LeadData) => l.id === leadData.leadgen_id) || null;
      } catch (error) {
        this.logger.warn('Could not fetch full lead data from Meta API', error);
      }

      const accountId = leadData.ad_account_id || leadData.adgroup_id?.split('_')[0];
      const { data: adAccount } = await supabase
        .from('ad_accounts')
        .select('id')
        .eq('account_id', accountId || '')
        .single();

      const { data: insertedLead, error } = await supabase
        .from('leads')
        .insert({
          lead_id: leadData.leadgen_id,
          form_id: leadData.form_id,
          page_id: leadData.page_id,
          ad_id: leadData.ad_id,
          ad_set_id: leadData.adgroup_id,
          ad_account_id: adAccount?.id,
          source: 'webhook',
          created_at: new Date(leadData.created_time * 1000).toISOString(),
        })
        .select()
        .single();

      if (error) {
        this.logger.error('Failed to insert lead:', error);
        return;
      }

      if (fullLeadData?.field_data && insertedLead) {
        for (const field of fullLeadData.field_data) {
          const mappedFieldName = await this.fieldMappingsService.getMappedFieldName(field.name);
          await supabase.from('lead_field_data').insert({
            lead_id: insertedLead.id,
            field_name: field.name,
            mapped_field_name: mappedFieldName,
            field_value: field.values?.[0] || '',
          });
        }
      }

      this.logger.log(`Lead ${leadData.leadgen_id} inserted successfully via webhook`);

      await supabase.from('sync_logs').insert({
        type: 'webhook',
        status: 'success',
      });
    } catch (error) {
      this.logger.error('Error processing leadgen event:', error);

      await supabase.from('sync_logs').insert({
        type: 'webhook',
        status: 'error',
        error_message: (error as Error).message,
      });
    }
  }
}
