import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ZohoService } from './zoho.service';
import { ZohoWebhookDto } from './dto/zoho-webhook.dto';

@Controller('api/zoho')
export class ZohoController {
  private readonly logger = new Logger(ZohoController.name);

  constructor(private readonly zohoService: ZohoService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() payload: ZohoWebhookDto) {
    this.logger.log(`Received Zoho webhook: ${payload.event_name}`);

    try {
      const result = await this.zohoService.processWebhookEvent(payload);
      return result;
    } catch (error) {
      this.logger.error('Webhook processing failed', error);
      return {
        success: false,
        message: (error as Error).message,
      };
    }
  }

  @Get('lookup')
  async lookupByPhone(@Query('phone') phone: string) {
    if (!phone) {
      return { error: 'Phone number is required' };
    }

    this.logger.log(`Looking up phone: ${phone}`);
    return this.zohoService.lookupByPhone(phone);
  }

  @Get('attribution/:leadId')
  async getAttribution(@Param('leadId') leadId: string) {
    const attribution = await this.zohoService.getAttribution(leadId);

    if (!attribution) {
      return { found: false };
    }

    return { found: true, attribution };
  }

  @Get('funnel-stats')
  async getFunnelStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.zohoService.getFunnelStats(startDate, endDate);
  }

  @Get('attributions')
  async getAttributionList(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offerFilter') offerFilter?: 'all' | 'with_offer' | 'without_offer',
    @Query('sortBy')
    sortBy?: 'created_at' | 'offer_amount' | 'deal_amount' | 'payment_amount' | 'roas',
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    return this.zohoService.getAttributionList(
      startDate,
      endDate,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 25,
      offerFilter,
      sortBy,
      sortDirection,
    );
  }

  @Get('cost/:phone')
  async getCostByPhone(@Param('phone') phone: string) {
    const result = await this.zohoService.lookupByPhone(
      decodeURIComponent(phone),
    );

    if (!result.found) {
      return {
        found: false,
        message: 'No lead found for this phone number',
      };
    }

    return {
      found: true,
      phone,
      campaign: result.lead?.campaign,
      ad: result.lead?.ad,
      leadDate: result.lead?.date,
      attributedSpend: result.costs?.attributedSpend,
      currency: result.costs?.currency,
      funnelStage: result.funnel?.currentStage || 'lead',
      offerAmount: result.funnel?.offerAmount,
      dealAmount: result.funnel?.dealAmount,
      paymentAmount: result.funnel?.paymentAmount,
      roas: result.roas,
    };
  }
}
